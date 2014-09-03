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

#include "websocket/websocket.h"

#include <gsystem-local-alloc.h>

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

gboolean
cockpit_handler_resource (CockpitWebService *server,
                          const gchar *path,
                          GHashTable *headers,
                          CockpitWebResponse *response,
                          CockpitHandlerData *ws)
{
  CockpitWebService *service;

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service)
    {
      cockpit_web_service_resource (service, response);
      g_object_unref (service);
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

static GBytes *
build_environment (CockpitWebService *service,
                   JsonObject *modules)
{
  const gchar *user;
  CockpitCreds *creds;
  JsonObject *env;
  JsonObject *localhost;
  JsonObject *languages;
  JsonObject *language;
  struct passwd *pwd;
  gchar *hostname;
  GBytes *bytes;
  guint n;

  const struct {
    const gchar *name;
    const gchar *code;
  } supported_languages[] = {
    { NC_("display-language", "English"), "" },
    { NC_("display-language", "Danish"),  "da" },
    { NC_("display-language", "German"),  "de" },
  };

  env = json_object_new ();
  if (service)
    {
      creds = cockpit_web_service_get_creds (service);
      user = cockpit_creds_get_user (creds);
      json_object_set_string_member (env, "user", user);
      pwd = cockpit_getpwnam_a (user, NULL);
      if (pwd)
        {
          json_object_set_string_member (env, "name", pwd->pw_gecos);
          free (pwd);
        }
    }

  localhost = json_object_new ();

  /* This awkwardly takes the localhost reference */
  json_object_set_object_member (env, "localhost", localhost);

  hostname = g_malloc0 (HOST_NAME_MAX + 1);
  gethostname (hostname, HOST_NAME_MAX);
  hostname[HOST_NAME_MAX] = '\0';

  json_object_set_string_member (env, "hostname", hostname);
  g_free (hostname);

  /* Only include version info if logged in */
  if (service)
    {
      json_object_set_string_member (localhost, "version", PACKAGE_VERSION);
      json_object_set_string_member (localhost, "build_info", COCKPIT_BUILD_INFO);
    }

  languages = json_object_new ();

  /* This awkwardly takes the languages reference */
  json_object_set_object_member (localhost, "languages", languages);

  for (n = 0; n < G_N_ELEMENTS (supported_languages); n++)
    {
      language = json_object_new ();
      json_object_set_object_member (languages, supported_languages[n].code, language);
      json_object_set_string_member (language, "name", supported_languages[n].name);
    }

  if (modules)
    json_object_set_object_member (localhost, "modules", json_object_ref (modules));

  bytes = cockpit_json_write_bytes (env);
  json_object_unref (env);

  return bytes;
}

typedef struct {
  CockpitWebResponse *response;
  GHashTable *headers;
} LoginResponse;

static void
login_response_free (gpointer data)
{
  LoginResponse *lr = data;
  g_object_unref (lr->response);
  g_hash_table_unref (lr->headers);
  g_free (lr);
}

static void
on_login_modules (GObject *source,
                  GAsyncResult *result,
                  gpointer user_data)
{
  LoginResponse *lr = user_data;
  CockpitWebService *service;
  JsonObject *modules;
  GBytes *content;

  service = COCKPIT_WEB_SERVICE (source);
  modules = cockpit_web_service_modules_finish (service, result);

  content = build_environment (service, modules);
  g_hash_table_replace (lr->headers, g_strdup ("Content-Type"), g_strdup ("application/json"));
  cockpit_web_response_content (lr->response, lr->headers, content, NULL);
  g_bytes_unref (content);

  if (modules)
    json_object_unref (modules);

  login_response_free (lr);
}

static void
on_login_complete (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  LoginResponse *lr = user_data;
  GError *error = NULL;
  CockpitWebService *service;
  GIOStream *io_stream;

  io_stream = cockpit_web_response_get_stream (lr->response);
  service = cockpit_auth_login_finish (COCKPIT_AUTH (object), result,
                                       !G_IS_SOCKET_CONNECTION (io_stream),
                                       lr->headers, &error);

  if (error)
    {
      cockpit_web_response_gerror (lr->response, lr->headers, error);
      login_response_free (lr);
      g_error_free (error);
    }
  else
    {
      cockpit_web_service_modules (service, "localhost", on_login_modules, lr);
      g_object_unref (service);
    }
}

gboolean
cockpit_handler_login (CockpitWebServer *server,
                       const gchar *path,
                       GHashTable *headers,
                       CockpitWebResponse *response,
                       CockpitHandlerData *ws)
{
  CockpitWebService *service;
  gchar *remote_peer = NULL;
  GIOStream *io_stream;
  LoginResponse *lr;

  lr = g_new0 (LoginResponse, 1);
  lr->response = g_object_ref (response);
  lr->headers = cockpit_web_server_new_table ();

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service == NULL)
    {
      io_stream = cockpit_web_response_get_stream (response);
      remote_peer = get_remote_address (io_stream);
      cockpit_auth_login_async (ws->auth, headers, remote_peer, on_login_complete, lr);
      g_free (remote_peer);
    }
  else
    {
      cockpit_web_service_modules (service, "localhost", on_login_modules, lr);
      g_object_unref (service);
    }

  /* no response yet */
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_handler_static (CockpitWebServer *server,
                        const gchar *path,
                        GHashTable *headers,
                        CockpitWebResponse *response,
                        CockpitHandlerData *ws)
{
  /* Cache forever */
  cockpit_web_response_file (response, path + 8, TRUE, ws->static_roots);
  return TRUE;
}

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


static void
send_index_response (CockpitWebResponse *response,
                     CockpitWebService *service,
                     JsonObject *modules,
                     CockpitHandlerData *ws)
{
  GHashTable *out_headers;
  GError *error = NULL;
  GMappedFile *file = NULL;
  GBytes *body = NULL;
  GBytes *prefix = NULL;
  GBytes *environ = NULL;
  GBytes *suffix = NULL;
  gchar *index_html;
  const gchar *needle;
  const gchar *data;
  const gchar *pos;
  gsize needle_len;
  gsize length;
  gsize offset;

  /*
   * Since the index file cannot be properly cached, it can change on
   * each request, so we include full environment information directly
   * rather than making the client do another round trip later.
   *
   * If the caller is already logged in, then this is included in the
   * environment.
   */

  index_html = g_build_filename (ws->static_roots[0], "index.html", NULL);
  file = g_mapped_file_new (index_html, FALSE, &error);
  if (file == NULL)
    {
      g_warning ("%s: %s", index_html, error->message);
      cockpit_web_response_error (response, 500, NULL, NULL);
      g_clear_error (&error);
      goto out;
    }

  body = g_mapped_file_get_bytes (file);
  data = g_bytes_get_data (body, &length);

  needle = "cockpit_environment_info";
  pos = g_strstr_len (data, length, needle);
  if (!pos)
    {
      g_warning ("couldn't find 'cockpit_environment_info' string in index.html");
      cockpit_web_response_error (response, 500, NULL, NULL);
      goto out;
    }

  environ = build_environment (service, modules);

  offset = (pos - data);
  prefix = g_bytes_new_from_bytes (body, 0, offset);

  needle_len = strlen (needle);
  suffix = g_bytes_new_from_bytes (body, offset + needle_len,
                                   length - (offset + needle_len));

  out_headers = cockpit_web_server_new_table ();
  g_hash_table_insert (out_headers, g_strdup ("Content-Type"), g_strdup ("text/html; charset=utf8"));
  cockpit_web_response_content (response, out_headers, prefix, environ, suffix, NULL);
  g_hash_table_unref (out_headers);

out:
  g_free (index_html);
  if (prefix)
    g_bytes_unref (prefix);
  if (body)
    g_bytes_unref (body);
  if (environ)
    g_bytes_unref (environ);
  if (suffix)
    g_bytes_unref (suffix);
  if (file)
    g_mapped_file_unref (file);
}

typedef struct {
  CockpitWebResponse *response;
  CockpitHandlerData *data;
} IndexResponse;

static void
on_index_modules (GObject *source_object,
                  GAsyncResult *result,
                  gpointer user_data)
{
  IndexResponse *ir = user_data;
  CockpitWebService *service = COCKPIT_WEB_SERVICE (source_object);
  JsonObject *modules;

  /* Failures printed elsewhere */
  modules = cockpit_web_service_modules_finish (service, result);
  send_index_response (ir->response, service, modules, ir->data);

  if (modules)
    json_object_unref (modules);
  g_object_unref (ir->response);
  g_free (ir);
}

gboolean
cockpit_handler_index (CockpitWebServer *server,
                       const gchar *path,
                       GHashTable *headers,
                       CockpitWebResponse *response,
                       CockpitHandlerData *ws)
{
  CockpitWebService *service;
  IndexResponse *ir;

  /*
   * In the future this code path should also be taken for GSSAPI
   * single-sign-on authentication, where the user never sees a login
   * screen.
   */

  service = cockpit_auth_check_cookie (ws->auth, headers);
  if (service)
    {
      /* Already logged in, lookup modules and return full environment */
      ir = g_new0 (IndexResponse, 1);
      ir->response = g_object_ref (response);
      ir->data = ws;
      cockpit_web_service_modules (service, "localhost", on_index_modules, ir);
    }
  else
    {
      /* Not logged in, include half-baked environment */
      send_index_response (response, NULL, NULL, ws);
    }

  return TRUE;
}
