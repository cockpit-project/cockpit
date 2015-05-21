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

#include "common/cockpitjson.h"
#include "common/cockpittemplate.h"

#include "websocket/websocket.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>
#include <glib/gi18n-lib.h>

#include <string.h>

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */
gboolean
cockpit_handler_socket (CockpitWebServer *server,
                        const gchar *path,
                        GIOStream *io_stream,
                        GHashTable *headers,
                        GByteArray *input,
                        guint in_length,
                        CockpitHandlerData *ws)
{
  CockpitWebService *service;
  const gchar *query = NULL;

  if (!g_str_has_prefix (path, "/socket"))
    return FALSE;

  if (path[7] == '?')
    query = path + 8;
  else if (path[7] != '\0')
    return FALSE;

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service)
    {
      if (query)
        cockpit_web_service_sideband (service, query, io_stream, headers, input);
      else
        cockpit_web_service_socket (service, io_stream, headers, input);
      g_object_unref (service);
    }
  else
    {
      cockpit_web_service_noauth (io_stream, headers, input);
    }

  return TRUE;
}

static GBytes *
substitute_environment (const gchar *variable,
                        gpointer user_data)
{
  GBytes *ret = NULL;
  JsonObject *object;
  gchar *hostname;
  gchar *contents;

  if (g_str_equal (variable, "environment"))
    {
      object = json_object_new ();
      hostname = g_malloc0 (HOST_NAME_MAX + 1);
      gethostname (hostname, HOST_NAME_MAX);
      hostname[HOST_NAME_MAX] = '\0';
      json_object_set_string_member (object, "hostname", hostname);
      g_free (hostname);

      if (g_file_get_contents ("/etc/os-release", &contents, NULL, NULL))
        {
          json_object_set_string_member (object, "os-release", contents);
          g_free (contents);
        }

      ret = cockpit_json_write_bytes (object);
      json_object_unref (object);
    }

  return ret;
}

static void
send_login_html (CockpitWebResponse *response,
                 CockpitHandlerData *ws)
{
  GHashTable *headers = NULL;
  GList *l, *output = NULL;
  gchar *login_html;
  GMappedFile *file;
  GError *error = NULL;
  GBytes *body = NULL;
  gsize length;

  login_html = g_build_filename (ws->static_roots[0], "login.html", NULL);
  file = g_mapped_file_new (login_html, FALSE, &error);
  if (file == NULL)
    {
      g_warning ("%s: %s", login_html, error->message);
      cockpit_web_response_error (response, 500, NULL, NULL);
      g_clear_error (&error);
      goto out;
    }

  body = g_mapped_file_get_bytes (file);
  output = cockpit_template_expand (body, substitute_environment, NULL);

  length = 0;
  for (l = output; l != NULL; l = g_list_next (l))
    length += g_bytes_get_size (l->data);

  headers = cockpit_web_server_new_table ();
  g_hash_table_insert (headers, g_strdup ("Content-Type"), g_strdup ("text/html; charset=utf8"));

  cockpit_web_response_headers_full (response, 200, "OK", length, headers);

  for (l = output; l != NULL; l = g_list_next (l))
    {
      if (!cockpit_web_response_queue (response, l->data))
        break;
    }
  if (l == NULL)
    cockpit_web_response_complete (response);

out:
  g_list_free_full (output, (GDestroyNotify)g_bytes_unref);
  if (headers)
    g_hash_table_unref (headers);
  g_free (login_html);
  if (body)
    g_bytes_unref (body);
  if (file)
    g_mapped_file_unref (file);
}

gboolean
cockpit_handler_resource (CockpitWebServer *server,
                          const gchar *path,
                          GHashTable *headers,
                          CockpitWebResponse *response,
                          CockpitHandlerData *ws)
{
  CockpitWebService *service;

  if (g_str_has_prefix (path, "/cockpit/static/"))
    {
      cockpit_web_response_file (response, path + 16, TRUE, ws->static_roots);
      return TRUE;
    }

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service)
    {
      cockpit_web_service_resource (service, headers, response);
      g_object_unref (service);
    }
  else if (g_str_equal (path, "/") || g_str_has_suffix (path, ".html"))
    {
      send_login_html (response, ws);
    }
  else
    {
      cockpit_web_response_error (response, 401, NULL, NULL);
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

gboolean
cockpit_handler_login (CockpitWebServer *server,
                       const gchar *path,
                       GHashTable *headers,
                       CockpitWebResponse *response,
                       CockpitHandlerData *ws)
{
  CockpitWebService *service;
  CockpitCreds *creds;
  gchar *remote_peer = NULL;
  GHashTable *out_headers;
  GIOStream *io_stream;

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service == NULL)
    {
      io_stream = cockpit_web_response_get_stream (response);
      remote_peer = get_remote_address (io_stream);
      cockpit_auth_login_async (ws->auth, headers, remote_peer, on_login_complete,
                                g_object_ref (response));
      g_free (remote_peer);
    }
  else
    {
      out_headers = cockpit_web_server_new_table ();
      creds = cockpit_web_service_get_creds (service);
      send_login_response (response, creds, out_headers);
      g_hash_table_unref (out_headers);
      g_object_unref (service);
    }

  /* no response yet */
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
