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

#include <gio/gio.h>
#include <glib-unix.h>
#include <string.h>
#include <dirent.h>

#include <glib-unix.h>
#include <json-glib/json-glib.h>
#include <sys/types.h>          /* See NOTES */
#include <sys/socket.h>
#include <netinet/in.h>
#include <netinet/tcp.h>

#include <cockpit/cockpit.h>

#include "libgsystem.h"

#include "cockpitws.h"

#define MAX_AUTH_CONTENT_LENGTH 4096

/* ---------------------------------------------------------------------------------------------------- */

static gint      opt_port         = 21064;
static gboolean  opt_no_tls       = FALSE;
static gboolean  opt_disable_auth = FALSE;
static gboolean  opt_debug = FALSE;

static GOptionEntry cmd_entries[] = {
  {"port", 'p', 0, G_OPTION_ARG_INT, &opt_port, "Local port to bind to (21064 if unset)", NULL},
  {"no-auth", 0, 0, G_OPTION_ARG_NONE, &opt_disable_auth, "Don't require authentication", NULL},
  {"no-tls", 0, 0, G_OPTION_ARG_NONE, &opt_no_tls, "Don't use TLS", NULL},
  {"debug", 'd', 0, G_OPTION_ARG_NONE, &opt_debug, "Debug mode: log messages to output", NULL},
  {NULL}
};

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  CockpitWebServer *server;
  GTlsCertificate *certificate;
  CockpitAuth *auth;
  GDBusObjectManager *object_manager;
  GMainLoop *loop;

  gboolean disable_auth;
} CockpitWsData;

/* ---------------------------------------------------------------------------------------------------- */

/* Called by @server when handling HTTP requests to /socket - runs in a separate
 * thread dedicated to the request so it may do blocking I/O
 */
static gboolean
on_handle_resource_socket (CockpitWebServer *server,
                           CockpitWebServerRequestType reqtype,
                           const gchar *resource,
                           GIOStream *io_stream,
                           GHashTable *headers,
                           GDataInputStream *in,
                           GDataOutputStream *out,
                           gpointer user_data)
{
  CockpitWsData *ws = user_data;
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

static gboolean
on_handle_resource_login (CockpitWebServer *server,
                          CockpitWebServerRequestType reqtype,
                          const gchar *resource,
                          GIOStream *io_stream,
                          GHashTable *headers,
                          GDataInputStream *in,
                          GDataOutputStream *out,
                          gpointer user_data)
{
  CockpitWsData *ws = user_data;
  GError *error = NULL;

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
      cookie_header = g_strdup_printf ("Set-Cookie: CockpitAuth=%s; Path=/; Expires=Wed, 13-Jan-2021 22:23:01 GMT;%s HttpOnly\r\n",
                                       cookie_b64,
                                       ws->certificate != NULL ? " Secure;" : "");
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

  response =
    g_strdup_printf ("HTTP/1.1 200 OK\r\n"
                     "%s"
                     "Content-Length: %d\r\n"
                     "Connection: close\r\n"
                     "\r\n"
                     "%s",
                     cookie_header? cookie_header : "",
                     (gint) strlen (response_body),
                     response_body);

  if (!g_output_stream_write_all (G_OUTPUT_STREAM (out), response, strlen (response), NULL, NULL, &error))
    {
      g_warning ("failed to send login reply: %s", error->message);
      g_error_free (error);
      error = NULL;
      goto out;
    }

out:
  if (error)
    {
      cockpit_web_server_return_gerror (G_OUTPUT_STREAM (out), error);
      g_error_free (error);
    }

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_handle_resource_logout (CockpitWebServer *server,
                           CockpitWebServerRequestType reqtype,
                           const gchar *resource,
                           GIOStream *io_stream,
                           GHashTable *headers,
                           GDataInputStream *in,
                           GDataOutputStream *out,
                           gpointer user_data)
{
  CockpitWsData *ws = user_data;
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

static gboolean
on_handle_static (CockpitWebServer *server,
                  CockpitWebServerRequestType reqtype,
                  const gchar *resource,
                  GSocketConnection *connection,
                  GHashTable *headers,
                  GDataInputStream *in,
                  GDataOutputStream *out,
                  gpointer user_data)
{
  gboolean handled = FALSE;
  CockpitWsData *data = user_data;
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

/* ---------------------------------------------------------------------------------------------------- */

static gchar *
generate_temp_cert (GError **error)
{
  const gchar *dir = PACKAGE_LOCALSTATE_DIR "/lib/cockpit";
  gchar *cert_path = NULL;
  gchar *stdout_str = NULL;
  gchar *stderr_str = NULL;
  gchar *command_line = NULL;
  gchar *ret = NULL;
  gint exit_status;

  cert_path = g_strdup_printf ("%s/temp-self-signed.cert", dir);

  /* Generate self-signed cert, if it does not exist */
  if (g_file_test (cert_path, G_FILE_TEST_EXISTS))
    {
      ret = cert_path;
      cert_path = NULL;
      goto out;
    }

  if (g_mkdir_with_parents (dir, 0700) != 0)
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "Error creating directory `%s': %m",
                   dir);
      goto out;
    }

  command_line = g_strdup_printf ("/etc/pki/tls/certs/make-dummy-cert %s", cert_path);

  g_info ("Generating temporary certificate using (command_line: `%s')",
          command_line);

  if (!g_spawn_command_line_sync (command_line,
                                  &stdout_str, /* standard_output */
                                  &stderr_str, /* standard_error */
                                  &exit_status,
                                  error))
    {
      g_prefix_error (error,
                      "Error generating temporary self-signed dummy cert using command-line `%s': ",
                      command_line);
      goto out;
    }

  if (!(WIFEXITED (exit_status) && exit_status == 0))
    {
      g_set_error (error,
                   G_IO_ERROR,
                   G_IO_ERROR_FAILED,
                   "Error generating temporary self-signed dummy cert: command-line `%s' did exit as expected: stdout=`%s' stderr=`%s'",
                   command_line,
                   stdout_str,
                   stderr_str);
      goto out;
    }

  ret = cert_path;
  cert_path = NULL;

out:
  g_free (cert_path);
  g_free (command_line);
  g_free (stdout_str);
  g_free (stderr_str);
  return ret;
}

static gint
ptr_strcmp (const gchar **a,
            const gchar **b)
{
  return g_strcmp0 (*a, *b);
}

static gchar *
load_cert_from_dir (const gchar *dir_name,
                    GError **error)
{
  gchar *ret = NULL;
  GDir *dir;
  const gchar *name;
  GPtrArray *p;

  p = g_ptr_array_new ();

  dir = g_dir_open (dir_name, 0, error);
  if (dir == NULL)
    goto out;

  while ((name = g_dir_read_name (dir)) != NULL)
    {
      if (!g_str_has_suffix (name, ".cert"))
        continue;
      g_ptr_array_add (p, g_strdup_printf ("%s/%s", dir_name, name));
    }

  g_ptr_array_sort (p, (GCompareFunc)ptr_strcmp);

  if (p->len > 0)
    {
      ret = p->pdata[p->len - 1];
      p->pdata[p->len - 1] = NULL;
    }

out:
  if (dir != NULL)
    g_dir_close (dir);
  g_ptr_array_foreach (p, (GFunc)g_free, NULL);
  g_ptr_array_free (p, TRUE);
  return ret;
}

static gboolean
load_cert (GTlsCertificate **out_cert,
           GError **error)
{
  GTlsCertificate *cert = NULL;
  gboolean ret = FALSE;
  gchar *cert_path = NULL;
  const gchar *cert_dir = PACKAGE_SYSCONF_DIR "/cockpit/ws-certs.d";
  GError *local_error;

  local_error = NULL;
  cert_path = load_cert_from_dir (cert_dir, &local_error);
  if (local_error != NULL)
    {
      g_propagate_prefixed_error (error, local_error,
                                  "Error loading certificates from %s: ",
                                  cert_dir);
      goto out;
    }

  /* Could be there's no certicate at all, so cert_path can indeed be
   * NULL. If so, use (and possibly generate) a temporary self-signed
   * certificate
   */
  if (cert_path == NULL)
    {
      cert_path = generate_temp_cert (error);
      if (cert_path == NULL)
        goto out;
    }

  cert = g_tls_certificate_new_from_file (cert_path, error);
  if (cert == NULL)
    {
      g_prefix_error (error, "Error loading certificate at path `%s': ", cert_path);
      goto out;
    }

  g_info ("Using certificate %s", cert_path);

  if (out_cert != NULL)
    {
      *out_cert = cert;
      cert = NULL;
    }

  ret = TRUE;

out:
  g_clear_object (&cert);
  g_free (cert_path);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */

int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  GOptionContext *context;
  CockpitWsData data;
  GError *local_error = NULL;
  GError **error = &local_error;

  g_type_init ();

  memset (&data, 0, sizeof (data));

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, cmd_entries, NULL);

  if (!g_option_context_parse (context, &argc, &argv, error))
    {
      goto out;
    }

  if (!opt_debug)
    cockpit_set_journal_logging ();

  if (opt_no_tls)
    {
      /* no certificate */
    }
  else
    {
      if (!load_cert (&data.certificate, error))
        goto out;
    }

  if (opt_disable_auth)
    {
      data.disable_auth = TRUE;
      data.auth = NULL;
    }
  else
    {
      data.disable_auth = FALSE;
      data.auth = cockpit_auth_new ();
    }

  data.object_manager = g_dbus_object_manager_client_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                                                       G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                                                                       "com.redhat.Cockpit",
                                                                       "/com/redhat/Cockpit",
                                                                       NULL, /* GDBusProxyTypeFunc */
                                                                       NULL, /* user_data for GDBusProxyTypeFunc */
                                                                       NULL, /* GDestroyNotify for GDBusProxyTypeFunc */
                                                                       NULL, /* GCancellable */
                                                                       error);
  if (data.object_manager == NULL)
    {
      g_prefix_error (error, "Error creating object manager: ");
      goto out;
    }

  data.server = cockpit_web_server_new (opt_port,
                                        data.certificate,
                                        NULL, /* opt_root */
                                        NULL,
                                        error);
  if (data.server == NULL)
    {
      g_prefix_error (error, "Error starting web server: ");
      goto out;
    }

  g_signal_connect (data.server,
                    "handle-resource",
                    G_CALLBACK (on_handle_resource_socket),
                    &data);
  g_signal_connect (data.server,
                    "handle-resource::/login",
                    G_CALLBACK (on_handle_resource_login),
                    &data);
  g_signal_connect (data.server,
                    "handle-resource::/logout",
                    G_CALLBACK (on_handle_resource_logout),
                    &data);
  g_signal_connect (data.server,
                    "handle-resource",
                    G_CALLBACK (on_handle_static),
                    &data);

  g_info ("HTTP Server listening on port %d", opt_port);

  data.loop = g_main_loop_new (NULL, FALSE);
  g_main_loop_run (data.loop);

  ret = 0;

out:
  if (local_error)
    {
      g_printerr ("%s (%s, %d)\n", local_error->message, g_quark_to_string (local_error->domain), local_error->code);
      g_error_free (local_error);
    }
  if (data.loop != NULL)
    g_main_loop_unref (data.loop);
  g_clear_object (&data.server);
  g_clear_object (&data.object_manager);
  g_clear_object (&data.certificate);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */
