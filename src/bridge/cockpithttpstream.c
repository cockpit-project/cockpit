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

#include "cockpithttpstream.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitstream.h"

#include "websocket/websocket.h"

#include <gio/gunixsocketaddress.h>

#include <string.h>

/**
 * CockpitHttpConnection
 *
 * A pooled raw HTTP connection. We close this after a short timeout
 * to try to preempt the server closing it.
 */

typedef struct {
  gchar *name;
  CockpitStream *stream;
  gulong sig_close;
  guint timeout;
} CockpitHttpConnection;

static GHashTable *connection_pool;

static void
cockpit_http_connection_free (gpointer data)
{
  CockpitHttpConnection *connection = data;
  if (connection->timeout)
    g_source_remove (connection->timeout);
  if (connection->stream)
    {
      g_signal_handler_disconnect (connection->stream, connection->sig_close);
      cockpit_stream_close (connection->stream, NULL);
      g_object_unref (connection->stream);
    }
  g_free (connection->name);
  g_slice_free (CockpitHttpConnection, connection);
}

static void
cockpit_http_connection_remove (const gchar *name)
{
  if (connection_pool)
    {
      g_hash_table_remove (connection_pool, name);
      if (g_hash_table_size (connection_pool) == 0)
        {
          g_hash_table_destroy (connection_pool);
          connection_pool = NULL;
        }
    }
}

static void
on_connection_close (CockpitStream *stream,
                     const gchar *problem,
                     gpointer data)
{
  CockpitHttpConnection *connection = data;
  g_debug ("%s: pooled connection closed", connection->name);
  cockpit_http_connection_remove (connection->name);
}

static gboolean
on_connection_timeout (gpointer data)
{
  CockpitHttpConnection *connection = data;
  g_debug ("%s: pooled timed out", connection->name);
  cockpit_http_connection_remove (connection->name);
  return FALSE;
}

static void
cockpit_http_connection_checkin (const gchar *name,
                                 CockpitStream *stream)
{
  CockpitHttpConnection *connection;

  connection = g_slice_new0 (CockpitHttpConnection);
  connection->name = g_strdup (name);
  connection->stream = g_object_ref (stream);
  connection->sig_close = g_signal_connect (stream, "close", G_CALLBACK (on_connection_close), connection);
  connection->timeout = g_timeout_add_seconds (10, on_connection_timeout, connection);

  if (!connection_pool)
    connection_pool = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, cockpit_http_connection_free);

  g_debug ("%s: pooling connection", connection->name);
  g_hash_table_replace (connection_pool, connection->name, connection);
}

static CockpitStream *
cockpit_http_connection_checkout (const gchar *name)
{
  CockpitHttpConnection *connection;
  CockpitStream *stream;

  if (!connection_pool)
    return NULL;

  connection = g_hash_table_lookup (connection_pool, name);
  if (!connection)
    return NULL;

  g_debug ("%s: reusing pooled connection", connection->name);

  stream = connection->stream;
  g_signal_handler_disconnect (connection->stream, connection->sig_close);
  connection->stream = NULL;

  cockpit_http_connection_remove (name);
  return stream;
}

/**
 * CockpitHttpStream:
 *
 * A #CockpitChannel that represents a HTTP request/response.
 *
 * The payload type for this channel is 'http-stream1'.
 */

/*
 * Some things we should add later without breaking the payload:
 *
 *  - Specifying the HTTP version of the request.
 *  - Chunked messages in the request when request is HTTP/1.1
 *  - Trans coding for non-UTF8 charsets.
 */

#define COCKPIT_HTTP_STREAM(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_HTTP_STREAM, CockpitHttpStream))

enum {
    BUFFER_REQUEST,
    RELAY_REQUEST,
    RELAY_DATA,
    FINISHED
};

typedef struct _CockpitHttpStream {
  CockpitChannel parent;

  /* The nickname for debugging and logging */
  gchar *name;
  const gchar *connection;

  /* The connection */
  CockpitStream *stream;
  gulong sig_read;
  gulong sig_close;

  gint state;
  gboolean failed;
  gboolean binary;
  gboolean keep_alive;

  /* The request */
  GList *request;

  /* From parsing the response */
  gboolean response_chunked;
  gssize response_length;
} CockpitHttpStream;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitHttpStreamClass;

G_DEFINE_TYPE (CockpitHttpStream, cockpit_http_stream, COCKPIT_TYPE_CHANNEL);

static gboolean
parse_content_length (CockpitHttpStream *self,
                      guint status,
                      GHashTable *headers)
{
  const gchar *header;
  guint64 value;
  gchar *end;

  if (status == 204)
    {
      self->response_length = 0;
      return TRUE;
    }

  header = g_hash_table_lookup (headers, "Content-Length");
  if (header == NULL)
    {
      self->response_length = -1;
      return TRUE;
    }

  value = g_ascii_strtoull (header, &end, 10);
  if (end[0] != '\0')
    {
      g_message ("%s: received invalid Content-Length in HTTP stream response", self->name);
      return FALSE;
    }
  else if (value > G_MAXSSIZE)
    {
      g_message ("%s: received Content-Length that was too big", self->name);
      return FALSE;
    }

  self->response_length = value;
  g_debug ("%s: content length is %" G_GSSIZE_FORMAT, self->name, self->response_length);

  return TRUE;
}

static gboolean
parse_transfer_encoding (CockpitHttpStream *self,
                         GHashTable *headers)
{
  const gchar *header;

  header = g_hash_table_lookup (headers, "Transfer-Encoding");
  if (header == NULL)
    {
      self->response_chunked = FALSE;
      return TRUE;
    }

  if (!g_str_equal (header, "chunked"))
    {
      g_message ("%s: received unsupported Transfer-Encoding in HTTP response: %s",
                 self->name, header);
      return FALSE;
    }

  self->response_chunked = TRUE;
  g_debug ("%s: chunked encoding", self->name);

  return TRUE;
}

static gboolean
parse_keep_alive (CockpitHttpStream *self,
                  const gchar *version,
                  GHashTable *headers)
{
  const gchar *header;

  header = g_hash_table_lookup (headers, "Connection");

  g_debug ("%s: got Connection of %s on %s response", self->name, header, version);

  if (!header)
    {
      if (version && g_ascii_strcasecmp (version, "HTTP/1.1") == 0)
        header = "keep-alive";
    }

  /*
   * This is pretty conservative. If a Connection header is present
   * and it *doesn't* have the non-standard "keep-alive" value in
   * it, then assume we can't keep alive. Either the connection is
   * meant to close, or we have no idea what the server is trying
   * to tell us.
   */

  self->keep_alive = (header && strstr (header, "keep-alive") != NULL);
  return TRUE;
}

static gboolean
relay_headers (CockpitHttpStream *self,
               CockpitChannel *channel,
               GByteArray *buffer)
{
  const gchar *problem = "protocol-error";
  GHashTable *headers = NULL;
  gchar *version = NULL;
  gchar *reason = NULL;
  JsonObject *object;
  const gchar *data;
  JsonObject *heads;
  GHashTableIter iter;
  GBytes *message;
  gpointer key;
  gpointer value;
  guint status;
  gsize length;
  gssize offset;
  gssize offset2;

  data = (const gchar *)buffer->data;
  length = buffer->len;

  offset = web_socket_util_parse_status_line (data, length, &version, &status, &reason);
  if (offset == 0)
    return FALSE; /* want more data */

  if (offset < 0)
    {
      g_message ("%s: received response with bad HTTP status line", self->name);
      goto out;
    }

  offset2 = web_socket_util_parse_headers (data + offset, length - offset, &headers);
  if (offset2 == 0)
    return FALSE; /* want more data */

  if (offset2 < 0)
    {
      g_message ("%s: received response with bad HTTP headers", self->name);
      goto out;
    }

  if (!parse_transfer_encoding (self, headers) ||
      !parse_content_length (self, status, headers) ||
      !parse_keep_alive (self, version, headers))
    goto out;

  problem = NULL;
  cockpit_pipe_skip (buffer, offset + offset2);

  if (!self->binary)
    {
      g_hash_table_remove (headers, "Content-Length");
      g_hash_table_remove (headers, "Range");
    }
  g_hash_table_remove (headers, "Connection");
  g_hash_table_remove (headers, "Transfer-Encoding");

  /* Now serialize all the rest of this into JSON */
  object = json_object_new ();
  json_object_set_int_member (object, "status", status);
  json_object_set_string_member (object, "reason", reason);
  g_debug ("%s: response: %u %s", self->name, status, reason);

  heads = json_object_new();
  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      g_debug ("%s: header: %s %s", self->name, (gchar *)key, (gchar *)value);
      json_object_set_string_member (heads, key, value);
    }

  json_object_set_object_member (object, "headers", heads);
  message = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_channel_send (channel, message, TRUE);
  g_bytes_unref (message);

out:
  if (problem)
    cockpit_channel_close (channel, problem);
  if (headers)
    g_hash_table_unref (headers);
  g_free (version);
  g_free (reason);

  return TRUE;
}

static void
relay_data (CockpitChannel *channel,
            GBytes *data)
{
  GBytes *block;
  gsize size;
  gsize offset;
  gsize length;

  size = g_bytes_get_size (data);
  if (size < 8192)
    {
      cockpit_channel_send (channel, data, FALSE);
    }
  else
    {
      for (offset = 0; offset < size; offset += 4096)
        {
          length = MIN (4096, size - offset);
          block = g_bytes_new_from_bytes (data, offset, length);
          cockpit_channel_send (channel, block, FALSE);
          g_bytes_unref (block);
        }
    }
}

static gboolean
relay_chunked (CockpitHttpStream *self,
               CockpitChannel *channel,
               GByteArray *buffer)
{
  GBytes *message;
  const gchar *data;
  const gchar *pos;
  guint64 size;
  gsize length;
  gsize beg;
  gchar *end;

  data = (const gchar *)buffer->data;
  length = buffer->len;

  pos = memchr (data, '\r', length);
  if (pos == NULL)
    return FALSE; /* want more data */

  beg = (pos + 2) - data;
  if (length < beg)
    {
      /* have to have a least the ending chars */
      return FALSE; /* want more data */
    }

  size = g_ascii_strtoull (data, &end, 16);
  if (pos[1] != '\n' || end != pos)
    {
      g_message ("%s: received invalid HTTP chunk", self->name);
      cockpit_channel_close (channel, "protocol-error");
    }
  else if (size > G_MAXSSIZE)
    {
      g_message ("%s: received extremely large HTTP chunk", self->name);
      cockpit_channel_close (channel, "protocol-error");
    }
  else if (length < beg + size + 2)
    {
      return FALSE; /* want more data */
    }
  else if (data[beg + size] != '\r' || data[beg + size + 1] != '\n')
    {
      g_message ("%s: received invalid HTTP chunk data", self->name);
      cockpit_channel_close (channel, "protocol-error");
    }
  else if (size == 0)
    {
      /* All done, yay */
      g_debug ("%s: received last chunk", self->name);
      cockpit_pipe_skip (buffer, beg + 2);
      cockpit_channel_close (channel, NULL);
      g_assert (self->state == FINISHED);
    }
  else
    {
      message = cockpit_pipe_consume (buffer, beg, size, 2);
      relay_data (channel, message);
      g_bytes_unref (message);
      return TRUE;
    }

  return TRUE;
}

static gboolean
relay_length (CockpitHttpStream *self,
              CockpitChannel *channel,
              GByteArray *buffer)
{
  GBytes *message = NULL;
  gsize block;

  g_assert (self->response_length >= 0);

  if (self->response_length == 0)
    {
      /* All done, yay */
      g_debug ("%s: received enough bytes", self->name);
      cockpit_channel_close (channel, NULL);
      g_assert (self->state == FINISHED);
    }
  else if (buffer->len == 0)
    {
      /* Not enough data? */
      return FALSE;
    }
  else
    {
      block = MIN (buffer->len, self->response_length);
      self->response_length -= block;

      message = cockpit_pipe_consume (buffer, 0, block, 0);
      relay_data (channel, message);
      g_bytes_unref (message);
    }

  return TRUE;
}

static gboolean
relay_all (CockpitHttpStream *self,
           CockpitChannel *channel,
           GByteArray *buffer)
{
  GBytes *message;

  if (buffer->len == 0)
    {
      /* Not enough data? */
      return FALSE;
    }

  message = cockpit_pipe_consume (buffer, 0, buffer->len, 0);
  relay_data (channel, message);
  g_bytes_unref (message);

  return TRUE;
}

static void
on_stream_read (CockpitStream *stream,
                GByteArray *buffer,
                gboolean end_of_data,
                gpointer user_data)
{
  CockpitHttpStream *self = user_data;
  CockpitChannel *channel = user_data;
  gboolean ret;

  g_object_ref (self);

  if (self->state < RELAY_REQUEST)
    {
      if (buffer->len != 0)
        {
          g_message ("%s: received data before HTTP request was sent", self->name);
          cockpit_channel_close (channel, "protocol-error");
        }
    }
  else if (self->state < RELAY_DATA)
    {
      /* Parse headers */
      if (relay_headers (self, channel, buffer))
        {
          self->state = RELAY_DATA;
        }
      else if (end_of_data)
        {
          g_message ("%s: received truncated HTTP response", self->name);
          cockpit_channel_close (channel, "protocol-error");
        }
    }
  while (self->state == RELAY_DATA)
    {
      if (self->response_chunked)
        ret = relay_chunked (self, channel, buffer);
      else if (self->response_length >= 0)
        ret = relay_length (self, channel, buffer);
      else
        ret = relay_all (self, channel, buffer);
      if (!ret)
        break;
    }

  g_object_unref (self);
}

static void
on_stream_close (CockpitStream *stream,
                 const gchar *problem,
                 gpointer user_data)
{
  CockpitHttpStream *self = user_data;
  CockpitChannel *channel = user_data;

  self->keep_alive = FALSE;
  if (self->state != FINISHED)
    {
      if (problem)
        {
          cockpit_channel_close (channel, problem);
        }
      else if (self->state == RELAY_DATA &&
               !self->response_chunked &&
               self->response_length <= 0)
        {
          g_debug ("%s: end of stream is end of data", self->name);
          cockpit_channel_close (channel, NULL);
        }
      else
        {
          g_message ("%s: received truncated HTTP response", self->name);
          cockpit_channel_close (channel, "protocol-error");
        }
    }
}

static gboolean
simple_token (const gchar *string)
{
  string += strcspn (string, " \t\r\n\v");
  return string[0] == '\0';
}

static gboolean
single_line (const gchar *string)
{
  string += strcspn (string, "\r\n\v");
  return string[0] == '\0';
}

static gboolean
disallowed_header (const gchar *name,
                   const gchar *value,
                   gboolean binary)
{
  static const gchar *bad_headers[] = {
      "Content-Length",
      "Content-MD5",
      "TE",
      "Trailer",
      "Transfer-Encoding",
      "Upgrade",
      NULL
  };

  static const gchar *bad_text[] = {
      "Accept-Encoding",
      "Content-Encoding",
      "Accept-Charset",
      "Accept-Ranges",
      "Content-Range",
      "Range",
      NULL
  };

  gint i;

  for (i = 0; bad_headers[i] != NULL; i++)
    {
      if (g_ascii_strcasecmp (bad_headers[i], name) == 0)
        return TRUE;
    }

  if (!binary)
    {
      for (i = 0; bad_text[i] != NULL; i++)
        {
          if (g_ascii_strcasecmp (bad_text[i], name) == 0)
            return TRUE;
        }
    }

  /* Only allow the caller to specify Connection: close */
  if (g_ascii_strcasecmp ("Connection", name) == 0 &&
      !g_strcmp0 (value, "close"))
    {
      return TRUE;
    }

  return FALSE;
}

static void
send_http_request (CockpitHttpStream *self)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *problem = "protocol-error";
  JsonObject *options;
  gboolean had_host;
  gboolean had_encoding;
  const gchar *method;
  const gchar *path;
  GString *string = NULL;
  JsonNode *node;
  JsonObject *headers;
  const gchar *header;
  const gchar *value;
  GList *request = NULL;
  GList *names = NULL;
  GBytes *bytes;
  GList *l;
  gsize total;

  options = cockpit_channel_get_options (channel);

  /*
   * The checks we do here for token validity are just enough to be able
   * to format an HTTP response, without leaking across lines etc.
   */

  if (!cockpit_json_get_string (options, "path", NULL, &path))
    {
      g_warning ("%s: bad \"path\" field in HTTP stream request", self->name);
      goto out;
    }
  else if (path == NULL)
    {
      g_warning ("%s: missing \"path\" field in HTTP stream request", self->name);
      goto out;
    }
  else if (!simple_token (path))
    {
      g_warning ("%s: invalid \"path\" field in HTTP stream request", self->name);
      goto out;
    }

  if (!cockpit_json_get_string (options, "method", NULL, &method))
    {
      g_warning ("%s: bad \"method\" field in HTTP stream request", self->name);
      goto out;
    }
  else if (method == NULL)
    {
      g_warning ("%s: missing \"method\" field in HTTP stream request", self->name);
      goto out;
    }
  else if (!simple_token (method))
    {
      g_warning ("%s: invalid \"method\" field in HTTP stream request", self->name);
      goto out;
    }

  string = g_string_sized_new (128);
  g_string_printf (string, "%s %s HTTP/1.1\r\n", method, path);

  had_encoding = had_host = FALSE;

  node = json_object_get_member (options, "headers");
  if (node)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          g_warning ("%s: invalid \"headers\" field in HTTP stream request", self->name);
          goto out;
        }

      headers = json_node_get_object (node);
      names = json_object_get_members (headers);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          header = l->data;
          if (!simple_token (header))
            {
              g_warning ("%s: invalid header in HTTP stream request: %s", self->name, header);
              goto out;
            }
          node = json_object_get_member (headers, header);
          if (!node || !JSON_NODE_HOLDS_VALUE (node) || json_node_get_value_type (node) != G_TYPE_STRING)
            {
              g_warning ("%s: invalid header value in HTTP stream request: %s", self->name, header);
              goto out;
            }
          value = json_node_get_string (node);
          if (disallowed_header (header, value, self->binary))
            {
              g_warning ("%s: disallowed header in HTTP stream request: %s", self->name, header);
              goto out;
            }
          if (!single_line (value))
            {
              g_warning ("%s: invalid header value in HTTP stream request: %s", self->name, header);
              goto out;
            }

          g_string_append_printf (string, "%s: %s\r\n", (gchar *)l->data, value);
          g_debug ("%s: sending header: %s %s", self->name, (gchar *)l->data, value);

          if (g_ascii_strcasecmp (l->data, "Host") == 0)
            had_host = TRUE;
          if (g_ascii_strcasecmp (l->data, "Accept-Encoding") == 0)
            had_encoding = TRUE;
        }
    }

  if (!had_host)
    g_string_append_printf (string, "Host: %s\r\n", self->name);
  if (!had_encoding)
    g_string_append (string, "Accept-Encoding: identity\r\n");

  if (!self->binary)
    g_string_append (string, "Accept-Charset: UTF-8\r\n");

  problem = NULL;
  request = g_list_reverse (self->request);
  self->request = NULL;

  /* Calculate how much data we have to send */
  total = 0;
  for (l = request; l != NULL; l = g_list_next (l))
    total += g_bytes_get_size (l->data);

  if (request || g_ascii_strcasecmp (method, "POST") == 0)
    g_string_append_printf (string, "Content-Length: %" G_GSIZE_FORMAT "\r\n", total);
  g_string_append (string, "\r\n");

  bytes = g_string_free_to_bytes (string);
  string = NULL;

  cockpit_stream_write (self->stream, bytes);
  g_bytes_unref (bytes);

  /* Now send all the data */
  for (l = request; l != NULL; l = g_list_next (l))
    cockpit_stream_write (self->stream, l->data);

out:
  g_list_free (names);
  g_list_free_full (request, (GDestroyNotify)g_bytes_unref);
  if (string)
    g_string_free (string, TRUE);
  if (problem)
    cockpit_channel_close (COCKPIT_CHANNEL (self), problem);
}

static void
cockpit_http_stream_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitHttpStream *self = (CockpitHttpStream *)channel;
  self->request = g_list_prepend (self->request, g_bytes_ref (message));
}

static void
cockpit_http_stream_done (CockpitChannel *channel)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (channel);

  g_return_if_fail (self->state == BUFFER_REQUEST);
  g_debug ("%s: sending request", self->name);
  self->state = RELAY_REQUEST;
  send_http_request (self);
}

static void
cockpit_http_stream_close (CockpitChannel *channel,
                           const gchar *problem)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (channel);

  if (problem)
    {
      self->failed = TRUE;
      self->state = FINISHED;
      COCKPIT_CHANNEL_CLASS (cockpit_http_stream_parent_class)->close (channel, problem);
    }
  else if (self->state == RELAY_DATA)
    {
      g_debug ("%s: relayed response", self->name);
      self->state = FINISHED;
      cockpit_channel_done (channel);

      /* Save this for another round? */
      if (self->keep_alive && self->connection)
        {
          g_signal_handler_disconnect (self->stream, self->sig_read);
          g_signal_handler_disconnect (self->stream, self->sig_close);
          cockpit_http_connection_checkin (self->connection, self->stream);
          g_object_unref (self->stream);
          self->stream = NULL;
        }

      COCKPIT_CHANNEL_CLASS (cockpit_http_stream_parent_class)->close (channel, NULL);
    }
  else if (self->state != FINISHED)
    {
      g_warn_if_reached ();
      self->failed = TRUE;
      self->state = FINISHED;
      COCKPIT_CHANNEL_CLASS (cockpit_http_stream_parent_class)->close (channel, "internal-error");
    }
}

static void
cockpit_http_stream_init (CockpitHttpStream *self)
{
  self->response_length = -1;
  self->keep_alive = FALSE;
  self->state = BUFFER_REQUEST;
}

static void
cockpit_http_stream_prepare (CockpitChannel *channel)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (channel);
  CockpitStreamOptions *stream_options = NULL;
  GSocketConnectable *connectable = NULL;
  const gchar *connection;
  JsonObject *options;

  COCKPIT_CHANNEL_CLASS (cockpit_http_stream_parent_class)->prepare (channel);

  if (self->failed)
    goto out;

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "connection", NULL, &connection))
    {
      g_warning ("%s: bad \"connection\" field in HTTP stream request", self->name);
      cockpit_channel_close (channel, "protocol-error");
      goto out;
    }

  if (connection)
    {
      self->name = g_strdup (connection);
      self->connection = self->name;
    }

  self->stream = cockpit_http_connection_checkout (self->connection);
  if (!self->stream)
    {
      stream_options = cockpit_channel_parse_stream (channel);
      if (!stream_options)
        goto out;

      connectable = cockpit_channel_parse_connectable (channel, self->name ? NULL : &self->name);
      if (!connectable)
        goto out;

      self->stream = cockpit_stream_connect (self->name, connectable, stream_options);
    }

  /* Parsed elsewhere */
  self->binary = json_object_has_member (options, "binary");

  self->sig_read = g_signal_connect (self->stream, "read", G_CALLBACK (on_stream_read), self);
  self->sig_close = g_signal_connect (self->stream, "close", G_CALLBACK (on_stream_close), self);

  cockpit_channel_ready (channel);

out:
  if (connectable)
    g_object_unref (connectable);
  if (stream_options)
    cockpit_stream_options_unref (stream_options);
}

static void
cockpit_http_stream_dispose (GObject *object)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (object);

  if (self->stream)
    {
      g_signal_handler_disconnect (self->stream, self->sig_read);
      g_signal_handler_disconnect (self->stream, self->sig_close);
      cockpit_stream_close (self->stream, NULL);
      g_object_unref (self->stream);
    }

  g_list_free_full (self->request, (GDestroyNotify)g_bytes_unref);
  self->request = NULL;

  G_OBJECT_CLASS (cockpit_http_stream_parent_class)->dispose (object);
}

static void
cockpit_http_stream_finalize (GObject *object)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (object);

  g_free (self->name);

  G_OBJECT_CLASS (cockpit_http_stream_parent_class)->finalize (object);
}

static void
cockpit_http_stream_class_init (CockpitHttpStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_http_stream_dispose;
  gobject_class->finalize = cockpit_http_stream_finalize;

  channel_class->prepare = cockpit_http_stream_prepare;
  channel_class->recv = cockpit_http_stream_recv;
  channel_class->done = cockpit_http_stream_done;
  channel_class->close = cockpit_http_stream_close;
}
