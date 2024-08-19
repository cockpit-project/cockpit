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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <argp.h>
#include <err.h>
#include <stddef.h>
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
      char *error = NULL;

      if (error)
        errx (EXIT_FAILURE, "Could not locate server certificate: %s", error);

      if (cockpit_conf_bool ("WebService", "ClientCertAuthentication", false))
        client_cert_mode = GNUTLS_CERT_REQUEST;

      bool allow_unencrypted = cockpit_conf_bool ("WebService", "AllowUnencrypted", false);

      connection_crypto_init ("/run/cockpit/tls/server/cert",
                              "/run/cockpit/tls/server/key",
                              allow_unencrypted, client_cert_mode);

      /* There's absolutely no need to keep these around */
      if (unlink ("/run/cockpit/tls/server/cert") != 0)
        err (EXIT_FAILURE, "unlink: /run/cockpit/tls/server/cert");

      if (unlink ("/run/cockpit/tls/server/key") != 0)
        err (EXIT_FAILURE, "unlink: /run/cockpit/tls/server/key");
    }

  server_run ();
  server_cleanup ();

  return 0;
}
