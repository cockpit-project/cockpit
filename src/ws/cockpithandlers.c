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

#include "cockpitbranding.h"
#include "cockpitchannelresponse.h"
#include "cockpitchannelsocket.h"
#include "cockpitwebservice.h"
#include "cockpitws.h"

#include "common/cockpitconf.h"
#include "common/cockpitjson.h"
#include "common/cockpitwebinject.h"

#include "websocket/websocket.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>
#include <glib/gi18n.h>

#include <string.h>

/* For overriding during tests */
const gchar *cockpit_ws_shell_component = "/shell/index.html";

static void
on_web_socket_noauth (WebSocketConnection *connection,
                      gpointer data)
{
  GBytes *payload;
  GBytes *prefix;

  g_debug ("closing unauthenticated web socket");

  payload = cockpit_transport_build_control ("command", "init", "problem", "no-session", NULL);
  prefix = g_bytes_new_static ("\n", 1);

  web_socket_connection_send (connection, WEB_SOCKET_DATA_TEXT, prefix, payload);
  web_socket_connection_close (connection, WEB_SOCKET_CLOSE_GOING_AWAY, "no-session");

  g_bytes_unref (prefix);
  g_bytes_unref (payload);
}

static void
handle_noauth_socket (GIOStream *io_stream,
                      const gchar *path,
                      GHashTable *headers,
                      GByteArray *input_buffer)
{
  WebSocketConnection *connection;

  connection = cockpit_web_service_create_socket (NULL, path, io_stream, headers, input_buffer);

  g_signal_connect (connection, "open", G_CALLBACK (on_web_socket_noauth), NULL);

  /* Unreferences connection when it closes */
  g_signal_connect (connection, "close", G_CALLBACK (g_object_unref), NULL);
}

/* Called by @server when handling HTTP requests to /cockpit/socket */
gboolean
cockpit_handler_socket (CockpitWebServer *server,
                        const gchar *original_path,
                        const gchar *path,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GByteArray *input,
                        CockpitHandlerData *ws)
{
  CockpitWebService *service = NULL;
  const gchar *segment = NULL;

  /*
   * Socket requests should come in on /cockpit/socket or /cockpit+app/socket.
   * However older javascript may connect on /socket, so we continue to support that.
   */

  if (path && path[0])
    segment = strchr (path + 1, '/');
  if (!segment)
    segment = path;

  if (!segment || !g_str_equal (segment, "/socket"))
    return FALSE;

  if (headers)
    service = cockpit_auth_check_cookie (ws->auth, path, headers);
  if (service)
    {
      cockpit_web_service_socket (service, path, io_stream, headers, input);
      g_object_unref (service);
    }
  else
    {
      handle_noauth_socket (io_stream, path, headers, input);
    }

  return TRUE;
}

gboolean
cockpit_handler_external (CockpitWebServer *server,
                          const gchar *original_path,
                          const gchar *path,
                          GIOStream *io_stream,
                          GHashTable *headers,
                          GByteArray *input,
                          CockpitHandlerData *ws)
{
  CockpitWebResponse *response = NULL;
  CockpitWebService *service = NULL;
  const gchar *segment = NULL;
  JsonObject *open = NULL;
  const gchar *query = NULL;
  CockpitCreds *creds;
  const gchar *expected;
  const gchar *upgrade;
  guchar *decoded;
  GBytes *bytes;
  gsize length;
  gsize seglen;

  /* The path must start with /cockpit+xxx/channel/csrftoken? or similar */
  if (path && path[0])
    segment = strchr (path + 1, '/');
  if (!segment)
    return FALSE;
  if (!g_str_has_prefix (segment, "/channel/"))
    return FALSE;
  segment += 9;

  /* Make sure we are authenticated, otherwise 404 */
  service = cockpit_auth_check_cookie (ws->auth, path, headers);
  if (!service)
    return FALSE;

  creds = cockpit_web_service_get_creds (service);
  g_return_val_if_fail (creds != NULL, FALSE);

  expected = cockpit_creds_get_csrf_token (creds);
  g_return_val_if_fail (expected != NULL, FALSE);

  /* The end of the token */
  query = strchr (segment, '?');
  if (query)
    {
      seglen = query - segment;
      query += 1;
    }
  else
    {
      seglen = strlen (segment);
      query = "";
    }

  /* No such path is valid */
  if (strlen (expected) != seglen || memcmp (expected, segment, seglen) != 0)
    {
      g_message ("invalid csrf token");
      return FALSE;
    }

  decoded = g_base64_decode (query, &length);
  if (decoded)
    {
      bytes = g_bytes_new_take (decoded, length);
      if (!cockpit_transport_parse_command (bytes, NULL, NULL, &open))
        {
          open = NULL;
          g_message ("invalid external channel query");
        }
      g_bytes_unref (bytes);
    }

  if (!open)
    {
      response = cockpit_web_response_new (io_stream, original_path, path, NULL, headers);
      cockpit_web_response_error (response, 400, NULL, NULL);
      g_object_unref (response);
    }
  else
    {
      upgrade = g_hash_table_lookup (headers, "Upgrade");
      if (upgrade && g_ascii_strcasecmp (upgrade, "websocket") == 0)
        {
          cockpit_channel_socket_open (service, open, original_path, path, io_stream, headers, input);
        }
      else
        {
          response = cockpit_web_response_new (io_stream, original_path, path, NULL, headers);
          cockpit_channel_response_open (service, headers, response, open);
          g_object_unref (response);
        }
      json_object_unref (open);
    }

  g_object_unref (service);

  return TRUE;
}


static void
add_oauth_to_environment (JsonObject *environment)
{
  static const gchar *url;
  JsonObject *object;

  url = cockpit_conf_string ("OAuth", "URL");

  if (url)
    {
      object = json_object_new ();
      json_object_set_string_member (object, "URL", url);
      json_object_set_string_member (object, "ErrorParam",
                                     cockpit_conf_string ("oauth", "ErrorParam"));
      json_object_set_string_member (object, "TokenParam",
                                     cockpit_conf_string ("oauth", "TokenParam"));
      json_object_set_object_member (environment, "OAuth", object);
  }
}

static GBytes *
build_environment (GHashTable *os_release)
{
  /*
   * We don't include entirety of os-release into the
   * environment for the login.html page. There could
   * be unexpected things in here.
   *
   * However since we are displaying branding based on
   * the OS name variant flavor and version, including
   * the corresponding information is not a leak.
   */
  static const gchar *release_fields[] = {
    "NAME", "ID", "PRETTY_NAME", "VARIANT", "VARIANT_ID", "CPE_NAME",
  };

  static const gchar *prefix = "\n    <script>\nvar environment = ";
  static const gchar *suffix = ";\n    </script>";

  GByteArray *buffer;
  GBytes *bytes;
  JsonObject *object;
  const gchar *title;
  gchar *hostname;
  JsonObject *osr;
  const gchar *value;
  gint i;

  object = json_object_new ();

  title = cockpit_conf_string ("WebService", "LoginTitle");
  if (title)
    json_object_set_string_member (object, "title", title);

  hostname = g_malloc0 (HOST_NAME_MAX + 1);
  gethostname (hostname, HOST_NAME_MAX);
  hostname[HOST_NAME_MAX] = '\0';
  json_object_set_string_member (object, "hostname", hostname);
  g_free (hostname);

  if (os_release)
    {
      osr = json_object_new ();
      for (i = 0; i < G_N_ELEMENTS (release_fields); i++)
        {
          value = g_hash_table_lookup (os_release, release_fields[i]);
          if (value)
            json_object_set_string_member (osr, release_fields[i], value);
        }
      json_object_set_object_member (object, "os-release", osr);
    }

  add_oauth_to_environment (object);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  buffer = g_bytes_unref_to_array (bytes);
  g_byte_array_prepend (buffer, (const guint8 *)prefix, strlen (prefix));
  g_byte_array_append (buffer, (const guint8 *)suffix, strlen (suffix));
  return g_byte_array_free_to_bytes (buffer);
}

static void
send_login_html (CockpitWebResponse *response,
                 CockpitHandlerData *ws)
{
  static const gchar *marker = "<head>";

  CockpitWebFilter *filter;
  GBytes *environment;

  GBytes *url_bytes = NULL;
  CockpitWebFilter *filter2 = NULL;
  const gchar *url_root = NULL;
  gchar *base;

  environment = build_environment (ws->os_release);
  filter = cockpit_web_inject_new (marker, environment, 1);
  g_bytes_unref (environment);
  cockpit_web_response_add_filter (response, filter);

  url_root = cockpit_web_response_get_url_root (response);
  if (url_root)
    base = g_strdup_printf ("<base href=\"%s/\">", url_root);
  else
    base = g_strdup ("<base href=\"/\">");

  url_bytes = g_bytes_new_take (base, strlen(base));
  filter2 = cockpit_web_inject_new (marker, url_bytes, 1);
  g_bytes_unref (url_bytes);
  cockpit_web_response_add_filter (response, filter2);

  cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);
  cockpit_web_response_file (response, "/login.html", ws->static_roots);
  g_object_unref (filter);
  if (filter2)
    g_object_unref (filter2);
}

static void
send_login_response (CockpitWebResponse *response,
                     JsonObject *object,
                     GHashTable *headers)
{
  GBytes *content;

  content = cockpit_json_write_bytes (object);

  g_hash_table_replace (headers, g_strdup ("Content-Type"), g_strdup ("application/json"));
  cockpit_web_response_content (response, headers, content, NULL);
  g_bytes_unref (content);
}

static void
on_login_complete (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  CockpitWebResponse *response = user_data;
  GError *error = NULL;
  JsonObject *response_data = NULL;
  GHashTable *headers;
  GIOStream *io_stream;
  GBytes *content;

  io_stream = cockpit_web_response_get_stream (response);

  headers = cockpit_web_server_new_table ();
  response_data = cockpit_auth_login_finish (COCKPIT_AUTH (object), result,
                                             io_stream, headers, &error);

  /* Never cache a login response */
  cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);
  if (error)
    {
      if (response_data)
        {
          g_hash_table_insert (headers, g_strdup ("Content-Type"), g_strdup ("application/json"));
          content = cockpit_json_write_bytes (response_data);
          cockpit_web_response_headers_full (response, 401, "Authentication required", -1, headers);
          cockpit_web_response_queue (response, content);
          cockpit_web_response_complete (response);
          g_bytes_unref (content);
        }
      else
        {
          cockpit_web_response_gerror (response, headers, error);
        }
      g_error_free (error);
    }
  else
    {
      send_login_response (response, response_data, headers);
    }

  if (response_data)
    json_object_unref (response_data);

  g_hash_table_unref (headers);
  g_object_unref (response);
}

static void
handle_login (CockpitHandlerData *data,
              CockpitWebService *service,
              const gchar *path,
              GHashTable *headers,
              CockpitWebResponse *response)
{
  GHashTable *out_headers;
  GIOStream *io_stream;
  CockpitCreds *creds;
  JsonObject *creds_json = NULL;

  if (service)
    {
      out_headers = cockpit_web_server_new_table ();
      creds = cockpit_web_service_get_creds (service);
      creds_json = cockpit_creds_to_json (creds);
      send_login_response (response, creds_json, out_headers);
      g_hash_table_unref (out_headers);
      json_object_unref (creds_json);
      return;
    }

  io_stream = cockpit_web_response_get_stream (response);
  cockpit_auth_login_async (data->auth, path,io_stream, headers,
                            on_login_complete, g_object_ref (response));
}

static void
handle_resource (CockpitHandlerData *data,
                 CockpitWebService *service,
                 const gchar *path,
                 GHashTable *headers,
                 CockpitWebResponse *response)
{
  gchar *where;

  where = cockpit_web_response_pop_path (response);
  if (where && (where[0] == '@' || where[0] == '$') && where[1] != '\0')
    {
      if (service)
        {
          cockpit_channel_response_serve (service, headers, response, where,
                                          cockpit_web_response_get_path (response));
        }
      else if (g_str_has_suffix (path, ".html"))
        {
          send_login_html (response, data);
        }
      else
        {
          cockpit_web_response_error (response, 401, NULL, NULL);
        }
    }
  else
    {
      cockpit_web_response_error (response, 404, NULL, NULL);
    }

  g_free (where);
}

static void
handle_shell (CockpitHandlerData *data,
              CockpitWebService *service,
              const gchar *path,
              GHashTable *headers,
              CockpitWebResponse *response)
{
  gboolean valid;
  const gchar *shell_path;

  /* Check if a valid path for a shell to be served at */
  valid = g_str_equal (path, "/") ||
          g_str_has_prefix (path, "/@") ||
          g_str_has_prefix (path, "/=") ||
          strspn (path + 1, COCKPIT_RESOURCE_PACKAGE_VALID) == strcspn (path + 1, "/");

  if (g_str_has_prefix (path, "/=/") ||
      g_str_has_prefix (path, "/@/") ||
      g_str_has_prefix (path, "//"))
    {
      valid = FALSE;
    }

  if (!valid)
    {
      cockpit_web_response_error (response, 404, NULL, NULL);
    }
  else if (service)
    {
      shell_path = cockpit_conf_string ("WebService", "Shell");
      cockpit_channel_response_serve (service, headers, response, NULL,
                                      shell_path ? shell_path : cockpit_ws_shell_component);
    }
  else
    {
      send_login_html (response, data);
    }
}

gboolean
cockpit_handler_default (CockpitWebServer *server,
                         const gchar *path,
                         GHashTable *headers,
                         CockpitWebResponse *response,
                         CockpitHandlerData *data)
{
  CockpitWebService *service;
  const gchar *remainder = NULL;
  gboolean resource;

  path = cockpit_web_response_get_path (response);
  g_return_val_if_fail (path != NULL, FALSE);

  resource = g_str_has_prefix (path, "/cockpit/") ||
             g_str_has_prefix (path, "/cockpit+") ||
             g_str_equal (path, "/cockpit");

  // Check for auth
  service = cockpit_auth_check_cookie (data->auth, path, headers);

  /* Stuff in /cockpit or /cockpit+xxx */
  if (resource)
    {
      cockpit_web_response_skip_path (response);
      remainder = cockpit_web_response_get_path (response);

      if (!remainder)
        {
          cockpit_web_response_error (response, 404, NULL, NULL);
          return TRUE;
        }
      else if (g_str_has_prefix (remainder, "/static/"))
        {
          cockpit_branding_serve (service, response, path, remainder + 8,
                                  data->os_release, data->static_roots);
          return TRUE;
        }
    }

  if (resource)
    {
      if (g_str_equal (remainder, "/login"))
        {
          handle_login (data, service, path, headers, response);
        }
      else
        {
          handle_resource (data, service, path, headers, response);
        }
    }
  else
    {
      handle_shell (data, service, path, headers, response);
    }

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_handler_root (CockpitWebServer *server,
                      const gchar *path,
                      GHashTable *headers,
                      CockpitWebResponse *response,
                      CockpitHandlerData *ws)
{
  /* Don't cache forever */
  cockpit_web_response_file (response, path, ws->static_roots);
  return TRUE;
}

gboolean
cockpit_handler_ping (CockpitWebServer *server,
                      const gchar *path,
                      GHashTable *headers,
                      CockpitWebResponse *response,
                      CockpitHandlerData *ws)
{
  GHashTable *out_headers;
  const gchar *body;
  GBytes *content;

  out_headers = cockpit_web_server_new_table ();

  /*
   * The /ping request has unrestricted CORS enabled on it. This allows javascript
   * in the browser on embedding websites to check if Cockpit is available. These
   * websites could do this in another way (such as loading an image from Cockpit)
   * but this does it in the correct manner.
   *
   * See: http://www.w3.org/TR/cors/
   */
  g_hash_table_insert (out_headers, g_strdup ("Access-Control-Allow-Origin"), g_strdup ("*"));

  g_hash_table_insert (out_headers, g_strdup ("Content-Type"), g_strdup ("application/json"));
  body ="{ \"service\": \"cockpit\" }";
  content = g_bytes_new_static (body, strlen (body));

  cockpit_web_response_content (response, out_headers, content, NULL);

  g_bytes_unref (content);
  g_hash_table_unref (out_headers);

  return TRUE;
}
