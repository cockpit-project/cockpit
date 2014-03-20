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

#include "websocket/websocket.h"
#include <cockpit/cockpit.h>

#include "gsystem-local-alloc.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>
#include <glib/gi18n-lib.h>

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
  GByteArray *buffer;
  gconstpointer data;
  const gchar *agent;
  gsize length;

  if (!g_str_equal (resource, "/socket")
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

  agent = ws->agent_program;
  if (!agent)
    agent = PACKAGE_LIBEXEC_DIR "/cockpit-agent";

  cockpit_web_socket_serve_dbus (server, 0, agent, io_stream, headers, buffer, ws->auth);

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
  gs_free gchar *response_body = NULL;
  gs_free gchar *response = NULL;
  CockpitCreds *creds = NULL;

  out_headers = cockpit_web_server_new_table ();

  if (reqtype == COCKPIT_WEB_SERVER_REQUEST_GET)
    {
      // check cookie
      creds = cockpit_auth_check_headers (ws->auth, headers, out_headers);
      if (creds == NULL)
        {
          g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                       "Sorry");
          goto out;
        }
    }
  else if (reqtype == COCKPIT_WEB_SERVER_REQUEST_POST)
    {
      gs_free gchar *request_body = NULL;

      request_body = read_request_body (headers, in, &error);
      if (request_body == NULL)
        goto out;

      creds = cockpit_auth_check_userpass (ws->auth, request_body,
                                           ws->certificate != NULL,
                                           out_headers, &error);
      if (creds == NULL)
        goto out;
    }

  {
    gs_unref_object JsonBuilder *builder = json_builder_new ();
    gs_unref_object JsonGenerator *generator = json_generator_new ();
    const gchar *user;
    JsonNode *root;

    json_builder_begin_object (builder);
    json_builder_set_member_name (builder, "user");
    user = cockpit_creds_get_user (creds);
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
  if (creds)
    cockpit_creds_unref (creds);
  if (error)
    {
      cockpit_web_server_return_gerror (G_OUTPUT_STREAM (out), out_headers, error);
      g_error_free (error);
    }
  if (out_headers)
    g_hash_table_unref (out_headers);

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

static gchar *
get_avatar_data_url (void)
{
  const gchar *file = PACKAGE_SYSCONF_DIR "/cockpit/avatar.png";

  gs_free gchar *raw_data = NULL;
  gsize raw_size;
  gs_free gchar *base64_data = NULL;

  if (!g_file_get_contents (file, &raw_data, &raw_size, NULL))
    return NULL;

  base64_data = g_base64_encode ((guchar *)raw_data, raw_size);
  return g_strdup_printf ("data:image/png;base64,%s", base64_data);
}

gboolean
cockpit_handler_cockpitdyn (CockpitWebServer *server,
                            CockpitWebServerRequestType reqtype,
                            const gchar *resource,
                            GIOStream *connection,
                            GHashTable *headers,
                            GDataInputStream *in,
                            GDataOutputStream *out,
                            CockpitHandlerData *data)
{
  GError *error = NULL;
  GHashTable *out_headers;
  GVariant *retval;
  GVariant *props;
  GString *str;
  gchar *s;
  guint n;

  const struct {
    const gchar *name;
    const gchar *code;
  } supported_languages[] = {
    { NC_("display-language", "English"), "" },
    { NC_("display-language", "Danish"),  "da" },
    { NC_("display-language", "German"),  "de" },
  };

  /*
   * This is cockpit-ws only use of DBus when in the unauthenticated
   * state. We don't use a proxy or otherwise require the hostname1
   * to remain running.
   *
   * Unfortunately no convenience function is provided by GDBus for
   * this call.
   */
  retval = g_dbus_connection_call_sync (data->system_bus,
                                        "org.freedesktop.hostname1",
                                        "/org/freedesktop/hostname1",
                                        "org.freedesktop.DBus.Properties",
                                        "GetAll",
                                        g_variant_new ("(s)", "org.freedesktop.hostname1"),
                                        G_VARIANT_TYPE ("(a{sv})"),
                                        G_DBUS_CALL_FLAGS_NONE,
                                        -1,
                                        NULL,
                                        &error);

  str = g_string_new (NULL);

  if (error == NULL)
    {
      g_variant_get (retval, "(@a{sv})", &props);
      if (!g_variant_lookup (props, "StaticHostname", "&s", &s))
	s = "";
      g_string_append_printf (str, "cockpitdyn_hostname = \"%s\";\n", s);
      if (!g_variant_lookup (props, "PrettyHostname", "&s", &s))
	s = "";
      g_string_append_printf (str, "cockpitdyn_pretty_hostname = \"%s\";\n", s);
    }
  else
    {
      g_warning ("Couldn't get system host name: %s", error->message);
      g_clear_error (&error);
    }

  s = get_avatar_data_url ();
  s = g_strescape (s? s : "", NULL);
  g_string_append_printf (str, "cockpitdyn_avatar_data_url = \"%s\";\n", s);
  g_free (s);

  s = g_strescape (PACKAGE_VERSION, NULL);
  g_string_append_printf (str, "cockpitdyn_version = \"%s\";\n", s);
  g_free (s);

  s = g_strescape (COCKPIT_BUILD_INFO, NULL);
  g_string_append_printf (str, "cockpitdyn_build_info = \"%s\";\n", s);
  g_free (s);

  g_string_append (str, "cockpitdyn_supported_languages = {");
  for (n = 0; n < G_N_ELEMENTS(supported_languages); n++)
    {
      if (n > 0)
        g_string_append (str, ", ");
      g_string_append_printf (str, "\"%s\": {name: \"%s\"}",
                              supported_languages[n].code,
                              supported_languages[n].name);
    }
  g_string_append (str, "};\n");

  out_headers = web_socket_util_new_headers ();
  g_hash_table_insert (out_headers, g_strdup ("Content-Type"), g_strdup ("application/javascript"));
  cockpit_web_server_return_content (G_OUTPUT_STREAM (out), out_headers, str->str, str->len);
  g_hash_table_unref (out_headers);
  g_string_free (str, TRUE);
  return TRUE;
}
