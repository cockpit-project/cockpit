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

#ifdef HAVE_CONFIG_H
#include <config.h>
#endif

#include <argp.h>
#include <err.h>
#include <stddef.h>
#include <stdlib.h>

#include <common/cockpitwebcertificate.h>
#include "utils.h"
#include "server.h"

#define COCKPIT_WS PACKAGE_LIBEXEC_DIR "/cockpit-ws"

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
        arguments->idle_timeout = arg_parse_int (arg, state, 0, (INT_MAX / 1000) - 1, "Invalid idle timeout") * 1000;
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
  char *error = NULL;
  char *certfile = NULL;

  /* default option values */
  arguments.no_tls = false;
  arguments.port = 9090;
  arguments.idle_timeout = 90000;

  argp_parse (&argp, argc, argv, 0, 0, &arguments);

  if (!arguments.no_tls)
    {
      certfile = cockpit_certificate_locate (&error);
      if (error)
        errx (1, "Could not locate server certificate: %s", error);
      debug ("Using certificate %s", certfile);
    }

  /* TODO: Add cockpit.conf option to enable client-certificate auth, once we support that */
  server_init (COCKPIT_WS, arguments.port, certfile, NULL, CERT_NONE);
  free (certfile);

  server_run (arguments.idle_timeout);
  server_cleanup ();
  return 0;
}
