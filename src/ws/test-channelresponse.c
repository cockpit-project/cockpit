/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "mock-auth.h"
#include "cockpitws.h"
#include "cockpitcreds.h"
#include "cockpitchannelresponse.h"

#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"
#include "common/cockpitjson.h"
#include "common/cockpittest.h"
#include "common/mock-io-stream.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitconf.h"

#include "websocket/websocket.h"

#include <glib.h>

#include <string.h>
#include <errno.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <sys/wait.h>

/*
 * To recalculate the checksums found in this file, do something like:
 * $ XDG_DATA_DIRS=$PWD/src/bridge/mock-resource/system/ XDG_DATA_HOME=/nonexistant cockpit-bridge --packages
 */

#define PASSWORD "this is the password"

typedef struct {
  CockpitWebService *service;
  GIOStream *io;
  GMemoryOutputStream *output;
  CockpitPipe *pipe;
  GHashTable *headers;
} TestResourceCase;

typedef struct {
  const gchar *xdg_data_home;
  gboolean org_path;
} TestResourceFixture;

static void
on_init_ready (GObject *object,
               GAsyncResult *result,
               gpointer data)
{
  gboolean *flag = data;
  g_assert (*flag == FALSE);
  cockpit_web_service_get_init_message_finish (COCKPIT_WEB_SERVICE (object),
                                               result);
  *flag = TRUE;
}

static void
setup_resource (TestResourceCase *tc,
                gconstpointer data)
{
  const TestResourceFixture *fixture = data;
  CockpitTransport *transport;
  GInputStream *input;
  GOutputStream *output;
  CockpitCreds *creds;
  gchar **environ;
  const gchar *user;
  const gchar *home = NULL;
  gboolean ready = FALSE;
  GBytes *password;

  const gchar *argv[] = {
    BUILDDIR "/cockpit-bridge",
    NULL
  };

  environ = g_get_environ ();
  environ = g_environ_setenv (environ, "XDG_DATA_DIRS", SRCDIR "/src/bridge/mock-resource/system", TRUE);

  if (fixture)
    home = fixture->xdg_data_home;
  if (!home)
    home = SRCDIR "/src/bridge/mock-resource/home";
  environ = g_environ_setenv (environ, "XDG_DATA_HOME", home, TRUE);

  /* Start up a cockpit-bridge here */
  tc->pipe = cockpit_pipe_spawn (argv, (const gchar **)environ, NULL, COCKPIT_PIPE_FLAGS_NONE);

  g_strfreev (environ);

  user = g_get_user_name ();
  password = g_bytes_new_take (g_strdup (PASSWORD), strlen (PASSWORD));
  creds = cockpit_creds_new ("cockpit", COCKPIT_CRED_USER, user, COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  transport = cockpit_pipe_transport_new (tc->pipe);
  tc->service = cockpit_web_service_new (creds, transport);

  /* Manually created services won't be init'd yet,
   * wait for that before sending data
   */
  cockpit_web_service_get_init_message_aysnc (tc->service, on_init_ready, &ready);
  while (!ready)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);

  cockpit_creds_unref (creds);

  input = g_memory_input_stream_new_from_data ("", 0, NULL);
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  tc->io = mock_io_stream_new (input, output);
  tc->output = G_MEMORY_OUTPUT_STREAM (output);
  g_object_unref (input);

  tc->headers = cockpit_web_server_new_table ();
  g_hash_table_insert (tc->headers, g_strdup ("Accept-Encoding"), g_strdup ("gzip, identity"));
}

static void
teardown_resource (TestResourceCase *tc,
                   gconstpointer data)
{
  cockpit_assert_expected ();

  g_hash_table_unref (tc->headers);

  g_object_add_weak_pointer (G_OBJECT (tc->service), (gpointer *)&tc->service);
  g_object_unref (tc->service);
  g_assert (tc->service == NULL);

  g_object_unref (tc->io);
  g_object_unref (tc->output);
  g_object_unref (tc->pipe);
}

static void
test_resource_simple (TestResourceCase *tc,
                      gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_simple_host (TestResourceCase *tc,
                           gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/@localhost/another/test.html";

  g_hash_table_insert (tc->headers, g_strdup ("Host"), g_strdup ("my.host"));
  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://my.host; connect-src 'self' http://my.host ws://my.host; form-action 'self' http://my.host; base-uri 'self' http://my.host; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://my.host\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_language (TestResourceCase *tc,
                        gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  gchar *url = "/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  g_hash_table_insert (tc->headers, g_strdup ("Accept-Language"), g_strdup ("pig, blah"));
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "60\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Inlay omehay irday</title>\n"
                           "</head>\n"
                           "<body>Inlay omehay irday</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_cookie (TestResourceCase *tc,
                      gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  g_hash_table_insert (tc->headers, g_strdup ("Cookie"), g_strdup ("CockpitLang=pig"));
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "60\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Inlay omehay irday</title>\n"
                           "</head>\n"
                           "<body>Inlay omehay irday</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_not_found (TestResourceCase *tc,
                         gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/cockpit/another@localhost/not-exist";

  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "another@localhost", "/not-exist");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 404 Not Found\r\n"
                           "Content-Type: text/html; charset=utf8\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_no_path (TestResourceCase *tc,
                       gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/cockpit/another@localhost";

  /* Missing path after package */
  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "another@localhost", "");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 404 Not Found\r\n"
                           "Content-Type: text/html; charset=utf8\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}


static void
test_resource_failure (TestResourceCase *tc,
                       gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  GPid pid;

  cockpit_expect_message ("*: external channel failed: terminated");

  /* Now kill the bridge */
  g_assert (cockpit_pipe_get_pid (tc->pipe, &pid));
  g_assert_cmpint (pid, >, 0);
  g_assert_cmpint (kill (pid, SIGTERM), ==, 0);
  /* Wait until it's gone; we can't use waitpid(), it interferes with GChildWatch */
  while (kill (pid, 0) >= 0)
    g_usleep (1000);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 500 Internal Server Error\r\n"
                           "Content-Type: text/html; charset=utf8\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n13\r\n"
                           "<html><head><title>\r\n15\r\n"
                           "Internal Server Error\r\n15\r\n"
                           "</title></head><body>\r\n15\r\n"
                           "Internal Server Error\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static const TestResourceFixture checksum_fixture = {
  .xdg_data_home = "/nonexistant"
};


static void
request_checksum (TestResourceCase *tc)
{
  CockpitWebResponse *response;
  GInputStream *input;
  GOutputStream *output;
  GIOStream *io;

  input = g_memory_input_stream_new_from_data ("", 0, NULL);
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  io = mock_io_stream_new (input, output);
  g_object_unref (input);

  /* Start the connection up, and poke it a bit */
  response = cockpit_web_response_new (io, "/unused", "/unused", NULL, NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/checksum");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (io);

  /* Use this when the checksum changes, due to mock resource changes */
#if 0
  bytes = g_memory_output_stream_steal_as_bytes (G_MEMORY_OUTPUT_STREAM (output));
  g_printerr ("%.*s\n", (gint)g_bytes_get_size (bytes), (gchar *)g_bytes_get_data (bytes, NULL));
  g_bytes_unref (bytes);
#endif

  g_object_unref (output);
  g_object_unref (response);
}

static void
test_resource_checksum (TestResourceCase *tc,
                        gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  /* We require that no user packages are loaded, so we have a checksum */
  g_assert (data == &checksum_fixture);

  request_checksum (tc);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$060119c2a544d8e5becd0f74f9dcde146b8d99e3",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "ETag: \"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-c\"\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Cache-Control: max-age=31556926, public\r\n"
                           "\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_not_modified (TestResourceCase *tc,
                            gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-c\""));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$060119c2a544d8e5becd0f74f9dcde146b8d99e3",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 304 Not Modified\r\n"
                           "ETag: \"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-c\"\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_not_modified_new_language (TestResourceCase *tc,
                                         gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-c\""));
  g_hash_table_insert (tc->headers, g_strdup ("Accept-Language"), g_strdup ("de"));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$060119c2a544d8e5becd0f74f9dcde146b8d99e3",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "ETag: \"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-de\"\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Cache-Control: max-age=31556926, public\r\n"
                           "\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_not_modified_cookie_language (TestResourceCase *tc,
                                            gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  gchar *cookie;

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-c\""));

  cookie = g_strdup_printf ("%s; CockpitLang=fr", (gchar *)g_hash_table_lookup (tc->headers, "Cookie"));
  g_hash_table_insert (tc->headers, g_strdup ("Cookie"), cookie);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$060119c2a544d8e5becd0f74f9dcde146b8d99e3",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "ETag: \"$060119c2a544d8e5becd0f74f9dcde146b8d99e3-fr\"\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Cache-Control: max-age=31556926, public\r\n"
                           "\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_no_checksum (TestResourceCase *tc,
                           gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  /* Missing checksum */
  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "xxx", "/test");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 404 Not Found\r\n"
                           "Content-Type: text/html; charset=utf8\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_bad_checksum (TestResourceCase *tc,
                           gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  /* Missing checksum */
  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "09323094823029348", "/path");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 404 Not Found\r\n"
                           "Content-Type: text/html; charset=utf8\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_language_suffix (TestResourceCase *tc,
                               gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.de.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "62\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Im Home-Verzeichnis</title>\n"
                           "</head>\n"
                           "<body>Im Home-Verzeichnis</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_language_fallback (TestResourceCase *tc,
                                 gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  /* Language cookie overrides */
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.fi.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_gzip_encoding (TestResourceCase *tc,
                             gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test-file.txt");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Encoding: gzip\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Content-Type: text/plain\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "34\r\n"
                           "\x1F\x8B\x08\x08N1\x03U\x00\x03test-file.txt\x00sT(\xCEM\xCC\xC9Q(I-"
                           ".QH\xCB\xCCI\xE5\x02\x00>PjG\x12\x00\x00\x00\x0D\x0A"
                           "0\x0D\x0A\x0D\x0A",
                           315);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static void
test_resource_head (TestResourceCase *tc,
                    gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  const gchar *url = "/@localhost/another/test.html";

  response = cockpit_web_response_new (tc->io, url, url, NULL, NULL);
  cockpit_web_response_set_method (response, "HEAD");

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "X-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\n"
                           "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; block-all-mixed-content\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Access-Control-Allow-Origin: http://localhost\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "0\r\n\r\n", -1);
  g_bytes_unref (bytes);
  g_object_unref (response);
}

static gboolean
on_hack_raise_sigchld (gpointer user_data)
{
  raise (SIGCHLD);
  return TRUE;
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  /*
   * HACK: Work around races in glib SIGCHLD handling.
   *
   * https://bugzilla.gnome.org/show_bug.cgi?id=731771
   * https://bugzilla.gnome.org/show_bug.cgi?id=711090
   */
  g_timeout_add_seconds (1, on_hack_raise_sigchld, NULL);

  /* Try to debug crashing during tests */
  signal (SIGSEGV, cockpit_test_signal_backtrace);

  /* We don't want to test the ping functionality in these tests */
  cockpit_ws_ping_interval = G_MAXUINT;

  g_test_add ("/web-channel/resource/simple", TestResourceCase, NULL,
              setup_resource, test_resource_simple, teardown_resource);
  g_test_add ("/web-channel/resource/simple_host", TestResourceCase, NULL,
              setup_resource, test_resource_simple_host, teardown_resource);
  g_test_add ("/web-channel/resource/language", TestResourceCase, NULL,
              setup_resource, test_resource_language, teardown_resource);
  g_test_add ("/web-channel/resource/cookie", TestResourceCase, NULL,
              setup_resource, test_resource_cookie, teardown_resource);
  g_test_add ("/web-channel/resource/not-found", TestResourceCase, NULL,
              setup_resource, test_resource_not_found, teardown_resource);
  g_test_add ("/web-channel/resource/no-path", TestResourceCase, NULL,
              setup_resource, test_resource_no_path, teardown_resource);
  g_test_add ("/web-channel/resource/failure", TestResourceCase, NULL,
              setup_resource, test_resource_failure, teardown_resource);
  g_test_add ("/web-channel/resource/checksum", TestResourceCase, &checksum_fixture,
              setup_resource, test_resource_checksum, teardown_resource);
  g_test_add ("/web-channel/resource/not-modified", TestResourceCase, &checksum_fixture,
              setup_resource, test_resource_not_modified, teardown_resource);
  g_test_add ("/web-channel/resource/not-modified-new-language", TestResourceCase, &checksum_fixture,
              setup_resource, test_resource_not_modified_new_language, teardown_resource);
  g_test_add ("/web-channel/resource/not-modified-cookie-language", TestResourceCase, &checksum_fixture,
              setup_resource, test_resource_not_modified_cookie_language, teardown_resource);
  g_test_add ("/web-channel/resource/no-checksum", TestResourceCase, NULL,
              setup_resource, test_resource_no_checksum, teardown_resource);
  g_test_add ("/web-channel/resource/bad-checksum", TestResourceCase, NULL,
              setup_resource, test_resource_bad_checksum, teardown_resource);
  g_test_add ("/web-channel/resource/language-suffix", TestResourceCase, NULL,
              setup_resource, test_resource_language_suffix, teardown_resource);
  g_test_add ("/web-channel/resource/language-fallback", TestResourceCase, NULL,
              setup_resource, test_resource_language_fallback, teardown_resource);

  g_test_add ("/web-channel/resource/gzip-encoding", TestResourceCase, NULL,
              setup_resource, test_resource_gzip_encoding, teardown_resource);
  g_test_add ("/web-channel/resource/head", TestResourceCase, NULL,
              setup_resource, test_resource_head, teardown_resource);

  return g_test_run ();
}
