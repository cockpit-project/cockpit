/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2021 Red Hat, Inc.
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

#include "cockpitposttestwebserver.h"

#include "common/cockpithash.h"
#include "common/cockpitmemory.h"
#include "common/cockpitwebresponse.h"

#include "websocket/websocket.h"

#include <sys/socket.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <systemd/sd-daemon.h>

guint cockpit_post_test_webserver_request_timeout = 600;
const gsize cockpit_post_test_webserver_buffer_size = 65536;
const gsize cockpit_post_test_webserver_request_maximum = 1073741824;

struct _CockpitPostTestWebServer {
  GObject parent_instance;

  gint port;
  GInetAddress *address;
  gboolean socket_activated;
  gint request_timeout;
  gint request_max;

  gchar *output_filename;

  GSocketService *socket_service;
  GMainContext *main_context;
  GHashTable *requests;
};

enum
{
  PROP_0,
  PROP_PORT,
  PROP_ADDRESS,
  PROP_OUTPUT_FILENAME,
  PROP_SOCKET_ACTIVATED,
};

static gint sig_handle_stream = 0;
static gint sig_handle_resource = 0;

static void cockpit_request_free (gpointer data);

static void cockpit_request_start (CockpitPostTestWebServer *self,
                                   GIOStream *stream,
                                   gboolean first);

static void initable_iface_init (GInitableIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitPostTestWebServer, cockpit_post_test_web_server, G_TYPE_OBJECT,
  G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, initable_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
cockpit_post_test_web_server_init (CockpitPostTestWebServer *server)
{
  server->requests = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                            cockpit_request_free, NULL);
  server->main_context = g_main_context_ref_thread_default ();
  server->address = NULL;
}

static void
cockpit_post_test_web_server_dispose (GObject *object)
{
  CockpitPostTestWebServer *self = COCKPIT_POST_TEST_WEB_SERVER (object);

  g_hash_table_remove_all (self->requests);

  G_OBJECT_CLASS (cockpit_post_test_web_server_parent_class)->dispose (object);
}

static void
cockpit_post_test_web_server_finalize (GObject *object)
{
  CockpitPostTestWebServer *server = COCKPIT_POST_TEST_WEB_SERVER (object);

  g_clear_object (&server->address);
  g_hash_table_destroy (server->requests);
  if (server->main_context)
    g_main_context_unref (server->main_context);
  g_free (server->output_filename);
  g_clear_object (&server->socket_service);

  G_OBJECT_CLASS (cockpit_post_test_web_server_parent_class)->finalize (object);
}

static void
cockpit_post_test_web_server_get_property (GObject *object,
                                           guint prop_id,
                                           GValue *value,
                                           GParamSpec *pspec)
{
  CockpitPostTestWebServer *server = COCKPIT_POST_TEST_WEB_SERVER (object);

  switch (prop_id)
    {
      case PROP_PORT:
        g_value_set_int (value, cockpit_post_test_web_server_get_port (server));
        break;

      case PROP_SOCKET_ACTIVATED:
        g_value_set_boolean (value, server->socket_activated);
        break;

      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
        break;
    }
}

static void
cockpit_post_test_web_server_set_property (GObject *object,
                                           guint prop_id,
                                           const GValue *value,
                                           GParamSpec *pspec)
{
  CockpitPostTestWebServer *server = COCKPIT_POST_TEST_WEB_SERVER (object);
  const gchar *address = NULL, *output_filename = NULL;

  switch (prop_id)
    {
      case PROP_PORT:
        server->port = g_value_get_int (value);
        break;

      case PROP_ADDRESS:
        address = g_value_get_string (value);
        if (address)
          {
            server->address = g_inet_address_new_from_string (address);
            if (!server->address)
              g_warning ("Couldn't parse IP address from: %s", address);
          }
        break;

      case PROP_OUTPUT_FILENAME:
        output_filename = g_value_get_string (value);
        if (output_filename)
          server->output_filename = g_strdup(output_filename);
        break;

      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
        break;
    }
}

static void
on_io_closed (GObject *stream,
              GAsyncResult *result,
              gpointer user_data)
{
  GError *error = NULL;

  if (!g_io_stream_close_finish (G_IO_STREAM (stream), result, &error))
    {
      if (!cockpit_web_should_suppress_output_error ("http", error))
        g_message ("http close error: %s", error->message);
      g_error_free (error);
    }
}

static void
close_io_stream (GIOStream *io)
{
  g_io_stream_close_async (io, G_PRIORITY_DEFAULT, NULL, on_io_closed, NULL);
}

static void
on_web_response_done (CockpitWebResponse *response,
                      gboolean reusable,
                      gpointer user_data)
{
  CockpitPostTestWebServer *self = user_data;
  GIOStream *io;

  io = cockpit_web_response_get_stream (response);
  if (reusable)
    cockpit_request_start (self, io, FALSE);
  else
    close_io_stream (io);
}

static gboolean
cockpit_post_test_web_server_default_handle_resource (CockpitPostTestWebServer *self,
                                                      const gchar *path,
                                                      GHashTable *headers,
                                                      CockpitWebResponse *response)
{
  cockpit_web_response_error (response, 404, NULL, NULL);
  return TRUE;
}

static gboolean
cockpit_post_test_web_server_default_handle_stream (CockpitPostTestWebServer *self,
                                                    const gchar *original_path,
                                                    const gchar *path,
                                                    const gchar *method,
                                                    GIOStream *io_stream,
                                                    GHashTable *headers,
                                                    GByteArray *input)
{
  CockpitWebResponse *response;
  gboolean claimed = FALSE;
  GQuark detail;
  gchar *pos;
  gchar *orig_pos;
  gchar bak;

  /* Yes, we happen to know that we can modify this string safely. */
  pos = strchr (path, '?');
  if (pos != NULL)
    {
      *pos = '\0';
      pos++;
    }

  /* We also have to strip original_path so that CockpitWebResponse
     can rediscover url_root. */
  orig_pos = strchr (original_path, '?');
  if (orig_pos != NULL)
    *orig_pos = '\0';

  /* TODO: Correct HTTP version for response */
  response = cockpit_web_response_new (io_stream, original_path, path, pos, headers,
                                       COCKPIT_WEB_RESPONSE_NONE);
  cockpit_web_response_set_method (response, !g_strcmp0 (method, "POST") ? "GET" : "POST");
  g_signal_connect_data (response, "done", G_CALLBACK (on_web_response_done),
                         g_object_ref (self), (GClosureNotify)g_object_unref, 0);

  /*
   * If the path has more than one component, then we search
   * for handlers registered under the detail like this:
   *
   *   /component/
   *
   * Otherwise we search for handlers registered under detail
   * of the entire path:
   *
   *  /component
   */

  /* Temporarily null terminate string after first component */
  pos = NULL;
  if (path[0] != '\0')
    {
      pos = strchr (path + 1, '/');
      if (pos != NULL)
        {
          pos++;
          bak = *pos;
          *pos = '\0';
        }
    }
  detail = g_quark_try_string (path);
  if (pos != NULL)
    *pos = bak;

  /* See if we have any takers... */
  g_signal_emit (self,
                 sig_handle_resource, detail,
                 path,
                 headers,
                 response,
                 &claimed);

  if (!claimed)
    claimed = cockpit_post_test_web_server_default_handle_resource (self, path, headers, response);

  /* TODO: Here is where we would plug keep-alive into response */
  g_object_unref (response);

  return claimed;
}

static void
cockpit_post_test_web_server_class_init (CockpitPostTestWebServerClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = cockpit_post_test_web_server_dispose;
  gobject_class->finalize = cockpit_post_test_web_server_finalize;
  gobject_class->set_property = cockpit_post_test_web_server_set_property;
  gobject_class->get_property = cockpit_post_test_web_server_get_property;

  g_object_class_install_property (gobject_class,
                                   PROP_PORT,
                                   g_param_spec_int ("port", NULL, NULL,
                                                     -1, 65535, 8080,
                                                     G_PARAM_READABLE |
                                                     G_PARAM_WRITABLE |
                                                     G_PARAM_CONSTRUCT_ONLY |
                                                     G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_ADDRESS,
                                   g_param_spec_string ("address", NULL, NULL, NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_OUTPUT_FILENAME,
                                   g_param_spec_string ("output-filename", NULL, NULL, NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_SOCKET_ACTIVATED,
                                   g_param_spec_boolean ("socket-activated", NULL, NULL, FALSE,
                                                         G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  sig_handle_stream = g_signal_new ("handle-stream",
                                    G_OBJECT_CLASS_TYPE (klass),
                                    G_SIGNAL_RUN_LAST,
                                    0, /* class offset */
                                    g_signal_accumulator_true_handled,
                                    NULL, /* accu_data */
                                    g_cclosure_marshal_generic,
                                    G_TYPE_BOOLEAN,
                                    6,
                                    G_TYPE_STRING,
                                    G_TYPE_STRING,
                                    G_TYPE_STRING,
                                    G_TYPE_IO_STREAM,
                                    G_TYPE_HASH_TABLE,
                                    G_TYPE_BYTE_ARRAY);

  sig_handle_resource = g_signal_new ("handle-resource",
                                      G_OBJECT_CLASS_TYPE (klass),
                                      G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                      0, /* class offset */
                                      g_signal_accumulator_true_handled,
                                      NULL, /* accu_data */
                                      g_cclosure_marshal_generic,
                                      G_TYPE_BOOLEAN,
                                      3,
                                      G_TYPE_STRING,
                                      G_TYPE_HASH_TABLE,
                                      COCKPIT_TYPE_WEB_RESPONSE);
}

CockpitPostTestWebServer *
cockpit_post_test_web_server_new (const gchar *address,
                                  gint port,
                                  const gchar *output_filename,
                                  GCancellable *cancellable,
                                  GError **error)
{
  GInitable *initable;
  initable = g_initable_new (COCKPIT_TYPE_POST_TEST_WEB_SERVER,
                             cancellable,
                             error,
                             "port", port,
                             "address", address,
                             "output-filename", output_filename,
                             NULL);
  if (initable != NULL)
    return COCKPIT_POST_TEST_WEB_SERVER (initable);
  else
    return NULL;
}

void
cockpit_post_test_web_server_start (CockpitPostTestWebServer *self)
{
  g_return_if_fail (COCKPIT_IS_POST_TEST_WEB_SERVER (self));
  g_socket_service_start (self->socket_service);
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_post_test_web_server_get_socket_activated (CockpitPostTestWebServer *self)
{
  return self->socket_activated;
}

gint
cockpit_post_test_web_server_get_port (CockpitPostTestWebServer *self)
{
  g_return_val_if_fail (COCKPIT_IS_POST_TEST_WEB_SERVER (self), -1);
  return self->port;
}

GHashTable *
cockpit_post_test_web_server_new_table (void)
{
  return g_hash_table_new_full (cockpit_str_case_hash, cockpit_str_case_equal, g_free, g_free);
}

gchar *
cockpit_post_test_web_server_parse_cookie (GHashTable *headers,
                                           const gchar *name)
{
  const gchar *header;
  const gchar *pos;
  const gchar *value;
  const gchar *end;
  gboolean at_start = TRUE;
  gchar *decoded;
  gint diff;
  gint offset;

  header = g_hash_table_lookup (headers, "Cookie");
  if (!header)
    return NULL;

  for (;;)
    {
      pos = strstr (header, name);
      if (!pos)
        return NULL;

      if (pos != header)
        {
          diff = strlen (header) - strlen (pos);
          offset = 1;
          at_start = FALSE;
          while (offset < diff)
            {
              if (!g_ascii_isspace (*(pos - offset)))
                {
                  at_start = *(pos - offset) == ';';
                  break;
                }
              offset++;
            }
        }

      pos += strlen (name);
      if (*pos == '=' && at_start)
        {
          value = pos + 1;
          end = strchr (value, ';');
          if (end == NULL)
            end = value + strlen (value);

          decoded = g_uri_unescape_segment (value, end, NULL);
          if (!decoded)
            g_debug ("invalid cookie encoding");

          return decoded;
        }
      else
        {
          at_start = FALSE;
        }
      header = pos;
    }
}

typedef struct {
    double qvalue;
    const gchar *value;
} Language;

static gint
sort_qvalue (gconstpointer a,
             gconstpointer b)
{
  const Language *la = *((Language **)a);
  const Language *lb = *((Language **)b);
  if (lb->qvalue == la->qvalue)
    return 0;
  return lb->qvalue < la->qvalue ? -1 : 1;
}

gchar **
cockpit_post_test_web_server_parse_languages (GHashTable *headers,
                                              const gchar *defawlt)
{
  const gchar *accept;
  Language *lang;
  GPtrArray *langs;
  GPtrArray *ret;
  gchar *copy;
  gchar *value;
  gchar *next;
  gchar *pos;
  guint i;

  langs = g_ptr_array_new_with_free_func (g_free);

  if (defawlt)
    {
      lang = g_new0 (Language, 1);
      lang->qvalue = 0.1;
      lang->value = defawlt;
      g_ptr_array_add (langs, lang);
    }

  accept = g_hash_table_lookup (headers, "Accept-Language");

  /* First build up an array we can sort */
  accept = copy = g_strdup (accept);

  while (accept)
    {
      next = strchr (accept, ',');
      if (next)
        {
          *next = '\0';
          next++;
        }

      lang = g_new0 (Language, 1);
      lang->qvalue = 1;

      pos = strchr (accept, ';');
      if (pos)
        {
          *pos = '\0';
          if (strncmp (pos + 1, "q=", 2) == 0)
            {
              lang->qvalue = g_ascii_strtod (pos + 3, NULL);
              if (lang->qvalue < 0)
                lang->qvalue = 0;
            }
        }

      lang->value = accept;
      g_ptr_array_add (langs, lang);
      accept = next;
    }

  g_ptr_array_sort (langs, sort_qvalue);

  /* Now in the right order add all the prefs */
  ret = g_ptr_array_new ();
  for (i = 0; i < langs->len; i++)
    {
      lang = langs->pdata[i];
      if (lang->qvalue > 0)
        {
          value = g_strstrip (g_ascii_strdown (lang->value, -1));
          g_ptr_array_add (ret, value);
        }
    }

  /* Add base languages after that */
  for (i = 0; i < langs->len; i++)
    {
      lang = langs->pdata[i];
      if (lang->qvalue > 0)
        {
          pos = strchr (lang->value, '-');
          if (pos)
            {
              value = g_strstrip (g_ascii_strdown (lang->value, pos - lang->value));
              g_ptr_array_add (ret, value);
            }
        }
    }

  g_free (copy);
  g_ptr_array_add (ret, NULL);
  g_ptr_array_free (langs, TRUE);
  return (gchar **)g_ptr_array_free (ret, FALSE);
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
    int state;
    GIOStream *io;
    GFile *file;
    GFileOutputStream *out_stream;
    GByteArray *header;
    gint delayed_reply;
    CockpitPostTestWebServer *web_server;
    gboolean eof_okay;
    GSource *source;
    GSource *timeout;
    gssize count;

    /* Attributes from header */
    GHashTable *headers;
    gchar *method;
    gchar *path;
    gchar *host;
} CockpitRequest;

static void
cockpit_request_free (gpointer data)
{
  CockpitRequest *request = data;
  if (request->timeout)
    {
      g_source_destroy(request->timeout);
      g_source_unref(request->timeout);
    }
  if (request->source)
    {
      g_source_destroy(request->source);
      g_source_unref(request->source);
    }

  /*
   * Request memory is either cleared or used elsewhere, by
   * handle-stream handlers (eg: the default handler. Don't
   * clear it here.
   */
  if (request->header)
    g_byte_array_unref (request->header);
  if (request->headers)
    g_hash_table_unref (request->headers);
  if (request->method)
    g_free (request->method);
  if (request->path)
    g_free (request->path);
  if (request->out_stream)
    {
      g_output_stream_close (G_OUTPUT_STREAM (request->out_stream), NULL, NULL);
      g_object_unref (request->out_stream);
    }
  g_object_unref (request->file);
  g_object_unref (request->io);
  g_free (request);
}

static void
cockpit_request_finish (CockpitRequest *request)
{
  g_hash_table_remove (request->web_server->requests, request);
}

static void
process_delayed_reply (CockpitRequest *request)
{
  CockpitWebResponse *response;

  g_assert (request->delayed_reply > 299);

  response = cockpit_web_response_new (request->io, NULL, NULL, NULL, request->headers,
                                       COCKPIT_WEB_RESPONSE_NONE);
  g_signal_connect_data (response, "done", G_CALLBACK (on_web_response_done),
                         g_object_ref (request->web_server), (GClosureNotify)g_object_unref, 0);

  cockpit_web_response_error (response, request->delayed_reply, NULL, NULL);

  g_object_unref (response);
}

static int
cockpit_request_load_header_from_file (CockpitRequest *request,
                                       GError **error)
{
  g_autoptr(GFileInputStream) raw_input_stream = g_file_read (request->file, NULL, error);
  g_autoptr(GInputStream) input_stream = g_buffered_input_stream_new (G_INPUT_STREAM (raw_input_stream));
  guint8 bytes[5] = {0, 0, 0, 0, 0};
  gssize read;

  request->header = g_byte_array_new ();

  while (g_strcmp0 ((gchar *)bytes, "\r\n\r\n"))
    {
      for (int i = 1; i <= 3; i++)
        bytes[i - 1] = bytes[i];

      read = g_input_stream_read (input_stream, (void *) &bytes[3], 1, NULL, error);
      if (read < 0)
        {
          g_warning ("couldn't read request file");
          return read;
        }
      if (read == 0)
        {
          g_warning ("unexpected end of file while reading header from request file");
          return read;
        }

      g_byte_array_append (request->header, &bytes[3], 1);
    }

  return request->header->len;
}

static void
process_request (CockpitRequest *request)
{
  gboolean claimed = FALSE;
  const gchar *actual_path;

  if (request->delayed_reply)
    {
      process_delayed_reply (request);
      return;
    }

  actual_path = request->path;

  /* See if we have any takers... */
  g_signal_emit (request->web_server,
                 sig_handle_stream, 0,
                 request->path,
                 actual_path,
                 request->method,
                 request->io,
                 request->headers,
                 request->header,
                 &claimed);

  if (!claimed)
    claimed = cockpit_post_test_web_server_default_handle_stream (request->web_server, request->path, actual_path,
                                                                  request->method, request->io, request->headers,
                                                                  request->header);

  if (!claimed)
    g_critical ("no handler responded to request: %s", actual_path);
}

static gboolean
parse_request_header (CockpitRequest *request)
{
  gssize off1;
  gssize off2;

  /* The hard input limit, we just terminate the connection */
  if (request->header->len > cockpit_post_test_webserver_request_maximum * 2)
    {
      g_message ("received HTTP request whose header was too large");
      return FALSE;
    }

  off1 = web_socket_util_parse_req_line ((const gchar *)request->header->data,
                                         request->header->len,
                                         &request->method,
                                         &request->path);
  if (off1 <= 0)
    {
      g_message ("received invalid HTTP request line");
      request->delayed_reply = 400;
      return FALSE;
    }
  if (!request->path || request->path[0] != '/')
    {
      g_message ("received invalid HTTP path");
      request->delayed_reply = 400;
      return FALSE;
    }

  off2 = web_socket_util_parse_headers ((const gchar *)request->header->data + off1,
                                        request->header->len - off1,
                                        &request->headers);
  if (off2 <= 0)
    {
      g_message ("received invalid HTTP request headers");
      request->delayed_reply = 400;
      return FALSE;
    }

  return TRUE;
}

static gboolean
parse_and_process_request (CockpitRequest *request)
{
  const gchar *str;
  gchar *end = NULL;
  guint64 length;

  /* Ignore Content-Length if set to non-zero */
  length = 0;
  str = g_hash_table_lookup (request->headers, "Content-Length");
  if (str != NULL)
    {
      end = NULL;
      length = g_ascii_strtoull (str, &end, 10);
      if (!end || end[0])
        {
          g_message ("received invalid Content-Length");
          request->delayed_reply = 400;
        }

      /* Ignore content */
      if (length != 0)
        {
          g_debug ("received non-zero Content-Length");
          length = 0;
        }
    }

  if (!g_str_equal (request->method, "GET") &&
      !g_str_equal (request->method, "HEAD") &&
      !g_str_equal (request->method, "POST"))
    {
      g_message ("received unsupported HTTP method");
      request->delayed_reply = 405;
    }

  request->host = g_hash_table_lookup (request->headers, "Host");
  if (!request->host || g_str_equal (request->host, ""))
    {
      g_message ("received HTTP request without Host header");
      request->delayed_reply = 400;
    }

  process_request (request);

  cockpit_request_finish (request);
  return TRUE;
}

#if !GLIB_CHECK_VERSION(2,43,2)
#define G_IO_ERROR_CONNECTION_CLOSED G_IO_ERROR_BROKEN_PIPE
#endif

static gboolean
should_suppress_request_error (GError *error,
                               gsize received)
{
  /* If no bytes received, then don't worry about ECONNRESET and friends */
  if (received > 0)
    return FALSE;

  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CONNECTION_CLOSED) ||
      g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }

#if !GLIB_CHECK_VERSION(2,43,2)
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_FAILED) &&
      strstr (error->message, g_strerror (ECONNRESET)))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }
#endif

  return FALSE;
}

static gboolean
on_request_input (GObject *pollable_input,
                  gpointer user_data)
{
  GPollableInputStream *input = (GPollableInputStream *)pollable_input;
  CockpitRequest *request = user_data;
  GError *input_error = NULL, *output_error = NULL;
  g_autofree void *buffer;
  /*
   * Stores last three bytes of previous buffer to catch end of header if it's split.
   * Note: it is unlikely to happen, but it's safer to handle it (buffer size may be changed and so on).
   */
  char last_buffer_end[3];
  gboolean last_buffer_valid = FALSE;
  gssize count;

  buffer = g_malloc (cockpit_post_test_webserver_buffer_size);

  do
    {
      count = g_pollable_input_stream_read_nonblocking (input, buffer,
                                                        cockpit_post_test_webserver_buffer_size, NULL, &input_error);

      if (count > 0)
        {
          gboolean header_end_found = FALSE;

          request->count += count;

          if (!request->header)
            {
              /* Record last three bytes */
              last_buffer_valid = TRUE;
              for (gsize i = 0; i < 3; i++)
                last_buffer_end[i] = ((char *) buffer)[count - 3 + i];

              /* Look for header end (\r\n\r\n) */
              char array[5] = {0, 0, 0, 0, 0};
              for (char *pointer = last_buffer_valid ? last_buffer_end : (char *)buffer;
                   pointer < (pointer + count);
                   pointer++)
                {
                  for (int i = 1; i <= 3; i++)
                    array[i - 1] = array[i];

                  array[3] = *pointer;
                  if (g_strcmp0 (array, "\r\n\r\n"))
                    {
                      header_end_found = TRUE;
                      break;
                    }

                  if (pointer == (last_buffer_end + 2))
                    pointer = (char *)buffer;
                }
            }

          count = g_output_stream_write (G_OUTPUT_STREAM (request->out_stream),
                                         buffer,
                                         count,
                                         NULL,
                                         &output_error);

          if (header_end_found)
            {
              /* Load header from output file */
              g_output_stream_flush (G_OUTPUT_STREAM (request->out_stream),
                                     NULL,
                                     &output_error);
              if (output_error)
                {
                  cockpit_request_finish (request);
                  g_message ("cannot flush output file: %s", output_error->message);
                  g_error_free (output_error);
                  return FALSE;
                }
              cockpit_request_load_header_from_file (request, &input_error);

              if (input_error)
                {
                  cockpit_request_finish (request);
                  g_message ("cannot load header from file: %s", input_error->message);
                  g_error_free (input_error);
                  return FALSE;
                }

              /* Parse header (return error if the processing fails) */
              if (!parse_request_header (request))
                {
                  process_delayed_reply (request);
                  cockpit_request_finish (request);
                  return FALSE;
                }
            }

          if (count <= 0)
            {
              g_message ("cannot write request to file: %s", output_error->message);
              cockpit_request_finish (request);
              g_error_free (output_error);
              return FALSE;
            }

          if (request->header)
            {
              /* Check if the whole request has been read */
              const gchar *str = g_hash_table_lookup (request->headers, "Content-Length");
              if (str != NULL)
                {
                  gchar *end = NULL;
                  int length = g_ascii_strtoull (str, &end, 10);
                  if (!end || end[0])
                    {
                      g_message ("received invalid Content-Length");
                      request->delayed_reply = 400;
                      process_delayed_reply (request);
                      cockpit_request_finish (request);
                      return FALSE;
                    }

                  if (request->count - request->header->len >= length)
                    break;
                }
            }
        }

      if (count < 0)
        {
          if (g_error_matches (input_error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              /* Just wait and try again */
              g_error_free (input_error);
              return TRUE;
            }

          if (!should_suppress_request_error (input_error, count))
            g_message ("couldn't read from connection: %s", input_error->message);

          cockpit_request_finish (request);
          g_error_free (input_error);
          return FALSE;
        }

      if (count == 0)
        {
          if (request->eof_okay)
            close_io_stream (request->io);
          else
            g_debug ("caller closed connection early");
          cockpit_request_finish (request);
          return FALSE;
        }
    }
  while (count > 0);

  /* Once we receive data EOF is unexpected (until possible next request) */
  request->eof_okay = FALSE;

  return parse_and_process_request (request);
}

static void
start_request_input (CockpitRequest *request)
{
  GPollableInputStream *poll_in;
  GInputStream *in;
  GError *error = NULL;

  /* Both GSocketConnection and GTlsServerConnection are pollable */
  in = g_io_stream_get_input_stream (request->io);
  poll_in = NULL;
  if (G_IS_POLLABLE_INPUT_STREAM (in))
    poll_in = (GPollableInputStream *)in;

  if (!poll_in || !g_pollable_input_stream_can_poll (poll_in))
    {
      if (in)
        g_critical ("cannot use a non-pollable input stream: %s", G_OBJECT_TYPE_NAME (in));
      else
        g_critical ("no input stream available");

      cockpit_request_finish (request);
      return;
    }

  /* Replace with a new source */
  if (request->source)
    {
      g_source_destroy (request->source);
      g_source_unref (request->source);
    }

  /* Create an output stream */
  request->out_stream = g_file_append_to (request->file, G_FILE_CREATE_REPLACE_DESTINATION, NULL, &error);
  if (!request->out_stream)
    {
      g_critical ("cannot open output file: %s", error->message);
      g_error_free (error);
      cockpit_request_finish (request);
      return;
    }

  request->source = g_pollable_input_stream_create_source (poll_in, NULL);
  g_source_set_callback (request->source, (GSourceFunc)on_request_input, request, NULL);
  g_source_attach (request->source, request->web_server->main_context);
}

static gboolean
on_request_timeout (gpointer data)
{
  CockpitRequest *request = data;
  if (request->eof_okay)
    g_debug ("request timed out, closing");
  else
    g_message ("request timed out, closing");
  cockpit_request_finish (request);
  return FALSE;
}

static void
cockpit_request_start (CockpitPostTestWebServer *self,
                       GIOStream *io,
                       gboolean first)
{
  GSocketConnection *connection;
  CockpitRequest *request;
  GSocket *socket;

  request = g_new0 (CockpitRequest, 1);
  request->web_server = self;
  request->io = g_object_ref (io);
  request->header = NULL;
  request->headers = NULL;
  request->path = NULL;
  request->host = NULL;
  request->count = 0;

  /* Create a new output file the request will be saved to */
  request->file = g_file_new_for_path (self->output_filename);
  g_file_delete (request->file, NULL, NULL);

  /* Right before a request, EOF is not unexpected */
  request->eof_okay = TRUE;

  request->timeout = g_timeout_source_new_seconds (cockpit_post_test_webserver_request_timeout);
  g_source_set_callback (request->timeout, on_request_timeout, request, NULL);
  g_source_attach (request->timeout, self->main_context);

  if (first)
    {
      connection = G_SOCKET_CONNECTION (io);
      socket = g_socket_connection_get_socket (connection);
      g_socket_set_blocking (socket, FALSE);
    }

  /* Owns the request */
  g_hash_table_add (self->requests, request);

  start_request_input (request);
}

static gboolean
on_incoming (GSocketService *service,
             GSocketConnection *connection,
             GObject *source_object,
             gpointer user_data)
{
  CockpitPostTestWebServer *self = COCKPIT_POST_TEST_WEB_SERVER (user_data);
  cockpit_request_start (self, G_IO_STREAM (connection), TRUE);

  /* handled */
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
cockpit_post_test_web_server_initable_init (GInitable *initable,
                                            GCancellable *cancellable,
                                            GError **error)
{
  CockpitPostTestWebServer *server = COCKPIT_POST_TEST_WEB_SERVER (initable);
  GSocketAddress *socket_address = NULL;
  GSocketAddress *result_address = NULL;

  gboolean ret = FALSE;
  gboolean failed = FALSE;

  server->socket_service = g_socket_service_new ();

  /* The web server has to be explicitly started */
  g_socket_service_stop (server->socket_service);

  if (server->address)
    {
      socket_address = g_inet_socket_address_new (server->address, server->port);
      if (socket_address)
        {
          failed = !g_socket_listener_add_address (G_SOCKET_LISTENER (server->socket_service),
                                                   socket_address, G_SOCKET_TYPE_STREAM,
                                                   G_SOCKET_PROTOCOL_DEFAULT,
                                                   NULL, &result_address,
                                                   error);
          if (!failed)
          {
            server->port = g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (result_address));
            g_object_unref (result_address);
          }
          g_object_unref (socket_address);
        }
    }

  /* No address passed in, let's listen on our own. */
  else if (server->port == 0)
    {
      server->port = g_socket_listener_add_any_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                          NULL, error);
      failed = (server->port == 0);
    }
  else if (server->port > 0)
    {
      failed = !g_socket_listener_add_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                 server->port, NULL, error);
    }
  if (failed)
    {
      g_prefix_error (error, "Failed to bind to port %d: ", server->port);
      goto out;
    }

  g_signal_connect (server->socket_service,
                    "incoming",
                    G_CALLBACK (on_incoming),
                    server);

  ret = TRUE;

  out:
  return ret;
}

gboolean
cockpit_post_test_web_server_add_socket (CockpitPostTestWebServer *self,
                                         GSocket *socket,
                                         GError **error)
{
  return g_socket_listener_add_socket (G_SOCKET_LISTENER (self->socket_service), socket, NULL, error);
}

static void
initable_iface_init (GInitableIface *iface)
{
  iface->init = cockpit_post_test_web_server_initable_init;
}

/* ---------------------------------------------------------------------------------------------------- */
