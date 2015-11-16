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

#include "cockpitchannelresponse.h"
#include "cockpitchannelsocket.h"
#include "cockpitwebservice.h"
#include "cockpitws.h"

#include "common/cockpitjson.h"
#include "common/cockpitenums.h"
#include "common/cockpitwebinject.h"

#include "websocket/websocket.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>
#include <glib/gi18n-lib.h>

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
  gchar *application;

  application = cockpit_auth_parse_application (path);
  connection = cockpit_web_service_create_socket (NULL, application, NULL, io_stream,
                                                  headers, input_buffer);
  g_free (application);

  g_signal_connect (connection, "open", G_CALLBACK (on_web_socket_noauth), NULL);

  /* Unreferences connection when it closes */
  g_signal_connect (connection, "close", G_CALLBACK (g_object_unref), NULL);
}

/* Called by @server when handling HTTP requests to /cockpit/socket */
gboolean
cockpit_handler_socket (CockpitWebServer *server,
                        const gchar *path,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GByteArray *input,
                        guint in_length,
                        CockpitHandlerData *ws)
{
  CockpitWebService *service = NULL;
  const gchar *query = NULL;
  const gchar *segment = NULL;

  /*
   * Socket requests should come in on /cockpit/socket or /cockpit+app/socket.
   * However older javascript may connect on /socket, so we continue to support that.
   */

  if (path && path[0])
    segment = strchr (path + 1, '/');
  if (!segment)
    segment = path;

  if (!segment || !g_str_has_prefix (segment, "/socket"))
    return FALSE;

  if (segment[7] == '?')
    query = segment + 8;
  else if (segment[7] != '\0')
    return FALSE;

  if (headers)
    service = cockpit_auth_check_cookie (ws->auth, path, headers);
  if (service)
    {
      if (query)
        cockpit_channel_socket_open (service, path, query, io_stream, headers, input);
      else
        cockpit_web_service_socket (service, path, io_stream, headers, input);
      g_object_unref (service);
    }
  else
    {
      handle_noauth_socket (io_stream, path, headers, input);
    }

  return TRUE;
}

static GBytes *
build_environment (GHashTable *os_release)
{
  static const gchar *prefix = "\n    <script>\nvar environment = ";
  static const gchar *suffix = ";\n    </script>";
  GByteArray *buffer;
  GHashTableIter iter;
  GBytes *bytes;
  JsonObject *object;
  gchar *hostname;
  gpointer key, value;
  JsonObject *osr;

  object = json_object_new ();
  hostname = g_malloc0 (HOST_NAME_MAX + 1);
  gethostname (hostname, HOST_NAME_MAX);
  hostname[HOST_NAME_MAX] = '\0';
  json_object_set_string_member (object, "hostname", hostname);
  g_free (hostname);

  if (os_release)
    {
      osr = json_object_new ();
      g_hash_table_iter_init (&iter, os_release);
      while (g_hash_table_iter_next (&iter, &key, &value))
        json_object_set_string_member (osr, key, value);
      json_object_set_object_member (object, "os-release", osr);
    }

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

  environment = build_environment (ws->os_release);
  filter = cockpit_web_inject_new (marker, environment);
  g_bytes_unref (environment);

  cockpit_web_response_add_filter (response, filter);
  cockpit_web_response_file (response, "/login.html", FALSE, ws->static_roots);
  g_object_unref (filter);
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
                     CockpitCreds *creds,
                     GHashTable *headers)
{
  JsonObject *object;
  GBytes *content;

  object = json_object_new ();
  json_object_set_string_member (object, "user", cockpit_creds_get_user (creds));

  content = cockpit_json_write_bytes (object);
  json_object_unref (object);

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
  CockpitWebService *service;
  CockpitAuthFlags flags = 0;
  CockpitCreds *creds;
  GHashTable *headers;
  GIOStream *io_stream;

  io_stream = cockpit_web_response_get_stream (response);
  if (G_IS_SOCKET_CONNECTION (io_stream))
    flags |= COCKPIT_AUTH_COOKIE_INSECURE;

  headers = cockpit_web_server_new_table ();
  service = cockpit_auth_login_finish (COCKPIT_AUTH (object), result, flags, headers, &error);

  if (error)
    {
      cockpit_web_response_gerror (response, headers, error);
      g_error_free (error);
    }
  else
    {
      creds = cockpit_web_service_get_creds (service);
      send_login_response (response, creds, headers);
      g_object_unref (service);
    }

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
  gchar *remote_peer = NULL;
  GIOStream *io_stream;
  CockpitCreds *creds;

  if (service)
    {
      out_headers = cockpit_web_server_new_table ();
      creds = cockpit_web_service_get_creds (service);
      send_login_response (response, creds, out_headers);
      g_hash_table_unref (out_headers);
    }
  else
    {
      io_stream = cockpit_web_response_get_stream (response);
      remote_peer = get_remote_address (io_stream);
      cockpit_auth_login_async (data->auth, path, headers, remote_peer,
                                on_login_complete, g_object_ref (response));
      g_free (remote_peer);
    }
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

  /* Check if a valid path for a shell to be served at */
  valid = g_str_equal (path, "/") ||
          g_str_has_prefix (path, "/@") ||
          strspn (path + 1, COCKPIT_RESOURCE_PACKAGE_VALID) == strcspn (path + 1, "/");

  if (g_str_has_prefix (path, "/@/") || g_str_has_prefix (path, "//"))
    valid = FALSE;

  if (!valid)
    {
      cockpit_web_response_error (response, 404, NULL, NULL);
    }
  else if (service)
    {
      cockpit_channel_response_serve (service, headers, response,
                                      NULL, cockpit_ws_shell_component);
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
          /* Static stuff is served without authentication */
          cockpit_web_response_file (response, remainder + 8, TRUE, data->static_roots);
          return TRUE;
        }
    }

  /* Remainder of stuff needs authentication */
  service = cockpit_auth_check_cookie (data->auth, path, headers);

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
  cockpit_web_response_file (response, path, FALSE, ws->static_roots);
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
