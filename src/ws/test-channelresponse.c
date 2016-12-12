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

#include <libssh/libssh.h>

#include <string.h>
#include <errno.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <sys/wait.h>

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
  creds = cockpit_creds_new (user, "cockpit", COCKPIT_CRED_PASSWORD, password, NULL);
  g_bytes_unref (password);

  transport = cockpit_pipe_transport_new (tc->pipe);
  tc->service = cockpit_web_service_new (creds, transport);
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
                           "Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
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
                           "Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
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
                           "Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
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

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, NULL);

  /* Now kill the bridge */
  g_assert (cockpit_pipe_get_pid (tc->pipe, &pid));
  g_assert_cmpint (pid, >, 0);
  g_assert_cmpint (kill (pid, SIGTERM), ==, 0);

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

static const TestResourceFixture checksum_path_fixture = {
  .xdg_data_home = "/nonexistant",
  .org_path = TRUE
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
                                "$386257ed81a663cdd7ee12633056dee18d60ddca",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "ETag: \"$386257ed81a663cdd7ee12633056dee18d60ddca-c\"\r\n"
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
test_resource_redirect_checksum (TestResourceCase *tc,
                                 gconstpointer data)
{
  CockpitWebResponse *response;
  GInputStream *input;
  GOutputStream *output;
  GIOStream *io;
  GError *error = NULL;
  GBytes *bytes;
  const TestResourceFixture *fix = data;
  const gchar *expected;
  /* We require that no user packages are loaded, so we have a checksum */
  g_assert (fix->xdg_data_home != NULL);


  input = g_memory_input_stream_new_from_data ("", 0, NULL);
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  io = mock_io_stream_new (input, output);
  g_object_unref (input);

  /* Start the connection up, and poke it a bit */
  response = cockpit_web_response_new (io, "/", "/", NULL, NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/not-found");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (io);
  g_object_unref (output);
  g_object_unref (response);

  /* Now do the real request ... we should be redirected */
  response = cockpit_web_response_new (tc->io,
                                       fix->org_path ? "/path/unused" : "/unused",
                                       "/unused", NULL, NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  if (fix->org_path)
    {
      expected = "HTTP/1.1 307 Temporary Redirect\r\n"
                 "Content-Type: text/html\r\n"
                 "Location: /path/cockpit/$386257ed81a663cdd7ee12633056dee18d60ddca/test/sub/file.ext\r\n"
                 "Content-Length: 91\r\n"
                 "\r\n"
                 "<html><head><title>Temporary redirect</title></head><body>Access via checksum</body></html>";
    }
  else
    {
      expected = "HTTP/1.1 307 Temporary Redirect\r\n"
                 "Content-Type: text/html\r\n"
                 "Location: /cockpit/$386257ed81a663cdd7ee12633056dee18d60ddca/test/sub/file.ext\r\n"
                 "Content-Length: 91\r\n"
                 "\r\n"
                 "<html><head><title>Temporary redirect</title></head><body>Access via checksum</body></html>";
    }

  cockpit_assert_bytes_eq (bytes, expected, -1);
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
                       g_strdup ("\"$386257ed81a663cdd7ee12633056dee18d60ddca-c\""));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$386257ed81a663cdd7ee12633056dee18d60ddca",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 304 Not Modified\r\n"
                           "ETag: \"$386257ed81a663cdd7ee12633056dee18d60ddca-c\"\r\n"
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
                       g_strdup ("\"$386257ed81a663cdd7ee12633056dee18d60ddca-c\""));
  g_hash_table_insert (tc->headers, g_strdup ("Accept-Language"), g_strdup ("de"));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$386257ed81a663cdd7ee12633056dee18d60ddca",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "ETag: \"$386257ed81a663cdd7ee12633056dee18d60ddca-de\"\r\n"
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
                       g_strdup ("\"$386257ed81a663cdd7ee12633056dee18d60ddca-c\""));

  cookie = g_strdup_printf ("%s; CockpitLang=fr", (gchar *)g_hash_table_lookup (tc->headers, "Cookie"));
  g_hash_table_insert (tc->headers, g_strdup ("Cookie"), cookie);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, tc->headers);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                "$386257ed81a663cdd7ee12633056dee18d60ddca",
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  cockpit_assert_bytes_eq (bytes,
                           "HTTP/1.1 200 OK\r\n"
                           "ETag: \"$386257ed81a663cdd7ee12633056dee18d60ddca-fr\"\r\n"
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
                           "Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
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
                           "Content-Security-Policy: default-src 'self'; connect-src 'self' ws: wss:\r\n"
                           "Content-Type: text/html\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
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
                           "Content-Encoding: gzip\r\n"
                           "Content-Type: text/plain\r\n"
                           "Cache-Control: no-cache, no-store\r\n"
                           "Transfer-Encoding: chunked\r\n"
                           "Vary: Cookie\r\n"
                           "\r\n"
                           "34\r\n"
                           "\x1F\x8B\x08\x08N1\x03U\x00\x03test-file.txt\x00sT(\xCEM\xCC\xC9Q(I-"
                           ".QH\xCB\xCCI\xE5\x02\x00>PjG\x12\x00\x00\x00\x0D\x0A" "0\x0D\x0A\x0D\x0A",
                           209);
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
  g_test_add ("/web-channel/resource/redirect-checksum", TestResourceCase, &checksum_fixture,
              setup_resource, test_resource_redirect_checksum, teardown_resource);
  g_test_add ("/web-channel/resource/redirect-path-checksum", TestResourceCase, &checksum_path_fixture,
              setup_resource, test_resource_redirect_checksum, teardown_resource);
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

  return g_test_run ();
}
