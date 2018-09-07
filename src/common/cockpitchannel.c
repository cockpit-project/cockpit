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

#include "common/cockpitflow.h"
#include "common/cockpitjson.h"
#include "common/cockpitunicode.h"

#include <json-glib/json-glib.h>

#include <stdlib.h>
#include <string.h>

/**
 * CockpitChannel:
 *
 * A base class for channels. Derived classes implement the actual payload
 * contents, opening the channel etc...
 *
 * A CockpitChannel is the base class for C code where messages on
 * the internal protocol are translated to IO of another type, be
 * that HTTP, stdio, DBus, WebSocket, file access, or whatever. Another
 * similar analogue to this code is the javascript cockpit.channel code
 * in cockpit.js.
 *
 * Most uses of this code are in the bridges, but cockpit-ws also (rarely)
 * uses CockpitChannel to translate the frontend side of channels to HTTP
 * or WebSocket responses.
 *
 * The channel queues messages received until unfrozen. The caller can
 * start off a channel as frozen, and then the implementation later
 * indicates that it's open and ready to receive messages.
 *
 * A channel sends messages over a #CockpitTransport. If the transport
 * closes then the channel closes, but the channel can also close
 * individually either for failure reasons, or with an orderly shutdown.
 *
 * See doc/protocol.md for information about channels.
 *
 * A channel can do flow control in two ways:
 *
 *  - It can throttle its peer sending data, by delaying responding to "ping"
 *    messages. It can listen to a "pressure" signal to control this.
 *  - It can optionally control another flow, by emitting a "pressure" signal
 *    when its peer receiving data does not respond to "ping" messages within
 *    a given window.
 */

/* Every 16K Send a ping */
#define  CHANNEL_FLOW_PING        (16L * 1024L)

/* Allow up to 1MB of data to be sent without ack */
#define  CHANNEL_FLOW_WINDOW       (2L * 1024L * 1024L)

struct _CockpitChannelPrivate {
    gulong recv_sig;
    gulong close_sig;
    gulong control_sig;

    /* Construct arguments */
    CockpitTransport *transport;
    gchar *id;
    JsonObject *open_options;
    gchar **capabilities;

    /* Queued messages before channel is ready */
    gboolean prepared;
    guint prepare_tag;

    /* Whether we've sent a closed message */
    gboolean sent_close;

    /* Whether we called the close vfunc */
    gboolean emitted_close;

    /* Whether the transport closed (before we did) */
    gboolean transport_closed;

    /* EOF flags */
    gboolean sent_done;
    gboolean received_done;

    /* Binary options */
    gboolean binary_ok;

    /* Other state */
    JsonObject *close_options;

    /* Buffer for incomplete unicode bytes */
    GBytes *out_buffer;
    gint buffer_timeout;

    /* The number of bytes sent, and current flow control window */
    gint64 out_sequence;
    gint64 out_window;

    /* Another object giving back-pressure on received data */
    gboolean flow_control;
    CockpitFlow *pressure;
    gulong pressure_sig;
    GQueue *throttled;
};

enum {
    PROP_0,
    PROP_TRANSPORT,
    PROP_ID,
    PROP_OPTIONS,
    PROP_CAPABILITIES,
};

static guint cockpit_channel_sig_closed;

static void    cockpit_channel_flow_iface_init     (CockpitFlowIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitChannel, cockpit_channel, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, cockpit_channel_flow_iface_init));

static gboolean
on_idle_prepare (gpointer data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (data);
  g_object_ref (self);
  self->priv->prepare_tag = 0;
  cockpit_channel_prepare (self);
  g_object_unref (self);
  return FALSE;
}

static void
cockpit_channel_init (CockpitChannel *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_CHANNEL,
                                            CockpitChannelPrivate);

  self->priv->out_sequence = 0;
  self->priv->out_window = CHANNEL_FLOW_WINDOW;
}

static void
process_recv (CockpitChannel *self,
              GBytes *payload)
{
  CockpitChannelClass *klass;

  if (self->priv->received_done)
    {
      cockpit_channel_fail (self, "protocol-error", "channel received message after done");
    }
  else
    {
      klass = COCKPIT_CHANNEL_GET_CLASS (self);
      if (klass->recv)
        (klass->recv) (self, payload);
    }
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel_id,
                   GBytes *data,
                   gpointer user_data)
{
  CockpitChannel *self = user_data;

  if (g_strcmp0 (channel_id, self->priv->id) != 0)
    return FALSE;

  process_recv (self, data);
  return TRUE;
}

static gboolean
process_ping (CockpitChannel *self,
              JsonObject *ping)
{
  GBytes *payload;

  if (self->priv->throttled)
    {
      g_debug ("%s: received ping while throttled", self->priv->id);
      g_queue_push_tail (self->priv->throttled, json_object_ref (ping));
      return FALSE;
    }
  else
    {
      g_debug ("%s: replying to ping with pong", self->priv->id);
      json_object_set_string_member (ping, "command", "pong");
      payload = cockpit_json_write_bytes (ping);
      cockpit_transport_send (self->priv->transport, NULL, payload);
      g_bytes_unref (payload);
      return TRUE;
    }
}

static void
process_pong (CockpitChannel *self,
              JsonObject *pong)
{
  gint64 sequence;

  if (!self->priv->flow_control)
    return;

  if (!cockpit_json_get_int (pong, "sequence", -1, &sequence))
    {
      g_message ("%s: received invalid \"pong\" \"sequence\" field", self->priv->id);
      sequence = -1;
    }

  g_debug ("%s: received pong with sequence: %" G_GINT64_FORMAT, self->priv->id, sequence);
  if (sequence > self->priv->out_window + (CHANNEL_FLOW_WINDOW * 10))
    {
      g_message ("%s: received a flow control ack with a suspiciously large sequence: %" G_GINT64_FORMAT,
                 self->priv->id, sequence);
    }

  if (sequence >= self->priv->out_window)
    {
      /* Up to this point has been confirmed received */
      self->priv->out_window = sequence + CHANNEL_FLOW_WINDOW;

      /* If our sent bytes are within the window, no longer under pressure */
      if (self->priv->out_sequence <= self->priv->out_window)
        cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);
    }
}

static void
process_control (CockpitChannel *self,
                 const gchar *command,
                 JsonObject *options)
{
  CockpitChannelClass *klass;
  const gchar *problem;

  if (g_str_equal (command, "close"))
    {
      g_debug ("close channel %s", self->priv->id);
      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        problem = NULL;
      cockpit_channel_close (self, problem);
      return;
    }

  if (g_str_equal (command, "ping"))
    {
      process_ping (self, options);
      return;
    }
  else if (g_str_equal (command, "pong"))
    {
      process_pong (self, options);
      return;
    }
  else if (g_str_equal (command, "done"))
    {
      if (self->priv->received_done)
        cockpit_channel_fail (self, "protocol-error", "channel received second done");
      else
        self->priv->received_done = TRUE;
    }

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  if (klass->control)
    (klass->control) (self, command, options);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitChannel *self = user_data;

  if (g_strcmp0 (channel_id, self->priv->id) != 0)
    return FALSE;

  process_control (self, command, options);
  return TRUE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (user_data);
  self->priv->transport_closed = TRUE;
  if (problem == NULL)
    problem = "disconnected";
  if (!self->priv->emitted_close)
    cockpit_channel_close (self, problem);
}

static void
cockpit_channel_actual_send (CockpitChannel *self,
                             GBytes *payload,
                             gboolean trust_is_utf8)
{
  GBytes *validated = NULL;
  guint64 out_sequence;
  JsonObject *ping;
  gsize size;

  g_return_if_fail (self->priv->out_buffer == NULL);
  g_return_if_fail (self->priv->buffer_timeout == 0);

  if (!trust_is_utf8)
    {
      if (!self->priv->binary_ok)
         payload = validated = cockpit_unicode_force_utf8 (payload);
    }

  cockpit_transport_send (self->priv->transport, self->priv->id, payload);

  /* A wraparound of our gint64 size? */
  if (self->priv->flow_control)
    {
      size = g_bytes_get_size (payload);
      g_return_if_fail (G_MAXINT64 - size > self->priv->out_sequence);

      /* How many bytes have been sent (queued) */
      out_sequence = self->priv->out_sequence + size;

      /* Every CHANNEL_FLOW_PING bytes we send a ping */
      if (out_sequence / CHANNEL_FLOW_PING != self->priv->out_sequence / CHANNEL_FLOW_PING)
        {
          ping = json_object_new ();
          json_object_set_int_member (ping, "sequence", out_sequence);
          cockpit_channel_control (self, "ping", ping);
          g_debug ("%s: sending ping with sequence: %" G_GINT64_FORMAT, self->priv->id, out_sequence);
          json_object_unref (ping);
        }

      /* If we've sent more than the window, apply back pressure */
      self->priv->out_sequence = out_sequence;
      if (self->priv->out_sequence > self->priv->out_window)
        {
          g_debug ("%s: sent too much data without acknowledgement, emitting back pressure until %"
                   G_GINT64_FORMAT, self->priv->id, self->priv->out_window);
          cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);
        }
    }

  if (validated)
    g_bytes_unref (validated);
}

static gboolean
flush_buffer (gpointer user_data)
{
  CockpitChannel *self = user_data;
  GBytes *payload;

  if (self->priv->out_buffer)
   {
      payload = g_bytes_ref (self->priv->out_buffer);
      g_bytes_unref (self->priv->out_buffer);
      self->priv->out_buffer = NULL;
      self->priv->buffer_timeout = 0;

      cockpit_channel_actual_send (self, payload, FALSE);
      g_bytes_unref (payload);
    }

  return FALSE;
}

static void
cockpit_channel_constructed (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  G_OBJECT_CLASS (cockpit_channel_parent_class)->constructed (object);

  g_return_if_fail (self->priv->id != NULL);
  g_return_if_fail (self->priv->transport != NULL);

  self->priv->capabilities = NULL;
  self->priv->recv_sig = g_signal_connect (self->priv->transport, "recv",
                                           G_CALLBACK (on_transport_recv), self);
  self->priv->control_sig = g_signal_connect (self->priv->transport, "control",
                                              G_CALLBACK (on_transport_control), self);
  self->priv->close_sig = g_signal_connect (self->priv->transport, "closed",
                                            G_CALLBACK (on_transport_closed), self);

  /* Freeze this channel's messages until ready */
  cockpit_transport_freeze (self->priv->transport, self->priv->id);
  self->priv->prepare_tag = g_idle_add_full (G_PRIORITY_HIGH, on_idle_prepare, self, NULL);
}


static gboolean
strv_contains (gchar **strv,
               gchar *str)
{
  g_return_val_if_fail (strv != NULL, FALSE);
  g_return_val_if_fail (str != NULL, FALSE);

  for (; *strv != NULL; strv++)
    {
      if (g_str_equal (str, *strv))
        return TRUE;
    }
  return FALSE;
}

static gboolean
cockpit_channel_ensure_capable (CockpitChannel *channel,
                                JsonObject *options)
{
  gchar **capabilities = NULL;
  JsonObject *close_options = NULL; // owned by channel
  gboolean missing = FALSE;
  gboolean ret = FALSE;
  gint len;
  gint i;

  if (!cockpit_json_get_strv (options, "capabilities", NULL, &capabilities))
    {
      cockpit_channel_fail (channel, "protocol-error", "got invalid capabilities field in open message");
      goto out;
    }

  if (!capabilities)
    {
      ret = TRUE;
      goto out;
    }

  len = g_strv_length (capabilities);
  for (i = 0; i < len; i++)
    {
      if (channel->priv->capabilities == NULL ||
          !strv_contains(channel->priv->capabilities, capabilities[i]))
        {
          g_message ("%s: unsupported capability required: %s", channel->priv->id, capabilities[i]);
          missing = TRUE;
        }
    }

  if (missing)
    {
      JsonArray *arr = json_array_new (); // owned by closed options

      if (channel->priv->capabilities != NULL)
        {
          len = g_strv_length (channel->priv->capabilities);
          for (i = 0; i < len; i++)
            json_array_add_string_element (arr, channel->priv->capabilities[i]);
        }

      close_options = cockpit_channel_close_options (channel);
      json_object_set_array_member (close_options, "capabilities", arr);
      cockpit_channel_close (channel, "not-supported");
    }

  ret = !missing;

out:
  g_free (capabilities);
  return ret;
}

static void
cockpit_channel_real_prepare (CockpitChannel *channel)
{
  CockpitChannel *self = COCKPIT_CHANNEL (channel);
  JsonObject *options;
  const gchar *binary;

  options = cockpit_channel_get_options (self);

  if (!cockpit_channel_ensure_capable (self, options))
    return;

  if (G_OBJECT_TYPE (channel) == COCKPIT_TYPE_CHANNEL)
    {
      cockpit_channel_close (channel, "not-supported");
      return;
    }

  if (!cockpit_json_get_string (options, "binary", NULL, &binary))
    {
      cockpit_channel_fail (self, "protocol-error", "channel has invalid \"binary\" option");
    }
  else if (binary != NULL)
    {
      self->priv->binary_ok = TRUE;
      if (!g_str_equal (binary, "raw"))
        {
          cockpit_channel_fail (self, "protocol-error",
                                "channel has invalid \"binary\" option: %s", binary);
        }
    }

  /*
   * The default here, can change from FALSE to TRUE over time once we assume that all
   * cockpit-ws participants have been upgraded sufficiently. The default when we're
   * on the channel creation side is to handle flow control.
   */
  if (!cockpit_json_get_bool (options, "flow-control", FALSE, &self->priv->flow_control))
    {
      cockpit_channel_fail (self, "protocol-error", "channel has invalid \"flow-control\" option");
    }
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
    case PROP_ID:
      g_value_set_string (value, self->priv->id);
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
    case PROP_ID:
      self->priv->id = g_value_dup_string (value);
      break;
    case PROP_OPTIONS:
      self->priv->open_options = g_value_dup_boxed (value);
      break;
    case PROP_CAPABILITIES:
      g_return_if_fail (self->priv->capabilities == NULL);
      self->priv->capabilities = g_value_dup_boxed (value);
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

  /*
   * This object was destroyed before going to the main loop
   * no need to wait until later before we fire various signals.
   */
  if (self->priv->prepare_tag)
    {
      g_source_remove (self->priv->prepare_tag);
      self->priv->prepare_tag = 0;
    }

  if (self->priv->recv_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->recv_sig);
  self->priv->recv_sig = 0;

  if (self->priv->control_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->control_sig);
  self->priv->control_sig = 0;

  if (self->priv->close_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->close_sig);
  self->priv->close_sig = 0;

  if (!self->priv->emitted_close)
    cockpit_channel_close (self, "terminated");

  if (self->priv->buffer_timeout)
    g_source_remove(self->priv->buffer_timeout);
  self->priv->buffer_timeout = 0;

  if (self->priv->out_buffer)
    g_bytes_unref (self->priv->out_buffer);
  self->priv->out_buffer = NULL;

  cockpit_flow_throttle (COCKPIT_FLOW (self), NULL);
  g_assert (self->priv->pressure == NULL);
  if (self->priv->throttled)
    g_queue_free_full (self->priv->throttled, (GDestroyNotify)json_object_unref);
  self->priv->throttled = NULL;

  G_OBJECT_CLASS (cockpit_channel_parent_class)->dispose (object);
}

static void
cockpit_channel_finalize (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  g_object_unref (self->priv->transport);
  if (self->priv->open_options)
    json_object_unref (self->priv->open_options);
  if (self->priv->close_options)
    json_object_unref (self->priv->close_options);

  g_strfreev (self->priv->capabilities);
  g_free (self->priv->id);

  G_OBJECT_CLASS (cockpit_channel_parent_class)->finalize (object);
}

static void
cockpit_channel_real_close (CockpitChannel *self,
                            const gchar *problem)
{
  JsonObject *object;
  GBytes *message;

  if (self->priv->sent_close)
    return;

  self->priv->sent_close = TRUE;

  if (!self->priv->transport_closed)
    {
      flush_buffer (self);

      if (self->priv->close_options)
        {
          object = self->priv->close_options;
          self->priv->close_options = NULL;
        }
      else
        {
          object = json_object_new ();
        }

      json_object_set_string_member (object, "command", "close");
      json_object_set_string_member (object, "channel", self->priv->id);
      if (problem)
        json_object_set_string_member (object, "problem", problem);

      message = cockpit_json_write_bytes (object);
      json_object_unref (object);

      cockpit_transport_send (self->priv->transport, NULL, message);
      g_bytes_unref (message);
    }

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

  klass->prepare = cockpit_channel_real_prepare;
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
  g_object_class_install_property (gobject_class, PROP_ID,
                                   g_param_spec_string ("id", "id", "id", NULL,
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
   * CockpitChannel:capabilities:
   *
   * The capabilties that this channel supports.
   */
  g_object_class_install_property (gobject_class, PROP_CAPABILITIES,
                                   g_param_spec_boxed ("capabilities",
                                                       "Capabilities",
                                                       "Channel Capabilities",
                                                       G_TYPE_STRV,
                                                       G_PARAM_WRITABLE | G_PARAM_STATIC_STRINGS));

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
 * If this is called immediately after or during construction then
 * the closing will happen after the main loop so that handlers
 * can connect appropriately.
 *
 * A @problem of NULL represents an orderly close.
 */
void
cockpit_channel_close (CockpitChannel *self,
                       const gchar *problem)
{
  CockpitChannelClass *klass;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));

  /* No further messages should be received */
  if (self->priv->recv_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->recv_sig);
  self->priv->recv_sig = 0;

  if (self->priv->control_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->control_sig);
  self->priv->control_sig = 0;

  if (self->priv->close_sig)
    g_signal_handler_disconnect (self->priv->transport, self->priv->close_sig);
  self->priv->close_sig = 0;

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  g_assert (klass->close != NULL);
  self->priv->emitted_close = TRUE;
  (klass->close) (self, problem);
}

/*
 * cockpit_channel_fail:
 * @self: a channel
 * @problem: the problem
 *
 * Close the channel with a @problem. In addition a "message" field
 * will be set on the channel, using the @format argument to bulid
 * the message. The message will also be logged.
 *
 * See cockpit_channel_close() for further info.
 */
void
cockpit_channel_fail (CockpitChannel *self,
                      const gchar *problem,
                      const gchar *format,
                      ...)
{
  JsonObject *options;
  gchar *message;
  va_list va;

  g_return_if_fail (problem != NULL);
  g_return_if_fail (COCKPIT_IS_CHANNEL (self));

  va_start (va, format);
  message = g_strdup_vprintf (format, va);
  va_end (va);

  options = cockpit_channel_close_options (self);
  if (!json_object_has_member (options, "message"))
    json_object_set_string_member (options, "message", message);
  g_message ("%s: %s", self->priv->id, message);
  g_free (message);

  cockpit_channel_close (self, problem);
}

/* Used by implementations */

/**
 * cockpit_channel_ready:
 * @self: a pipe
 * @message: an optional control message, or NULL
 *
 * Called by channel implementations to signal when they're
 * ready. Any messages received before the channel was ready
 * will be delivered to the channel's recv() vfunc in the order
 * that they were received.
 *
 * If this is called immediately after or during construction then
 * the closing will happen after the main loop so that handlers
 * can connect appropriately.
 */
void
cockpit_channel_ready (CockpitChannel *self,
                       JsonObject *message)
{
  g_object_ref (self);

  cockpit_transport_thaw (self->priv->transport, self->priv->id);
  cockpit_channel_control (self, "ready", message);

  g_object_unref (self);
}

/**
 * cockpit_channel_send:
 * @self: a pipe
 * @payload: the message payload to send
 * @trust_is_utf8: set to true if sure data is UTF8
 *
 * Called by implementations to send a message over the transport
 * on the right channel.
 *
 * This message is queued, and sent once the transport can.
 */
void
cockpit_channel_send (CockpitChannel *self,
                      GBytes *payload,
                      gboolean trust_is_utf8)
{
  const guint8 *data;
  gsize length;
  GBytes *send_data = payload;
  GByteArray *combined;

  if (self->priv->buffer_timeout)
    g_source_remove(self->priv->buffer_timeout);
  self->priv->buffer_timeout = 0;

  if (self->priv->out_buffer)
    {
      combined = g_bytes_unref_to_array (self->priv->out_buffer);
      self->priv->out_buffer = NULL;

      data = g_bytes_get_data (payload, &length);
      g_byte_array_append (combined, data, length);
      send_data = g_byte_array_free_to_bytes (combined);

      trust_is_utf8 = FALSE;
    }

  if (!trust_is_utf8 && !self->priv->binary_ok)
    {
      if (cockpit_unicode_has_incomplete_ending (send_data))
        {
          self->priv->out_buffer = g_bytes_ref (send_data);
          self->priv->buffer_timeout = g_timeout_add (500, flush_buffer, self);
        }
    }

  if (!self->priv->buffer_timeout)
    cockpit_channel_actual_send (self, send_data, trust_is_utf8);

  if (send_data != payload)
    g_bytes_unref (send_data);
}

/**
 * cockpit_channel_get_option:
 * @self: a channel
 *
 * Called by implementations to get the channel's open options.
 *
 * Returns: (transfer none): the open options, should not be NULL
 */
JsonObject *
cockpit_channel_get_options (CockpitChannel *self)
{
  g_return_val_if_fail (COCKPIT_IS_CHANNEL (self), NULL);
  return self->priv->open_options;
}

/**
 * cockpit_channel_get_transport:
 * @self: a channel
 *
 * Called by implementations to get the channel's transtport.
 *
 * Returns: (transfer none): the transport, should not be NULL
 */
CockpitTransport *
cockpit_channel_get_transport (CockpitChannel *self)
{
  g_return_val_if_fail (COCKPIT_IS_CHANNEL (self), NULL);
  return self->priv->transport;
}

/**
 * cockpit_channel_close_options
 * @self: a channel
 *
 * Called by implementations to get the channel's close options.
 *
 * Returns: (transfer none): the close options, should not be NULL
 */
JsonObject *
cockpit_channel_close_options (CockpitChannel *self)
{
  g_return_val_if_fail (COCKPIT_IS_CHANNEL (self), NULL);
  if (!self->priv->close_options)
    self->priv->close_options = json_object_new ();
  return self->priv->close_options;
}

/**
 * cockpit_channel_get_id:
 * @self a channel
 *
 * Get the identifier for this channel.
 *
 * Returns: (transfer none): the identifier
 */
const gchar *
cockpit_channel_get_id (CockpitChannel *self)
{
  g_return_val_if_fail (COCKPIT_IS_CHANNEL (self), NULL);
  return self->priv->id;
}

/**
 * cockpit_channel_prepare:
 * @self: the channel
 *
 * Usually this is automatically called after the channel is
 * created and control returns to the mainloop. However you
 * can preempt that by calling this function. In the case of
 * a frozen channel, this method needs to be called to set
 * things in motion.
 */
void
cockpit_channel_prepare (CockpitChannel *self)
{
  CockpitChannelClass *klass;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));

  if (self->priv->prepared)
    return;

  if (self->priv->prepare_tag)
    {
      g_source_remove (self->priv->prepare_tag);
      self->priv->prepare_tag = 0;
    }

  self->priv->prepared = TRUE;
  if (!self->priv->emitted_close)
    {
      klass = COCKPIT_CHANNEL_GET_CLASS (self);
      g_assert (klass->prepare);
      (klass->prepare) (self);
    }
}

/**
 * cockpit_channel_control:
 * @self: the channel
 * @command: the control command
 * @options: optional control message or NULL
 *
 * Send a control message to the other side.
 *
 * If @options is not NULL, then it may be modified by this code.
 *
 * With @command of "done" will send an EOF to the other side. This
 * should only be called once. Whether an EOF should be sent or not
 * depends on the payload type.
 */
void
cockpit_channel_control (CockpitChannel *self,
                         const gchar *command,
                         JsonObject *options)
{
  JsonObject *object;
  GBytes *message;
  const gchar *problem;
  gchar *problem_copy = NULL;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (command != NULL);

  if (g_str_equal (command, "done"))
    {
      g_return_if_fail (self->priv->sent_done == FALSE);
      self->priv->sent_done = TRUE;
    }

  /* If closing save the close options
   * and let close send the message */
  else if (g_str_equal (command, "close"))
    {
      if (!self->priv->close_options)
        {
          /* Ref for close_options, freed in parent */
          self->priv->close_options = json_object_ref (options);
        }

      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        problem = NULL;

      /* Use a problem copy so it out lasts the value in close_options */
      problem_copy = g_strdup (problem);
      cockpit_channel_close (self, problem_copy);
      goto out;
    }

  if (options)
    object = json_object_ref (options);
  else
    object = json_object_new ();

  json_object_set_string_member (object, "command", command);
  json_object_set_string_member (object, "channel", self->priv->id);

  message = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (self->priv->transport, NULL, message);
  g_bytes_unref (message);

out:
  g_free (problem_copy);
}

static void
on_throttle_pressure (GObject *object,
                      gboolean throttle,
                      gpointer user_data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (user_data);
  GQueue *throttled;
  JsonObject *ping;

  if (throttle)
    {
      if (!self->priv->throttled)
        self->priv->throttled = g_queue_new ();
    }
  else
    {
      throttled = self->priv->throttled;
      self->priv->throttled = NULL;
      while (throttled)
        {
          ping = g_queue_pop_head (throttled);
          if (!ping)
            {
              g_queue_free (throttled);
              throttled = NULL;
            }
          else
            {
              if (!process_ping (self, ping))
                g_assert_not_reached (); /* Because throttle is FALSE */
              json_object_unref (ping);
            }
        }
    }
}

static void
cockpit_channel_throttle (CockpitFlow *flow,
                          CockpitFlow *controlling)
{
  CockpitChannel *self = COCKPIT_CHANNEL (flow);

  if (self->priv->pressure)
    {
      g_signal_handler_disconnect (self->priv->pressure, self->priv->pressure_sig);
      g_object_remove_weak_pointer (G_OBJECT (self->priv->pressure), (gpointer *)&self->priv->pressure);
      self->priv->pressure = NULL;
    }

  if (controlling)
    {
      self->priv->pressure = controlling;
      g_object_add_weak_pointer (G_OBJECT (self->priv->pressure), (gpointer *)&self->priv->pressure);
      self->priv->pressure_sig = g_signal_connect (controlling, "pressure", G_CALLBACK (on_throttle_pressure), self);
    }
}

static void
cockpit_channel_flow_iface_init (CockpitFlowIface *iface)
{
  iface->throttle = cockpit_channel_throttle;
}
