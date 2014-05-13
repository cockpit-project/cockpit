/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
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

#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <systemd/sd-daemon.h>

#include <cockpit/cockpit.h>

#include "cockpitws.h"
#include "cockpitwebresponse.h"

#include "cockpit/cockpitmemory.h"

#include "websocket/websocket.h"

#include <gsystem-local-alloc.h>

guint cockpit_ws_request_timeout = 30;
gsize cockpit_ws_request_maximum = 4096;

typedef struct _CockpitWebServerClass CockpitWebServerClass;

struct _CockpitWebServer {
  GObject parent_instance;

  gint port;
  GTlsCertificate *certificate;
  gchar **document_roots;
  gint request_timeout;
  gint request_max;

  GSocketService *socket_service;
  GMainContext *main_context;
  GHashTable *requests;
};

struct _CockpitWebServerClass {
  GObjectClass parent_class;

  gboolean (* handle_stream)   (CockpitWebServer *server,
                                CockpitWebServerRequestType reqtype,
                                const gchar *path,
                                GIOStream *io_stream,
                                GHashTable *headers,
                                GByteArray *input,
                                guint in_length);

  gboolean (* handle_resource) (CockpitWebServer *server,
                                CockpitWebServerRequestType reqtype,
                                const gchar *path,
                                GHashTable *headers,
                                GBytes *input,
                                CockpitWebResponse *response);
};

enum
{
  PROP_0,
  PROP_PORT,
  PROP_CERTIFICATE,
  PROP_DOCUMENT_ROOTS,
};

static gint sig_handle_stream = 0;
static gint sig_handle_resource = 0;

static void cockpit_request_free (gpointer data);

static void initable_iface_init (GInitableIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitWebServer, cockpit_web_server, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, initable_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
cockpit_web_server_init (CockpitWebServer *server)
{
  server->requests = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                            cockpit_request_free, NULL);
  server->main_context = g_main_context_ref_thread_default ();
}

static void
cockpit_web_server_constructed (GObject *object)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);
  static gchar *default_roots[] = { ".", NULL };

  G_OBJECT_CLASS (cockpit_web_server_parent_class)->constructed (object);

  if (server->document_roots == NULL)
    server->document_roots = g_strdupv (default_roots);
}

static void
cockpit_web_server_dispose (GObject *object)
{
  CockpitWebServer *self = COCKPIT_WEB_SERVER (object);

  g_hash_table_remove_all (self->requests);

  G_OBJECT_CLASS (cockpit_web_server_parent_class)->dispose (object);
}

static void
cockpit_web_server_finalize (GObject *object)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  g_clear_object (&server->certificate);
  g_strfreev (server->document_roots);
  g_hash_table_destroy (server->requests);
  if (server->main_context)
    g_main_context_unref (server->main_context);
  g_clear_object (&server->socket_service);

  G_OBJECT_CLASS (cockpit_web_server_parent_class)->finalize (object);
}

static void
cockpit_web_server_get_property (GObject *object,
                                 guint prop_id,
                                 GValue *value,
                                 GParamSpec *pspec)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  switch (prop_id)
    {
    case PROP_PORT:
      g_value_set_int (value, server->port);
      break;

    case PROP_CERTIFICATE:
      g_value_set_object (value, server->certificate);
      break;

    case PROP_DOCUMENT_ROOTS:
      g_value_set_boxed (value, server->document_roots);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static gchar **
filter_document_roots (const gchar **input)
{
  GPtrArray *roots;
  char *path;
  gint i;

  roots = g_ptr_array_new ();
  for (i = 0; input && input[i]; i++)
    {
      path = realpath (input[i], NULL);
      if (path == NULL)
        g_warning ("couldn't resolve document root: %s: %m", input[i]);
      else
        g_ptr_array_add (roots, path);
    }
  g_ptr_array_add (roots, NULL);
  return (gchar **)g_ptr_array_free (roots, FALSE);
}

static void
cockpit_web_server_set_property (GObject *object,
                                 guint prop_id,
                                 const GValue *value,
                                 GParamSpec *pspec)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  switch (prop_id)
    {
    case PROP_PORT:
      server->port = g_value_get_int (value);
      break;

    case PROP_CERTIFICATE:
      server->certificate = g_value_dup_object (value);
      break;

    case PROP_DOCUMENT_ROOTS:
      server->document_roots = filter_document_roots (g_value_get_boxed (value));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

typedef struct {
  gpointer data;
  gsize length;
} InputData;

static void
input_data_clear_and_free (gpointer data)
{
  InputData *id = data;
  cockpit_secclear (id->data, id->length);
  g_free (id->data);
  g_free (id);
}

static gboolean
cockpit_web_server_default_handle_stream (CockpitWebServer *self,
                                          CockpitWebServerRequestType reqtype,
                                          const gchar *path,
                                          GIOStream *io_stream,
                                          GHashTable *headers,
                                          GByteArray *input,
                                          guint in_length)
{
  CockpitWebResponse *response;
  gboolean claimed = FALSE;
  InputData *id = NULL;
  GQuark detail;
  GBytes *bytes;

  /*
   * A bit more complicated, so that we can guarantee clearing the
   * input data. It might contain passwords.
   */

  if (in_length == 0)
    {
      bytes = g_bytes_new_static ("", 0);
    }
  else
    {
      id = g_new0 (InputData, 1);
      id->length = in_length;

      if (in_length == input->len)
        {
          /* preserve the byte array wrapper */
          g_byte_array_ref (input);
          id->data = g_byte_array_free (input, FALSE);
        }
      else
        {
          id->data = g_memdup (input->data, in_length);
          cockpit_secclear (input->data, in_length);
          g_byte_array_remove_range (input, 0, in_length);
        }

      bytes = g_bytes_new_with_free_func (id->data, id->length,
                                          input_data_clear_and_free, id);
    }

  /* TODO: Correct HTTP version for response */
  response = cockpit_web_response_new (io_stream, path);

  detail = g_quark_try_string (path);

  /* See if we have any takers... */
  g_signal_emit (self,
                 sig_handle_resource, detail,
                 reqtype,  /* args */
                 path,
                 headers,
                 bytes,
                 response,
                 &claimed);

  g_bytes_unref (bytes);

  /* TODO: Here is where we would plug keep-alive into respnse */
  g_object_unref (response);

  return claimed;
}

static gboolean
cockpit_web_server_default_handle_resource (CockpitWebServer *self,
                                            CockpitWebServerRequestType reqtype,
                                            const gchar *path,
                                            GHashTable *headers,
                                            GBytes *input,
                                            CockpitWebResponse *response)
{
  if (reqtype == COCKPIT_WEB_SERVER_REQUEST_POST)
    cockpit_web_response_error (response, 405, NULL, "POST not available for this path");
  else
    cockpit_web_response_file (response, path, (const gchar **)self->document_roots);
  return TRUE;
}

static void
cockpit_web_server_class_init (CockpitWebServerClass *klass)
{
  GObjectClass *gobject_class;

  klass->handle_stream = cockpit_web_server_default_handle_stream;
  klass->handle_resource = cockpit_web_server_default_handle_resource;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->constructed = cockpit_web_server_constructed;
  gobject_class->dispose = cockpit_web_server_dispose;
  gobject_class->finalize = cockpit_web_server_finalize;
  gobject_class->set_property = cockpit_web_server_set_property;
  gobject_class->get_property = cockpit_web_server_get_property;

  g_object_class_install_property (gobject_class,
                                   PROP_PORT,
                                   g_param_spec_int ("port", NULL, NULL,
                                                     0, 65535, 8080,
                                                     G_PARAM_READABLE |
                                                     G_PARAM_WRITABLE |
                                                     G_PARAM_CONSTRUCT_ONLY |
                                                     G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_CERTIFICATE,
                                   g_param_spec_object ("certificate", NULL, NULL,
                                                        G_TYPE_TLS_CERTIFICATE,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_DOCUMENT_ROOTS,
                                   g_param_spec_boxed ("document-roots", NULL, NULL,
                                                        G_TYPE_STRV,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  sig_handle_stream = g_signal_new ("handle-stream",
                                    G_OBJECT_CLASS_TYPE (klass),
                                    G_SIGNAL_RUN_LAST,
                                    G_STRUCT_OFFSET (CockpitWebServerClass, handle_stream),
                                    g_signal_accumulator_true_handled,
                                    NULL, /* accu_data */
                                    g_cclosure_marshal_generic,
                                    G_TYPE_BOOLEAN,
                                    6,
                                    G_TYPE_INT,
                                    G_TYPE_STRING,
                                    G_TYPE_IO_STREAM,
                                    G_TYPE_HASH_TABLE,
                                    G_TYPE_BYTE_ARRAY,
                                    G_TYPE_UINT);

  sig_handle_resource = g_signal_new ("handle-resource",
                                      G_OBJECT_CLASS_TYPE (klass),
                                      G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                      G_STRUCT_OFFSET (CockpitWebServerClass, handle_resource),
                                      g_signal_accumulator_true_handled,
                                      NULL, /* accu_data */
                                      g_cclosure_marshal_generic,
                                      G_TYPE_BOOLEAN,
                                      5,
                                      G_TYPE_INT,
                                      G_TYPE_STRING,
                                      G_TYPE_HASH_TABLE,
                                      G_TYPE_BYTES,
                                      COCKPIT_TYPE_WEB_RESPONSE);
}

CockpitWebServer *
cockpit_web_server_new (gint port,
                        GTlsCertificate *certificate,
                        const gchar **document_roots,
                        GCancellable *cancellable,
                        GError **error)
{
  GInitable *initable;
  initable = g_initable_new (COCKPIT_TYPE_WEB_SERVER,
                             cancellable,
                             error,
                             "port", port,
                             "certificate", certificate,
                             "document-roots", document_roots,
                             NULL);
  if (initable != NULL)
    return COCKPIT_WEB_SERVER (initable);
  else
    return NULL;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
validate_token (const gchar *token,
                GError **error)
{
  const guchar *p;
  for (p = (guchar*)token; *p; p++)
    {
      guchar c = *p;

      /* http://tools.ietf.org/html/rfc2616#section-2.2 */
      switch (c)
        {
        case '(':
        case ')':
        case '<':
        case '>':
        case '@':
        case ',':
        case ';':
        case ':':
        case '\'':
        case '"':
        case '/':
        case '[':
        case ']':
        case '?':
        case '=':
        case '{':
        case '}':
        case ' ':
        case '\t':
          {
            g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                         "Invalid token '%u' in cookie name", c);
            return FALSE;
          }
        default:
          {
            if (!(c >= 32 && c <= 127))
              {
                g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                             "Invalid token '%u' in cookie name", c);
                return FALSE;
              }
            else
              break;
          }
        }
    }
  return TRUE;
}

static gboolean
parse_cookie_pair (const gchar *header_value,
                   gchar **out_cookie_name,
                   gchar **out_cookie_value,
                   GError **error)
{
  gboolean ret = FALSE;
  const gchar *equals;
  const gchar *cookie_raw;
  gs_free gchar *ret_cookie_name = NULL;
  gs_free gchar *ret_cookie_value = NULL;

  equals = strchr (header_value, '=');
  if (!equals)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "Invalid cookie; missing '='");
      goto out;
    }
  ret_cookie_name = g_strndup (header_value, equals - header_value);

  if (!validate_token (ret_cookie_name, error))
    goto out;

  cookie_raw = equals + 1;
  ret_cookie_value = g_uri_unescape_segment (cookie_raw, NULL, NULL);

  ret = TRUE;
  *out_cookie_name = ret_cookie_name;
  ret_cookie_name = NULL;
  *out_cookie_value = ret_cookie_value;
  ret_cookie_value = NULL;
out:
  return ret;
}

GHashTable *
cockpit_web_server_new_table (void)
{
  return web_socket_util_new_headers ();
}

gboolean
cockpit_web_server_parse_cookies (GHashTable *headers,
                                  GHashTable **out_cookies,
                                  GError **error)
{
  gboolean ret = FALSE;
  GHashTableIter hash_iter;
  const gchar *key;
  const gchar *value;
  gs_unref_hashtable GHashTable *ret_cookies = NULL;

  ret_cookies = cockpit_web_server_new_table ();

  g_hash_table_iter_init (&hash_iter, headers);
  while (g_hash_table_iter_next (&hash_iter, (gpointer)&key, (gpointer)&value))
    {
      if (g_ascii_strcasecmp (key, "Cookie") == 0)
        {
          gs_strfreev gchar** elements = NULL;
          guint n;
          elements = g_strsplit (value, ";", 0);
          for (n = 0; elements[n] != NULL; n++)
            {
              gchar *cookie_name;
              gchar *cookie_value;
              g_strstrip(elements[n]);
              if (!parse_cookie_pair (elements[n], &cookie_name, &cookie_value, error))
		goto out;
              /* adopt strings */
              g_hash_table_replace (ret_cookies, cookie_name, cookie_value);
            }
        }
    }

  ret = TRUE;
  *out_cookies = ret_cookies;
  ret_cookies = NULL;
out:
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  int state;
  GIOStream *io;
  GByteArray *buffer;
  gint delayed_reply;
  CockpitWebServer *web_server;
  GSource *source;
  GSource *timeout;
} CockpitRequest;

static void
cockpit_request_free (gpointer data)
{
  CockpitRequest *request = data;
  if (request->timeout)
    {
      g_source_destroy (request->timeout);
      g_source_unref (request->timeout);
    }
  if (request->source)
    {
      g_source_destroy (request->source);
      g_source_unref (request->source);
    }

  /*
   * Request memory is either cleared or used elsewhere, by
   * handle-stream handlers (eg: the default handler. Don't
   * clear it here. The buffer may still be in use.
   */
  g_byte_array_unref (request->buffer);
  g_object_unref (request->io);
}

static void
cockpit_request_finish (CockpitRequest *request)
{
  g_hash_table_remove (request->web_server->requests, request);
}

static void
process_delayed_reply (CockpitRequest *request,
                       const gchar *path,
                       GHashTable *headers)
{
  CockpitWebResponse *response;
  const gchar *host;
  const gchar *body;
  GBytes *bytes;
  gsize length;
  gchar *url;

  g_assert (request->delayed_reply > 299);

  response = cockpit_web_response_new (request->io, NULL);

  if (request->delayed_reply == 301)
    {
      body = "<html><head><title>Moved</title></head>"
        "<body>Please use TLS</body></html>";
      host = g_hash_table_lookup (headers, "Host");
      url = g_strdup_printf ("https://%s%s",
                             host != NULL ? host : "", path);
      length = strlen (body);
      cockpit_web_response_headers (response, 301, "Moved Permanently", length,
                                    "Content-Type", "text/html",
                                    "Location", url,
                                    NULL);
      g_free (url);
      bytes = g_bytes_new_static (body, length);
      if (cockpit_web_response_queue (response, bytes))
        cockpit_web_response_complete (response);
      g_bytes_unref (bytes);
      return;
    }

  cockpit_web_response_error (response, request->delayed_reply, NULL, NULL);
  g_object_unref (response);
}

static void
process_request (CockpitRequest *request,
                 CockpitWebServerRequestType reqtype,
                 const gchar *path,
                 GHashTable *headers,
                 guint length)
{
  gboolean claimed = FALSE;

  if (request->delayed_reply)
    {
      process_delayed_reply (request, path, headers);
      return;
    }

  /* See if we have any takers... */
  g_signal_emit (request->web_server,
                 sig_handle_stream, 0,
                 reqtype,  /* args */
                 path,
                 request->io,
                 headers,
                 request->buffer,
                 length,
                 &claimed);

  if (!claimed)
    g_critical ("no handler responded to request: %s", path);
}

static gboolean
parse_and_process_request (CockpitRequest *request)
{
  CockpitWebServerRequestType reqtype = 0;
  gboolean again = FALSE;
  GHashTable *headers = NULL;
  gchar *method = NULL;
  gchar *path = NULL;
  const gchar *str;
  gchar *end = NULL;
  gssize off1;
  gssize off2;
  guint64 length;

  /* The hard input limit, we just terminate the connection */
  if (request->buffer->len > cockpit_ws_request_maximum * 2)
    {
      g_message ("received HTTP request that was too large");
      goto out;
    }

  off1 = web_socket_util_parse_req_line ((const gchar *)request->buffer->data,
                                         request->buffer->len,
                                         &method,
                                         &path);
  if (off1 == 0)
    {
      again = TRUE;
      goto out;
    }
  if (off1 < 0)
    {
      g_message ("received invalid HTTP request line");
      request->delayed_reply = 400;
      goto out;
    }

  off2 = web_socket_util_parse_headers ((const gchar *)request->buffer->data + off1,
                                        request->buffer->len - off1,
                                        &headers);
  if (off2 == 0)
    {
      again = TRUE;
      goto out;
    }
  if (off2 < 0)
    {
      g_message ("received invalid HTTP request headers");
      request->delayed_reply = 400;
      goto out;
    }

  /* If we get a Content-Length then we have to read that much data */
  length = 0;
  str = g_hash_table_lookup (headers, "Content-Length");
  if (str != NULL)
    {
      end = NULL;
      length = g_ascii_strtoull (str, &end, 10);
      if (!end || end[0])
        {
          g_message ("received invalid Content-Length");
          request->delayed_reply = 400;
          goto out;
        }

      /* The soft limit, we return 413 */
      if (length > cockpit_ws_request_maximum)
        {
          g_debug ("received too large Content-Length");
          request->delayed_reply = 413;
        }
    }

  /* Not enough data yet */
  if (request->buffer->len < off1 + off2 + length)
    {
      again = TRUE;
      goto out;
    }

  if (g_str_equal (method, "GET"))
    reqtype = COCKPIT_WEB_SERVER_REQUEST_GET;
  else if (g_str_equal (method, "POST"))
    reqtype = COCKPIT_WEB_SERVER_REQUEST_POST;
  else
    {
      g_message ("received unsupported HTTP method");
      request->delayed_reply = 405;
    }

  /*
   * TODO: the following are not implemented and required by HTTP/1.1
   *  * Transfer-Encoding: chunked (for requests)
   *
   * TODO: The following would help speed up cockpit:
   *  * keep-alives
   */

  g_byte_array_remove_range (request->buffer, 0, off1 + off2);
  process_request (request, reqtype, path, headers, length);

out:
  if (headers)
    g_hash_table_unref (headers);
  g_free (method);
  g_free (path);
  if (!again)
    cockpit_request_finish (request);
  return again;
}

static gboolean
should_suppress_request_error (GError *error)
{
  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_request_input (GObject *pollable_input,
                  gpointer user_data)
{
  GPollableInputStream *input = (GPollableInputStream *)pollable_input;
  CockpitRequest *request = user_data;
  GError *error = NULL;
  gsize length;
  gssize count;

  length = request->buffer->len;
  g_byte_array_set_size (request->buffer, length + 4096);

  count = g_pollable_input_stream_read_nonblocking (input, request->buffer->data + length,
                                                    4096, NULL, &error);
  if (count < 0)
    {
      g_byte_array_set_size (request->buffer, length);

      /* Just wait and try again */
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_error_free (error);
          return TRUE;
        }

      if (!should_suppress_request_error (error))
        g_warning ("couldn't read from connection: %s", error->message);

      cockpit_request_finish (request);
      g_error_free (error);
      return FALSE;
    }

  g_byte_array_set_size (request->buffer, length + count);

  if (count == 0)
    {
      g_debug ("caller closed connection early");
      cockpit_request_finish (request);
      return FALSE;
    }

  return parse_and_process_request (request);
}

static void
start_request_input (CockpitRequest *request)
{
  GPollableInputStream *poll_in;
  GInputStream *in;

  /* Both GSocketConnection and GTlsServerConnection are pollable */
  in = g_io_stream_get_input_stream (request->io);
  poll_in = NULL;
  if (G_IS_POLLABLE_INPUT_STREAM (in))
    poll_in = (GPollableInputStream *)in;

  if (!poll_in || !g_pollable_input_stream_can_poll (poll_in))
    {
      g_critical ("cannot use a non-pollable input stream: %s", G_OBJECT_TYPE_NAME (in));
      cockpit_request_finish (request);
      return;
    }

  /* Replace with a new source */
  if (request->source)
    {
      g_source_destroy (request->source);
      g_source_unref (request->source);
    }

  request->source = g_pollable_input_stream_create_source (poll_in, NULL);
  g_source_set_callback (request->source, (GSourceFunc)on_request_input, request, NULL);
  g_source_attach (request->source, request->web_server->main_context);
}

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition condition,
                 gpointer user_data)
{
  CockpitRequest *request = user_data;
  guchar first_byte;
  GInputVector vector[1] = { { &first_byte, 1 } };
  gint flags = G_SOCKET_MSG_PEEK;
  gboolean redirect_tls;
  gboolean is_tls;
  GSocketAddress *addr;
  GInetAddress *inet;
  GError *error = NULL;
  GIOStream *tls_stream;
  gssize num_read;

  num_read = g_socket_receive_message (socket,
                                       NULL, /* out GSocketAddress */
                                       vector,
                                       1,
                                       NULL, /* out GSocketControlMessage */
                                       NULL, /* out num_messages */
                                       &flags,
                                       NULL, /* GCancellable* */
                                       &error);
  if (num_read < 0)
    {
      /* Just wait and try again */
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_error_free (error);
          return TRUE;
        }

      if (!should_suppress_request_error (error))
        g_warning ("couldn't read from socket: %s", error->message);

      cockpit_request_finish (request);
      g_error_free (error);
      return FALSE;
    }

  is_tls = TRUE;
  redirect_tls = FALSE;

  /*
   * TLS streams are guaranteed to start with octet 22.. this way we can distinguish them
   * from regular HTTP requests
   */
  if (first_byte != 22 && first_byte != 0x80)
    {
      is_tls = FALSE;
      redirect_tls = TRUE;
      addr = g_socket_connection_get_remote_address (G_SOCKET_CONNECTION (request->io), NULL);
      if (G_IS_INET_SOCKET_ADDRESS (addr))
        {
          inet = g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (addr));
          redirect_tls = !g_inet_address_get_is_loopback (inet);
        }
      g_clear_object (&addr);
    }

  if (is_tls)
    {
      tls_stream = g_tls_server_connection_new (request->io,
                                                request->web_server->certificate,
                                                &error);
      if (tls_stream == NULL)
        {
          g_warning ("couldn't create new TLS stream: %s", error->message);
          cockpit_request_finish (request);
          g_error_free (error);
          return FALSE;
        }

      g_object_unref (request->io);
      request->io = G_IO_STREAM (tls_stream);
    }
  else if (redirect_tls)
    {
      request->delayed_reply = 301;
    }

  start_request_input (request);

  /* No longer run *this* source */
  return FALSE;
}

static gboolean
on_request_timeout (gpointer data)
{
  CockpitRequest *request = data;
  g_message ("request timed out, closing");
  cockpit_request_finish (request);
  return FALSE;
}

static gboolean
on_incoming (GSocketService *service,
             GSocketConnection *connection,
             GObject *source_object,
             gpointer user_data)
{
  CockpitWebServer *self = COCKPIT_WEB_SERVER (user_data);
  CockpitRequest *request;
  GSocket *socket;

  request = g_new0 (CockpitRequest, 1);
  request->web_server = self;
  request->io = g_object_ref (connection);
  request->buffer = g_byte_array_new ();

  request->timeout = g_timeout_source_new_seconds (cockpit_ws_request_timeout);
  g_source_set_callback (request->timeout, on_request_timeout, request, NULL);
  g_source_attach (request->timeout, self->main_context);

  socket = g_socket_connection_get_socket (connection);
  g_socket_set_blocking (socket, FALSE);

  /* Owns the request */
  g_hash_table_add (self->requests, request);

  if (self->certificate)
    {
      request->source = g_socket_create_source (g_socket_connection_get_socket (connection),
                                                G_IO_IN, NULL);
      g_source_set_callback (request->source, (GSourceFunc)on_socket_input, request, NULL);
      g_source_attach (request->source, self->main_context);
    }
  else
    {
      start_request_input (request);
    }

  /* handled */
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
cockpit_web_server_initable_init (GInitable *initable,
                                  GCancellable *cancellable,
                                  GError **error)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (initable);
  gboolean ret = FALSE;
  gboolean failed;
  int n, fd;

  server->socket_service = g_socket_service_new ();

  n = sd_listen_fds (0);
  if (n > 0)
    {
      /* We got file descriptors passed in, use those. */

      for (fd = SD_LISTEN_FDS_START; fd < SD_LISTEN_FDS_START + n; fd++)
        {
          gs_unref_object GSocket *s = NULL;
          gboolean b;

          s = g_socket_new_from_fd (fd, error);
          if (s == NULL)
            {
              g_prefix_error (error, "Failed to acquire passed socket %i: ", fd);
              goto out;
            }

          b = g_socket_listener_add_socket (G_SOCKET_LISTENER (server->socket_service),
                                            s,
                                            NULL,
                                            error);
          if (!b)
            {
              g_prefix_error (error, "Failed to add listener for socket %i: ", fd);
              goto out;
            }
        }
    }
  else
    {
      /* No fds passed in, let's listen on our own. */
      if (server->port == 0)
        {
          server->port = g_socket_listener_add_any_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                              NULL, error);
          failed = (server->port == 0);
        }
      else
        {
          failed = !g_socket_listener_add_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                     server->port, NULL, error);
        }
      if (failed)
        {
          g_prefix_error (error, "Failed to bind to port %d: ", server->port);
          goto out;
        }
    }

  g_signal_connect (server->socket_service,
                    "incoming",
                    G_CALLBACK (on_incoming),
                    server);

  ret = TRUE;

out:
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
initable_iface_init (GInitableIface *iface)
{
  iface->init = cockpit_web_server_initable_init;
}

/* ---------------------------------------------------------------------------------------------------- */
