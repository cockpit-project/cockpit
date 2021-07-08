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

#include "cockpitconnect.h"
#include "cockpitstream.h"

#include "common/cockpitflow.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitwebresponse.h"

#include "websocket/websocket.h"

#include <gio/gunixsocketaddress.h>

#include <string.h>

/**
 * CockpitHttpClient
 *
 * Information about a certain set of HTTP connections that
 * have been given a connection name, grouping them together as
 * a client. In this mode we cache connections and reuse them
 * as well as share options and address info.
 */

typedef struct {
  gint refs;
  gchar *name;
  CockpitConnectable *connectable;
  CockpitStream *stream;
  gulong sig_close;
  guint timeout;
} CockpitHttpClient;

static GHashTable *clients;

static void
cockpit_http_client_reset (CockpitHttpClient *client)
{
  if (client->timeout)
    g_source_remove (client->timeout);
  if (client->stream)
    {
      g_signal_handler_disconnect (client->stream, client->sig_close);
      g_object_unref (client->stream);
    }

  client->sig_close = 0;
  client->stream = NULL;
  client->timeout = 0;
}

static void
cockpit_http_client_unref (gpointer data)
{
  CockpitHttpClient *client = data;
  if (--client->refs == 0)
    {
      cockpit_http_client_reset (client);
      if (client->connectable)
        cockpit_connectable_unref (client->connectable);
      g_free (client->name);
      g_slice_free (CockpitHttpClient, client);
    }
}

static CockpitHttpClient *
cockpit_http_client_ref (CockpitHttpClient *client)
{
  client->refs++;
  return client;
}

static void
on_client_close (CockpitStream *stream,
                 const gchar *problem,
                 gpointer data)
{
  CockpitHttpClient *client = data;
  g_debug ("%s: connection closed", client->name);
  cockpit_http_client_reset (client);
}

static gboolean
on_client_timeout (gpointer data)
{
  CockpitHttpClient *client = data;
  g_debug ("%s: connection timed out", client->name);
  cockpit_http_client_reset (client);
  return FALSE;
}

static CockpitHttpClient *
cockpit_http_client_ensure (const gchar *name)
{
  CockpitHttpClient *client = NULL;

  if (name)
    {
      if (!clients)
        clients = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, cockpit_http_client_unref);
      client = g_hash_table_lookup (clients, name);
    }

  if (!client)
    {
      client = g_slice_new0 (CockpitHttpClient);
      client->name = g_strdup (name);

      if (clients && name)
        {
          g_debug ("%s: registering client", name);
          g_hash_table_replace (clients, client->name, cockpit_http_client_ref (client));
        }
    }
  else if (name)
    {
      g_debug ("%s: using client", name);
    }

  cockpit_http_client_ref (client);
  return client;
}

static void
cockpit_http_client_checkin (CockpitHttpClient *client,
                             CockpitStream *stream)
{
  cockpit_http_client_reset (client);
  client->stream = g_object_ref (stream);
  client->sig_close = g_signal_connect (stream, "close", G_CALLBACK (on_client_close), client);
  client->timeout = g_timeout_add_seconds (10, on_client_timeout, client);
}

static CockpitStream *
cockpit_http_client_checkout (CockpitHttpClient *client)
{
  CockpitStream *stream = NULL;

  if (client->stream)
    {
      g_debug ("%s: reusing connection", client->name);

      stream = g_object_ref (client->stream);
      cockpit_http_client_reset (client);
    }

  return stream;
}

/**
 * CockpitHttpStream:
 *
 * A #CockpitChannel that represents a HTTP request/response.
 *
 * The payload type for this channel is 'http-stream2'.
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
  CockpitHttpClient *client;

  /* The connection */
  CockpitStream *stream;
  gulong sig_open;
  gulong sig_read;
  gulong sig_close;

  gint state;
  gboolean failed;
  gboolean binary;
  gboolean keep_alive;
  gboolean headers_inline;

  /* The request */
  GList *request;
  gint64 body_length;

  /* Stores number of bytes in the request waiting to be sent */
  /* Only valid when body_length is set (otherwise the request is sent at once) */
  gulong request_buffer_size;

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
                      CockpitChannel *channel,
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
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received invalid Content-Length in HTTP stream response", self->name);
      return FALSE;
    }
  else if (value > G_MAXSSIZE)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received Content-Length that was too big", self->name);
      return FALSE;
    }

  self->response_length = value;
  g_debug ("%s: content length is %" G_GSSIZE_FORMAT, self->name, self->response_length);

  return TRUE;
}

static gboolean
parse_transfer_encoding (CockpitHttpStream *self,
                         CockpitChannel *channel,
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
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received unsupported Transfer-Encoding in HTTP response: %s",
                            self->name, header);
      return FALSE;
    }

  self->response_chunked = TRUE;
  g_debug ("%s: chunked encoding", self->name);

  return TRUE;
}

gboolean
cockpit_http_stream_parse_keep_alive (const gchar *version,
                                      GHashTable *headers)
{
  const gchar *header;

  header = g_hash_table_lookup (headers, "Connection");

  if (!header)
    {
      g_debug ("got no \"Connection\" header on %s response", version);
      if (version && g_ascii_strcasecmp (version, "HTTP/1.1") == 0)
        header = "keep-alive";
    }
  else
    {
      g_debug ("got \"Connection\" header of %s on %s response", header, version);
    }

  /*
   * This is pretty conservative. If a Connection header is present
   * and it *doesn't* have the non-standard "keep-alive" value in
   * it, then assume we can't keep alive. Either the connection is
   * meant to close, or we have no idea what the server is trying
   * to tell us.
   */

  return (header && strstr (header, "keep-alive") != NULL);
}

static gboolean
parse_keep_alive (CockpitHttpStream *self,
                  CockpitChannel *channel,
                  const gchar *version,
                  GHashTable *headers)
{
  self->keep_alive = cockpit_http_stream_parse_keep_alive (version, headers);
  return TRUE;
}

static gboolean
relay_headers (CockpitHttpStream *self,
               CockpitChannel *channel,
               GByteArray *buffer)
{
  g_autoptr(GHashTable) headers = NULL;
  g_autofree gchar *version = NULL;
  g_autofree gchar *reason = NULL;
  g_autoptr(JsonObject) object = NULL;
  const gchar *data;
  JsonObject *heads;
  GHashTableIter iter;
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
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received response with bad HTTP status line", self->name);
      return TRUE;
    }

  offset2 = web_socket_util_parse_headers (data + offset, length - offset, &headers);
  if (offset2 == 0)
    return FALSE; /* want more data */

  if (offset2 < 0)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received response with bad HTTP headers", self->name);
      return TRUE;
    }

  g_debug ("%s: response: %u %s", self->name, status, reason);
  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    g_debug ("%s: header: %s %s", self->name, (gchar *)key, (gchar *)value);

  if (!parse_transfer_encoding (self, channel, headers) ||
      !parse_content_length (self, channel, status, headers) ||
      !parse_keep_alive (self, channel, version, headers))
    return TRUE;

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

  heads = json_object_new();
  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    json_object_set_string_member (heads, key, value);

  json_object_set_object_member (object, "headers", heads);

  if (self->headers_inline)
    {
      g_autoptr(GBytes) message = cockpit_json_write_bytes (object);
      cockpit_channel_send (channel, message, TRUE);
    }
  else
    {
      cockpit_channel_control (channel, "response", object);
    }

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
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received invalid HTTP chunk", self->name);
    }
  else if (size > G_MAXSSIZE)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received extremely large HTTP chunk", self->name);
    }
  else if (length < beg + size + 2)
    {
      return FALSE; /* want more data */
    }
  else if (data[beg + size] != '\r' || data[beg + size + 1] != '\n')
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: received invalid HTTP chunk data", self->name);
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
on_stream_open (CockpitStream *stream,
                gpointer user_data)
{
  CockpitChannel *channel = user_data;
  cockpit_channel_ready (channel, NULL);
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
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: received data before HTTP request was sent", self->name);
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
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: received truncated HTTP response", self->name);
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
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: received truncated HTTP response", self->name);
        }
    }
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
flush_request_buffer (CockpitHttpStream *self)
{
  GList *request = NULL;
  GList *l;

  request = g_list_reverse (self->request);
  self->request = NULL;

  /* Send all the data */
  for (l = request; l != NULL; l = g_list_next (l))
    cockpit_stream_write (self->stream, l->data);

  if (self->body_length != -1)
    self->request_buffer_size = 0;

  g_list_free_full (request, (GDestroyNotify)g_bytes_unref);
}

static void
send_http_header (CockpitHttpStream *self, gsize body_length)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
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
  g_autoptr(GList) names = NULL;
  GBytes *bytes;
  GList *l;

  options = cockpit_channel_get_options (channel);

  /*
   * The checks we do here for token validity are just enough to be able
   * to format an HTTP response, without leaking across lines etc.
   */

  if (!cockpit_json_get_string (options, "path", NULL, &path))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: bad \"path\" field in HTTP stream request", self->name);
      return;
    }
  else if (path == NULL)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: missing \"path\" field in HTTP stream request", self->name);
      return;
    }
  else if (!cockpit_web_response_is_simple_token (path))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"path\" field in HTTP stream request", self->name);
      return;
    }

  if (!cockpit_json_get_string (options, "method", NULL, &method))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: bad \"method\" field in HTTP stream request", self->name);
      return;
    }
  else if (method == NULL)
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: missing \"method\" field in HTTP stream request", self->name);
      return;
    }
  else if (!cockpit_web_response_is_simple_token (method))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"method\" field in HTTP stream request", self->name);
      return;
    }

  g_debug ("%s: sending %s request", self->name, method);

  string = g_string_sized_new (128);
  g_string_printf (string, "%s %s HTTP/1.1\r\n", method, path);

  had_encoding = had_host = FALSE;

  node = json_object_get_member (options, "headers");
  if (node)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "%s: invalid \"headers\" field in HTTP stream request", self->name);
          return;
        }

      headers = json_node_get_object (node);
      names = json_object_get_members (headers);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          header = l->data;
          if (!cockpit_web_response_is_simple_token (header))
            {
              cockpit_channel_fail (channel, "protocol-error",
                                    "%s: invalid header in HTTP stream request: %s", self->name, header);
              return;
            }
          node = json_object_get_member (headers, header);
          if (!node || !JSON_NODE_HOLDS_VALUE (node) || json_node_get_value_type (node) != G_TYPE_STRING)
            {
              cockpit_channel_fail (channel, "protocol-error",
                                    "%s: invalid header value in HTTP stream request: %s", self->name, header);
              return;
            }
          value = json_node_get_string (node);
          if (disallowed_header (header, value, self->binary))
            {
              cockpit_channel_fail (channel, "protocol-error",
                                    "%s: disallowed header in HTTP stream request: %s", self->name, header);
              return;
            }
          if (!cockpit_web_response_is_header_value (value))
            {
              cockpit_channel_fail (channel, "protocol-error",
                                    "%s: invalid header value in HTTP stream request: %s", self->name, header);
              return;
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
    {
      g_string_append (string, "Host: ");
      g_string_append_uri_escaped (string, self->client->connectable->name, "[]!%$&()*+,-.:;=\\_~", FALSE);
      g_string_append (string, "\r\n");
    }
  if (!had_encoding)
    g_string_append (string, "Accept-Encoding: identity\r\n");

  if (!self->binary)
    g_string_append (string, "Accept-Charset: UTF-8\r\n");

  if (self->request || g_ascii_strcasecmp (method, "POST") == 0)
    g_string_append_printf (string, "Content-Length: %" G_GSIZE_FORMAT "\r\n", body_length);
  g_string_append (string, "\r\n");

  bytes = g_string_free_to_bytes (string);
  string = NULL;

  cockpit_stream_write (self->stream, bytes);
  g_bytes_unref (bytes);
}

static void
send_http_request (CockpitHttpStream *self)
{
  GList *l;
  gsize total;

  /* Calculate how much data we have to send */
  total = 0;
  for (l = self->request; l != NULL; l = g_list_next (l))
    total += g_bytes_get_size (l->data);

  send_http_header (self, total);
  flush_request_buffer (self);
}

static void
cockpit_http_stream_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitHttpStream *self = (CockpitHttpStream *)channel;
  self->request = g_list_prepend (self->request, g_bytes_ref (message));
  if (self->body_length != -1)
    {
      self->request_buffer_size += g_bytes_get_size (message);
      if (self->request_buffer_size > 65535)
        flush_request_buffer (self);
    }
}

static gboolean
cockpit_http_stream_control (CockpitChannel *channel,
                             const gchar *command,
                             JsonObject *options)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (channel);

  if (g_str_equal (command, "done"))
    {
      if (self->body_length == -1)
        {
          g_return_val_if_fail (self->state == BUFFER_REQUEST, FALSE);
          self->state = RELAY_REQUEST;
          send_http_request (self);
        }
      else
        {
          g_return_val_if_fail (self->state == RELAY_REQUEST, FALSE);
          flush_request_buffer (self);
        }
      return TRUE;
    }

  return FALSE;
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
      cockpit_channel_control (channel, "done", NULL);

      /* Save this for another round? */
      if (self->keep_alive)
        {
          if (self->sig_open)
            g_signal_handler_disconnect (self->stream, self->sig_open);
          g_signal_handler_disconnect (self->stream, self->sig_read);
          g_signal_handler_disconnect (self->stream, self->sig_close);
          cockpit_http_client_checkin (self->client, self->stream);
          cockpit_flow_throttle (COCKPIT_FLOW (self->stream), NULL);
          cockpit_flow_throttle (COCKPIT_FLOW (channel), NULL);
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
  self->body_length = -1;
  self->request_buffer_size = 0;
  self->keep_alive = FALSE;
  self->state = BUFFER_REQUEST;
}

static void
cockpit_http_stream_prepare (CockpitChannel *channel)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (channel);
  CockpitConnectable *connectable = NULL;
  const gchar *payload;
  const gchar *connection;
  JsonObject *options;
  const gchar *path;
  gint64 body_length;

  COCKPIT_CHANNEL_CLASS (cockpit_http_stream_parent_class)->prepare (channel);

  if (self->failed)
    goto out;

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "connection", NULL, &connection))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "bad \"connection\" field in HTTP stream request");
      goto out;
    }

  if (!cockpit_json_get_string (options, "path", "/", &path))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "bad \"path\" field in HTTP stream request");
      goto out;
    }

  if (json_object_has_member (options, "body-length"))
    {
      if (!cockpit_json_get_int (options, "body-length", -1, &body_length) || body_length <= 0)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"body-length\" field in HTTP stream request");
          goto out;
        }

      self->body_length = body_length;

      /* Request is relayed continuously when body-length is set */
      self->state = RELAY_REQUEST;
    }

  /*
   * In http-stream1 the headers are sent as first message.
   * In http-stream2 the headers are in a control message.
   */
  if (cockpit_json_get_string (options, "payload", NULL, &payload) &&
      payload && g_str_equal (payload, "http-stream1"))
    {
      self->headers_inline = TRUE;
    }

  self->client = cockpit_http_client_ensure (connection);

  if (!self->client->connectable ||
      json_object_has_member (options, "unix") ||
      json_object_has_member (options, "port") ||
      json_object_has_member (options, "internal") ||
      json_object_has_member (options, "tls") ||
      json_object_has_member (options, "address"))
    {
      connectable = cockpit_connect_parse_stream (channel);
      if (!connectable)
        goto out;

      if (self->client->connectable)
        cockpit_connectable_unref (self->client->connectable);
      self->client->connectable = cockpit_connectable_ref (connectable);
    }

  self->name = g_strdup_printf ("%s://%s%s",
                                self->client->connectable->tls ? "https" : "http",
                                self->client->connectable->name, path);

  self->stream = cockpit_http_client_checkout (self->client);
  if (!self->stream)
    {
      self->stream = cockpit_stream_connect (self->name, self->client->connectable);
      self->sig_open = g_signal_connect (self->stream, "open", G_CALLBACK (on_stream_open), self);
    }

  /* Parsed elsewhere */
  self->binary = json_object_has_member (options, "binary");

  self->sig_read = g_signal_connect (self->stream, "read", G_CALLBACK (on_stream_read), self);
  self->sig_close = g_signal_connect (self->stream, "close", G_CALLBACK (on_stream_close), self);

  /* Let the channel throttle the stream's input flow*/
  cockpit_flow_throttle (COCKPIT_FLOW (self->stream), COCKPIT_FLOW (self));

  /* Let the stream throtlte the channel peer's output flow */
  cockpit_flow_throttle (COCKPIT_FLOW (channel), COCKPIT_FLOW (self->stream));

  /* If not waiting for open */
  if (!self->sig_open)
    cockpit_channel_ready (channel, NULL);

  /* Send the header now if body length is specified */
  if (self->body_length != -1)
    send_http_header (self, self->body_length);

out:
  if (connectable)
    cockpit_connectable_unref (connectable);
}

static void
cockpit_http_stream_dispose (GObject *object)
{
  CockpitHttpStream *self = COCKPIT_HTTP_STREAM (object);

  if (self->stream)
    {
      if (self->sig_open)
        g_signal_handler_disconnect (self->stream, self->sig_open);
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
  if (self->client)
    cockpit_http_client_unref (self->client);

  G_OBJECT_CLASS (cockpit_http_stream_parent_class)->finalize (object);
}

static void
cockpit_http_stream_constructed (GObject *object)
{
  const gchar *caps[] = { "tls-certificates",
                          "address",
                          NULL };

  G_OBJECT_CLASS (cockpit_http_stream_parent_class)->constructed (object);

  g_object_set (object, "capabilities", &caps, NULL);
}

static void
cockpit_http_stream_class_init (CockpitHttpStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_http_stream_dispose;
  gobject_class->finalize = cockpit_http_stream_finalize;
  gobject_class->constructed = cockpit_http_stream_constructed;

  channel_class->prepare = cockpit_http_stream_prepare;
  channel_class->control = cockpit_http_stream_control;
  channel_class->recv = cockpit_http_stream_recv;
  channel_class->close = cockpit_http_stream_close;
}
