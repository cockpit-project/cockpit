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
on_transport_recv (CockpitTransport *transport,
                   guint channel,
                   GBytes *payload)
{
  const gchar *command = NULL;
  JsonObject *options;

  /* We only handle control channel commands here */
  if (channel != 0)
    return FALSE;

  /* Read out the actual command and channel this message is about */
  if (!cockpit_transport_parse_command (payload, &command, &channel, &options))
    {
      /* Warning already logged */
      cockpit_transport_close (transport, "protocol-error");
      return TRUE; /* handled */
    }

  if (g_str_equal (command, "open"))
    process_open (transport, channel, options);
  else if (g_str_equal (command, "close"))
    process_close (transport, channel);
  else
    g_debug ("Received unknown control command: %s", command);

  json_object_unref (options);
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
  gboolean closed = FALSE;
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

  transport = cockpit_pipe_transport_new ("stdio", 0, outfd);
  g_signal_connect (transport, "recv", G_CALLBACK (on_transport_recv), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_direct_hash, g_direct_equal, NULL, g_object_unref);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);
  g_hash_table_destroy (channels);
  exit (0);
}
