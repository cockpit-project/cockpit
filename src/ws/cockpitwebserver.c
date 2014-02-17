/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "websocket/websocket.h"

#include "gsystem-local-alloc.h"

typedef struct _CockpitWebServerClass CockpitWebServerClass;

struct _CockpitWebServer {
  GObject parent_instance;

  gint port;
  GTlsCertificate *certificate;
  gchar *document_root;

  GSocketService *socket_service;
};

struct _CockpitWebServerClass {
  GObjectClass parent_class;

  gboolean (* handle_resource) (CockpitWebServer *server,
                                CockpitWebServerRequestType reqtype,
                                const gchar *escaped_resource,
                                GIOStream *io_stream,
                                GHashTable *headers,
                                GDataInputStream *in,
                                GDataOutputStream *out);
};

enum
{
  PROP_0,
  PROP_PORT,
  PROP_CERTIFICATE,
  PROP_DOCUMENT_ROOT
};

enum
{
  HANDLE_RESOURCE_SIGNAL,
  LAST_SIGNAL
};

static void initable_iface_init (GInitableIface *iface);


static guint signals[LAST_SIGNAL] = { 0 };

G_DEFINE_TYPE_WITH_CODE (CockpitWebServer, cockpit_web_server, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, initable_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
cockpit_web_server_init (CockpitWebServer *server)
{
}

static void
cockpit_web_server_finalize (GObject *object)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  g_clear_object (&server->certificate);
  g_free (server->document_root);

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

    case PROP_DOCUMENT_ROOT:
      g_value_set_string (value, server->document_root);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
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

    case PROP_DOCUMENT_ROOT:
      server->document_root = g_value_dup_string (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_web_server_class_init (CockpitWebServerClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
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
                                   PROP_DOCUMENT_ROOT,
                                   g_param_spec_string ("document-root", NULL, NULL,
                                                        ".",
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  signals[HANDLE_RESOURCE_SIGNAL] = g_signal_new ("handle-resource",
                                                  G_OBJECT_CLASS_TYPE (klass),
                                                  G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                                  G_STRUCT_OFFSET (CockpitWebServerClass, handle_resource),
                                                  g_signal_accumulator_true_handled,
                                                  NULL, /* accu_data */
                                                  g_cclosure_marshal_generic,
                                                  G_TYPE_BOOLEAN,
                                                  6,
                                                  COCKPIT_TYPE_WEB_SERVER_REQUEST_TYPE,
                                                  G_TYPE_STRING,
                                                  G_TYPE_IO_STREAM,
                                                  G_TYPE_HASH_TABLE,
                                                  G_TYPE_DATA_INPUT_STREAM,
                                                  G_TYPE_DATA_OUTPUT_STREAM);
}

CockpitWebServer *
cockpit_web_server_new (gint port,
                        GTlsCertificate *certificate,
                        const gchar *document_root,
                        GCancellable *cancellable,
                        GError **error)
{
  GInitable *initable;
  initable = g_initable_new (COCKPIT_TYPE_WEB_SERVER,
                             cancellable,
                             error,
                             "port", port,
                             "certificate", certificate,
                             "document-root", document_root,
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

void
cockpit_web_server_return_content (GOutputStream *out,
                                   GHashTable *headers,
                                   gpointer content,
                                   gsize length)
{
  GHashTableIter iter;
  GError *error = NULL;
  gpointer value;
  gpointer key;
  GString *resp;

  resp = g_string_new (NULL);

  g_string_printf (resp, "HTTP/1.1 200 OK\r\n"
                         "Content-Length: %" G_GSIZE_FORMAT "\r\n"
                         "Connection: close\r\n", length);

  if (headers)
    {
      g_hash_table_iter_init (&iter, headers);
      while (g_hash_table_iter_next (&iter, &key, &value))
        g_string_append_printf (resp, "%s: %s\r\n", (gchar *)key, (gchar *)value);
    }

  g_string_append (resp, "\r\n");

  if (!g_output_stream_write_all (out, resp->str, resp->len, NULL, NULL, &error) ||
      !g_output_stream_write_all (out, content, length, NULL, NULL, &error))
    goto out;

out:
  g_string_free (resp, TRUE);
  if (error)
    {
      g_warning ("Failed to write response: %s", error->message);
      g_error_free (error);
    }
}

void
cockpit_web_server_return_error (GOutputStream *out,
                                 guint code,
                                 const gchar *format,
                                 ...)
{
  GError *local_error = NULL;
  GError **error = &local_error;
  gs_free gchar *body = NULL;
  gs_free gchar *s = NULL;
  va_list var_args;
  gs_free gchar *reason = NULL;

  va_start (var_args, format);
  reason = g_strdup_vprintf (format, var_args);
  va_end (var_args);

  g_message ("Returning error-response %d with reason `%s'", code, reason);

  body = g_strdup_printf ("<html><head><title>%d %s</title></head>"
                          "<body>%s</body></html>",
                          code, reason,
                          reason);

  s = g_strdup_printf ("HTTP/1.1 %d %s\r\n"
                       "Content-Length: %" G_GUINT64_FORMAT "\r\n"
                       "Connection: close\r\n"
                       "\r\n"
                       "%s",
                       code, reason,
                       strlen (body),
                       body);
  if (!g_output_stream_write_all (out, s, strlen (s), NULL, NULL, error))
    goto out;

out:
  if (local_error)
    {
      g_warning ("Failed to write error: %s", local_error->message);
      g_error_free (local_error);
    }
}

void
cockpit_web_server_return_gerror (GOutputStream *out,
                                  GError *error)
{
  int code;

  if (g_error_matches (error,
                       COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED))
	  code = 403;
  else if (g_error_matches (error,
                            G_IO_ERROR, G_IO_ERROR_INVALID_DATA))
    code = 400;
  else if (g_error_matches (error,
                            G_IO_ERROR, G_IO_ERROR_NO_SPACE))
    code = 413;
  else
    code = 500;

  cockpit_web_server_return_error (out, code, "%s", error->message);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
serve_static_file (CockpitWebServer *server,
                   GDataInputStream *input,
                   GDataOutputStream *output,
                   const gchar *escaped,
                   GCancellable *cancellable)
{
  const gchar *content_type;
  GString *str = NULL;
  GError *local_error = NULL;
  GError **error = &local_error;
  gchar *query = NULL;
  gs_free gchar *unescaped = NULL;
  gs_free gchar *path = NULL;
  gs_free gchar *mime_type = NULL;
  gs_unref_object GFileInputStream *file_in = NULL;
  gs_unref_object GFile *f = NULL;
  gs_unref_object GFileInfo *info = NULL;

  query = strchr (escaped, '?');
  if (query != NULL)
    *query++ = 0;

again:
  unescaped = g_uri_unescape_string (escaped, NULL);
  path = g_build_filename (server->document_root, unescaped, NULL);
  f = g_file_new_for_path (path);

  file_in = g_file_read (f, NULL, error);
  if (file_in == NULL)
    {
      if (g_strcmp0 (escaped, "/") == 0 &&
          (g_error_matches (local_error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND)
           || g_error_matches (local_error, G_IO_ERROR, G_IO_ERROR_IS_DIRECTORY)))
        {
          escaped = "/index.html";
          g_clear_error (&local_error);
          goto again;
        }

      /* TODO: Don't leak our errors to untrusted client. And not every error is a 404 ... */
      cockpit_web_server_return_error (G_OUTPUT_STREAM (output), 404,
                                       "Error getting stream for file at path `%s': %s (%s, %d)", path,
                                       local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
      goto out;
    }

  str = g_string_new ("HTTP/1.1 200 OK\r\n");
  info = g_file_input_stream_query_info (file_in,
                                         G_FILE_ATTRIBUTE_STANDARD_SIZE ","
                                         G_FILE_ATTRIBUTE_STANDARD_CONTENT_TYPE,
                                         cancellable, error);
  if (info == NULL)
    {
      /* TODO: Don't leak our error codes and messages to untrusted client */
      cockpit_web_server_return_error (G_OUTPUT_STREAM (output), 500, "Error querying file at path %s: %s (%s, %d)", path,
                                       local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
      goto out;
    }

  g_string_append (str, "Connection: close\r\n");

  if (g_file_info_has_attribute (info, G_FILE_ATTRIBUTE_STANDARD_SIZE))
    {
      g_string_append_printf (str,
                              "Content-Length: %" G_GINT64_FORMAT "\r\n",
                              g_file_info_get_size (info));
    }
  content_type = g_file_info_get_content_type (info);
  if (content_type != NULL)
    {
      mime_type = g_content_type_get_mime_type (content_type);
      if (mime_type != NULL)
        {
          g_string_append_printf (str,
                                  "Content-Type: %s\r\n",
                                  mime_type);
        }
    }

  g_string_append (str, "\r\n");

  if (!g_output_stream_write_all (G_OUTPUT_STREAM (output),
                                  str->str,
                                  str->len,
                                  NULL,
                                  cancellable,
                                  error))
    {
      g_prefix_error (error, "Error writing %d bytes to output stream: ", (gint) str->len);
      goto out;
    }

  if (!g_output_stream_splice (G_OUTPUT_STREAM (output),
                               G_INPUT_STREAM (file_in),
                               0,
                               cancellable,
                               error))
    {
      g_prefix_error (error, "Error splicing to output stream: ");
      goto out;
    }

  if (!g_input_stream_close (G_INPUT_STREAM (file_in), cancellable, error))
    {
      g_prefix_error (error, "Error closing input stream: ");
      goto out;
    }

out:
  if (local_error != NULL)
    {
      g_warning ("Error serving static file: %s (%s, %d)",
                 local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
    }
  if (str)
    g_string_free (str, TRUE);
}

static void
process_request (CockpitWebServer *server,
                 GIOStream *io_stream,
                 GDataInputStream *input,
                 GDataOutputStream *output,
                 gboolean using_tls,
                 GCancellable *cancellable)
{
  gboolean claimed = FALSE;
  GError *local_error = NULL;
  GError **error = &local_error;
  const gchar *escaped;
  gchar *line = NULL;
  gsize line_len;
  gchar *tmp = NULL;
  gs_unref_hashtable GHashTable *headers = NULL;
  gs_free gchar *header_line = NULL;
  CockpitWebServerRequestType reqtype;
  gs_free gchar *buf = NULL;

  headers = web_socket_util_new_headers ();

  /* First read the request line */
  line = g_data_input_stream_read_line (input, &line_len, cancellable, error);
  if (line == NULL)
    {
      if (error != NULL)
        {
          g_prefix_error (error, "Error reading request line: ");
        }
      else
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                       "Error reading request line (no data)");
        }
      goto out;
    }

  /* Then each header */
  do
    {
      gchar *key;
      gchar *value;

      g_free (header_line);
      header_line = g_data_input_stream_read_line (input, NULL, cancellable, error);
      if (header_line == NULL)
        {
          g_prefix_error (error,
                          "Error reading header line %d: ",
                          g_hash_table_size (headers));
          goto out;
        }

      if (strlen (header_line) == 0)
        break;

      tmp = strstr (header_line, ": ");
      if (tmp == NULL)
        {
          g_prefix_error (error,
                          "Header line %d with content `%s' is malformed: ",
                          g_hash_table_size (headers),
                          header_line);
          goto out;
        }
      key = g_strndup (header_line, tmp - header_line);
      value = g_strdup (tmp + 2);
      g_strstrip (key);
      /* transfer ownership of key and value */
      g_hash_table_insert (headers, key, value);
    }
  while (TRUE);

  if (g_str_has_prefix (line, "GET "))
    {
      reqtype = COCKPIT_WEB_SERVER_REQUEST_GET;
      escaped = line + 4; /* Skip "GET " */
    }
  else if (g_str_has_prefix (line, "POST "))
    {
      reqtype = COCKPIT_WEB_SERVER_REQUEST_POST;
      escaped = line + 5;
    }
  else
    {
      cockpit_web_server_return_error (G_OUTPUT_STREAM (output), 501, "Only GET and POST is implemented");
      goto out;
    }

  /* TODO: This is a bug, which causes all redirects to go to '/' */
  tmp = strchr (escaped, ' ');
  if (tmp != NULL)
    {
      *tmp = 0;
      /* version = tmp + 1; */
    }

  /* Redirect plain HTTP if configured to use HTTPS */
  if (server->certificate != NULL && !using_tls)
    {
      const gchar *body =
        "<html><head><title>Moved</title></head>"
        "<body>Please use TLS</body></html>";
      const gchar *host;
      host = g_hash_table_lookup (headers, "Host");
      g_free (buf);
      buf = g_strdup_printf ("HTTP/1.1 301 Moved Permanently\r\n"
                             "Location: https://%s/%s\r\n"
                             "Content-Length: %d\r\n"
                             "Connection: close\r\n"
                             "\r\n"
                             "%s",
                             host != NULL ? host : "", tmp,
                             (gint) strlen (body), body);
      if (!g_output_stream_write_all (G_OUTPUT_STREAM (output), buf, strlen (buf), NULL, cancellable, error))
        {
          g_prefix_error (error, "Error writing 301 to redirect to https://%s/%s: ",
                          host != NULL ? host : "", tmp);
          goto out;
        }
      goto out;
    }
  else
    {
      /* See if we have any takers... */
      g_signal_emit (server,
                     signals[HANDLE_RESOURCE_SIGNAL],
                     /* TODO: This is a resource leak */
                     g_quark_from_string (escaped), /* detail */
                     reqtype,  /* args */
                     escaped,
                     io_stream,
                     headers,
                     input,
                     output,
                     &claimed);
      if (claimed)
        {
          goto out;
        }
      else
        {
          /* Don't look for filesystem resources for POST */
          if (reqtype == COCKPIT_WEB_SERVER_REQUEST_POST)
            {
              cockpit_web_server_return_error (G_OUTPUT_STREAM (output), 404, "Not found (use GET)");
              goto out;
            }

          serve_static_file (server, input, output, escaped, cancellable);
        }
    }

out:
  if (local_error != NULL)
    {
      g_warning ("Error processing request: %s (%s, %d)",
                 local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
    }


  local_error = NULL;
  if (!g_io_stream_is_closed (io_stream) && !g_output_stream_is_closed (G_OUTPUT_STREAM (output)) &&
      !g_output_stream_flush (G_OUTPUT_STREAM (output), NULL, &local_error))
    {
      g_warning ("Error flusing output stream: %s (%s, %d)",
                 local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
    }
}

static gboolean
on_run (GThreadedSocketService *service,
        GSocketConnection *connection,
        GSocketListener *listener,
        gpointer user_data)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (user_data);
  GError *local_error = NULL;
  GError **error = &local_error;
  gs_unref_object GIOStream *io_stream = NULL;
  GIOStream *tls_stream = NULL;
  GOutputStream *out = NULL;
  GInputStream *in = NULL;
  gs_unref_object GDataInputStream *data = NULL;
  gs_unref_object GDataOutputStream *out_data = NULL;
  GCancellable *cancellable = NULL;

  if (server->certificate != NULL)
    {
      guchar first_byte;
      GInputVector vector[1] = {{&first_byte, 1}};
      gint flags = G_SOCKET_MSG_PEEK;
      gssize num_read;

      num_read = g_socket_receive_message (g_socket_connection_get_socket (connection),
                                           NULL, /* out GSocketAddress */
                                           vector,
                                           1,
                                           NULL, /* out GSocketControlMessage */
                                           NULL, /* out num_messages */
                                           &flags,
                                           NULL, /* GCancellable* */
                                           error);
      if (num_read == -1)
        goto out;

      /* TLS streams are guaranteed to start with octet 22.. this way we can distinguish them
       * from regular HTTP requests
       */
      if (first_byte != 22 && first_byte != 0x80)
        goto not_tls;

      tls_stream = g_tls_server_connection_new (G_IO_STREAM (connection),
                                                server->certificate,
                                                error);
      if (tls_stream == NULL)
        goto out;

      io_stream = tls_stream;
      in = g_io_stream_get_input_stream (G_IO_STREAM (tls_stream));
      out = g_io_stream_get_output_stream (G_IO_STREAM (tls_stream));
    }
  else
    {
not_tls:
      io_stream = g_object_ref (connection);
      in = g_io_stream_get_input_stream (G_IO_STREAM (connection));
      out = g_io_stream_get_output_stream (G_IO_STREAM (connection));
    }

  data = g_data_input_stream_new (in);
  g_data_input_stream_set_byte_order (data, G_DATA_STREAM_BYTE_ORDER_BIG_ENDIAN);

  out_data = g_data_output_stream_new (out);
  g_data_output_stream_set_byte_order (out_data, G_DATA_STREAM_BYTE_ORDER_BIG_ENDIAN);

  /* Be tolerant of input */
  g_data_input_stream_set_newline_type (data, G_DATA_STREAM_NEWLINE_TYPE_ANY);

  /* Keep serving until requested to not to anymore */
  process_request (server, io_stream, data, out_data, tls_stream != NULL, cancellable);

  /* Forcibly close the connection when we're done */
  (void) g_io_stream_close (G_IO_STREAM (connection), cancellable, NULL);
  if (tls_stream != NULL)
    {
      (void) g_io_stream_close ((GIOStream*)tls_stream, cancellable, NULL);
    }

out:
  if (local_error)
    {
      g_warning ("Serving the stream resulted in error: %s (%s, %d)",
                 local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_clear_error (&local_error);
    }

  /* Prevent other GThreadedSocket::run handlers from being called (doesn't matter,
   * we're the only one)
   */

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

  server->socket_service = g_threaded_socket_service_new (G_MAXINT);

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
                    "run",
                    G_CALLBACK (on_run),
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
