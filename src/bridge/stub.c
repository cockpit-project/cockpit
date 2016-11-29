/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
#include "config.h"

#include "cockpitbridge.h"
#include "cockpitchannel.h"
#include "cockpitdbusinternal.h"
#include "cockpitdbusjson.h"
#include "cockpitechochannel.h"
#include "cockpitinteracttransport.h"
#include "cockpithttpstream.h"
#include "cockpitnullchannel.h"
#include "cockpitpackages.h"
#include "cockpitwebsocketstream.h"

#include "common/cockpittransport.h"
#include "common/cockpitassets.h"
#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittest.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitwebresponse.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <glib-unix.h>
#include <glib/gstdio.h>

/* This program is is meant to be used in place of cockpit-bridge
 * in non-system setting. As such only payloads that make no changes
 * to the system or support their own forms of authentication (ei: http)
 * should be included here.
 */

static CockpitPackages *packages;

extern gboolean cockpit_dbus_json_allow_external;

static CockpitPayloadType payload_types[] = {
  { "http-stream1", cockpit_http_stream_get_type },
  { "http-stream2", cockpit_http_stream_get_type },
  { "null", cockpit_null_channel_get_type },
  { "echo", cockpit_echo_channel_get_type },
  { "websocket-stream1", cockpit_web_socket_stream_get_type },
  { "dbus-json3", cockpit_dbus_json_get_type },
  { NULL },
};

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

static void
send_init_command (CockpitTransport *transport)
{
  const gchar *checksum;
  JsonObject *object;
  GBytes *bytes;

  object = json_object_new ();
  json_object_set_string_member (object, "command", "init");
  json_object_set_int_member (object, "version", 1);

  checksum = cockpit_packages_get_checksum (packages);
  if (checksum)
    json_object_set_string_member (object, "checksum", checksum);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean *closed = data;
  *closed = TRUE;
  return TRUE;
}

static int
run_bridge (const gchar *interactive)
{
  CockpitTransport *transport;
  CockpitBridge *bridge;
  gboolean terminated = FALSE;
  gboolean interupted = FALSE;
  gboolean closed = FALSE;
  const gchar *init_host = NULL;
  guint sig_term;
  guint sig_int;
  int outfd;

  cockpit_set_journal_logging (G_LOG_DOMAIN, !isatty (2));

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      outfd = 1;
    }

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, &terminated);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, &interupted);

  g_type_init ();

  cockpit_dbus_json_allow_external = FALSE;

  packages = cockpit_packages_new ();
  cockpit_dbus_internal_startup (interactive != NULL);

  if (interactive)
    {
      /* Allow skipping the init message when interactive */
      init_host = "localhost";
      transport = cockpit_interact_transport_new (0, outfd, interactive);
    }
  else
    {
      transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);
    }

  g_resources_register (cockpitassets_get_resource ());
  cockpit_web_failure_resource = "/org/cockpit-project/Cockpit/fail.html";

  bridge = cockpit_bridge_new (transport, payload_types, init_host);
  cockpit_dbus_process_startup ();

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  send_init_command (transport);

  while (!terminated && !closed && !interupted)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (bridge);
  g_object_unref (transport);
  cockpit_packages_free (packages);
  packages = NULL;

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  /* So the caller gets the right signal */
  if (terminated)
    raise (SIGTERM);

  return 0;
}

static void
print_version (void)
{
  gint i, offset, len;

  g_print ("Version: %s\n", PACKAGE_VERSION);
  g_print ("Protocol: 1\n");

  g_print ("Payloads: ");
  offset = 10;
  for (i = 0; payload_types[i].name != NULL; i++)
    {
      len = strlen (payload_types[i].name);
      if (offset + len > 70)
        {
          g_print ("\n");
          offset = 0;
        }

      if (offset == 0)
        {
          g_print ("    ");
          offset = 4;
        };

      g_print ("%s ", payload_types[i].name);
      offset += len + 1;
    }
}

int
main (int argc,
      char **argv)
{
  GOptionContext *context;
  GError *error = NULL;
  int ret;

  static gboolean opt_packages = FALSE;
  static gboolean opt_version = FALSE;
  static gchar *opt_interactive = NULL;

  static GOptionEntry entries[] = {
    { "interact", 0, 0, G_OPTION_ARG_STRING, &opt_interactive, "Interact with the raw protocol", "boundary" },
    { "packages", 0, 0, G_OPTION_ARG_NONE, &opt_packages, "Show Cockpit package information", NULL },
    { "version", 0, 0, G_OPTION_ARG_NONE, &opt_version, "Show Cockpit version information", NULL },
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);

  /* Debugging issues during testing */
#if WITH_DEBUG
  signal (SIGABRT, cockpit_test_signal_backtrace);
  signal (SIGSEGV, cockpit_test_signal_backtrace);
#endif

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  /*
   * All channels that are added here should
   * not rely on running as a real user, however
   * they may lookup paths, such as run dir or
   * home directory. Glib has problems if
   * g_get_user_database_entry is called without
   * a real user, which it's path functions
   * do as a last resort when no environment vars
   * are set. So set HOME if it isn't set..
   */
  g_setenv("HOME", "/", FALSE);


  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_description (context,
                                    "cockpit-stub provides a limited number of channels and is meant to be"
                                    "used in place of cockpit-bridge in non-system setting. When\n"
                                    "run from the command line one of the options above must be specified.\n");

  g_option_context_parse (context, &argc, &argv, &error);
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-stub: %s\n", error->message);
      g_error_free (error);
      return 1;
    }

  if (opt_packages)
    {
      cockpit_packages_dump ();
      return 0;
    }
  else if (opt_version)
    {
      print_version ();
      return 0;
    }

  if (!opt_interactive && isatty (1))
    {
      g_printerr ("cockpit-stub: no option specified\n");
      return 2;
    }

  ret = run_bridge (opt_interactive);

  g_free (opt_interactive);
  return ret;
}
