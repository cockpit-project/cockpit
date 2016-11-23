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

#include "common/cockpitjson.h"
#include "common/cockpitloopback.h"
#include "common/cockpitunicode.h"

#include <json-glib/json-glib.h>

#include <gio/gunixsocketaddress.h>

#include <glib/gstdio.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

const gchar * cockpit_bridge_local_address = NULL;

/**
 * CockpitChannel:
 *
 * A base class for the server (ie: bridge) side of a channel. Derived
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
    gulong control_sig;

    /* Construct arguments */
    CockpitTransport *transport;
    gchar *id;
    JsonObject *open_options;
    gchar **capabilities;

    /* Queued messages before channel is ready */
    gboolean ready;
    GQueue *received;

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
    gboolean base64_encoding;

    /* Other state */
    JsonObject *close_options;

    /* If we've gotten to the main-loop yet */
    guint prepare_tag;
};

enum {
    PROP_0,
    PROP_TRANSPORT,
    PROP_ID,
    PROP_OPTIONS,
    PROP_CAPABILITIES,
};

static guint cockpit_channel_sig_closed;

G_DEFINE_TYPE (CockpitChannel, cockpit_channel, G_TYPE_OBJECT);

static gboolean
on_idle_prepare (gpointer data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (data);
  g_object_ref (self);
  cockpit_channel_prepare (self);
  g_object_unref (self);
  return FALSE;
}

static void
cockpit_channel_init (CockpitChannel *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_CHANNEL,
                                            CockpitChannelPrivate);

  self->priv->prepare_tag = g_idle_add_full (G_PRIORITY_HIGH, on_idle_prepare, self, NULL);
}

static GBytes *
base64_decode (GBytes *bytes)
{
  gconstpointer data;
  guchar *decoded;
  gsize length;
  gint state = 0;
  guint save = 0;

  data = g_bytes_get_data (bytes, &length);

  if (length == 0)
    return g_bytes_new_static ("", 0);

  /* We can use a smaller limit here, since we know the saved state is 0,
     +1 used to avoid calling g_malloc0(0), and hence returning NULL */
  decoded = g_malloc0 ((length / 4) * 3 + 3);
  length = g_base64_decode_step (data, length, decoded, &state, &save);

  return g_bytes_new_take (decoded, length);
}

static GBytes *
base64_encode (GBytes *bytes)
{
  gconstpointer data;
  gchar *encoded;
  gsize length;
  gint state = 0;
  gint save = 0;

  data = g_bytes_get_data (bytes, &length);

  if (length == 0)
    return g_bytes_new_static ("", 0);

  /* We can use a smaller limit here, since we know the saved state is 0,
     +1 is needed for trailing \0, also check for unlikely integer overflow */

  if (length >= ((G_MAXSIZE - 1) / 4 - 1) * 3)
    g_error ("%s: input too large for Base64 encoding (%"G_GSIZE_FORMAT" chars)", G_STRLOC, length);

  encoded = g_malloc ((length / 3 + 1) * 4 + 4);
  length = g_base64_encode_step (data, length, FALSE, encoded, &state, &save);
  length += g_base64_encode_close (FALSE, encoded + length, &state, &save);

  return g_bytes_new_take (encoded, length);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel_id,
                   GBytes *data,
                   gpointer user_data)
{
  CockpitChannel *self = user_data;
  CockpitChannelClass *klass;
  GBytes *decoded = NULL;

  if (g_strcmp0 (channel_id, self->priv->id) != 0)
    return FALSE;

  if (self->priv->received_done)
    {
      cockpit_channel_fail (self, "protocol-error", "channel received message after done");
      return TRUE;
    }

  if (self->priv->ready)
    {
      if (self->priv->base64_encoding)
        data = decoded = base64_decode (data);
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

  if (decoded)
    g_bytes_unref (decoded);

  return TRUE;
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
  CockpitChannelClass *klass;
  const gchar *problem;

  if (g_strcmp0 (channel_id, self->priv->id) != 0)
    return FALSE;

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  if (g_str_equal (command, "close"))
    {
      g_debug ("close channel %s", channel_id);
      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        problem = NULL;
      cockpit_channel_close (self, problem);
      return TRUE;
    }

  if (g_str_equal (command, "done"))
    {
      if (self->priv->received_done)
        {
          cockpit_channel_fail (self, "protocol-error", "channel received second done");
        }
      else
        {
          self->priv->received_done = TRUE;
          if (!self->priv->ready)
            return TRUE;
        }
    }

  if (klass->control)
    return (klass->control) (self, command, options);

  return FALSE;
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
cockpit_channel_constructed (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);

  G_OBJECT_CLASS (cockpit_channel_parent_class)->constructed (object);

  g_return_if_fail (self->priv->id != NULL);

  self->priv->capabilities = NULL;
  self->priv->recv_sig = g_signal_connect (self->priv->transport, "recv",
                                           G_CALLBACK (on_transport_recv), self);
  self->priv->control_sig = g_signal_connect (self->priv->transport, "control",
                                              G_CALLBACK (on_transport_control), self);
  self->priv->close_sig = g_signal_connect (self->priv->transport, "closed",
                                            G_CALLBACK (on_transport_closed), self);
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
          g_message ("unsupported capability required: %s", capabilities[i]);
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
      if (g_str_equal (binary, "base64"))
        {
          self->priv->base64_encoding = TRUE;
        }
      else if (!g_str_equal (binary, "raw"))
        {
          cockpit_channel_fail (self, "protocol-error",
                                "channel has invalid \"binary\" option: %s", binary);
        }
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

  if (self->priv->received)
    g_queue_free_full (self->priv->received, (GDestroyNotify)g_bytes_unref);
  self->priv->received = NULL;

  if (!self->priv->emitted_close)
    cockpit_channel_close (self, "terminated");

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
  GSocketAddress *address;
  GInetAddress *inet;
  const gchar *port;

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


  /*
   * If we're running under a test server, register that server's HTTP address
   * as an internal address, available for use in cockpit channels.
   */

  port = g_getenv ("COCKPIT_TEST_SERVER_PORT");
  if (port)
    {
      inet = g_inet_address_new_loopback (G_SOCKET_FAMILY_IPV4);
      address = g_inet_socket_address_new (inet, atoi (port));
      cockpit_channel_internal_address ("/test-server", address);
      g_object_unref (address);
      g_object_unref (inet);
    }
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
  CockpitChannelClass *klass;
  GBytes *decoded;
  GBytes *payload;
  GQueue *queue;

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  g_assert (klass->recv != NULL);
  g_assert (klass->close != NULL);

  g_object_ref (self);
  while (self->priv->received)
    {
      queue = self->priv->received;
      self->priv->received = NULL;
      for (;;)
        {
          payload = g_queue_pop_head (queue);
          if (payload == NULL)
            break;
          if (self->priv->base64_encoding)
            {
              decoded = base64_decode (payload);
              g_bytes_unref (payload);
              payload = decoded;
            }
          (klass->recv) (self, payload);
          g_bytes_unref (payload);
        }
      g_queue_free (queue);
    }

  cockpit_channel_control (self, "ready", message);
  self->priv->ready = TRUE;

  /* No more data coming? */
  if (self->priv->received_done)
    {
      if (klass->control)
        (klass->control) (self, "done", NULL);
    }

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
  GBytes *encoded = NULL;
  GBytes *validated = NULL;

  if (!trust_is_utf8)
    {
      if (!self->priv->binary_ok)
        payload = validated = cockpit_unicode_force_utf8 (payload);
    }

  if (self->priv->base64_encoding)
    payload = encoded = base64_encode (payload);

  cockpit_transport_send (self->priv->transport, self->priv->id, payload);

  if (encoded)
    g_bytes_unref (encoded);
  if (validated)
    g_bytes_unref (validated);
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
 * can preempt that by calling this function.
 */
void
cockpit_channel_prepare (CockpitChannel *self)
{
  CockpitChannelClass *klass;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));

  if (!self->priv->prepare_tag)
    return;

  g_source_remove (self->priv->prepare_tag);
  self->priv->prepare_tag = 0;

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

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (command != NULL);

  if (g_str_equal (command, "done"))
    {
      g_return_if_fail (self->priv->sent_done == FALSE);
      self->priv->sent_done = TRUE;
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
}

static GHashTable *internal_addresses;

static void
safe_unref (gpointer data)
{
  GObject *object = data;
  if (object != NULL)
    g_object_unref (object);
}

static gboolean
lookup_internal (const gchar *name,
                 GSocketConnectable **connectable)
{
  const gchar *env;
  gboolean ret = FALSE;
  GSocketAddress *address;

  g_assert (name != NULL);
  g_assert (connectable != NULL);

  if (internal_addresses)
    {
      ret = g_hash_table_lookup_extended (internal_addresses, name, NULL,
                                          (gpointer *)connectable);
    }

  if (!ret && g_str_equal (name, "ssh-agent"))
    {
      *connectable = NULL;
      env = g_getenv ("SSH_AUTH_SOCK");
      if (env != NULL && env[0] != '\0')
        {
          address = g_unix_socket_address_new (env);
          *connectable = G_SOCKET_CONNECTABLE (address);
          cockpit_channel_internal_address ("ssh-agent", address);
        }
      ret = TRUE;
    }

  return ret;
}

void
cockpit_channel_internal_address (const gchar *name,
                                  GSocketAddress *address)
{
  if (!internal_addresses)
    {
      internal_addresses = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                  g_free, safe_unref);
    }

  if (address)
    address = g_object_ref (address);

  g_hash_table_replace (internal_addresses, g_strdup (name), address);
}

gboolean
cockpit_channel_remove_internal_address (const gchar *name)
{
  gboolean ret = FALSE;
  if (internal_addresses)
      ret = g_hash_table_remove (internal_addresses, name);
  return ret;
}

static GSocketConnectable *
parse_address (CockpitChannel *self,
               gchar **possible_name,
               gboolean *local_address)
{
  GSocketConnectable *connectable = NULL;
  const gchar *unix_path;
  const gchar *internal;
  const gchar *address;
  JsonObject *options;
  gboolean local = FALSE;
  GError *error = NULL;
  const gchar *host;
  gint64 port;
  gchar *name = NULL;
  gboolean open = FALSE;

  options = self->priv->open_options;
  if (!cockpit_json_get_string (options, "unix", NULL, &unix_path))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"unix\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_int (options, "port", G_MAXINT64, &port))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"port\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "internal", NULL, &internal))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"internal\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "address", NULL, &address))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"address\" option in channel");
      goto out;
    }

  if (port != G_MAXINT64 && unix_path)
    {
      cockpit_channel_fail (self, "protocol-error", "cannot specify both \"port\" and \"unix\" options");
      goto out;
    }
  else if (port != G_MAXINT64)
    {
      if (port <= 0 || port > 65535)
        {
          cockpit_channel_fail (self, "protocol-error", "received invalid \"port\" option");
          goto out;
        }

      if (address)
        {
          connectable = g_network_address_new (address, port);
          host = address;

          /* This isn't perfect, but matches the use case. Specify address => non-local */
          local = FALSE;
        }
      else if (cockpit_bridge_local_address)
        {
          connectable = g_network_address_parse (cockpit_bridge_local_address, port, &error);
          host = cockpit_bridge_local_address;
          local = TRUE;
        }
      else
        {
          connectable = cockpit_loopback_new (port);
          host = "localhost";
          local = TRUE;
        }

      if (error != NULL)
        {
          cockpit_channel_fail (self, "internal-error",
                                "couldn't parse local address: %s: %s", host, error->message);
          goto out;
        }
      else
        {
          name = g_strdup_printf ("%s:%d", host, (gint)port);
        }
    }
  else if (unix_path)
    {
      name = g_strdup (unix_path);
      connectable = G_SOCKET_CONNECTABLE (g_unix_socket_address_new (unix_path));
      local = FALSE;
    }
  else if (internal)
    {
      gboolean reg = lookup_internal (internal, &connectable);

      if (!connectable)
        {
          if (reg)
            cockpit_channel_close (self, "not-found");
          else
            cockpit_channel_fail (self, "not-found", "couldn't find internal address: %s", internal);
          goto out;
        }

      name = g_strdup (internal);
      connectable = g_object_ref (connectable);
      local = FALSE;
    }
  else
    {
      cockpit_channel_fail (self, "protocol-error",
                            "no \"port\" or \"unix\" or other address option for channel");
      goto out;
    }

  open = TRUE;

out:
  g_clear_error (&error);
  if (open)
    {
      if (possible_name)
          *possible_name = g_strdup (name);
      if (local_address)
        *local_address = local;
    }
  else
    {
      if (connectable)
        g_object_unref (connectable);
      connectable = NULL;
    }

  g_free (name);
  return connectable;
}

GSocketAddress *
cockpit_channel_parse_address (CockpitChannel *self,
                               gchar **possible_name)
{
  GSocketConnectable *connectable;
  GSocketAddressEnumerator *enumerator;
  GSocketAddress *address;
  GError *error = NULL;
  gchar *name = NULL;

  connectable = parse_address (self, &name, NULL);
  if (!connectable)
    return NULL;

  /* This is sync, but realistically, it doesn't matter for current use cases */
  enumerator = g_socket_connectable_enumerate (connectable);
  g_object_unref (connectable);

  address = g_socket_address_enumerator_next (enumerator, NULL, &error);
  g_object_unref (enumerator);

  if (error != NULL)
    {
      cockpit_channel_fail (self, "not-found", "couldn't find address: %s: %s", name, error->message);
      g_error_free (error);
      g_free (name);
      return NULL;
    }

  if (possible_name)
    *possible_name = name;
  else
    g_free (name);

  return address;
}

static gboolean
parse_option_file_or_data (CockpitChannel *self,
                           JsonObject *options,
                           const gchar *option,
                           const gchar **file,
                           const gchar **data)
{
  JsonObject *object;
  JsonNode *node;

  g_assert (file != NULL);
  g_assert (data != NULL);

  node = json_object_get_member (options, option);
  if (!node)
    {
      *file = NULL;
      *data = NULL;
      return TRUE;
    }

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"%s\" tls option for channel", option);
      return FALSE;
    }

  object = json_node_get_object (node);

  if (!cockpit_json_get_string (object, "file", NULL, file))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"file\" %s option for channel", option);
    }
  else if (!cockpit_json_get_string (object, "data", NULL, data))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"data\" %s option for channel", option);
    }
  else if (!*file && !*data)
    {
      cockpit_channel_fail (self, "not-supported", "missing or unsupported \"%s\" option for channel", option);
    }
  else if (*file && *data)
    {
      cockpit_channel_fail (self, "protocol-error", "cannot specify both \"file\" and \"data\" in \"%s\" option for channel", option);
    }
  else
    {
      return TRUE;
    }

  return FALSE;
}

static gboolean
load_pem_contents (CockpitChannel *self,
                   const gchar *filename,
                   const gchar *option,
                   GString *pem)
{
  GError *error = NULL;
  gchar *contents = NULL;
  gsize len;

  if (!g_file_get_contents (filename, &contents, &len, &error))
    {
      cockpit_channel_fail (self, "internal-error",
                            "couldn't load \"%s\" file: %s: %s", option, filename, error->message);
      g_clear_error (&error);
      return FALSE;
    }
  else
    {
      g_string_append_len (pem, contents, len);
      g_string_append_c (pem, '\n');
      g_free (contents);
      return TRUE;
    }
}

static gchar *
expand_filename (const gchar *filename)
{
  if (!g_path_is_absolute (filename))
    return g_build_filename (g_get_home_dir (), filename, NULL);
  else
    return g_strdup (filename);
}

static gboolean
parse_cert_option_as_pem (CockpitChannel *self,
                          JsonObject *options,
                          const gchar *option,
                          GString *pem)
{
  gboolean ret = TRUE;
  const gchar *file;
  const gchar *data;
  gchar *path;

  if (!parse_option_file_or_data (self, options, option, &file, &data))
    return FALSE;

  if (file)
    {
      path = expand_filename (file);

      /* For now we assume file contents are PEM */
      ret = load_pem_contents (self, path, option, pem);

      g_free (path);
    }
  else if (data)
    {
      /* Format this as PEM of the given type */
      g_string_append (pem, data);
      g_string_append_c (pem, '\n');
    }

  return ret;
}

static gboolean
parse_cert_option_as_database (CockpitChannel *self,
                               JsonObject *options,
                               const gchar *option,
                               GTlsDatabase **database)
{
  gboolean temporary = FALSE;
  GError *error = NULL;
  gboolean ret = TRUE;
  const gchar *file;
  const gchar *data;
  gchar *path;
  gint fd;

  if (!parse_option_file_or_data (self, options, option, &file, &data))
    return FALSE;

  if (file)
    {
      path = expand_filename (file);
      ret = TRUE;
    }
  else if (data)
    {
      temporary = TRUE;
      path = g_build_filename (g_get_user_runtime_dir (), "cockpit-bridge-cert-authority.XXXXXX", NULL);
      fd = g_mkstemp (path);
      if (fd < 0)
        {
          ret = FALSE;
          cockpit_channel_fail (self, "internal-error",
                                "couldn't create temporary directory: %s: %s", path, g_strerror (errno));
        }
      else
        {
          close (fd);
          if (!g_file_set_contents (path, data, -1, &error))
            {
              cockpit_channel_fail (self, "internal-error",
                                    "couldn't write temporary data to: %s: %s", path, error->message);
              g_clear_error (&error);
              ret = FALSE;
            }
        }
    }
  else
    {
      /* Not specified */
      *database = NULL;
      return TRUE;
    }

  if (ret)
    {
      *database = g_tls_file_database_new (path, &error);
      if (error)
        {
          cockpit_channel_fail (self, "internal-error",
                                "couldn't load certificate data: %s: %s", path, error->message);
          g_clear_error (&error);
          ret = FALSE;
        }
    }

  /* Leave around when problem, for debugging */
  if (temporary && ret == TRUE)
    g_unlink (path);

  g_free (path);

  return ret;
}

static gboolean
parse_stream_options (CockpitChannel *self,
                      CockpitConnectable *connectable)
{
  gboolean ret = FALSE;
  GTlsCertificate *cert = NULL;
  GTlsDatabase *database = NULL;
  gboolean use_tls = FALSE;
  GError *error = NULL;
  GString *pem = NULL;
  JsonObject *options;
  JsonNode *node;

  /* No validation for local servers by default */
  gboolean validate = !connectable->local;

  node = json_object_get_member (self->priv->open_options, "tls");
  if (node && !JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (self, "protocol-error", "invalid \"tls\" option for channel");
      goto out;
    }
  else if (node)
    {
      options = json_node_get_object (node);
      use_tls = TRUE;

      /*
       * The only function in GLib to parse private keys takes
       * them in PEM concatenated form. This is a limitation of GLib,
       * rather than concatenated form being a decent standard for
       * certificates and keys. So build a combined PEM as expected by
       * GLib here.
       */

      pem = g_string_sized_new (8192);

      if (!parse_cert_option_as_pem (self, options, "certificate", pem))
        goto out;

      if (pem->len)
        {
          if (!parse_cert_option_as_pem (self, options, "key", pem))
            goto out;

          cert = g_tls_certificate_new_from_pem (pem->str, pem->len, &error);
          if (error != NULL)
            {
              cockpit_channel_fail (self, "internal-error",
                                    "invalid \"certificate\" or \"key\" content: %s", error->message);
              g_error_free (error);
              goto out;
            }
        }

      if (!parse_cert_option_as_database (self, options, "authority", &database))
        goto out;

      if (!cockpit_json_get_bool (options, "validate", validate, &validate))
        {
          cockpit_channel_fail (self, "protocol-error", "invalid \"validate\" option");
          goto out;
        }
    }

  ret = TRUE;

out:
  if (ret)
    {
      connectable->tls = use_tls;
      connectable->tls_cert = cert;
      cert = NULL;

      if (database)
        {
          connectable->tls_database = database;
          connectable->tls_flags = G_TLS_CERTIFICATE_VALIDATE_ALL;
          if (!validate)
              connectable->tls_flags &= ~(G_TLS_CERTIFICATE_INSECURE | G_TLS_CERTIFICATE_BAD_IDENTITY);
          database = NULL;
        }
      else
        {
          if (validate)
            connectable->tls_flags = G_TLS_CERTIFICATE_VALIDATE_ALL;
          else
            connectable->tls_flags = G_TLS_CERTIFICATE_GENERIC_ERROR;
        }
    }

  if (pem)
    g_string_free (pem, TRUE);
  if (cert)
    g_object_unref (cert);
  if (database)
    g_object_unref (database);

  return ret;
}

CockpitConnectable *
cockpit_channel_parse_stream (CockpitChannel *self)
{
  CockpitConnectable *connectable;
  GSocketConnectable *address;
  gboolean local;
  gchar *name;

  address = parse_address (self, &name, &local);
  if (!address)
    return NULL;

  connectable = g_new0 (CockpitConnectable, 1);
  connectable->address = address;
  connectable->name = name;
  connectable->refs = 1;
  connectable->local = local;

  if (!parse_stream_options (self, connectable))
    {
      cockpit_connectable_unref (connectable);
      connectable = NULL;
    }

  return connectable;
}
