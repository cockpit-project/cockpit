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
#include "cockpitechochannel.h"
#include "cockpitnullchannel.h"
#include "cockpitrestjson.h"
#include "cockpitresource.h"
#include "cockpitstream.h"
#include "cockpitfsread.h"
#include "cockpitfswrite.h"
#include "cockpitfswatch.h"
#include "cockpitfsdir.h"

#include "deprecated/cockpitdbusjson1.h"
#include "deprecated/cockpitdbusjson2.h"

#include "common/cockpitjson.h"

#include <json-glib/json-glib.h>

#include <stdlib.h>
#include <string.h>

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

typedef struct {
    gboolean ready;
    gboolean close;
    gchar *problem;
} LaterData;

struct _CockpitChannelPrivate {
    gulong recv_sig;
    gulong close_sig;

    /* Construct arguments */
    CockpitTransport *transport;
    gchar *id;
    JsonObject *open_options;

    /* Queued messages before channel is ready */
    gboolean ready;
    GQueue *received;

    /* Whether we've sent a closed message */
    gboolean closed;

    /* Whether the transport closed (before we did) */
    gboolean transport_closed;

    /* Binary options */
    gboolean binary_ok;
    gboolean base64_encoding;

    /* Other state */
    JsonObject *close_options;

    /* If we've gotten to the main-loop yet */
    guint later_tag;
    LaterData *later_data;
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
on_idle_later (gpointer data)
{
  CockpitChannel *self = data;
  LaterData *later = self->priv->later_data;

  self->priv->later_tag = 0;

  if (later)
    {
      self->priv->later_data = NULL;
      if (later->ready && !(later->close && later->problem != NULL))
        cockpit_channel_ready (self);
      if (later->close)
        cockpit_channel_close (self, later->problem);
      g_free (later->problem);
      g_slice_free (LaterData, later);
    }

  return FALSE;
}
static void
cockpit_channel_init (CockpitChannel *self)
{
  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, COCKPIT_TYPE_CHANNEL,
                                            CockpitChannelPrivate);

  self->priv->later_tag = g_idle_add_full (G_PRIORITY_HIGH, on_idle_later, self, NULL);
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

  /* We can use a smaller limit here, since we know the saved state is 0,
     +1 used to avoid calling g_malloc0(0), and hence returning NULL */
  decoded = g_malloc0 ((length / 4) * 3 + 1);
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

  /* We can use a smaller limit here, since we know the saved state is 0,
     +1 is needed for trailing \0, also check for unlikely integer overflow */

  if (length >= ((G_MAXSIZE - 1) / 4 - 1) * 3)
    g_error ("%s: input too large for Base64 encoding (%"G_GSIZE_FORMAT" chars)", G_STRLOC, length);

  encoded = g_malloc ((length / 3 + 1) * 4 + 1);
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

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitChannel *self = COCKPIT_CHANNEL (user_data);
  self->priv->transport_closed = TRUE;
  if (!self->priv->closed)
    cockpit_channel_close (self, problem);
}

static void
cockpit_channel_constructed (GObject *object)
{
  CockpitChannel *self = COCKPIT_CHANNEL (object);
  const gchar *binary;

  G_OBJECT_CLASS (cockpit_channel_parent_class)->constructed (object);

  g_return_if_fail (self->priv->id != NULL);

  self->priv->recv_sig = g_signal_connect (self->priv->transport, "recv",
                                           G_CALLBACK (on_transport_recv), self);
  self->priv->close_sig = g_signal_connect (self->priv->transport, "closed",
                                            G_CALLBACK (on_transport_closed), self);

  binary = cockpit_channel_get_option (self, "binary");
  if (binary != NULL)
    {
      self->priv->binary_ok = TRUE;
      if (g_str_equal (binary, "base64"))
        {
          self->priv->base64_encoding = TRUE;
        }
      else if (!g_str_equal (binary, "raw"))
        {
          g_warning ("%s: channel has invalid binary option: %s", self->priv->id, binary);
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
  if (self->priv->later_tag)
    {
      g_source_remove (self->priv->later_tag);
      on_idle_later (self);
    }

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
  const gchar *overridden = problem;
  JsonObject *object;
  GBytes *message;

  if (self->priv->closed)
    return;

  self->priv->closed = TRUE;

  if (!self->priv->transport_closed)
    {
      if (overridden == NULL)
        overridden = "";

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
      json_object_set_string_member (object, "problem", overridden);

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
                                      const gchar *id,
                                      JsonObject *options)
{
  CockpitChannel *channel;
  GType channel_type;
  const gchar *payload;

  if (!cockpit_json_get_string (options, "payload", NULL, &payload))
    payload = NULL;
  /* TODO: We need to migrate away from dbus-json1 */
  if (g_strcmp0 (payload, "dbus-json1") == 0)
    channel_type = COCKPIT_TYPE_DBUS_JSON1;
  else if (g_strcmp0 (payload, "dbus-json2") == 0)
    channel_type = COCKPIT_TYPE_DBUS_JSON2;
  else if (g_strcmp0 (payload, "dbus-json3") == 0)
    channel_type = COCKPIT_TYPE_DBUS_JSON;
  else if (g_strcmp0 (payload, "rest-json1") == 0)
    channel_type = COCKPIT_TYPE_REST_JSON;
  else if (g_strcmp0 (payload, "stream") == 0)
    channel_type = COCKPIT_TYPE_STREAM;
  else if (g_strcmp0 (payload, "resource2") == 0)
    channel_type = COCKPIT_TYPE_RESOURCE;
  else if (g_strcmp0 (payload, "fsread1") == 0)
    channel_type = COCKPIT_TYPE_FSREAD;
  else if (g_strcmp0 (payload, "fswrite1") == 0)
    channel_type = COCKPIT_TYPE_FSWRITE;
  else if (g_strcmp0 (payload, "fswatch1") == 0)
    channel_type = COCKPIT_TYPE_FSWATCH;
  else if (g_strcmp0 (payload, "fsdir1") == 0)
    channel_type = COCKPIT_TYPE_FSDIR;
  else if (g_strcmp0 (payload, "null") == 0)
    channel_type = COCKPIT_TYPE_NULL_CHANNEL;
  else if (g_strcmp0 (payload, "echo") == 0)
    channel_type = COCKPIT_TYPE_ECHO_CHANNEL;
  else
    channel_type = COCKPIT_TYPE_CHANNEL;

  channel = g_object_new (channel_type,
                          "transport", transport,
                          "id", id,
                          "options", options,
                          NULL);

  if (channel_type == COCKPIT_TYPE_CHANNEL)
    {
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

  if (self->priv->later_tag)
    {
      if (!self->priv->later_data)
        self->priv->later_data = g_slice_new0 (LaterData);
      self->priv->later_data->close = TRUE;
      if (!self->priv->later_data->problem)
        self->priv->later_data->problem = g_strdup (problem);
    }
  else
    {
      klass = COCKPIT_CHANNEL_GET_CLASS (self);
      g_assert (klass->close != NULL);
      (klass->close) (self, problem);
    }
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

  if (self->priv->later_tag)
    {
      if (!self->priv->later_data)
        self->priv->later_data = g_slice_new0 (LaterData);
      self->priv->later_data->ready = TRUE;
      return;
    }

  klass = COCKPIT_CHANNEL_GET_CLASS (self);
  g_assert (klass->recv != NULL);

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
          decoded = NULL;
          if (self->priv->base64_encoding)
            payload = decoded = base64_decode (payload);
          (klass->recv) (self, payload);
          if (decoded)
            g_bytes_unref (decoded);
          g_bytes_unref (payload);
        }
      g_queue_free (queue);
    }

  self->priv->ready = TRUE;
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
  if (!cockpit_json_get_string (self->priv->open_options, name, NULL, &value))
    value = NULL;
  return value;
}

/**
 * cockpit_channel_get_int_option:
 * @self: a channel
 * @name: the option name
 *
 * Called by implementations to get an int value from the
 * channel's options.
 *
 * Returns: the option value or G_MAXINT64
 */
gint64
cockpit_channel_get_int_option (CockpitChannel *self,
                                const gchar *name)
{
  gint64 value;
  if (!cockpit_json_get_int (self->priv->open_options, name, G_MAXINT64, &value))
    value = G_MAXINT64;
  return value;
}

/**
 * cockpit_channel_get_bool_option:
 * @self: a channel
 * @name: the option name
 * @defawlt: default value
 *
 * Called by implementations to get an int value from the
 * channel's options.
 *
 * Returns: TRUE or FALSE if option set, @defauwlt if not set
 */
gboolean
cockpit_channel_get_bool_option (CockpitChannel *self,
                                 const gchar *name,
                                 gboolean defawlt)
{
  gboolean value;
  if (!cockpit_json_get_bool (self->priv->open_options, name, defawlt, &value))
    value = defawlt;
  return value;
}


/**
 * cockpit_channel_get_strv_option:
 * @self: a channel
 * @name: the option name
 *
 * Called by implementations to get a string array value from
 * the channel's options.
 *
 * Returns: (transfer none): the option value or NULL.
 */
const gchar **
cockpit_channel_get_strv_option (CockpitChannel *self,
                                 const gchar *name)
{
  gchar **value;

  g_return_val_if_fail (COCKPIT_IS_CHANNEL (self), NULL);

  value = g_object_get_data (G_OBJECT (self), name);
  if (value)
    return (const gchar **)value;

  if (!cockpit_json_get_strv (self->priv->open_options, name, NULL, &value))
    value = NULL;

  /* Stash here so caller can not worry about memory */
  g_object_set_data_full (G_OBJECT (self), name, value, g_free);
  return (const gchar **)value;
}

/**
 * cockpit_channel_close_option:
 * @self: a channel
 * @name: the option name
 * @value: the value to add
 *
 * Add a value to the close message for this channel. This must
 * be called before the cockpit_channel_close base class
 * implementation.
 */
void
cockpit_channel_close_option (CockpitChannel *self,
                              const gchar *name,
                              const gchar *value)
{
  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (name != NULL);
  g_return_if_fail (value != NULL);

  if (!self->priv->close_options)
    self->priv->close_options = json_object_new ();
  json_object_set_string_member (self->priv->close_options, name, value);
}

/**
 * cockpit_channel_close_int_option:
 * @self: a channel
 * @name: the option name
 * @value: the value to add
 *
 * Add a value to the close message for this channel. This must
 * be called before the cockpit_channel_close base class
 * implementation.
 */
void
cockpit_channel_close_int_option (CockpitChannel *self,
                                  const gchar *name,
                                  gint64 value)
{
  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (name != NULL);

  if (!self->priv->close_options)
    self->priv->close_options = json_object_new ();
  json_object_set_int_member (self->priv->close_options, name, value);
}

/**
 * cockpit_channel_close_json_option:
 * @self: a channel
 * @name: the option name
 * @value: the value to add
 *
 * Add a JSON value to the close message for this channel. This must
 * be called befor ethe cockpit_channel_close base class
 * implementation.
 */
void
cockpit_channel_close_json_option (CockpitChannel *self,
                                   const gchar *name,
                                   JsonNode *node)
{
  g_return_if_fail (COCKPIT_IS_CHANNEL (self));
  g_return_if_fail (name != NULL);
  g_return_if_fail (node != NULL);

  if (!self->priv->close_options)
    self->priv->close_options = json_object_new ();
  json_object_set_member (self->priv->close_options, name,
                          json_node_copy (node));
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
