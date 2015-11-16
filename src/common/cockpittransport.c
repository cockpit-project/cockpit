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

#include "common/cockpitjson.h"

#include <stdlib.h>
#include <string.h>

enum {
  RECV,
  CONTROL,
  CLOSED,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS];

G_DEFINE_ABSTRACT_TYPE (CockpitTransport, cockpit_transport, G_TYPE_OBJECT);

static void
cockpit_transport_init (CockpitTransport *self)
{

}

static void
cockpit_transport_get_property (GObject *object,
                                guint property_id,
                                GValue *value,
                                GParamSpec *pspec)
{
  /* Should be overridden by derived abstract classes */
  G_OBJECT_WARN_INVALID_PROPERTY_ID (object, property_id, pspec);
}

static gboolean
cockpit_transport_default_recv (CockpitTransport *transport,
                                const gchar *channel,
                                GBytes *payload)
{
  gboolean ret = FALSE;
  const gchar *inner_channel;
  JsonObject *options;
  const gchar *command = NULL;

  /* Our default handler parses control channel and fires control signal */
  if (channel)
    return FALSE;

  /* Read out the actual command and channel this message is about */
  if (!cockpit_transport_parse_command (payload, &command, &inner_channel, &options))
    {
      /* Warning already logged */
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }

  g_signal_emit (transport, signals[CONTROL], 0, command, inner_channel, options, payload, &ret);

  if (!ret)
    g_debug ("received unknown control command: %s", command);
  json_object_unref (options);

  return TRUE;
}


static void
cockpit_transport_class_init (CockpitTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->recv = cockpit_transport_default_recv;

  object_class->get_property = cockpit_transport_get_property;

  g_object_class_install_property (object_class, 1,
              g_param_spec_string ("name", "name", "name", NULL,
                                   G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  signals[RECV] = g_signal_new ("recv", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_LAST,
                                G_STRUCT_OFFSET (CockpitTransportClass, recv),
                                g_signal_accumulator_true_handled, NULL,
                                g_cclosure_marshal_generic,
                                G_TYPE_BOOLEAN, 2, G_TYPE_STRING, G_TYPE_BYTES);

  signals[CONTROL] = g_signal_new ("control", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_LAST,
                                   G_STRUCT_OFFSET (CockpitTransportClass, control),
                                   g_signal_accumulator_true_handled, NULL,
                                   g_cclosure_marshal_generic,
                                   G_TYPE_BOOLEAN, 4,
                                   G_TYPE_STRING, G_TYPE_STRING, JSON_TYPE_OBJECT, G_TYPE_BYTES);

  signals[CLOSED] = g_signal_new ("closed", COCKPIT_TYPE_TRANSPORT, G_SIGNAL_RUN_FIRST,
                                  G_STRUCT_OFFSET (CockpitTransportClass, closed),
                                  NULL, NULL, g_cclosure_marshal_generic,
                                  G_TYPE_NONE, 1, G_TYPE_STRING);
}

void
cockpit_transport_send (CockpitTransport *transport,
                        const gchar *channel,
                        GBytes *data)
{
  CockpitTransportClass *klass;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  klass = COCKPIT_TRANSPORT_GET_CLASS (transport);
  g_return_if_fail (klass && klass->send);
  klass->send (transport, channel, data);
}

void
cockpit_transport_close (CockpitTransport *transport,
                         const gchar *problem)
{
  CockpitTransportClass *klass;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  klass = COCKPIT_TRANSPORT_GET_CLASS (transport);
  g_return_if_fail (klass && klass->close);
  klass->close (transport, problem);
}

void
cockpit_transport_emit_recv (CockpitTransport *transport,
                             const gchar *channel,
                             GBytes *data)
{
  gboolean result = FALSE;
  gchar *name = NULL;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  g_signal_emit (transport, signals[RECV], 0, channel, data, &result);

  if (!result)
    {
      g_object_get (transport, "name", &name, NULL);
      g_debug ("%s: No handler for received message in channel %s", name, channel);
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

/**
 * cockpit_transport_parse_frame:
 * @message: message to parse
 * @channel: location to return the channel
 *
 * Parse a message into a channel and payload.
 * @channel will be set to NULL if a control channel
 * message. @channel must be freed.
 *
 * Will return NULL if invalid message.
 *
 * Returns: (transfer full): the payload or NULL.
 */
GBytes *
cockpit_transport_parse_frame (GBytes *message,
                               gchar **channel)
{
  const gchar *data;
  gsize length;
  const gchar *line;
  gsize channel_len;

  g_return_val_if_fail (message != NULL, NULL);

  data = g_bytes_get_data (message, &length);
  line = memchr (data, '\n', length);
  if (!line)
    {
      g_warning ("Received invalid message without channel prefix");
      return NULL;
    }

  channel_len = line - data;
  if (memchr (data, '\0', channel_len) != NULL)
    {
      g_warning ("Received massage with invalid channel prefix");
      return NULL;
    }

  if (channel_len)
    *channel = g_strndup (data, channel_len);
  else
    *channel = NULL;

  channel_len++;
  return g_bytes_new_from_bytes (message, channel_len, length - channel_len);
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
 * so you should free it after done. @command and @channel are owned by
 * @options. @channel will be NULL for a missing channel.
 *
 * On failure, message has already been printed.
 *
 * Returns: whether command parsed or not.
 */
gboolean
cockpit_transport_parse_command (GBytes *payload,
                                 const gchar **command,
                                 const gchar **channel,
                                 JsonObject **options)
{
  GError *error = NULL;
  gboolean ret = FALSE;
  JsonObject *object;
  gboolean valid;

  object = cockpit_json_parse_bytes (payload, &error);
  if (!object)
    {
      g_warning ("Received unparseable control message: %s", error->message);
      g_error_free (error);
      goto out;
    }

  /* Parse out the command */
  if (command)
    {
      if (!cockpit_json_get_string (object, "command", NULL, command) ||
          *command == NULL || g_str_equal (*command, ""))
        {
          g_warning ("Received invalid control message: invalid or missing command");
          goto out;
        }
    }

  /* Parse out the channel */
  valid = cockpit_json_get_string (object, "channel", NULL, channel);
  if (valid && *channel)
    {
      valid = (!g_str_equal ("", *channel) &&
               strcspn (*channel, "\n") == strlen (*channel));
    }

  if (!valid)
    {
      g_warning ("Received invalid control message: invalid channel");
      goto out;
    }

  *options = json_object_ref (object);
  ret = TRUE;

out:
  if (object)
    json_object_unref (object);
  return ret;
}

static JsonObject *
build_json_va (const gchar *name,
               va_list va)
{
  JsonObject *object;
  const gchar *value;

  object = json_object_new ();

  while (name)
    {
      value = va_arg (va, const gchar *);
      if (value)
        json_object_set_string_member (object, name, value);
      name = va_arg (va, const gchar *);
    }

  return object;
}

JsonObject *
cockpit_transport_build_json (const gchar *name,
                              ...)
{
  JsonObject *object;
  va_list va;

  va_start (va, name);
  object = build_json_va (name, va);
  va_end (va);

  return object;
}

GBytes *
cockpit_transport_build_control (const gchar *name,
                                 ...)
{
  JsonObject *object;
  GBytes *message;
  va_list va;

  va_start (va, name);
  object = build_json_va (name, va);
  va_end (va);

  message = cockpit_json_write_bytes (object);
  json_object_unref (object);
  return message;
}


