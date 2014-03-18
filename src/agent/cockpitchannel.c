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

#include "cockpitchannel.h"
#include "cockpitdbusjson.h"
#include "cockpittextstream.h"

#include "cockpit/cockpitjson.h"

#include <stdlib.h>
#include <string.h>

/**
 * CockpitChannel:
 *
 * A base class for the server (ie: agent) side of a channel. Derived
 * classes implement the actual payload contents, opening the channel
 * etc...
 *
 * The channel queues messages received until the implementation
 * indicates that it's open and ready to receive messages.
 *
 * A channel sends messages over a #CockpitTransport. If the transport
 * closes then the channel closes, but the channel can also close
 * individually either for failure reasons, or with an orderly shutdown.
 *
 * See doc/protocol.md for information about channels.
 */

struct _CockpitChannelPrivate {
  gulong recv_sig;
  gulong close_sig;

  /* Construct arguments */
  CockpitTransport *transport;
  guint number;
  JsonObject *options;

  /* Queued messages before channel is ready */
  gboolean ready;
  GQueue *received;

  /* Whether we've sent a closed message */
  gboolean closed;
};

enum {
  PROP_0,
  PROP_TRANSPORT,
  PROP_CHANNEL,
  PROP_OPTIONS,
};

static guint cockpit_channel_sig_closed;

G_DEFINE_TYPE (CockpitChannel, cockpit_channel, G_TYPE_OBJECT);

static void
cockpit_channel_init (CockpitChannel *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_CHANNEL,
                                            CockpitChannelPrivate);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   guint channel,
                   GBytes *data,
                   gpointer user_data)
{
  CockpitChannel *self = user_data;
  CockpitChannelClass *klass;

  if (channel != self->priv->number)
    return FALSE;

  if (self->priv->ready)
    {
      klass = COCKPIT_CHANNEL_GET_CLASS (self);
      g_assert (klass->recv);
      (klass->recv) (self, data);
    }
  else
    {
      if (!self->priv->received)
        self->priv->received = g_queue_new ();
      g_queue_push_tail (self->priv->received, g_bytes_ref (data));
    }

  return TRUE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (user_data);
  if (!self->priv->closed)
    {
      self->priv->closed = TRUE;
      g_signal_emit (self, cockpit_channel_sig_closed, 0, problem);
    }
}

static void
cockpit_channel_constructed (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  G_OBJECT_CLASS (cockpit_channel_parent_class)->constructed (object);

  self->priv->recv_sig = g_signal_connect (self->priv->transport, "recv",
                                           G_CALLBACK (on_transport_recv), self);
  self->priv->close_sig = g_signal_connect (self->priv->transport, "closed",
                                           G_CALLBACK (on_transport_closed), self);
}

static void
cockpit_channel_get_property (GObject *object,
                              guint prop_id,
                              GValue *value,
                              GParamSpec *pspec)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  switch (prop_id)
    {
      case PROP_TRANSPORT:
        g_value_set_object (value, self->priv->transport);
        break;
      case PROP_CHANNEL:
        g_value_set_uint (value, self->priv->number);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
        break;
    }
}

static void
cockpit_channel_set_property (GObject *object,
                              guint prop_id,
                              const GValue *value,
                              GParamSpec *pspec)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  switch (prop_id)
    {
      case PROP_TRANSPORT:
        self->priv->transport = g_value_dup_object (value);
        break;
      case PROP_CHANNEL:
        self->priv->number = g_value_get_uint (value);
        break;
      case PROP_OPTIONS:
        self->priv->options = g_value_dup_boxed (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
        break;
    }
}

static void
cockpit_channel_dispose (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  if (self->priv->recv_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->recv_sig);
  self->priv->recv_sig = 0;

  if (self->priv->close_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->close_sig);
  self->priv->close_sig = 0;

  if (self->priv->received)
    g_queue_free_full (self->priv->received, (GDestroyNotify)g_bytes_unref);
  self->priv->received = NULL;

  if (!self->priv->closed)
    cockpit_channel_close (self, "terminated");

  G_OBJECT_CLASS (cockpit_channel_parent_class)->dispose (object);
}

static void
cockpit_channel_finalize (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  g_object_unref (self->priv->transport);
  json_object_unref (self->priv->options);

  G_OBJECT_CLASS (cockpit_channel_parent_class)->finalize (object);
}

static void
cockpit_channel_real_close (CockpitChannel *self,
                            const gchar *problem)
{
  const gchar *reason = problem;
  GBytes *message;
  gchar *json;

  if (self->priv->closed)
    return;

  self->priv->closed = TRUE;

  if (reason == NULL)
    reason = "";
  json = g_strdup_printf ("{\"command\": \"close\", \"channel\": %u, \"reason\": \"%s\"}",
                          self->priv->number, reason);

  message = g_bytes_new_take (json, strlen (json));
  cockpit_transport_send (self->priv->transport, 0, message);
  g_bytes_unref (message);

  g_signal_emit (self, cockpit_channel_sig_closed, 0, problem);
}

static void
cockpit_channel_class_init (CockpitChannelClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_channel_constructed;
  gobject_class->get_property = cockpit_channel_get_property;
  gobject_class->set_property = cockpit_channel_set_property;
  gobject_class->dispose = cockpit_channel_dispose;
  gobject_class->finalize = cockpit_channel_finalize;

  klass->close = cockpit_channel_real_close;

  /**
   * CockpitChannel:transport:
   *
   * The transport to send and receive messages over.
   */
  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
             g_param_spec_object ("transport", "transport", "transport", COCKPIT_TYPE_TRANSPORT,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitChannel:channel:
   *
   * The numeric channel to receive and send messages on.
   */
  g_object_class_install_property (gobject_class, PROP_CHANNEL,
             g_param_spec_uint ("channel", "channel", "channel", 1, G_MAXUINT, G_MAXUINT,
                                  G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitChannel:options:
   *
   * The JSON options used to open this channel. The exact contents are
   * dependent on the derived channel class ... but this must at the
   * very least contain a 'payload' field describing what kind of channel
   * this should be.
   */
  g_object_class_install_property (gobject_class, PROP_OPTIONS,
             g_param_spec_boxed ("options", "options", "options", JSON_TYPE_OBJECT,
                                  G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  /**
   * CockpitChannel::closed:
   *
   * Emitted when the channel closes. This is similar to CockpitTransport::closed
   * but only applies to the individual channel.
   *
   * The channel will also be closed when the transport closes.
   */
  cockpit_channel_sig_closed = g_signal_new ("closed", COCKPIT_TYPE_CHANNEL, G_SIGNAL_RUN_LAST,
                                             G_STRUCT_OFFSET (CockpitChannelClass, closed),
                                             NULL, NULL, NULL, G_TYPE_NONE, 1, G_TYPE_STRING);

  g_type_class_add_private (klass, sizeof (CockpitChannelPrivate));
}

/**
 * cockpit_channel_open:
 * @transport: the transport to send/receive messages on
 * @number: the channel number
 * @options: the options to open the channel.
 *
 * Open a channel for the 'payload' field in @options. Other fields
 * in @options are dependent on the channel type.
 *
 * Guarantee: channel will not close immediately, even on invalid input.
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_channel_open (CockpitTransport *transport,
                      guint number,
                      JsonObject *options)
{
  CockpitChannel *channel;
  GType channel_type;
  const gchar *payload;

  if (!cockpit_json_get_string (options, "payload", NULL, &payload))
    payload = NULL;
  if (g_strcmp0 (payload, "dbus-json1") == 0)
    channel_type = COCKPIT_TYPE_DBUS_JSON;
  else if (g_strcmp0 (payload, "text-stream") == 0)
    channel_type = COCKPIT_TYPE_TEXT_STREAM;
  else
    channel_type = COCKPIT_TYPE_CHANNEL;

  channel = g_object_new (channel_type,
                          "transport", transport,
                          "channel", number,
                          "options", options,
                          NULL);

  if (channel_type == COCKPIT_TYPE_CHANNEL)
    {
      if (payload)
        {
          g_warning ("agent doesn't support payloads of type: %s", payload);
          cockpit_channel_close (channel, "not-supported");
        }
      else
        {
          g_warning ("no payload type present in request to open channel");
          cockpit_channel_close (channel, "protocol-error");
        }
    }

  return channel;
}

/**
 * cockpit_channel_close:
 * @self: a channel
 * @problem: the problem or NULL
 *
 * Close the channel. This can be called mulitple times.
 *
 * It may be that the channel doesn't close immediately.
 * The channel will emit the CockpitChannel::closed signal when the
 * channel actually closes.
 *
 * A @reason of NULL represents an orderly close.
 */
void
cockpit_channel_close (CockpitChannel *self,
                       const gchar *reason)
{
  CockpitChannelClass *klass;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  g_assert (klass->close != NULL);
  (klass->close) (self, reason);
}

/* Used by implementations */

/**
 * cockpit_channel_ready:
 * @self: a pipe
 *
 * Called by channel implementations to signal when they're
 * ready. Any messages received before the channel was ready
 * will be delivered to the channel's recv() vfunc in the order
 * that they were received.
 */
void
cockpit_channel_ready (CockpitChannel *self)
{
  CockpitChannelClass *klass;
  GBytes *payload;
  GQueue *queue;

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  g_assert (klass->recv != NULL);

  while (self->priv->received)
    {
      queue = self->priv->received;
      self->priv->received = NULL;
      for (;;)
        {
          payload = g_queue_pop_head (queue);
          if (payload == NULL)
            break;
          (klass->recv) (self, payload);
          g_bytes_unref (payload);
        }
      g_queue_free (queue);
    }

  self->priv->ready = TRUE;
}

/**
 * cockpit_channel_send:
 * @self: a pipe
 * @payload: the message payload to send
 *
 * Called by implementations to send a message over the transport
 * on the right channel.
 *
 * This message is queued, and sent once the transport can.
 */
void
cockpit_channel_send (CockpitChannel *self,
                      GBytes *payload)
{
  cockpit_transport_send (self->priv->transport, self->priv->number, payload);
}

/**
 * cockpit_channel_get_option:
 * @self: a channel
 * @name: the option name
 *
 * Called by implementations to get a string value from the
 * channel's options.
 *
 * Returns: (transfer none): the option value or NULL
 */
const gchar *
cockpit_channel_get_option (CockpitChannel *self,
                            const gchar *name)
{
  const gchar *value;
  if (!cockpit_json_get_string (self->priv->options, name, NULL, &value))
    value = NULL;
  return value;
}
