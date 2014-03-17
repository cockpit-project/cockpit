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

#include "websocket/websocket.h"

#include <json-glib/json-glib.h>

#include <glib/gstdio.h>

#include <stdlib.h>
#include <string.h>

static JsonParser *parser;
static JsonGenerator *generator;

/* -----------------------------------------------------------------------------
 * Mock
 */

static GType mock_transport_get_type (void) G_GNUC_CONST;

typedef struct {
  GObject parent;
  GQueue *sent;
  GList *gc;
} MockTransport;

typedef GObjectClass MockTransportClass;

static void mock_transport_iface (CockpitTransportIface *iface);

G_DEFINE_TYPE_WITH_CODE (MockTransport, mock_transport, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_TRANSPORT, mock_transport_iface);
);

static void
mock_transport_init (MockTransport *self)
{
  self->sent = g_queue_new ();
}

static void
mock_transport_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      g_value_set_string (value, "mock-name");
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_finalize (GObject *object)
{
  MockTransport *self = (MockTransport *)object;

  g_list_free_full (self->gc, (GDestroyNotify)json_node_free);
  g_queue_free (self->sent);

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_class_init (MockTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->finalize = mock_transport_finalize;
  object_class->get_property = mock_transport_get_property;
  object_class->set_property = mock_transport_set_property;
  g_object_class_override_property (object_class, 1, "name");
}

static void
mock_transport_send (CockpitTransport *transport,
                     guint channel,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  GError *error = NULL;
  const gchar *string;
  gsize length;
  JsonNode *node;

  if (channel != 0)
    {
      string = g_bytes_get_data (data, &length);
      g_assert (length > 0);
      json_parser_load_from_data (parser, string, length, &error);
      g_assert_no_error (error);
      node = json_node_copy (json_parser_get_root (parser));
      g_queue_push_tail (self->sent, node);
      self->gc = g_list_prepend (self->gc, node);
    }
}

static void
mock_transport_close (CockpitTransport *transport,
                      const gchar *problem)
{
  cockpit_transport_emit_closed (transport, problem);
}

static void
mock_transport_iface (CockpitTransportIface *iface)
{
  iface->send = mock_transport_send;
  iface->close = mock_transport_close;
}

static GType mock_server_get_type (void) G_GNUC_CONST;

typedef struct {
  GThreadedSocketService parent;
  GHashTable *responses;
  gboolean keep_alive;
  gboolean slowly; /* write one byte at a time */
  gboolean stutter; /* write data, then wait, then close */
  gboolean no_length; /* don't send Content-Length */
  gint connections;
}MockServer;

typedef GThreadedSocketServiceClass MockServerClass;

G_DEFINE_TYPE (MockServer, mock_server, G_TYPE_THREADED_SOCKET_SERVICE);

static void
responses_free (gpointer data)
{
  g_queue_foreach (data, (GFunc)g_free, NULL);
  g_queue_free (data);
}

static void
mock_server_init (MockServer *self)
{
  self->responses = g_hash_table_new_full (g_str_hash, g_str_equal,
                                           g_free, responses_free);
}

static gboolean
mock_server_respond (MockServer *self,
                     const gchar *what,
                     GOutputStream *out)
{
  gboolean keep_alive;
  GQueue *queue;
  gchar *response;
  gsize length;
  GError *error = NULL;

  /* Do we have a response? */
  queue = g_hash_table_lookup (self->responses, what);
  if (queue)
    response = g_queue_pop_head (queue);

  if (response == NULL)
    {
      keep_alive = FALSE;
      response = "HTTP/1.0 404 Not Found\r\n\r\nNot found";
    }
  else
    {
      keep_alive = strstr (response, "Connection: keep-alive\r\n") != NULL;
    }

  length = strlen (response);
  if (self->stutter)
    length--;

  if (self->slowly)
    {
      while (length > 0)
        {
          g_output_stream_write_all (out, response, 1, NULL, NULL, &error);
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
            {
              g_error_free (error);
              return FALSE;
            }
          g_assert_no_error (error);
          response++;
          length--;
        }
    }
  else
    {
      g_output_stream_write_all (out, response, length, NULL, NULL, &error);
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
        {
          g_error_free (error);
          return FALSE;
        }
      g_assert_no_error (error);
    }

  if (self->stutter)
    {
      g_assert (!keep_alive);
      g_usleep (100 * 1000); /* 100 ms */
      g_output_stream_write_all (out, response + length, 1, NULL, NULL, &error);
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
        {
          g_error_free (error);
          return FALSE;
        }
      g_assert_no_error (error);
    }

  return keep_alive;
}

static gboolean
mock_server_stream (MockServer *self,
                    GOutputStream *out)
{
  const gchar *headers;
  gchar *response;
  GError *error = NULL;
  gint i;

  headers = "HTTP/1.0 200 OK\r\n\r\n";
  g_output_stream_write_all (out, headers, strlen (headers), NULL, NULL, &error);
  g_assert_no_error (error);

  for (i = 0; TRUE; i++)
    {
      response = g_strdup_printf ("[%d%s", i, self->stutter ? "" : "]");
      g_output_stream_write_all (out, response, strlen (response), NULL, NULL, &error);
      g_free (response);

      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
        {
          g_error_free (error);
          break;
        }

      g_assert_no_error (error);
      g_usleep (50 * 1000); /* 50 ms */

      if (self->stutter)
        {
          g_output_stream_write_all (out, "]", 1, NULL, NULL, &error);
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
            {
              g_error_free (error);
              break;
            }
          g_assert_no_error (error);
        }
    }

  return FALSE;
}

static gboolean
mock_server_handle (MockServer *self,
                    GBufferedInputStream *in,
                    GOutputStream *out)
{
  GError *error = NULL;
  GHashTable *headers = NULL;
  gchar *what = NULL;
  const gchar *data;
  gsize length;
  gsize want;
  gssize off;
  const gchar *value;
  gchar *end;
  gboolean keep_alive;

  /* Read the request */
  do
    {
      if (g_buffered_input_stream_fill (in, 1024, NULL, &error) == 0)
        return FALSE; /* connection closed */
      g_assert_no_error (error);

      if (what == NULL)
        {
          gchar *method, *resource;
          data = g_buffered_input_stream_peek_buffer (in, &length);
          off = web_socket_util_parse_req_line (data, length, &method, &resource);
          g_assert (off >= 0);
          if (off == 0)
            continue;
          g_assert_cmpint (g_input_stream_skip (G_INPUT_STREAM (in), off, NULL, NULL), ==, off);
          what = g_strdup_printf ("%s %s", method, resource);
          g_free (method);
          g_free (resource);
        }

      if (headers == NULL)
        {
          data = g_buffered_input_stream_peek_buffer (in, &length);
          off = web_socket_util_parse_headers (data, length, &headers);
          g_assert (off >= 0);
          if (off == 0)
            continue;
          g_assert_cmpint (g_input_stream_skip (G_INPUT_STREAM (in), off, NULL, NULL), ==, off);
        }

      value = g_hash_table_lookup (headers, "Content-Length");
      if (value == NULL)
        {
          want = 0;
        }
      else
        {
          g_assert (value != NULL);
          want = strtoul (value, &end, 10);
          g_assert (end && end[0] == '\0');
        }

      data = g_buffered_input_stream_peek_buffer (in, &length);
      if (length < want)
        continue;

      if (want > 0)
        {
          g_assert_cmpstr (g_hash_table_lookup (headers, "Content-Type"), ==, "application/json");
          json_parser_load_from_data (parser, data, want, &error);
          g_assert_no_error (error);
          g_assert_cmpint (g_input_stream_skip (G_INPUT_STREAM (in), want, NULL, NULL), ==, want);
        }
    }
  while (0);

  if (g_str_equal (what, "GET /stream"))
    keep_alive = mock_server_stream (self, out);
  else
    keep_alive = mock_server_respond (self, what, out);

  g_free (what);
  g_hash_table_destroy (headers);
  return keep_alive;
}

static gboolean
mock_server_connection (GThreadedSocketService *service,
                        GSocketConnection *connection,
                        GObject *source_object)
{
  MockServer *self = (MockServer *)service;
  GInputStream *in;
  GOutputStream *out;
  gboolean keep_alive;
  GError *error = NULL;

  self->connections++;
  in = g_buffered_input_stream_new (g_io_stream_get_input_stream (G_IO_STREAM (connection)));
  out = g_io_stream_get_output_stream (G_IO_STREAM (connection));

  do
   {
     keep_alive = mock_server_handle (self, G_BUFFERED_INPUT_STREAM (in), out);
   }
  while (keep_alive);

  g_io_stream_close (G_IO_STREAM (connection), NULL, &error);
  g_assert_no_error (error);
  g_object_unref (in);
  return TRUE;
}

static void
mock_server_finalize (GObject *object)
{
  MockServer *self = (MockServer *)object;

  g_hash_table_destroy (self->responses);

  G_OBJECT_CLASS (mock_server_parent_class)->finalize (object);
}

static void
mock_server_class_init (MockServerClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  GThreadedSocketServiceClass *service_class = G_THREADED_SOCKET_SERVICE_CLASS (klass);

  object_class->finalize = mock_server_finalize;
  service_class->run = mock_server_connection;
}

static void
mock_server_push (MockServer *self,
                  const gchar *method,
                  const gchar *resource,
                  gchar *response)
{
  GQueue *queue;
  gchar *what;

  what = g_strdup_printf ("%s %s", method, resource);
  queue = g_hash_table_lookup (self->responses, what);
  if (queue == NULL)
    {
      queue = g_queue_new ();
      g_hash_table_insert (self->responses, what, queue);
      what = NULL;
    }
  g_free (what);

  g_queue_push_tail (queue, response);
}

static void
mock_server_response (MockServer *self,
                      const gchar *method,
                      const gchar *resource,
                      gint status,
                      const gchar *body)
{
  GString *string;
  const gchar *reason;

  if (status == 200)
    reason = "OK";
  else
    reason = "";

  string = g_string_new ("");
  g_string_printf (string, "HTTP/1.0 %d %s\r\n", status, reason);
  if (body)
    {
      g_string_append (string, "Content-Type: application/json\r\n");
      if (!self->no_length)
        g_string_append_printf (string, "Content-Length: %d\r\n", (gint)strlen (body));
    }
  if (self->keep_alive)
    {
      g_assert (!self->no_length);
      g_string_append (string, "Connection: keep-alive\r\n");
      if (!body)
        g_string_append(string, "Content-Length: 0\r\n");
    }
  g_string_append (string, "\r\n");
  if (body)
    g_string_append (string, body);

  mock_server_push (self, method, resource, g_string_free (string, FALSE));
}

#if 0
static void
mock_server_response_json (MockServer *self,
                           const gchar *method,
                           const gchar *resource,
                           gint status,
                           JsonNode *node)
{
  gchar *body = NULL;

  if (node)
    {
      json_generator_set_root (generator, node);
      body = json_generator_to_data (generator, NULL);
    }

  mock_server_response (self, method, resource, status, body);
}
#endif

/* -----------------------------------------------------------------------------
 * Test
 */

typedef struct {
  MockTransport *transport;
  MockServer *server;
  JsonObject *options;
  CockpitChannel *channel;
  gchar *channel_problem;
  GQueue *sent;
} TestCase;

static void
on_closed_get_problem (CockpitChannel *channel,
                       const gchar *problem,
                       gpointer user_data)
{
  gchar **retval = user_data;
  g_assert (retval != NULL && *retval == NULL);
  *retval = g_strdup (problem ? problem : "");
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  GError *error = NULL;
  gint port;

  tc->server = g_object_new (mock_server_get_type (), NULL);
  port = g_socket_listener_add_any_inet_port (G_SOCKET_LISTENER (tc->server), NULL, &error);
  g_assert_no_error (error);
  g_socket_service_start (G_SOCKET_SERVICE (tc->server));

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  tc->sent = tc->transport->sent;

  tc->options = json_object_new ();
  json_object_set_int_member (tc->options, "port", port);

  tc->channel = g_object_new (COCKPIT_TYPE_REST_JSON,
                              "options", tc->options,
                              "transport", tc->transport,
                              "channel", 888,
                              NULL);
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_closed_get_problem), &tc->channel_problem);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  g_socket_service_stop (G_SOCKET_SERVICE (tc->server));
  g_object_unref (tc->server);

  if (tc->channel)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
      g_object_unref (tc->channel);
      g_assert (tc->channel == NULL);
    }

  json_object_unref (tc->options);
  g_object_unref (tc->transport);
  g_free (tc->channel_problem);
}

static void
send_request (TestCase *tc,
              const char *string)
{
  GBytes *sent;

  sent = g_bytes_new (string, strlen (string));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 888, sent);
  g_bytes_unref (sent);
}

static void
simple_request (TestCase *tc,
                const gchar *method,
                const gchar *path)
{
  GBytes *sent;
  gchar *data;

  data = g_strdup_printf ("{\"method\":\"%s\",\"path\":\"%s\"}", method, path);
  sent = g_bytes_new_take (data, strlen (data));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 888, sent);
  g_bytes_unref (sent);
}

static void
assert_json_eq_ (const gchar *domain,
                 const gchar *file,
                 int line,
                 const gchar *func,
                 const char *expr,
                 JsonNode *json,
                 const gchar *str)
{
  GError *error = NULL;
  gchar *message;
  gchar *generated;

  json_parser_load_from_data (parser, str, -1, &error);
  g_assert_no_error (error);

  if (!cockpit_json_equal (json, json_parser_get_root (parser)))
    {
      json_generator_set_root (generator, json);
      generated = json_generator_to_data (generator, NULL);

      message = g_strdup_printf ("assertion failed (%s == %s): %s == %s",
                                 expr, str, generated, str);
      g_assertion_message (domain, file, line, func, message);
      g_free (message);
      g_free (generated);
    }
}

#define assert_json_eq(json, str) \
  assert_json_eq_ (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, #json, (json), (str));

#define all_is_quiet(tc) \
  ((tc)->transport->sent->head == NULL && (tc)->channel_problem == NULL)

static void
test_simple (TestCase *tc,
             gconstpointer unused)
{
  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");
}

static void
test_stutter (TestCase *tc,
              gconstpointer unused)
{
  tc->server->stutter = TRUE;
  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");
}

static void
test_no_length (TestCase *tc,
                gconstpointer unused)
{
  tc->server->no_length = TRUE;
  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"body\":{\"key\":\"value\"}}");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true}");
}

static void
test_stutter_no_length (TestCase *tc,
                        gconstpointer unused)
{
  tc->server->stutter = TRUE;
  tc->server->no_length = TRUE;
  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"body\":{\"key\":\"value\"}}");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true}");
}

static void
test_post (TestCase *tc,
           gconstpointer unused)
{
  mock_server_response (tc->server, "POST", "/", 200,
                        "{ \"key\": \"value\" }");

  send_request (tc, "{\"method\":\"POST\",\"path\":\"/\",\"body\": []}");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");
}

static void
test_slowly (TestCase *tc,
             gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");
}

static void
test_keep_alive (TestCase *tc,
                 gconstpointer unused)
{
  tc->server->keep_alive = TRUE;

  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");
  mock_server_response (tc->server, "GET", "/", 200,
                        "{ \"key\": \"value\" }");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":200,\"message\":\"OK\","
                  " \"complete\":true,\"body\":{\"key\":\"value\"}}");

  g_assert_cmpint (tc->server->connections, ==, 1);
}

static void
test_bad_json (TestCase *tc,
               gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_response (tc->server, "GET", "/", 200, "{ ");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "protocol-error");
}

static void
test_bad_status (TestCase *tc,
                 gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_push (tc->server, "GET", "/", "BLAH\r\n");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "protocol-error");
}

static void
test_bad_truncated (TestCase *tc,
                    gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_push (tc->server, "GET", "/", "BL");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "protocol-error");
}

static void
test_bad_version (TestCase *tc,
                  gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_push (tc->server, "GET", "/", "HTTP/2.0 200 OK\r\n\r\n");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "protocol-error");
}

static void
test_skip_body_error_version (TestCase *tc,
                              gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_push (tc->server, "GET", "/",
                    "HTTP/1.1 400 Bad\r\nContent-type: application/json\r\n\r\n{ }");

  simple_request (tc, "GET", "/");

  /* Even though had json, skipped due to HTTP version, (only works one errors) */
  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  assert_json_eq (g_queue_pop_head (tc->sent),
                  "{\"cookie\":0,\"status\":400,\"message\":\"Bad\","
                  " \"complete\":true}");
}

static void
test_bad_content_length (TestCase *tc,
                         gconstpointer unused)
{
  tc->server->slowly = TRUE;

  mock_server_push (tc->server, "GET", "/",
                    "HTTP/1.0 200 OK\r\nContent-Length: blah\r\n\r\n");

  simple_request (tc, "GET", "/");

  while (all_is_quiet (tc))
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->channel_problem, ==, "protocol-error");
}

static void
test_stream (TestCase *tc,
             gconstpointer unused)
{
  gchar *expect;
  JsonObject *last;
  JsonNode *body;
  gint i;

  mock_server_response (tc->server, "GET", "/", 200,
                        " { \"key\": 1 } { \"key\": 2 }{ \"key\": 3}  ");

  simple_request (tc, "GET", "/");

  for (i = 1; TRUE; i++)
    {
      g_assert_cmpint (i, <=, 3);

      while (all_is_quiet (tc))
        g_main_context_iteration (NULL, TRUE);

      last = json_node_get_object (g_queue_pop_head (tc->sent));

      body = json_object_get_member (last, "body");
      expect = g_strdup_printf ("{\"key\": %d}", i);
      assert_json_eq (body, expect);
      g_free (expect);

      g_assert (last != NULL);
      if (json_object_has_member (last, "complete"))
        break;
    }
}

static void
test_stream_stutter (TestCase *tc,
                     gconstpointer unused)
{
  gchar *expect;
  JsonObject *last;
  JsonNode *body;
  gint i;

  /* Write data in strange write() calls */
  tc->server->stutter = TRUE;
  simple_request (tc, "GET", "/stream");

  for (i = 0; i < 4; i++)
    {
      while (all_is_quiet (tc))
        g_main_context_iteration (NULL, TRUE);

      last = json_node_get_object (g_queue_pop_head (tc->sent));

      body = json_object_get_member (last, "body");
      expect = g_strdup_printf ("[%d]", i);
      assert_json_eq (body, expect);
      g_free (expect);
    }
}

static void
test_poll_interval (TestCase *tc,
                    gconstpointer unused)
{
  JsonNode *last = NULL;
  JsonNode *next = NULL;
  gint count;
  gchar *response;
  gint i;

  for (i = 0; i < 10; i++)
    {
      /* Every second response is identical to previous */
      response = g_strdup_printf ("{ \"key\": %d}", i / 2);
      mock_server_response (tc->server, "GET", "/poll", 200, response);
      g_free (response);
    }

  send_request (tc, "{ \"path\": \"/poll\", \"poll\": { \"interval\": 20 }}");

  count = 0;
  for (;;)
    {
      while (all_is_quiet (tc))
        g_main_context_iteration (NULL, TRUE);

      next = g_queue_pop_head (tc->sent);
      g_assert (!cockpit_json_equal (last, next));
      last = next;

      count++;

      g_assert (last != NULL);
      if (json_object_has_member (json_node_get_object (last), "complete"))
        break;
    }

  /* Will get every other of above responses, and then a 404 once they all get unqueued */
  assert_json_eq (last,
                  "{\"cookie\":0,\"status\":404,\"message\":\"Not Found\",\"complete\":true}");
  g_assert_cmpint (count, ==, 5 + 1);
}

static void
test_poll_stutter (TestCase *tc,
                   gconstpointer unused)
{
  JsonNode *last = NULL;
  JsonNode *next = NULL;
  gint count;
  gchar *response;
  gint i;

  tc->server->stutter = TRUE;
  tc->server->no_length = TRUE;

  for (i = 0; i < 10; i++)
    {
      /* Every second response is identical to previous */
      response = g_strdup_printf ("[%d]", i / 2);
      mock_server_response (tc->server, "GET", "/poll", 200, response);
      g_free (response);
    }

  send_request (tc, "{ \"path\": \"/poll\", \"poll\": { \"interval\": 20 }}");

  count = 0;
  for (;;)
    {
      while (all_is_quiet (tc))
        g_main_context_iteration (NULL, TRUE);

      next = g_queue_pop_head (tc->sent);
      g_assert (!cockpit_json_equal (last, next));
      last = next;

      count++;

      g_assert (last != NULL);
      if (json_object_has_member (json_node_get_object (last), "complete"))
        break;
    }

  /* Will get every other of above responses, and then a 404 once they all get unqueued */
  assert_json_eq (last,
                  "{\"cookie\":0,\"status\":404,\"message\":\"Not Found\",\"complete\":true}");
  g_assert_cmpint (count, ==, 5 + 1);
}


static void
test_poll_watch (TestCase *tc,
                 gconstpointer unused)
{
  JsonNode *last = NULL;
  JsonNode *next = NULL;
  gint count;
  gchar *response;
  JsonObject *object;
  gint i;

  for (i = 0; i < 10; i++)
    {
      /* Every second response is identical to previous */
      response = g_strdup_printf ("{ \"key\": %d}", i / 2);
      mock_server_response (tc->server, "GET", "/poll", 200, response);
      g_free (response);
    }

  send_request (tc, "{ \"path\": \"/poll\", \"poll\": { \"watch\": 5 }}");

  /* Get the streaming request to use as a watch, note we can do this after */
  send_request (tc, "{ \"cookie\": 5, \"path\": \"/stream\" }");

  count = 0;
  for (;;)
    {
      while (all_is_quiet (tc))
        g_main_context_iteration (NULL, TRUE);

      next = g_queue_pop_head (tc->sent);

      /* Skip the stream responses */
      object = json_node_get_object (next);
      if (json_object_get_int_member (object, "cookie") == 5)
        continue;

      /* Otherwise the poll responses should each be different */
      g_assert (!cockpit_json_equal (last, next));

      count++;
      last = next;

      if (json_object_has_member (object, "complete"))
        break;
    }

  /* Will get every other of above responses, and then a 404 once they all get unqueued */
  assert_json_eq (last,
                  "{\"cookie\":0,\"status\":404,\"message\":\"Not Found\",\"complete\":true}");
  g_assert_cmpint (count, ==, 5 + 1);
}

static void
test_bad_unix_socket (void)
{
  gchar *problem = NULL;
  MockTransport *transport;
  CockpitChannel *channel;
  JsonObject *options;
  GBytes *sent;
  gint i;
  gchar *string;

  transport = g_object_new (mock_transport_get_type (), NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "unix", "/non-existant");

  channel = g_object_new (COCKPIT_TYPE_REST_JSON,
                          "options", options,
                          "transport", transport,
                          "channel", 888,
                          NULL);
  json_object_unref (options);

  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_get_problem), &problem);

  /* Send requests immediately */
  for (i = 0; i < 4; i++)
    {
      string = g_strdup_printf ("{ \"cookie\": %d, \"path\": \"/bad-unix\" }", i);
      sent = g_bytes_new_take (string, strlen (string));
      cockpit_transport_emit_recv (COCKPIT_TRANSPORT (transport), 888, sent);
      g_bytes_unref (sent);
    }

  g_object_unref (transport);

  /* When closed immediately unref */
  while (transport->sent->head == NULL && problem == NULL)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (problem, ==, "not-found");

  g_object_add_weak_pointer (G_OBJECT (channel), (gpointer *)&channel);
  g_object_unref (channel);
  g_assert (channel == NULL);

  while (g_main_context_iteration (NULL, FALSE));
}

int
main (int argc,
      char *argv[])
{
  gint ret;

  g_type_init ();

  g_set_prgname ("test-restjson");
  g_test_init (&argc, &argv, NULL);

  g_test_add ("/rest-json/simple", TestCase, NULL,
              setup, test_simple, teardown);
  g_test_add ("/rest-json/stutter", TestCase, NULL,
              setup, test_stutter, teardown);
  g_test_add ("/rest-json/no-length", TestCase, NULL,
              setup, test_no_length, teardown);
  g_test_add ("/rest-json/stutter-no-length", TestCase, NULL,
              setup, test_stutter_no_length, teardown);
  g_test_add ("/rest-json/post", TestCase, NULL,
              setup, test_post, teardown);
  g_test_add ("/rest-json/slowly", TestCase, NULL,
              setup, test_slowly, teardown);
  g_test_add ("/rest-json/keep-alive", TestCase, NULL,
              setup, test_keep_alive, teardown);

  g_test_add ("/rest-json/bad-json", TestCase, NULL,
              setup, test_bad_json, teardown);
  g_test_add ("/rest-json/bad-status", TestCase, NULL,
              setup, test_bad_status, teardown);
  g_test_add ("/rest-json/bad-truncated", TestCase, NULL,
              setup, test_bad_truncated, teardown);
  g_test_add ("/rest-json/bad-content-length", TestCase, NULL,
              setup, test_bad_content_length, teardown);
  g_test_add ("/rest-json/bad-version", TestCase, NULL,
              setup, test_bad_version, teardown);
  g_test_add_func ("/rest-json/bad-unix", test_bad_unix_socket);

  g_test_add ("/rest-json/skip-body-error-version", TestCase, NULL,
              setup, test_skip_body_error_version, teardown);
  g_test_add ("/rest-json/stream", TestCase, NULL,
              setup, test_stream, teardown);
  g_test_add ("/rest-json/stream-stutter", TestCase, NULL,
              setup, test_stream_stutter, teardown);
  g_test_add ("/rest-json/poll-interval", TestCase, NULL,
              setup, test_poll_interval, teardown);
  g_test_add ("/rest-json/poll-watch", TestCase, NULL,
              setup, test_poll_watch, teardown);
  g_test_add ("/rest-json/poll-stutter", TestCase, NULL,
              setup, test_poll_stutter, teardown);

  parser = json_parser_new ();
  generator = json_generator_new ();

  ret = g_test_run ();

  g_object_unref (parser);
  g_object_unref (generator);

  return ret;
}
