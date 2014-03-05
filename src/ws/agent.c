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

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "dbus-server.h"
#include "cockpitfdtransport.h"

#include "gsystem-local-alloc.h"


/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

/*
 * TODO: Currently this only handles one channel per agent. Future
 * work will make it so that each agent (and thus ssh connection)
 * can handle mulitple channels.
 */

static DBusServerData *dbus_server = NULL;
static guint dbus_channel = 0;

static void
control_close_command (CockpitTransport *transport,
                       guint channel,
                       const gchar *reason)
{
  GBytes *message;
  gchar *json;

  if (reason == NULL)
    reason = "";
  if (channel == 0)
    json = g_strdup_printf ("{\"command\": \"close\", \"reason\": \"%s\"}", reason);
  else
    json = g_strdup_printf ("{\"command\": \"close\", \"channel\": %u, \"reason\": \"%s\"}", channel, reason);

  message = g_bytes_new_take (json, strlen (json));
  cockpit_transport_send (transport, 0, message);
  g_bytes_unref (message);
}

static const gchar *
safe_read_option (JsonObject *options,
                  const char *name)
{
  JsonNode *node;
  const gchar *value = NULL;

  node = json_object_get_member (options, name);
  if (node && json_node_get_value_type (node) == G_TYPE_STRING)
    value = json_node_get_string (node);

  return value;
}

static void
process_open (CockpitTransport *transport,
              guint channel,
              JsonObject *options)
{
  const gchar *dbus_service;
  const gchar *dbus_path;
  const gchar *payload = NULL;

  /* TODO: For now we only support one payload: dbus-json1 */
  payload = safe_read_option (options, "payload");
  if (g_strcmp0 (payload, "dbus-json1") != 0)
    {
      g_warning ("agent only supports payloads of type dbus-json1");
      control_close_command (transport, channel, "not-supported");
      return;
    }

  dbus_service = safe_read_option (options, "service");
  if (dbus_service == NULL || !g_dbus_is_name (dbus_service))
    {
      g_warning ("agent got invalid dbus service");
      control_close_command (transport, channel, "protocol-error");
      return;
    }

  dbus_path = safe_read_option (options, "object-manager");
  if (dbus_path == NULL || !g_variant_is_object_path (dbus_path))
    {
      g_warning ("agent got invalid object-manager path");
      control_close_command (transport, channel, "protocol-error");
      return;
    }

  /* TODO: Only one channel for now */
  g_debug ("Open dbus-json1 channel %u with %s at %s", channel, dbus_service, dbus_path);
  dbus_server = dbus_server_serve_dbus (G_BUS_TYPE_SYSTEM,
                                        dbus_service,
                                        dbus_path,
                                        transport,
                                        channel);

  if (dbus_server == NULL)
    control_close_command (transport, channel, "internal-error");
  else
    dbus_channel = channel;
}

static void
process_close (CockpitTransport *transport,
               guint channel)
{
  if (dbus_channel != channel)
    {
      g_warning ("agent got request to close wrong channel");
      cockpit_transport_close (transport, "protocol-error");
    }
  else
    {
      g_debug ("Close dbus-json1 channel %u", channel);
      dbus_server_stop_dbus (dbus_server);
      dbus_server = NULL;
      dbus_channel = 0;
      control_close_command (transport, channel, "");
    }
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   guint channel,
                   GBytes *payload)
{
  gs_unref_object JsonParser *parser = NULL;
  const gchar *command = NULL;
  JsonObject *options;

  /* We only handle control channel commands here */
  if (channel != 0)
    return FALSE;

  parser = json_parser_new();

  /* Read out the actual command and channel this message is about */
  if (!cockpit_transport_parse_command (parser, payload, &command,
                                        &channel, &options))
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

  transport = cockpit_fd_transport_new ("stdio", 0, outfd);
  g_signal_connect (transport, "recv", G_CALLBACK (on_transport_recv), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  while (!closed)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);
  exit (0);
}
