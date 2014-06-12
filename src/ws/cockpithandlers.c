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
#include "cockpitwebservice.h"
#include "cockpitws.h"

#include "cockpit/cockpitjson.h"

#include "websocket/websocket.h"
#include <cockpit/cockpit.h>

#include <gsystem-local-alloc.h>

#include <json-glib/json-glib.h>

#include <gio/gio.h>
#include <glib/gi18n-lib.h>

#include <string.h>

const char *cockpit_ws_static_directory = PACKAGE_DATA_DIR "/static";

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */
gboolean
cockpit_handler_socket (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *path,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GByteArray *input,
                        guint in_length,
                        CockpitHandlerData *ws)
{
  CockpitWebService *service;

  if (!g_str_equal (path, "/socket"))
    return FALSE;

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service)
    {
      cockpit_web_service_socket (service, io_stream, headers, input);
      g_object_unref (service);
    }
  else
    {
      cockpit_web_service_noauth (io_stream, headers, input);
    }

  return TRUE;
}

static gchar *
get_remote_address (GIOStream *io)
{
  GSocketAddress *remote = NULL;
  GSocketConnection *connection = NULL;
  GIOStream *base;
  gchar *result = NULL;

  if (G_IS_TLS_CONNECTION (io))
    {
      g_object_get (io, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        connection = g_object_ref (base);
      g_object_unref (base);
    }
  else if (G_IS_SOCKET_CONNECTION (io))
    {
      connection = g_object_ref (io);
    }

  if (connection)
    remote = g_socket_connection_get_remote_address (connection, NULL);
  if (remote && G_IS_INET_SOCKET_ADDRESS (remote))
    result = g_inet_address_to_string (g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (remote)));

  if (remote)
    g_object_unref (remote);
  if (connection)
    g_object_unref (connection);

  return result;
}

static void
send_login_response (CockpitWebResponse *response,
                     CockpitWebService *service,
                     GHashTable *out_headers)
{
  JsonBuilder *builder = json_builder_new ();
  CockpitCreds *creds;
  gchar *response_body;
  GBytes *content;
  const gchar *user;
  gsize length;
  JsonNode *root;

  creds = cockpit_web_service_get_creds (service);

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "user");
  user = cockpit_creds_get_user (creds);
  json_builder_add_string_value (builder, user);
  struct passwd *pwd = cockpit_getpwnam_a (user, NULL);
  if (pwd)
    {
      json_builder_set_member_name (builder, "name");
      json_builder_add_string_value (builder, pwd->pw_gecos);
      free (pwd);
    }
  json_builder_end_object (builder);

  root = json_builder_get_root (builder);
  response_body = cockpit_json_write (root, &length);
  json_node_free (root);

  content = g_bytes_new_take (response_body, length);
  cockpit_web_response_content (response, out_headers, content, NULL);
  g_bytes_unref (content);
}

static void
on_login_complete (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  CockpitWebResponse *response = COCKPIT_WEB_RESPONSE (user_data);
  GError *error = NULL;
  GHashTable *out_headers = NULL;
  CockpitWebService *service;
  GIOStream *io_stream;

  out_headers = cockpit_web_server_new_table ();

  io_stream = cockpit_web_response_get_stream (response);
  service = cockpit_auth_login_finish (COCKPIT_AUTH (object), result,
                                       !G_IS_SOCKET_CONNECTION (io_stream),
                                       out_headers, &error);

  if (error)
    {
      cockpit_web_response_gerror (response, out_headers, error);
      g_error_free (error);
    }
  else
    {
      send_login_response (response, service, out_headers);
      g_object_unref (service);
    }

  g_hash_table_unref (out_headers);

  g_object_unref (response);
}

gboolean
cockpit_handler_login (CockpitWebServer *server,
                       CockpitWebServerRequestType reqtype,
                       const gchar *path,
                       GHashTable *headers,
                       GBytes *input,
                       CockpitWebResponse *response,
                       CockpitHandlerData *ws)
{
  CockpitWebService *service;
  gchar *remote_peer = NULL;
  GIOStream *io_stream;

  if (reqtype == COCKPIT_WEB_SERVER_REQUEST_GET)
    {
      service = cockpit_auth_check_cookie (ws->auth, headers);
      if (service == NULL)
        {
          cockpit_web_response_error (response, 401, NULL, NULL);
        }
      else
        {
          send_login_response (response, service, NULL);
          g_object_unref (service);
        }
    }
  else if (reqtype == COCKPIT_WEB_SERVER_REQUEST_POST)
    {
      io_stream = cockpit_web_response_get_stream (response);
      remote_peer = get_remote_address (io_stream);
      cockpit_auth_login_async (ws->auth, headers, input, remote_peer,
                                on_login_complete, g_object_ref (response));
      g_free (remote_peer);
      /* no response yet */
    }

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_handler_logout (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *path,
                        GHashTable *headers,
                        GBytes *input,
                        CockpitWebResponse *response,
                        CockpitHandlerData *ws)
{
  GIOStream *io_stream;
  GHashTable *out_headers;
  const gchar *body;
  gboolean secure;
  GBytes *content;

  io_stream = cockpit_web_response_get_stream (response);
  secure = !G_IS_SOCKET_CONNECTION (io_stream);

  out_headers = cockpit_web_server_new_table ();
  cockpit_auth_logout (ws->auth, headers, secure, out_headers);

  body ="<html><head><title>Logged out</title></head>"
    "<body>Logged out</body></html>";

  content = g_bytes_new_static (body, strlen (body));
  cockpit_web_response_content (response, out_headers, content, NULL);
  g_bytes_unref (content);
  g_hash_table_unref (out_headers);

  return TRUE;
}

gboolean
cockpit_handler_deauthorize (CockpitWebServer *server,
                             CockpitWebServerRequestType reqtype,
                             const gchar *path,
                             GHashTable *headers,
                             GBytes *input,
                             CockpitWebResponse *response,
                             CockpitHandlerData *ws)
{
  CockpitWebService *service;
  CockpitCreds *creds;
  const gchar *body;
  GBytes *bytes;

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (!service)
    {
      cockpit_web_response_error (response, 401, NULL, "Unauthorized");
      return TRUE;
    }

  /* Poison the creds, so they no longer work for new reauthorization */
  creds = cockpit_web_service_get_creds (service);
  cockpit_creds_poison (creds);
  g_object_unref (service);

  body ="<html><head><title>Deauthorized</title></head>"
    "<body>Deauthorized</body></html>";

  bytes = g_bytes_new_static (body, strlen (body));
  cockpit_web_response_content (response, NULL, bytes, NULL);
  g_bytes_unref (bytes);
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
                            const gchar *path,
                            GHashTable *headers,
                            GBytes *input,
                            CockpitWebResponse *response,
                            CockpitHandlerData *data)
{
  gchar *hostname;
  GHashTable *out_headers;
  GBytes *content;
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

  str = g_string_new (NULL);

  hostname = g_malloc0 (HOST_NAME_MAX + 1);
  gethostname (hostname, HOST_NAME_MAX);
  hostname[HOST_NAME_MAX] = '\0';

  g_string_append_printf (str, "cockpitdyn_hostname = \"%s\";\n", hostname);
  g_string_append (str, "cockpitdyn_pretty_hostname = \"\";\n");
  g_free (hostname);

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
  content = g_string_free_to_bytes (str);
  cockpit_web_response_content (response, out_headers, content, NULL);
  g_hash_table_unref (out_headers);
  g_bytes_unref (content);
  return TRUE;
}

gboolean
cockpit_handler_static (CockpitWebServer *server,
                        CockpitWebServerRequestType reqtype,
                        const gchar *path,
                        GHashTable *headers,
                        GBytes *input,
                        CockpitWebResponse *response,
                        CockpitHandlerData *ws)
{
  const gchar *roots[] = { cockpit_ws_static_directory, NULL };

  if (reqtype != COCKPIT_WEB_SERVER_REQUEST_GET)
    return FALSE;

  if (!g_str_has_prefix (path, "/static/"))
    return FALSE;

  cockpit_web_response_file (response, path + 8, TRUE, roots);
  return TRUE;
}
