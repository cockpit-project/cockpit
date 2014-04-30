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
#include "cockpitreauthorize.h"

#include "cockpit/cockpitpipetransport.h"

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
  guint channel_number = 0;
  g_object_get (channel, "channel", &channel_number, NULL);
  g_hash_table_remove (channels, GUINT_TO_POINTER (channel_number));
}

static void
process_open (CockpitTransport *transport,
              guint channel_number,
              JsonObject *options)
{
  CockpitChannel *channel;

  if (g_hash_table_lookup (channels, GUINT_TO_POINTER (channel_number)))
    {
      g_warning ("Caller tried to reuse a channel that's already in use");
      cockpit_transport_close (transport, "protocol-error");
      return;
    }

  channel = cockpit_channel_open (transport, channel_number, options);
  g_hash_table_insert (channels, GUINT_TO_POINTER (channel_number), channel);
  g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), NULL);
}

static void
process_close (CockpitTransport *transport,
               guint channel_number)
{
  CockpitChannel *channel;

  /*
   * The channel may no longer exist due to a race of the agent closing
   * a channel and the web closing it at the same time.
   */

  channel = g_hash_table_lookup (channels, GUINT_TO_POINTER (channel_number));
  if (channel)
    {
      g_debug ("Close channel %u", channel_number);
      cockpit_channel_close (channel, NULL);
    }
  else
    {
      g_debug ("Already closed channel %u", channel_number);
    }
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      guint channel,
                      JsonObject *options,
                      gpointer user_data)
{
  if (g_str_equal (command, "open"))
    process_open (transport, channel, options);
  else if (g_str_equal (command, "close"))
    process_close (transport, channel);
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

int
main (int argc,
      char **argv)
{
  CockpitTransport *transport;
  CockpitReauthorize *reauthorize;
  GDBusConnection *connection;
  gboolean closed = FALSE;
  GError *error = NULL;
  gpointer agent;
  int outfd;

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

  g_type_init ();

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);
  g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  connection = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, &error);
  if (connection == NULL)
    {
      g_message ("couldn't connect to system bus: %s", error->message);
      g_clear_error (&error);
    }

  agent = cockpit_polkit_agent_register (NULL);
  reauthorize = cockpit_reauthorize_new (transport);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_direct_hash, g_direct_equal, NULL, g_object_unref);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (reauthorize);
  if (agent)
    cockpit_polkit_agent_unregister (agent);
  if (connection)
    g_object_unref (connection);
  g_object_unref (transport);
  g_hash_table_destroy (channels);
  exit (0);
}
