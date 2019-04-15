/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "wsinstance.h"

#include <assert.h>
#include <err.h>
#include <stdarg.h>
#include <stddef.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>

#include <gnutls/x509.h>

#include "common/cockpitmemory.h"

#include "utils.h"

/* This is a bit lame, but having a hard limit on peer certificates is
 * desirable: Let's not get DoSed by huge certs */
#define MAX_PEER_CERT_SIZE 100000

__attribute__((__format__ (__printf__, 3, 4)))
static void
snprintf_checked (char *str,
                  size_t size,
                  const char *fmt, ...)
{
  va_list args;
  int r;

  va_start (args, fmt);
  r = vsnprintf (str, size, fmt, args);
  va_end (args);

  if (r >= size)
    {
      fprintf (stderr, "snprintf_checked got a too small buffer of %zu bytes but tried to print %i\n", size, r);
      abort ();
    }
}


/**
 * ws_init_peer_cert: Retrieve and publish information about the client-side TLS certificate
 */
static void
ws_init_peer_cert (WsInstance *ws, const gnutls_datum_t *der)
{
  gnutls_x509_crt_t cert;
  static char cert_pem[MAX_PEER_CERT_SIZE];
  size_t cert_pem_size = sizeof (cert_pem);

  assert (der);

  /* clone DER certificate */
  ws->peer_cert.size = der->size;
  ws->peer_cert.data = mallocx (der->size);
  memcpy (ws->peer_cert.data, der->data, der->size);

  /* convert to X.509 to extract information and PEM */
  gnutls_check (gnutls_x509_crt_init (&cert));
  gnutls_check (gnutls_x509_crt_import (cert, der, GNUTLS_X509_FMT_DER));
  gnutls_check (gnutls_x509_crt_print (cert, GNUTLS_CRT_PRINT_ONELINE, &ws->peer_cert_info));
  gnutls_check (gnutls_x509_crt_export (cert, GNUTLS_X509_FMT_PEM, cert_pem, &cert_pem_size));

  /* GnuTLS should already enforce that, but make double-sure */
  assert (cert_pem_size < sizeof (cert_pem));
  assert (cert_pem[cert_pem_size] == '\0');
  debug ("TLS peer certificate: %s", ws->peer_cert_info.data);

  /* TODO: write X.509 certificate to our $RUNTIME_DIRECTORY, so that PAM modules can check that these got validated */
  debug ("TLS peer certificate PEM:\n%s", cert_pem);

  gnutls_x509_crt_deinit (cert);
}

/**
 * ws_instance_new: Launch a new cockpit-ws child process
 *
 * Sessions with different client TLS certificates, https-without-certificate,
 * and unencrypted http get shielded from each other, so that attacks in one ws
 * cannot tamper with other sessions.
 *
 * @ws_path: Path to cockpit-ws binary
 * @mode: #WS_INSTANCE_{HTTP,HTTP_REDIRECT,HTTPS}
 * @client_cert_der: client TLS certificate in DER format (as retrieved from gnutls_certificate_get_peers())
 * @state_dir: Directory for putting the unix socket to cockpit-ws and
 *             certificate information. This is sensitive and must only be accessible to cockpit-tls!
 */
WsInstance *
ws_instance_new (const char *ws_path,
                 enum WsInstanceMode mode,
                 const gnutls_datum_t *client_cert_der,
                 const char *state_dir)
{
  WsInstance *ws;
  int fd;
  pid_t pid;
  static unsigned long ws_socket_id = 0; /* generate unique Unix socket names */
  static char pid_str[20];

  ws = callocx (1, sizeof (WsInstance));

  /* create a listening socket for cockpit-ws */
  fd = socket (AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0)
    err (1, "failed to create cockpit-ws socket");
  ws->socket.sun_family = AF_UNIX;
  /* Generate unique Unix socket name; theoretical wrap-around on ULONG_MAX */
  assert (++ws_socket_id > 0);
  snprintf_checked (ws->socket.sun_path, sizeof (ws->socket.sun_path), "%s/ws.%lu.sock", state_dir, ws_socket_id);
  unlink (ws->socket.sun_path);
  if (bind (fd, (const struct sockaddr *) &ws->socket, sizeof (ws->socket)) < 0)
    err (1, "failed to bind cockpit-ws socket %s", ws->socket.sun_path);
  if (listen (fd, 20) < 0)
    err (1, "failed to set cockpit-ws socket to listen");

  pid = fork ();
  if (pid < 0)
    err (1, "failed to fork");
  if (pid > 0)
    {
      /* parent */
      debug ("forked cockpit-ws as pid %i on socket %s", pid, ws->socket.sun_path);
      close (fd);
      ws->pid = pid;
      if (mode == WS_INSTANCE_HTTPS && client_cert_der)
        ws_init_peer_cert (ws, client_cert_der);
      return ws;
    }

  /* child */
  /* pass the socket to ws like systemd activation does, see sd_listen_fds(3) */
  if (dup2 (fd, SD_LISTEN_FDS_START) < 0)
    err (1, "failed to dup socket fd");
  snprintf_checked (pid_str, sizeof (pid_str), "%i", getpid ());
  setenv ("LISTEN_FDS", "1", 1);
  setenv ("LISTEN_PID", pid_str, 1);
  debug ("cockpit-ws child process: setup complete, executing %s", ws_path);
  switch (mode)
    {
      case WS_INSTANCE_HTTP:
        execl (ws_path, ws_path, "--no-tls", "--port", "0", NULL);
        break;

      case WS_INSTANCE_HTTP_REDIRECT:
        execl (ws_path, ws_path, "--proxy-tls-redirect", "--no-tls", "--port", "0", NULL);
        break;

      case WS_INSTANCE_HTTPS:
        execl (ws_path, ws_path, "--for-tls-proxy", "--port", "0", NULL);
        break;

      default:
        errx (1, "Invalid mode");
    }
  err (127, "failed to execute %s", ws_path);
}

void
ws_instance_free (WsInstance *ws)
{
  debug ("freeing cockpit-ws instance pid %i on socket %s", ws->pid, ws->socket.sun_path);
  if (ws->peer_cert.size)
    {
      gnutls_free (ws->peer_cert.data);
      gnutls_free (ws->peer_cert_info.data);
    }
  if (ws->pid)
    {
      /* this normally gets called on SIGCHLD or when connections fail, i. e.
       * ws crashes; but make sure that we can wait() it */
      kill (ws->pid, SIGKILL);
      waitpid (ws->pid, NULL, 0);
    }

  unlink (ws->socket.sun_path);
  free (ws);
}

/**
 * ws_instance_has_peer_cert: Check if that instance is for a given GnuTLS DER client certificate
 *
 * Returns true if either this ws instance has no client certificate and der is
 * %NULL or empty, or if both certificates are identical. Otherwise returns false.
 */
bool
ws_instance_has_peer_cert (WsInstance *ws, const gnutls_datum_t *der)
{
  if (!der)
    return ws->peer_cert.size == 0;

  /* this includes the case where both are absent */
  if (ws->peer_cert.size != der->size)
    return false;
  return memcmp (ws->peer_cert.data, der->data, der->size) == 0;
}
