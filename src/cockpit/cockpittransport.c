/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpittransport.h"

#include "cockpit/cockpitjson.h"

#include <stdlib.h>
#include <string.h>

enum {
  RECV,
  CLOSED,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS];

typedef CockpitTransportIface CockpitTransportInterface;

static void   cockpit_transport_default_init    (CockpitTransportIface *iface);

G_DEFINE_INTERFACE (CockpitTransport, cockpit_transport, G_TYPE_OBJECT);

static void
cockpit_transport_default_init (CockpitTransportIface *iface)
{
  g_object_interface_install_property (iface,
             g_param_spec_string ("name", "name", "name", NULL,
                                  G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  signals[RECV] = g_signal_new ("recv", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_LAST,
                                G_STRUCT_OFFSET (CockpitTransportIface, recv),
                                g_signal_accumulator_true_handled, NULL,
                                g_cclosure_marshal_generic,
                                G_TYPE_BOOLEAN, 2, G_TYPE_UINT, G_TYPE_BYTES);

  signals[CLOSED] = g_signal_new ("closed", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_FIRST,
                                  G_STRUCT_OFFSET (CockpitTransportIface, closed),
                                  NULL, NULL, g_cclosure_marshal_generic,
                                  G_TYPE_NONE, 1, G_TYPE_STRING);
}

void
cockpit_transport_send (CockpitTransport *transport,
                        guint channel,
                        GBytes *data)
{
  CockpitTransportIface *iface;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  iface = COCKPIT_TRANSPORT_GET_IFACE(transport);
  g_return_if_fail (iface && iface->send);
  iface->send (transport, channel, data);
}

void
cockpit_transport_close (CockpitTransport *transport,
                         const gchar *problem)
{
  CockpitTransportIface *iface;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  iface = COCKPIT_TRANSPORT_GET_IFACE(transport);
  g_return_if_fail (iface && iface->close);
  iface->close (transport, problem);
}

void
cockpit_transport_emit_recv (CockpitTransport *transport,
                             guint channel,
                             GBytes *data)
{
  gboolean result = FALSE;
  gchar *name = NULL;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  g_signal_emit (transport, signals[RECV], 0, channel, data, &result);

  if (!result)
    {
      g_object_get (transport, "name", &name, NULL);
      g_debug ("%s: No handler for received message in channel %u", name, channel);
      g_free (name);
    }
}

void
cockpit_transport_emit_closed (CockpitTransport *transport,
                               const gchar *problem)
{
  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));
  g_signal_emit (transport, signals[CLOSED], 0, problem);
}

GBytes *
cockpit_transport_parse_frame (GBytes *message,
                               guint *channel)
{
  gconstpointer data;
  unsigned long val;
  gsize offset;
  gsize length;
  const gchar *line;
  char *end;

  g_return_val_if_fail (message != NULL, NULL);

  data = g_bytes_get_data (message, &length);
  line = memchr (data, '\n', length);
  if (!line)
    {
      g_warning ("Received invalid message without channel prefix");
      return NULL;
    }

  offset = (line - (gchar *)data) + 1;
  val = strtoul (data, &end, 10);
  if (end != line || val > G_MAXINT)
    {
      g_warning ("Received invalid message prefix");
      return NULL;
    }

  *channel = val;
  return g_bytes_new_from_bytes (message, offset, length - offset);
}

/**
 * cockpit_transport_parse_command:
 * @payload: command JSON payload to parse
 * @command: a location to return the command
 * @channel: location to return the channel
 * @options: location to return the options
 *
 * Parse a command and return various values from the
 * command. The @options value is transfered with ownership,
 * so you should free it after done. @command is owned by
 * @options.
 *
 * On failure, message has already been printed.
 *
 * Returns: whether command parsed or not.
 */
gboolean
cockpit_transport_parse_command (GBytes *payload,
                                 const gchar **command,
                                 guint *channel,
                                 JsonObject **options)
{
  GError *error = NULL;
  gboolean ret = FALSE;
  JsonObject *object;
  JsonNode *node;
  gint64 num;

  object = cockpit_json_parse_bytes (payload, &error);
  if (!object)
    {
      g_warning ("Received unparseable control message: %s", error->message);
      g_error_free (error);
      goto out;
    }

  /* Parse out the command */
  if (!cockpit_json_get_string (object, "command", NULL, command) ||
      *command == NULL || g_str_equal (*command, ""))
    {
      g_warning ("Received invalid control message: invalid or missing command");
      goto out;
    }

  /* Parse out the channel */
  node = json_object_get_member (object, "channel");
  if (!node)
    *channel = 0;
  else if (cockpit_json_get_int (object, "channel", 0, &num) && num > 0 && num < G_MAXUINT)
    *channel = num;
  else
    {
      g_warning ("Received invalid control message: invalid or missing channel");
      goto out;
    }

  *options = json_object_ref (object);
  ret = TRUE;

out:
  if (object)
    json_object_unref (object);
  return ret;
}
