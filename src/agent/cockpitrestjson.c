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

#include "cockpitrestjson.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpitpipe.h"

#include "websocket/websocket.h"

#include <gio/gunixsocketaddress.h>

#include <string.h>

/**
 * CockpitRestJson:
 *
 * A #CockpitChannel that sends REST JSON messages to an
 * HTTP server.
 *
 * The payload type for this channel is 'rest-json1'.
 */

#define COCKPIT_REST_JSON(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_REST_JSON, CockpitRestJson))

typedef struct _CockpitRestJson {
  CockpitChannel parent;

  /* The address to connect to */
  GSocketAddress *address;

  /* The nickname for debugging and logging */
  gchar *name;

  /*
   * A table of gint64 cookie -> CockpitRestRequest.
   *
   * Note that this enforces only one request with a given cookie
   * can be occurring at the same time. Another request with the
   * same cookie as one that's currently going, will cancel
   * the prior one.
   *
   * Not all requests are active. For example a poll request sits
   * around and repeats itself every so often.
   *
   * CockpitRestRequest structs are owned by this hashtable.
   */
  GHashTable *requests;

  /*
   * A table of CockpitPipe* -> CockpitRestResponse.
   *
   * Stuff in this table is waiting for data on the given pipe.
   *
   * CockpitRestResponse structs are owned by this hashtable.
   * CockpitPipe objects are also owned by this hashtable, with
   * the exception of the inactive CockpitPipe.
   */
  GHashTable *responses;

  /*
   * If the server supported keep-alive, then we keep one pipe
   * inactively cached around here for efficiency.
   */
  CockpitPipe *inactive;
  guint inactive_close;

  /*
   * A table of gint64 -> GArray(gint64)
   *
   * Tracks the watches between various requests, such as
   * poll type requests.
   *
   * Data in this table is "owned" by the requests themselves
   * Watches should be removed by the request that added them.
   * When all requests are gone, all watches should be gone too.
   */
  GHashTable *watches;

  /* Singleton objects for efficiency ... */
  JsonParser *parser;

  /* Whether the channel is closed or not */
  gboolean closed;
} CockpitRestJson;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitRestJsonClass;

G_DEFINE_TYPE (CockpitRestJson, cockpit_rest_json, COCKPIT_TYPE_CHANNEL);

typedef struct _CockpitRestRequest CockpitRestRequest;
typedef struct _CockpitRestResponse CockpitRestResponse;
typedef struct _CockpitRestPoll CockpitRestPoll;

struct _CockpitRestRequest {
  /* The cookie for the request, and key into requests table */
  gint64 cookie;

  /* Debugging label for the request */
  gchar *label;

  /* An active response for this req, owned by responses table */
  CockpitRestResponse *resp;

  /* Weak reference back to channel (ie: self) */
  CockpitRestJson *channel;

  /* Data to send for this request */
  GBytes *headers;
  GBytes *body;

  /* If poll type request, will be non-null */
  CockpitRestPoll *poll;
};

struct _CockpitRestPoll {
  /* Last data polled, or NULL */
  JsonNode *last;

  /* Timeout source for next poll */
  guint timeout_id;

  /* Idle source set after watch notified */
  guint watch_id;

  /* An other cookie being watched */
  gint64 watching;
};

struct _CockpitRestResponse {
  /* The pipe we're talking on */
  CockpitPipe *pipe;
  guint sig_read;
  guint sig_close;

  /* Corresponding req, owned by requests table */
  CockpitRestRequest *req;

  /* Status and headers received so far */
  gboolean got_status;
  guint status;
  gchar *message;
  GString *failure;
  GHashTable *headers;
  gssize remaining_length;

  /* Whether body is valid for parsing */
  gboolean skip_body;

  /* Whether sent a completed response on channel */
  gboolean incomplete;
};

static void
cockpit_rest_request_notify (CockpitRestJson *self,
                             CockpitRestRequest *req);

static void
cockpit_rest_watch_add (CockpitRestJson *self,
                        guint64 watched,
                        guint64 watching)
{
  GArray *watches;

  watches = g_hash_table_lookup (self->watches, &watched);
  if (watches == NULL)
    {
      watches = g_array_new (0, 0, sizeof (gint64));
      g_hash_table_insert (self->watches, g_memdup (&watched, sizeof (watched)), watches);
    }
  g_array_append_val (watches, watching);
}

static void
cockpit_rest_watch_remove (CockpitRestJson *self,
                           guint64 watched,
                           guint64 watching)
{
  gboolean found = FALSE;
  GArray *watches;
  gint i;

  /*
   * We're pretty strict about the caller knowing a given
   * watch exists, and enforcing that it's removed correctly.
   */

  watches = g_hash_table_lookup (self->watches, &watched);
  g_assert (watches != NULL);

  for (i = 0; i < watches->len; i++)
    {
      if (g_array_index (watches, gint64, i) == watching)
        {
          g_array_remove_index_fast (watches, i);
          found = TRUE;
          break;
        }
    }
  g_assert (found == TRUE);

  if (watches->len == 0)
    {
      g_array_free (watches, TRUE);
      g_hash_table_remove (self->watches, &watched);
    }
}

static void
cockpit_rest_watch_notify (CockpitRestJson *self,
                           guint64 watched)
{
  CockpitRestRequest *req;
  GArray *watches;
  gint64 watching;
  gint i;

  watches = g_hash_table_lookup (self->watches, &watched);
  if (watches)
    {
      for (i = 0; i < watches->len; i++)
        {
          watching = g_array_index (watches, gint64, i);
          req = g_hash_table_lookup (self->requests, &watching);
          if (req != NULL)
            cockpit_rest_request_notify (self, req);
        }
    }
}

static void
cockpit_rest_response_destroy (gpointer data)
{
  CockpitRestResponse *resp = data;

#if 0
  g_debug ("%s: %s: response destroyed",
           resp->req ? resp->req->channel->name : "?",
           resp->req ? resp->req->label : "?");
#endif

  if (resp->pipe)
    {
      g_signal_handler_disconnect (resp->pipe, resp->sig_read);
      g_signal_handler_disconnect (resp->pipe, resp->sig_close);
      cockpit_pipe_close (resp->pipe, NULL);
      g_object_unref (resp->pipe);
    }
  if (resp->headers)
    g_hash_table_unref (resp->headers);
  if (resp->req)
    resp->req->resp = NULL;
  if (resp->failure)
    g_string_free (resp->failure, TRUE);
  g_free (resp->message);
  g_free (resp);
}

static void
cockpit_rest_poll_destroy (CockpitRestRequest *req)
{
  g_assert (req->poll);

  if (req->poll->last)
    json_node_free (req->poll->last);
  if (req->poll->timeout_id)
    g_source_remove (req->poll->timeout_id);
  if (req->poll->watch_id)
    g_source_remove (req->poll->watch_id);

  /* Tell the request we were watching to not notify us any longer */
  if (req->poll->watching)
    cockpit_rest_watch_remove (req->channel, req->poll->watching, req->cookie);

  g_free (req->poll);
  req->poll = NULL;
}

static void
cockpit_rest_request_destroy (gpointer data)
{
  CockpitRestRequest *req = data;
  CockpitRestJson *self = req->channel; /* weak ref */

  g_debug ("%s: %s: request destroyed", self->name, req->label);

  /* Destroying a request, also destroys any response in progress */
  if (req->resp)
    {
      req->resp->req = NULL;
      g_hash_table_remove (self->responses, req->resp->pipe);
    }

  if (req->poll)
    cockpit_rest_poll_destroy (req);

  g_free (req->label);
  g_bytes_unref (req->headers);
  g_bytes_unref (req->body);
  g_free (req);
}

static void
cockpit_rest_response_reply (CockpitRestJson *self,
                             CockpitRestResponse *resp,
                             JsonNode *body,
                             gboolean complete)
{
  CockpitRestRequest *req = resp->req;
  JsonGenerator *generator;
  JsonBuilder *builder;
  JsonNode *node;
  gchar *data;
  gsize length;
  GBytes *bytes;

  g_assert (resp->req != NULL);

  if (req->poll)
    {
      if (resp->status >= 200 && resp->status <= 299)
       {
         if (!body)
           {
#if 0
             g_debug ("%s: %s: poll got blank spot, skipping",
                      self->name, req->label);
#endif
             return; /* no data, no reply */
           }

          if (cockpit_json_equal (req->poll->last, body))
            {
#if 0
              g_debug ("%s: %s: poll got identical data, skipping",
                       self->name, req->label);
#endif
              return; /* no change, no reply */
            }

          g_debug ("%s: %s: poll found changed data, sending",
                   self->name, req->label);
          if (req->poll->last)
            json_node_free (req->poll->last);
          req->poll->last = json_node_copy (body);
          complete = FALSE;
       }
      else
        {
          g_debug ("%s: %s: poll failed, complete",
                   self->name, req->label);

          /* On failure, stop the poll */
          cockpit_rest_poll_destroy (req);
          complete = TRUE;
        }
    }
  else
    {
      g_debug ("%s: %s: sending %sresponse",
               self->name, req->label, complete ? "last " : "");
    }

  builder = json_builder_new ();
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "cookie");
  json_builder_add_int_value (builder, resp->req->cookie);
  json_builder_set_member_name (builder, "status");
  json_builder_add_int_value (builder, resp->status);
  json_builder_set_member_name (builder, "message");
  if (resp->failure && resp->failure->len > 0)
    json_builder_add_string_value (builder, resp->failure->str);
  else
    json_builder_add_string_value (builder, resp->message);
  if (complete)
    {
      json_builder_set_member_name (builder, "complete");
      json_builder_add_boolean_value (builder, TRUE);
      resp->incomplete = FALSE;
    }
  if (body)
    {
      json_builder_set_member_name (builder, "body");
      json_builder_add_value (builder, json_node_copy (body));
    }
  json_builder_end_object (builder);

  node = json_builder_get_root (builder);
  generator = cockpit_channel_get_generator (COCKPIT_CHANNEL (self));
  json_generator_set_root (generator, node);
  json_node_free (node);
  g_object_unref (builder);

  data = json_generator_to_data (generator, &length);

  bytes = g_bytes_new_take (data, length);
  cockpit_channel_send (COCKPIT_CHANNEL (self), bytes);
  g_bytes_unref (bytes);
}

static gssize
cockpit_rest_response_parse (CockpitRestJson *self,
                             CockpitRestResponse *resp,
                             const gchar *data,
                             gsize limit,
                             gboolean end_of_data,
                             guint *replies)
{
  GError *error = NULL;
  gssize total = 0;
  gsize block;
  gsize spaces;

  for (;;)
    {
      if (limit == 0)
        return total;

      spaces = 0;
      block = cockpit_json_skip (data, limit, &spaces);

      if (block == 0)
        {
          /* likely invalid JSON, catch below */
          if (end_of_data)
            block = limit;

          /* need more data */
          else
            return total;
        }

      limit -= block;
      total += block;

      /* Some non-whitespace data found */
      if (spaces != block)
        {
          if (!json_parser_load_from_data (self->parser, data + spaces, block - spaces, &error))
            {
              g_debug ("%s", error->message);
              g_message ("%s: %s: invalid JSON received in response to REST request",
                         self->name, resp->req->label);
              g_error_free (error);
              return -1;
            }

          cockpit_rest_response_reply (self, resp,
                                       json_parser_get_root (self->parser),
                                       end_of_data && limit == 0);
          (*replies)++;
        }

      data += block;
    }
}

static gboolean
parse_content_length (CockpitRestRequest *req,
                      GHashTable *headers,
                      gssize *length)
{
  const gchar *header;
  guint64 value;
  gchar *end;

  header = g_hash_table_lookup (headers, "Content-Length");
  if (header == NULL)
    {
      *length = -1;
      return TRUE;
    }

  value = g_ascii_strtoull (header, &end, 10);
  if (end[0] != '\0')
    {
      g_message ("%s: %s: received invalid Content-Length in REST JSON response",
                 req->channel->name, req->label);
      return FALSE;
    }
  else if (value > G_MAXSSIZE)
    {
      g_message ("%s: %s: received Content-Length that was too big",
                 req->channel->name, req->label);
      return FALSE;
    }

  *length = value;
  return TRUE;
}

static gboolean
cockpit_rest_response_process (CockpitRestJson *self,
                               CockpitRestResponse *resp,
                               GByteArray *buffer,
                               gboolean end_of_data)
{
  gboolean done = FALSE;
  guint replies;
  gssize off;
  gsize at = 0;
  const gchar *type;
  const gchar *data;
  gsize block;

  if (!resp->got_status)
    {
      off = web_socket_util_parse_status_line ((const gchar *)buffer->data,
                                               buffer->len, &resp->status,
                                               &resp->message);
      if (off == 0)
        goto out;
      if (off < 0)
        {
          g_message ("%s: %s received response with bad HTTP status line",
                     self->name, resp->req->label);
          cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
          goto out;
        }

      resp->got_status = TRUE;
      at += off;

      /* We expect HTTP/1.0 responses, at least for successful responses */
      if (memcmp (buffer->data, "HTTP/1.0", 8) != 0)
        {
          if (resp->status >= 200 && resp->status <= 299)
            {
              g_message ("%s: %s: received response with unexpected HTTP version",
                         self->name, resp->req->label);
            }
          resp->skip_body = TRUE;
        }
    }

  if (!resp->headers)
    {
      off = web_socket_util_parse_headers ((const gchar *)buffer->data + at,
                                           buffer->len - at, &resp->headers);
      if (off == 0)
        goto out;
      if (off < 0)
        {
          g_message ("%s: %s received response with bad HTTP headers",
                     self->name, resp->req->label);
          cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
          goto out;
        }
      at += off;

      /* How much do we have to read? */
      if (!parse_content_length (resp->req, resp->headers, &resp->remaining_length))
        {
          cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
          goto out;
        }

      /* If status is 2XX, then we expect json body */
      type = g_hash_table_lookup (resp->headers, "Content-Type");
      if (type == NULL)
        {
          if (resp->status >= 200 && resp->status <= 299)
            type = "application/json";
          else
            type = "text/plain";
        }

      if (!g_str_has_prefix (type, "text/json") &&
          !g_str_has_prefix (type, "application/json"))
        {
          resp->skip_body = TRUE;
        }

      /*
       * If a plain text error, then get the contents as a more
       * detailed message. This lets us return something better
       * than "Internal Server Error" in those cases.
       */
      if (g_str_has_prefix (type, "text/plain") &&
          (resp->status < 200 || resp->status > 299))
        {
          resp->failure = g_string_new ("");
        }
    }

  /* Calculate how much of received data we should process */
  g_assert (at <= buffer->len);
  block = buffer->len - at;
  if (resp->remaining_length >= 0)
    {
      if (resp->remaining_length <= block)
        block = resp->remaining_length;
      if (resp->remaining_length == block)
        end_of_data = TRUE;
    }

  data = (const gchar *)buffer->data + at;
  replies = 0;
  if (resp->skip_body)
    {
      off = block;
      if (resp->failure && g_utf8_validate (data, block, NULL))
        g_string_append_len (resp->failure, data, block);
    }
  else
    {
      off = cockpit_rest_response_parse (self, resp, data, block, end_of_data, &replies);
      if (off < 0)
        {
          cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
          goto out;
        }
    }
  at += off;

  if (resp->remaining_length < 0)
    {
      /* Unknown length, read till end of pipe */
      done = end_of_data;
    }
  else
    {
      /* Known length, can tell when done */
      g_assert (off <= resp->remaining_length);
      resp->remaining_length -= off;
      done = resp->remaining_length == 0;
    }

  /* If no replies sent yet, must have skipped body, or no body */
  if (done && !replies)
    cockpit_rest_response_reply (self, resp, NULL, TRUE);

out:
  if (at > 0)
    cockpit_pipe_skip (buffer, at);
  return done;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *buffer,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitRestJson *self = user_data;
  CockpitRestResponse *resp;
  CockpitRestRequest *req;
  const gchar *keep_alive;

  /* Lookup active response */
  resp = g_hash_table_lookup (self->responses, pipe);
  g_assert (resp != NULL);

  req = resp->req;
  g_assert (req != NULL);

  /* Any polls watching this request should fire now */
  cockpit_rest_watch_notify (self, req->cookie);

  if (cockpit_rest_response_process (self, resp, buffer, end_of_data))
    {
      if (self->inactive == NULL && resp->headers)
        {
          keep_alive = g_hash_table_lookup (resp->headers, "Connection");
          if (keep_alive && strstr (keep_alive, "keep-alive"))
            {
#if 0
              g_debug ("%s: keeping pipe around due to keep-alive", self->name);
#endif
              g_signal_handler_disconnect (resp->pipe, resp->sig_read);
              self->inactive = resp->pipe;
              self->inactive_close = resp->sig_close;
              resp->sig_read = resp->sig_close = 0;
              resp->pipe = NULL;
            }
        }

      /* This will destroy the response, and remove it from request */
      g_hash_table_remove (self->responses, pipe);

      /* If this is not a poll request, then it can be destroyed */
      if (!req->poll)
        g_hash_table_remove (self->requests, &req->cookie);
    }
  else
    {
      /* Response not done, but pipe is done */
      if (end_of_data)
        {
          g_message ("%s: %s: received truncated HTTP response",
                     self->name, resp->req->label);
          cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
        }
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitRestJson *self = user_data;
  CockpitRestResponse *resp;

  if (pipe == self->inactive)
    {
      g_debug ("%s: inactive pipe closed%s%s",
               self->name, problem ? ": " : "", problem ? problem : "");
      self->inactive = NULL;
      g_object_unref (pipe);
      return;
    }

  resp = g_hash_table_lookup (self->responses, pipe);
  if (resp != NULL)
    {
      g_debug ("%s: active pipe closed%s%s",
               self->name, problem ? ": " : "", problem ? problem : "");
      if (problem == NULL)
        on_pipe_read (pipe, cockpit_pipe_get_buffer (pipe), TRUE, self);
      else
        cockpit_channel_close (COCKPIT_CHANNEL (self), problem);
    }
}

static void
cockpit_rest_request_send (CockpitRestJson *self,
                           CockpitRestRequest *req)
{
  CockpitRestResponse *resp;

  g_assert (req != NULL);
  g_assert (req->resp == NULL);

  resp = g_new0 (CockpitRestResponse, 1);

  if (self->inactive)
    {
      resp->pipe = self->inactive;
      self->inactive = NULL;
      resp->sig_close = self->inactive_close;
      self->inactive_close = 0;
    }
  else
    {
      resp->pipe = cockpit_pipe_connect (self->name, self->address);
      resp->sig_close = g_signal_connect (resp->pipe, "close", G_CALLBACK (on_pipe_close), self);
    }

  /*
   * poll responses are part of a greater set of responses
   * and the poll logic tracks completion separately, so
   * override that here.
   */
  if (req->poll)
    resp->incomplete = FALSE;
  else
    resp->incomplete = TRUE;

  /* Owns the response */
  g_hash_table_insert (self->responses, resp->pipe, resp);

  resp->sig_read = g_signal_connect (resp->pipe, "read", G_CALLBACK (on_pipe_read), self);
  resp->req = req;
  req->resp = resp;
  cockpit_pipe_write (resp->pipe, req->headers);
  if (req->body)
    cockpit_pipe_write (resp->pipe, req->body);
}

static gboolean
on_idle_request_send (gpointer data)
{
  CockpitRestRequest *req = data;
  g_assert (req->poll != NULL);

  req->poll->watch_id = 0;
  if (req->resp == NULL)
    cockpit_rest_request_send (req->channel, req);
  return FALSE; /* don't run again */
}

static void
cockpit_rest_request_notify (CockpitRestJson *self,
                             CockpitRestRequest *req)
{
  g_assert (req != NULL);
  g_assert (req->poll != NULL);

  if (!req->poll->watch_id)
    req->poll->watch_id = g_idle_add (on_idle_request_send, req);
}

static GBytes *
build_body_from_json (CockpitRestJson *self,
                      JsonObject *json)
{
  JsonGenerator *generator;
  gchar *data;
  gsize length;
  JsonNode *node;

  node = json_object_get_member (json, "body");
  if (!node)
    return NULL;

  generator = cockpit_channel_get_generator (COCKPIT_CHANNEL (self));
  json_generator_set_root (generator, node);
  data = json_generator_to_data (generator, &length);
  return g_bytes_new_take (data, length);
}

static gboolean
on_request_interval (gpointer user_data)
{
  CockpitRestRequest *req = user_data;
  CockpitRestJson *self = req->channel;

  /* Still active, wait for the next timeout */
  if (req->resp == NULL)
    cockpit_rest_request_send (self, req);

  return TRUE;
}

static void
cockpit_rest_request_create (CockpitRestJson *self,
                             JsonObject *json)
{
  CockpitRestRequest *req = NULL;
  JsonObject *pollopts = NULL;
  GString *string = NULL;
  gint64 cookie;
  const gchar *method;
  const gchar *path;
  gsize length;
  JsonNode *node;
  gint64 interval;
  gint64 watch;

  if (!cockpit_json_get_int (json, "cookie", 0, &cookie) ||
      !cockpit_json_get_string (json, "path", NULL, &path) ||
      !cockpit_json_get_string (json, "method", NULL, &method))
    {
      g_warning ("Invalid arguments in REST JSON request");
      goto out;
    }

  if (method == NULL)
    {
      /* Cancel a request with the given cookie.  It is not an error
         if there is no request with that cookie.  Such a request
         might just have completed and our caller might not yet have
         noticed that.
      */

      req = g_hash_table_lookup (self->requests, &cookie);
      if (req)
        {
          g_debug ("%s: %s request cancelled", self->name, req->label);
          g_hash_table_remove (self->requests, &cookie);
        }
      else
        g_debug ("%s: no request found when cancelling cookie %"G_GINT64_FORMAT, self->name, cookie);

      goto out_without_request;
    }

  if (path == NULL)
    {
      g_warning ("Missing \"path\" member in REST JSON request");
      goto out;
    }
  else if (path[0] != '/')
    {
      g_warning ("Invalid \"path\" member in REST JSON request: must start with a slash");
      goto out;
    }
  else if (strcspn (path, " \r\t\n\v") != strlen (path))
    {
      g_warning ("Invalid \"path\" member in REST JSON request: contains spaces");
      goto out;
    }

  if (strcspn (method, " \t\r\n\v()<>@,;:\"\[]?={}") != strlen (method))
    {
      g_warning ("Invalid \"method\" member in REST JSON request: contains bad chars");
      goto out;
    }

  node = json_object_get_member (json, "poll");
  if (node != NULL)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          g_warning ("Invalid \"poll\" member in REST JSON request: should be object");
          goto out;
        }
      pollopts = json_node_get_object (node);
      if (!cockpit_json_get_int (pollopts, "interval", 1000, &interval) ||
          interval < 0 || interval >= G_MAXINT32)
        {
          g_warning ("Invalid \"interval\" member in REST JSON request: should be non-negative integer");
          goto out;
        }
      if (!cockpit_json_get_int (pollopts, "watch", 0, &watch))
        {
          g_warning ("Invalid \"watch\" member in REST JSON request: should be non-negative integer");
          goto out;
        }
    }

  string = g_string_sized_new (128);
  g_string_printf (string, "%s %s HTTP/1.0\r\n", method, path);
  g_string_append (string, "Connection: keep-alive\r\n");

  req = g_new0 (CockpitRestRequest, 1);
  req->body = build_body_from_json (self, json);

  length = 0;
  if (req->body)
    {
      length = g_bytes_get_size (req->body);
      g_string_append (string, "Content-Type: application/json\r\n");
    }

  g_string_append_printf (string, "Content-Length: %" G_GSIZE_FORMAT "\r\n", length);
  g_string_append (string, "\r\n");

  req->label = g_strdup (path);
  req->channel = self;
  req->cookie = cookie;
  req->headers = g_string_free_to_bytes (string);

  string = NULL;

  /*
   * The table here owns the request. This also has the effect
   * of cancelling any other requests with the same cookie.
   *
   * We do this before the poll stuff below, because the
   * cockpit_rest_watch_add() needs everything to be in order.
   */
  g_hash_table_insert (self->requests, &req->cookie, req);

  if (pollopts)
    {
      req->poll = g_new0 (CockpitRestPoll, 1);
      if (interval == 0)
        ;
      else if (interval % 1000 == 0)
        req->poll->timeout_id = g_timeout_add_seconds (interval / 1000, on_request_interval, req);
      else
        req->poll->timeout_id = g_timeout_add (interval, on_request_interval, req);
      req->poll->watching = watch;
      if (watch != 0)
        cockpit_rest_watch_add (self, watch, cookie);
    }

  /* And fire it away */
  cockpit_rest_request_send (self, req);

out:
  if (!req)
    cockpit_channel_close (COCKPIT_CHANNEL (self), "protocol-error");
out_without_request:
  if (string)
    g_string_free (string, TRUE);
}

static void
cockpit_rest_json_recv (CockpitChannel *channel,
                        GBytes *message)
{
  CockpitRestJson *self = (CockpitRestJson *)channel;
  GError *error = NULL;
  JsonNode *node = NULL;
  gsize length;

  length = g_bytes_get_size (message);
  if (json_parser_load_from_data (self->parser,
                                  g_bytes_get_data (message, NULL),
                                  length, &error))
    {
      node = json_parser_get_root (self->parser);
      if (json_node_get_node_type (node) != JSON_NODE_OBJECT)
          g_set_error (&error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_UNKNOWN, "Not an object");
    }

  if (error == NULL)
    {
      cockpit_rest_request_create (self, json_node_get_object (node));
    }
  else
    {
      g_warning ("Received invalid REST JSON request: %s", error->message);
      cockpit_channel_close (channel, "protocol-error");
      g_error_free (error);
    }
}

static void
cockpit_rest_json_close (CockpitChannel *channel,
                         const gchar *problem)
{
  CockpitRestJson *self = COCKPIT_REST_JSON (channel);
  CockpitPipe *pipe;

  self->closed = TRUE;

  /* Closes any pipes involved in requests */
  g_hash_table_remove_all (self->requests);
  g_hash_table_remove_all (self->responses);

  if (self->inactive)
    {
      pipe = self->inactive;
      self->inactive = NULL;
      g_signal_handler_disconnect (pipe, self->inactive_close);
      cockpit_pipe_close (pipe, NULL);
      g_object_unref (pipe);
    }

  COCKPIT_CHANNEL_CLASS (cockpit_rest_json_parent_class)->close (channel, problem);
}

static void
cockpit_rest_json_init (CockpitRestJson *self)
{
  self->parser = json_parser_new ();

  /* Table of gint64 -> CockpitRestRequest */
  self->requests = g_hash_table_new_full (cockpit_json_int_hash, cockpit_json_int_equal,
                                          NULL, cockpit_rest_request_destroy);

  /* Table of CockpitPipe* -> CockpitRestResponse */
  self->responses = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                           NULL, cockpit_rest_response_destroy);

  /* Table of gint64 -> GArray(gint64) */
  self->watches = g_hash_table_new (cockpit_json_int_hash, cockpit_json_int_equal);
}

static void
on_socket_address_ready (GObject *source,
                         GAsyncResult *result,
                         gpointer user_data)
{
  CockpitRestJson *self = COCKPIT_REST_JSON (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GSocketAddressEnumerator *enumerator;
  GError *error = NULL;

  if (!self->closed)
    {
      enumerator = G_SOCKET_ADDRESS_ENUMERATOR (source);
      self->address = g_socket_address_enumerator_next_finish (enumerator, result, &error);
      if (error != NULL)
        {
          g_warning ("couldn't find address for %s: %s", self->name, error->message);
          cockpit_channel_close (channel, "not-found");
        }
      else
        {
          cockpit_channel_ready (channel);
        }
    }
  g_object_unref (self);
}

static gboolean
initialize_in_idle (gpointer user_data)
{
  CockpitRestJson *self = COCKPIT_REST_JSON (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GSocketAddressEnumerator *enumerator;
  GSocketConnectable *connectable;
  GError *error = NULL;
  const gchar *unix_path;
  gint64 port;

  if (self->closed)
    return FALSE;

  port = cockpit_channel_get_int_option (channel, "port");
  unix_path = cockpit_channel_get_option (channel, "unix");

  if (port != G_MAXINT64 && unix_path)
    {
      g_warning ("cannot specify both host and unix options");
      cockpit_channel_close (channel, "protocol-error");
    }
  else if (port != G_MAXINT64)
    {
      connectable = g_network_address_parse ("localhost", port, &error);
      if (error != NULL)
        {
          g_warning ("received invalid port option: %s", error->message);
          cockpit_channel_close (channel, "protocol-error");
        }
      else
        {
          self->name = g_strdup_printf ("localhost:%d", (gint)port);
          enumerator = g_socket_connectable_enumerate (connectable);
          g_object_unref (connectable);
          g_socket_address_enumerator_next_async (enumerator, NULL,
                                                  on_socket_address_ready,
                                                  g_object_ref (self));
          g_object_unref (enumerator);
        }
    }
  else if (unix_path)
    {
      self->name = g_strdup (unix_path);
      self->address = g_unix_socket_address_new (unix_path);
      cockpit_channel_ready (channel);
    }
  else
    {
      g_warning ("received neither a port or unix option");
      cockpit_channel_close (channel, "protocol-error");
    }

  return FALSE; /* don't run again */
}

static void
cockpit_rest_json_constructed (GObject *object)
{
  G_OBJECT_CLASS (cockpit_rest_json_parent_class)->constructed (object);

  /* Guarantee not to close immediately */
  g_idle_add_full (G_PRIORITY_DEFAULT, initialize_in_idle,
                   g_object_ref (object), g_object_unref);
}

static void
cockpit_rest_json_dispose (GObject *object)
{
  CockpitRestJson *self = COCKPIT_REST_JSON (object);

  if (!self->closed)
    cockpit_channel_close (COCKPIT_CHANNEL (self), "terminated");

  G_OBJECT_CLASS (cockpit_rest_json_parent_class)->dispose (object);
}

static void
cockpit_rest_json_finalize (GObject *object)
{
  CockpitRestJson *self = COCKPIT_REST_JSON (object);

  g_object_unref (self->parser);
  if (self->address)
    g_object_unref (self->address);
  g_hash_table_destroy (self->requests);
  g_hash_table_destroy (self->responses);

  g_assert (g_hash_table_size (self->watches) == 0);
  g_hash_table_destroy (self->watches);

  g_assert (self->inactive == NULL);
  g_free (self->name);

  G_OBJECT_CLASS (cockpit_rest_json_parent_class)->finalize (object);
}

static void
cockpit_rest_json_class_init (CockpitRestJsonClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_rest_json_constructed;
  gobject_class->dispose = cockpit_rest_json_dispose;
  gobject_class->finalize = cockpit_rest_json_finalize;

  channel_class->recv = cockpit_rest_json_recv;
  channel_class->close = cockpit_rest_json_close;
}

/**
 * cockpit_rest_json_open:
 * @transport: the transport to send/receive messages on
 * @number: the channel number
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitRestJson is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_rest_json_open (CockpitTransport *transport,
                        guint number,
                        const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "rest-json1");

  channel = g_object_new (COCKPIT_TYPE_REST_JSON,
                          "transport", transport,
                          "channel", number,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
