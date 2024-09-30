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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpittransport.h"

#include "common/cockpitjson.h"

#include <stdlib.h>
#include <string.h>

typedef struct {
    gconstpointer channel;
    JsonObject *control;
    GBytes *data;
} FrozenMessage;

static void
frozen_message_free (gpointer data)
{
  FrozenMessage *frozen = data;
  if (frozen->data)
    g_bytes_unref (frozen->data);
  if (frozen->control)
    json_object_unref (frozen->control);
  g_slice_free (FrozenMessage, frozen);
}

enum {
  RECV,
  CONTROL,
  CLOSED,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS];

typedef struct {
  GHashTable *freeze;
  GQueue *frozen;
} CockpitTransportPrivate;

G_DEFINE_ABSTRACT_TYPE_WITH_CODE (CockpitTransport, cockpit_transport, G_TYPE_OBJECT,
                                  G_ADD_PRIVATE (CockpitTransport));

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
maybe_freeze_message (CockpitTransport *self,
                      const gchar *channel,
                      JsonObject *control,
                      GBytes *data)
{
  CockpitTransportPrivate *priv = cockpit_transport_get_instance_private (self);
  FrozenMessage *frozen = NULL;

  if (priv->freeze && channel)
    {
      /* Note that we dig out the real value for the channel */
      channel = g_hash_table_lookup (priv->freeze, channel);
      if (channel)
        {
          frozen = g_slice_new0 (FrozenMessage);
          frozen->channel = channel; /* owned by hashtable */
          frozen->data = g_bytes_ref (data);
          if (control)
            frozen->control = json_object_ref (control);
          if (!priv->frozen)
            priv->frozen = g_queue_new ();
          g_queue_push_tail (priv->frozen, frozen);
          return TRUE;
        }
    }

  return FALSE;
}

static gboolean
cockpit_transport_default_recv (CockpitTransport *transport,
                                const gchar *channel,
                                GBytes *payload)
{
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

  cockpit_transport_emit_control (transport, command, inner_channel, options, payload);
  json_object_unref (options);

  return TRUE;
}

static gboolean
cockpit_transport_default_control (CockpitTransport *transport,
                                   const gchar *command,
                                   const gchar *channel,
                                   JsonObject *options,
                                   GBytes *payload)
{
  GBytes *message;

  if (channel != NULL)
    return FALSE;

  /* A single hop ping. Respond to it right here, immediately */
  if (g_str_equal (command, "ping"))
    {
      json_object_set_string_member (options, "command", "pong");
      message = cockpit_json_write_bytes (options);
      cockpit_transport_send (transport, NULL, message);
      g_bytes_unref (message);
      return TRUE;
    }
  else if (g_str_equal (command, "pong"))
    {
      /* Ignore pong commands */
      return TRUE;
    }

  /* Not handled */
  return FALSE;
}

static void
cockpit_transport_finalize (GObject *object)
{
  CockpitTransport *self = COCKPIT_TRANSPORT (object);
  CockpitTransportPrivate *priv = cockpit_transport_get_instance_private (self);

  if (priv->freeze)
    g_hash_table_destroy (priv->freeze);
  if (priv->frozen)
    g_queue_free_full (priv->frozen, frozen_message_free);

  G_OBJECT_CLASS (cockpit_transport_parent_class)->finalize (object);
}

static void
cockpit_transport_class_init (CockpitTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  klass->recv = cockpit_transport_default_recv;
  klass->control = cockpit_transport_default_control;

  object_class->get_property = cockpit_transport_get_property;
  object_class->finalize = cockpit_transport_finalize;

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

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  if (maybe_freeze_message (transport, channel, NULL, data))
    return;

  g_signal_emit (transport, signals[RECV], 0, channel, data, &result);

  if (!result)
    g_debug ("no handler for received message in channel %s", channel);
}

void
cockpit_transport_emit_control (CockpitTransport *transport,
                                const gchar *command,
                                const gchar *channel,
                                JsonObject *options,
                                GBytes *data)
{
  gboolean result = FALSE;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));

  if (maybe_freeze_message (transport, channel, options, data))
    return;

  g_signal_emit (transport, signals[CONTROL], 0, command, channel, options, data, &result);

  if (!result)
    g_debug ("received unknown control command: %s", command);
}

void
cockpit_transport_emit_closed (CockpitTransport *transport,
                               const gchar *problem)
{
  g_return_if_fail (COCKPIT_IS_TRANSPORT (transport));
  g_signal_emit (transport, signals[CLOSED], 0, problem);
}

void
cockpit_transport_freeze (CockpitTransport *self,
                          const gchar *channel)
{
  CockpitTransportPrivate *priv = cockpit_transport_get_instance_private (self);

  g_return_if_fail (COCKPIT_IS_TRANSPORT (self));
  g_return_if_fail (channel != NULL);

  if (!priv->freeze)
    priv->freeze = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  g_hash_table_add (priv->freeze, g_strdup (channel));
}

void
cockpit_transport_thaw (CockpitTransport *self,
                        const gchar *channel)
{
  CockpitTransportPrivate *priv = cockpit_transport_get_instance_private (self);
  FrozenMessage *frozen;
  const gchar *command;
  gchar *stolen = NULL;
  GList *l, *flush;

  g_return_if_fail (COCKPIT_IS_TRANSPORT (self));
  g_return_if_fail (channel != NULL);

  if (priv->freeze)
    stolen = g_hash_table_lookup (priv->freeze, channel);
  if (stolen)
    g_hash_table_steal (priv->freeze, channel);

  for (l = priv->frozen ? priv->frozen->head : NULL; l != NULL; )
    {
      frozen = l->data;
      flush = (stolen == frozen->channel) ? l : NULL;
      l = g_list_next (l);

      if (flush)
        {
          if (frozen->control)
            {
              command = NULL;
              cockpit_json_get_string (frozen->control, "command", NULL, &command);
              cockpit_transport_emit_control (self, command, stolen, frozen->control, frozen->data);
            }
          else
            {
              cockpit_transport_emit_recv (self, stolen, frozen->data);
            }
          g_queue_delete_link (priv->frozen, flush);
          frozen_message_free (frozen);
        }
    }

  g_free (stolen);
}

static GBytes *
parse_frame (GBytes *message,
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
      g_message ("received invalid message without channel prefix");
      return NULL;
    }

  channel_len = line - data;
  if (memchr (data, '\0', channel_len) != NULL)
    {
      g_message ("received massage with invalid channel prefix");
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
  return parse_frame (message, channel);
}

/**
 * cockpit_transport_parse_command:
 * @payload: command JSON payload to parse
 * @command: a location to return the command
 * @channel: location to return the channel
 * @options: location to return the options
 *
 * Parse a command and return various values from the
 * command. The @options value is transferred with ownership,
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
      g_warning ("Received unparsable control message: %s", error->message);
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
  if (channel)
    {
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
