/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "cockpitchannel.h"
#include "cockpitdbusjson.h"
#include "cockpitpolkitagent.h"

#include "cockpit/cockpitlog.h"
#include "cockpit/cockpitpipetransport.h"

#include <sys/prctl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <gsystem-local-alloc.h>


/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

static GHashTable *channels;

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  g_hash_table_remove (channels, cockpit_channel_get_id (channel));
}

static void
process_open (CockpitTransport *transport,
              const gchar *channel_id,
              JsonObject *options)
{
  CockpitChannel *channel;

  if (!channel_id)
    {
      g_warning ("Caller tried to open channel with invalid id");
      cockpit_transport_close (transport, "protocol-error");
    }
  else if (g_hash_table_lookup (channels, channel_id))
    {
      g_warning ("Caller tried to reuse a channel that's already in use");
      cockpit_transport_close (transport, "protocol-error");
    }
  else
    {
      channel = cockpit_channel_open (transport, channel_id, options);
      g_hash_table_insert (channels, g_strdup (channel_id), channel);
      g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), NULL);
    }
}

static void
process_close (CockpitTransport *transport,
               const gchar *channel_id)
{
  CockpitChannel *channel;

  /*
   * The channel may no longer exist due to a race of the agent closing
   * a channel and the web closing it at the same time.
   */

  if (!channel_id)
    {
      g_warning ("Caller tried to close channel without an id");
      cockpit_transport_close (transport, "protocol-error");
      return;
    }

  channel = g_hash_table_lookup (channels, channel_id);
  if (channel)
    {
      g_debug ("Close channel %s", channel_id);
      cockpit_channel_close (channel, NULL);
    }
  else
    {
      g_debug ("Already closed channel %s", channel_id);
    }
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      gpointer user_data)
{
  if (g_str_equal (command, "open"))
    process_open (transport, channel_id, options);
  else if (g_str_equal (command, "close"))
    process_close (transport, channel_id);
  else
    return FALSE;
  return TRUE; /* handled */
}

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

static void
setup_dbus_daemon (gpointer unused)
{
  prctl (PR_SET_PDEATHSIG, SIGTERM);
}

static GPid
start_dbus_daemon (void)
{
  GError *error = NULL;
  const gchar *env;
  GString *address;
  gint std_output;
  gchar *line;
  gsize len;
  gssize ret;
  GPid pid = 0;

  gchar *dbus_argv[] = {
      "dbus-daemon",
      "--print-address",
      "--session",
      "--nofork",
      "--nopidfile",
      NULL
  };

  /* Automatically start a DBus session if necessary */
  env = g_getenv ("DBUS_SESSION_BUS_ADDRESS");
  if (env != NULL && env[0] != '\0')
    return 0;

  /* The DBus daemon produces useless messages on stderr mixed in */
  g_spawn_async_with_pipes (NULL, dbus_argv, NULL,
                            G_SPAWN_SEARCH_PATH | G_SPAWN_STDERR_TO_DEV_NULL,
                            setup_dbus_daemon, NULL, &pid, NULL, &std_output, NULL, &error);
  if (error != NULL)
    {
      g_warning ("couldn't start DBus session bus: %s", error->message);
      g_error_free (error);
      return 0;
    }

  address = g_string_new ("");
  for (;;)
    {
      len = address->len;
      g_string_set_size (address, len + 256);
      ret = read (std_output, address->str + len, 256);
      if (ret < 0)
        {
          g_string_set_size (address, len);
          if (errno != EAGAIN)
            {
              g_warning ("couldn't read address from dbus-daemon: %s", g_strerror (errno));
              break;
            }
        }
      else if (ret == 0)
        {
          break;
        }
      else
        {
          g_string_set_size (address, len + ret);
          line = strchr (address->str, '\n');
          if (line != NULL)
            {
              *line = '\0';
              break;
            }
        }
    }

  close (std_output);
  g_setenv ("DBUS_SESSION_BUS_ADDRESS", address->str, TRUE);
  g_string_free (address, TRUE);

  return pid;
}

int
main (int argc,
      char **argv)
{
  CockpitTransport *transport;
  GDBusConnection *connection;
  gboolean closed = FALSE;
  GError *error = NULL;
  gpointer polkit_agent;
  GPid daemon_pid;
  int outfd;

  signal (SIGPIPE, SIG_IGN);
  cockpit_set_journal_logging ();

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("agent couldn't redirect stdout to stderr");
      outfd = 1;
    }

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  /* Start a session daemon if necessary */
  daemon_pid = start_dbus_daemon ();

  g_type_init ();

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);
  g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  connection = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
  if (connection == NULL)
    {
      g_message ("couldn't connect to session bus: %s", error->message);
      g_clear_error (&error);
    }
  else
    {
      g_dbus_connection_set_exit_on_close (connection, FALSE);
    }

  polkit_agent = cockpit_polkit_agent_register (transport, NULL);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  if (polkit_agent)
    cockpit_polkit_agent_unregister (polkit_agent);
  if (connection)
    g_object_unref (connection);
  g_object_unref (transport);
  g_hash_table_destroy (channels);

  if (daemon_pid)
    kill (daemon_pid, SIGTERM);
  exit (0);
}
