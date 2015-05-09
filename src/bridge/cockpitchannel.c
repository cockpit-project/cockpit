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

#include <json-glib/json-glib.h>

#include <gio/gunixsocketaddress.h>

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
      g_warning ("%s: channel received message after done", self->priv->id);
      cockpit_channel_close (self, "protocol-error");
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
  if (g_str_equal (command, "options"))
    {
      if (klass->options)
        (klass->options) (self, options);
      return TRUE;
    }
  else if (g_str_equal (command, "done"))
    {
      if (self->priv->received_done)
        {
          g_warning ("%s: channel received second done", self->priv->id);
          cockpit_channel_close (self, "protocol-error");
        }
      else
        {
          self->priv->received_done = TRUE;
          if (self->priv->ready)
            {
              if (klass->done)
                (klass->done) (self);
            }
        }
      return TRUE;
    }
  else if (g_str_equal (command, "close"))
    {
      g_debug ("close channel %s", channel_id);
      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        problem = NULL;
      cockpit_channel_close (self, problem);
    }

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

  self->priv->recv_sig = g_signal_connect (self->priv->transport, "recv",
                                           G_CALLBACK (on_transport_recv), self);
  self->priv->control_sig = g_signal_connect (self->priv->transport, "control",
                                              G_CALLBACK (on_transport_control), self);
  self->priv->close_sig = g_signal_connect (self->priv->transport, "closed",
                                            G_CALLBACK (on_transport_closed), self);
}

static void
cockpit_channel_real_prepare (CockpitChannel *channel)
{
  CockpitChannel *self = COCKPIT_CHANNEL (channel);
  JsonObject *options;
  const gchar *binary;
  const gchar *payload;

  options = cockpit_channel_get_options (self);

  if (G_OBJECT_TYPE (channel) == COCKPIT_TYPE_CHANNEL)
    {
      if (!cockpit_json_get_string (options, "payload", NULL, &payload))
        payload = NULL;

      if (payload)
        {
          g_warning ("bridge doesn't support payloads of type: %s", payload);
          cockpit_channel_close (channel, "not-supported");
        }
      else
        {
          g_warning ("no payload type present in request to open channel");
          cockpit_channel_close (channel, "protocol-error");
        }
      return;
    }

  if (!cockpit_json_get_string (options, "binary", NULL, &binary))
    {
      g_warning ("%s: channel has invalid \"binary\" option", self->priv->id);
      cockpit_channel_close (self, "protocol-error");
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
          g_warning ("%s: channel has invalid \"binary\" option: %s", self->priv->id, binary);
          cockpit_channel_close (self, "protocol-error");
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
      cockpit_channel_internal_address ("test-server", address);
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

/* Used by implementations */

/**
 * cockpit_channel_ready:
 * @self: a pipe
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
cockpit_channel_ready (CockpitChannel *self)
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

  self->priv->ready = TRUE;

  /* No more data coming? */
  if (self->priv->received_done)
    {
      if (klass->done)
        (klass->done) (self);
    }

  g_object_unref (self);
}

static GBytes *
check_utf8_and_force_if_necessary (GBytes *input)
{
  const gchar *data;
  const gchar *end;
  gsize length;
  GString *string;

  data = g_bytes_get_data (input, &length);
  if (g_utf8_validate (data, length, &end))
    return g_bytes_ref (input);

  string = g_string_sized_new (length + 16);
  do
    {
      /* Valid part of the string */
      g_string_append_len (string, data, end - data);

      /* Replacement character */
      g_string_append (string, "\xef\xbf\xbd");

      length -= (end - data) + 1;
      data = end + 1;
    }
  while (!g_utf8_validate (data, length, &end));

  if (length)
    g_string_append_len (string, data, length);

  return g_string_free_to_bytes (string);
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
        payload = validated = check_utf8_and_force_if_necessary (payload);
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
 * cockpit_channel_done:
 * @self: the channel
 *
 * Send an EOF to the other side. This should only be called once.
 * Whether an EOF should be sent or not depends on the payload type.
 */
void
cockpit_channel_done (CockpitChannel *self)
{
  JsonObject *object;
  GBytes *message;

  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (self->priv->sent_done == FALSE);

  self->priv->sent_done = TRUE;

  object = json_object_new ();
  json_object_set_string_member (object, "command", "done");
  json_object_set_string_member (object, "channel", self->priv->id);

  message = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (self->priv->transport, NULL, message);
  g_bytes_unref (message);
}

static GHashTable *internal_addresses;

void
cockpit_channel_internal_address (const gchar *name,
                                  GSocketAddress *address)
{
  if (!internal_addresses)
    {
      internal_addresses = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                  g_free, g_object_unref);
    }

  g_hash_table_replace (internal_addresses, g_strdup (name), g_object_ref (address));
}

GSocketConnectable *
cockpit_channel_parse_connectable (CockpitChannel *self,
                                   gchar **possible_name)
{
  const gchar *problem = "protocol-error";
  GSocketConnectable *connectable = NULL;
  const gchar *unix_path;
  const gchar *internal;
  JsonObject *options;
  GError *error = NULL;
  const gchar *host;
  gint64 port;

  options = self->priv->open_options;
  if (!cockpit_json_get_string (options, "unix", NULL, &unix_path))
    {
      g_warning ("invalid \"unix\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_int (options, "port", G_MAXINT64, &port))
    {
      g_warning ("invalid \"port\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "internal", NULL, &internal))
    {
      g_warning ("invalid \"internal\" option in channel");
      goto out;
    }

  if (port != G_MAXINT64 && unix_path)
    {
      g_warning ("cannot specify both \"port\" and \"unix\" options");
      goto out;
    }
  else if (port != G_MAXINT64)
    {
      if (port <= 0 || port > 65535)
        {
          g_warning ("received invalid \"port\" option");
          goto out;
        }

      if (cockpit_bridge_local_address)
        {
          connectable = g_network_address_parse (cockpit_bridge_local_address, port, &error);
          host = cockpit_bridge_local_address;
        }
      else
        {
          connectable = cockpit_loopback_new (port);
          host = "localhost";
        }
      if (error != NULL)
        {
          g_warning ("couldn't parse local address: %s: %s", host, error->message);
          problem = "internal-error";
          goto out;
        }
      else
        {
          if (possible_name)
            *possible_name = g_strdup_printf ("%s:%d", host, (gint)port);
        }
    }
  else if (unix_path)
    {
      if (possible_name)
        *possible_name = g_strdup (unix_path);
      connectable = G_SOCKET_CONNECTABLE (g_unix_socket_address_new (unix_path));
    }
  else if (internal)
    {
      if (internal_addresses)
        connectable = g_hash_table_lookup (internal_addresses, internal);
      if (!connectable)
        {
          g_warning ("couldn't find internal address: %s", internal);
          problem = "not-found";
          goto out;
        }

      if (possible_name)
        *possible_name = g_strdup (internal);
      connectable = g_object_ref (connectable);
    }
  else
    {
      g_warning ("no \"port\" or \"unix\" or other address option for channel");
      goto out;
    }

  problem = NULL;

out:
  g_clear_error (&error);
  if (problem)
    {
      cockpit_channel_close (self, problem);
      if (connectable)
        g_object_unref (connectable);
      connectable = NULL;
    }
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

  connectable = cockpit_channel_parse_connectable (self, &name);
  if (!connectable)
    return NULL;

  /* This is sync, but realistically, it doesn't matter for current use cases */
  enumerator = g_socket_connectable_enumerate (connectable);
  g_object_unref (connectable);

  address = g_socket_address_enumerator_next (enumerator, NULL, &error);
  g_object_unref (enumerator);

  if (error != NULL)
    {
      g_warning ("couldn't find address: %s: %s", name, error->message);
      cockpit_channel_close (self, "not-found");
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

CockpitStreamOptions *
cockpit_channel_parse_stream (CockpitChannel *self)
{
  const gchar *problem = "protocol-error";
  CockpitStreamOptions *ret;
  gboolean use_tls = FALSE;
  JsonNode *node;

  node = json_object_get_member (self->priv->open_options, "tls");
  if (node && !JSON_NODE_HOLDS_OBJECT (node))
    {
      g_warning ("invalid \"tls\" option for channel");
      goto out;
    }

  use_tls = node != NULL;
  problem = NULL;

out:
  if (problem)
    {
      cockpit_channel_close (self, problem);
      return NULL;
    }

  ret = g_new0 (CockpitStreamOptions, 1);
  ret->refs = 1;
  ret->tls_client = use_tls;
  ret->tls_client_flags = 0; /* No validation for local servers */

  return ret;
}
