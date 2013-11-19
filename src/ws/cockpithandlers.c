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

#include "cockpithandlers.h"
#include "cockpitws.h"

#include <cockpit/cockpit.h>

#include "libgsystem.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <string.h>

#define MAX_AUTH_CONTENT_LENGTH 4096

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */
gboolean
cockpit_handler_socket (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *resource,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GDataInputStream *in,
                        GDataOutputStream *out,
                        CockpitHandlerData *ws)
{
  const gchar *target_host;
  GByteArray *buffer;
  gconstpointer data;
  gsize length;

  if (!g_str_has_prefix (resource, "/socket/")
      || (g_ascii_strcasecmp (g_hash_table_lookup (headers, "Upgrade"), "websocket") != 0
          && g_ascii_strcasecmp (g_hash_table_lookup (headers, "Connection"), "Upgrade") != 0))
    return FALSE;

  /* Save the data which has already been read from input */
  buffer = g_byte_array_new ();
  data = g_buffered_input_stream_peek_buffer (G_BUFFERED_INPUT_STREAM (in), &length);
  g_byte_array_append (buffer, data, length);

  /* We're going to be dealing with the IO stream directly, so skip these */
  g_filter_input_stream_set_close_base_stream (G_FILTER_INPUT_STREAM (in), FALSE);
  g_filter_output_stream_set_close_base_stream (G_FILTER_OUTPUT_STREAM (out), FALSE);

  target_host = resource + strlen ("/socket/");
  cockpit_web_socket_serve_dbus (server, target_host, 0, PACKAGE_LIBEXEC_DIR "/cockpit-agent",
                                 io_stream, headers, buffer, ws->auth);

  g_byte_array_unref (buffer);
  return TRUE;
}

static gchar *
read_request_body (GHashTable *headers,
                   GDataInputStream *in,
                   GError **error)
{
  guint content_length_num;
  const gchar *content_length_text;
  gsize bytes_read;
  gchar *body = NULL;

  content_length_text = g_hash_table_lookup (headers, "Content-Length");
  if (!content_length_text)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Missing Content-Length");
      goto out;
    }
  content_length_num = (guint)g_ascii_strtoull (content_length_text, NULL, 10);

  if (content_length_num > MAX_AUTH_CONTENT_LENGTH)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_NO_SPACE,
                   "Too Large");
      goto out;
    }

  body = g_new0 (gchar, content_length_num + 1);
  if (!g_input_stream_read_all (G_INPUT_STREAM (in), body,
                                content_length_num,
                                &bytes_read, NULL, error))
    goto out;

  if (bytes_read != content_length_num)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Wrong Content-Length");
      goto out;
    }

  return body;

out:
  g_free (body);
  return NULL;
}

gboolean
cockpit_handler_login (CockpitWebServer *server,
                       CockpitWebServerRequestType reqtype,
                       const gchar *resource,
                       GIOStream *io_stream,
                       GHashTable *headers,
                       GDataInputStream *in,
                       GDataOutputStream *out,
                       CockpitHandlerData *ws)
{
  GError *error = NULL;

  GHashTable *out_headers = NULL;
  gs_free gchar *user = NULL;
  gs_free gchar *cookie_header = NULL;
  gs_free gchar *response_body = NULL;
  gs_free gchar *response = NULL;

  if (reqtype == COCKPIT_WEB_SERVER_REQUEST_GET)
    {
      // check cookie
      if (!cockpit_auth_check_headers (ws->auth, headers, &user, NULL))
        {
          g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                       "Sorry");
          goto out;
        }
    }
  else if (reqtype == COCKPIT_WEB_SERVER_REQUEST_POST)
    {
      // create cookie
      gs_free gchar *cookie = NULL;
      gs_free gchar *cookie_b64 = NULL;
      gs_free gchar *request_body = NULL;

      request_body = read_request_body (headers, in, &error);
      if (request_body == NULL)
        goto out;

      if (!cockpit_auth_check_userpass (ws->auth, request_body, &cookie,
                                     &user, NULL,
                                     &error))
        goto out;

      cookie_b64 = g_base64_encode ((guint8*)cookie, strlen (cookie));
      out_headers = cockpit_web_server_new_table ();
      g_hash_table_insert (out_headers, g_strdup ("Set-Cookie"),
                           g_strdup_printf ("CockpitAuth=%s; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly",
                                            cookie_b64,
                                            ws->certificate != NULL ? " Secure;" : ""));
    }

  {
    gs_unref_object JsonBuilder *builder = json_builder_new ();
    gs_unref_object JsonGenerator *generator = json_generator_new ();
    JsonNode *root;

    json_builder_begin_object (builder);
    json_builder_set_member_name (builder, "user");
    json_builder_add_string_value (builder, user);
    struct passwd *pwd = getpwnam (user);
    if (pwd)
      {
        json_builder_set_member_name (builder, "name");
        json_builder_add_string_value (builder, pwd->pw_gecos);
      }
    json_builder_end_object (builder);

    root = json_builder_get_root (builder);
    json_generator_set_root (generator, root);
    response_body = json_generator_to_data (generator, NULL);
    json_node_free (root);
  }


  cockpit_web_server_return_content (G_OUTPUT_STREAM (out),
                                     out_headers, response_body,
                                     strlen (response_body));

out:
  if (out_headers)
    g_hash_table_unref (out_headers);
  if (error)
    {
      cockpit_web_server_return_gerror (G_OUTPUT_STREAM (out), error);
      g_error_free (error);
    }

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_handler_logout (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *resource,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GDataInputStream *in,
                        GDataOutputStream *out,
                        CockpitHandlerData *ws)
{
  GError *error = NULL;
  gchar *buf;
  const gchar *body;

  body ="<html><head><title>Logged out</title></head>"
    "<body>Please log in again</body></html>";

  buf = g_strdup_printf ("HTTP/1.1 200 OK\r\n"
                         "Set-Cookie: CockpitAuth=blank; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly\r\n"
                         "Content-Length: %d\r\n"
                         "Connection: close\r\n"
                         "\r\n"
                         "%s",
                         ws->certificate != NULL ? " Secure;" : "",
                         (gint)strlen (body),
                         body);

  if (!g_output_stream_write_all (G_OUTPUT_STREAM (out), buf, strlen (buf), NULL, NULL, &error))
    {
      g_warning ("Error sending /logout response: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

out:
  g_free (buf);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_handler_static (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *resource,
                        GSocketConnection *connection,
                        GHashTable *headers,
                        GDataInputStream *in,
                        GDataOutputStream *out,
                        CockpitHandlerData *data)
{
  gboolean handled = FALSE;
  GVariant *result_byte_array = NULL;
  GVariant *result = NULL;
  GDBusProxy *proxy = NULL;
  GError *error;
  const guchar *content;
  gsize content_len;
  GString *str = NULL;
  gs_free gchar *user = NULL;

  handled = TRUE;

  cockpit_auth_check_headers (data->auth, headers, &user, NULL);

  proxy = (GDBusProxy *) g_dbus_object_manager_get_interface (data->object_manager,
                                                              "/com/redhat/Cockpit/Manager",
                                                              "com.redhat.Cockpit.Manager");
  if (proxy == NULL)
    {
      cockpit_web_server_return_error (G_OUTPUT_STREAM (out), 500, "No proxy for /com/redhat/Cockpit/Manager");
      goto out;
    }

  error = NULL;
  result = g_dbus_proxy_call_sync (proxy,
                                   "HTTPGet",
                                   g_variant_new ("(ss)", resource, user ? user : ""),
                                   G_DBUS_CALL_FLAGS_NONE,
                                   -1,   /* default timeout */
                                   NULL, /* GCancellable* */
                                   &error);
  if (result == NULL)
    {
      cockpit_web_server_return_error (G_OUTPUT_STREAM (out), 500,
                                       "Error getting resource %s via D-Bus: %s (%s, %d)", resource,
                                       error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  g_variant_get (result, "(@ay)", &result_byte_array);
  content = g_variant_get_fixed_array (result_byte_array,
                                       &content_len,
                                       sizeof (guchar));

  /* Prepare headers */
  str = g_string_new ("HTTP/1.1 200 OK\r\n");
  /* TODO: Content-Type ? */
  g_string_append_printf (str,
                          "Content-Length: %" G_GINT64_FORMAT "\r\n"
                          "Connection: close\r\n",
                          content_len);
  g_string_append (str, "\r\n");

  error = NULL;
  if (!g_output_stream_write_all (G_OUTPUT_STREAM (out),
                                  str->str,
                                  str->len,
                                  NULL,
                                  NULL, /* GCancellable */
                                  &error))
    {
      g_warning ("Error writing %d bytes to output stream for header for resource `%s': %s (%s, %d)",
                 (gint) str->len, resource,
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

  error = NULL;
  if (content != NULL
      && !g_output_stream_write_all (G_OUTPUT_STREAM (out),
                                     content,
                                     content_len,
                                     NULL,
                                     NULL, /* GCancellable* */
                                     &error))
    {
      g_warning ("Error writing %d bytes for static content for resource `%s': %s (%s, %d)",
                 (gint) content_len, resource,
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
      goto out;
    }

out:
  if (str != NULL)
    g_string_free (str, FALSE);
  if (result_byte_array != NULL)
    g_variant_unref (result_byte_array);
  if (result != NULL)
    g_variant_unref (result);
  return handled; /* handled */
}
