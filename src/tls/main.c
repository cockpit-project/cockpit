/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include <argp.h>
#include <err.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#include <common/cockpitconf.h>
#include <common/cockpitwebcertificate.h>
#include "utils.h"
#include "server.h"
#include "connection.h"

/* CLI arguments */
struct arguments {
  uint16_t port;
  bool no_tls;
  int idle_timeout;
};

#define OPT_NO_TLS 1000
#define OPT_IDLE_TIMEOUT 1001

static int
arg_parse_int (char *arg, struct argp_state *state, int min, int max, const char *error_msg)
{
  char *endptr = NULL;
  long num = strtol (arg, &endptr, 10);

  if (!*arg || *endptr != '\0' || num < min || num > max)
    argp_error (state, "%s: %s", error_msg, arg);
  return (int) num;
}

/* Parse a single option. */
static error_t
parse_opt (int key, char *arg, struct argp_state *state)
{
  struct arguments *arguments = state->input;

  switch (key)
    {
      case OPT_NO_TLS:
        arguments->no_tls = true;
        break;
      case 'p':
        arguments->port = arg_parse_int (arg, state, 1, UINT16_MAX, "Invalid port");
        break;
      case OPT_IDLE_TIMEOUT:
        arguments->idle_timeout = arg_parse_int (arg, state, 0, INT_MAX, "Invalid idle timeout");
        break;
      default:
        return ARGP_ERR_UNKNOWN;
    }
  return 0;
}

static struct argp_option options[] = {
  {"no-tls", OPT_NO_TLS, 0, 0,  "Don't use TLS" },
  {"port", 'p', "PORT", 0, "Local port to bind to (9090 if unset)" },
  {"idle-timeout", OPT_IDLE_TIMEOUT, "SECONDS", 0, "Time after which to exit if there are no connections; 0 to run forever (default: 90)" },
  { 0 }
};

static const struct argp argp = {
  .options = options,
  .parser = parse_opt,
  .doc = "cockpit-tls -- TLS terminating proxy for cockpit-ws",
};

int
main (int argc, char **argv)
{
  struct arguments arguments;
  gnutls_certificate_request_t client_cert_mode = GNUTLS_CERT_IGNORE;
  const char *runtimedir;

  /* default option values */
  arguments.no_tls = false;
  arguments.port = 9090;
  arguments.idle_timeout = 90;

  argp_parse (&argp, argc, argv, 0, 0, &arguments);

  runtimedir = secure_getenv ("RUNTIME_DIRECTORY");
  if (!runtimedir)
    errx (EXIT_FAILURE, "$RUNTIME_DIRECTORY environment variable must be set to a private directory");

  server_init ("/run/cockpit/wsinstance", runtimedir, arguments.idle_timeout, arguments.port);

  if (!arguments.no_tls)
    {
      static const char cert_dir[] = "/run/cockpit/tls/server";

      if (cockpit_conf_bool ("WebService", "ClientCertAuthentication", false))
        client_cert_mode = GNUTLS_CERT_REQUEST;

      bool allow_unencrypted = cockpit_conf_bool ("WebService", "AllowUnencrypted", false);

      int cert_dirfd = open (cert_dir, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
      if (cert_dirfd == -1)
        err (EXIT_FAILURE, "open: %s", cert_dir);

      connection_crypto_init (cert_dirfd, allow_unencrypted, client_cert_mode);

      /* Clean up certificate files after loading */
      for (int i = 0; ; i++)
        {
          char cert_name[16], key_name[16];
          snprintf (cert_name, sizeof cert_name, "%d.crt", i);
          snprintf (key_name, sizeof key_name, "%d.key", i);

          if (unlinkat (cert_dirfd, cert_name, 0) != 0)
            break;
          unlinkat (cert_dirfd, key_name, 0);
        }

      close (cert_dirfd);
    }

  server_run ();
  server_cleanup ();

  return 0;
}
