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

#include "cockpitws.h"
#include "cockpitcreds.h"
#include "cockpitchannelresponse.h"

#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"
#include "common/cockpitjson.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitconf.h"

#include "websocket/websocket.h"

#include <glib.h>

#include "testlib/cockpittest.h"
#include "testlib/mock-auth.h"

#include <string.h>
#include <errno.h>
#include <stdio.h>
#include <unistd.h>

#include <sys/syscall.h>
#include <sys/poll.h>
#include <sys/types.h>
#include <sys/socket.h>
#include <sys/wait.h>

#ifndef SYS_pidfd_open
#define SYS_pidfd_open 434  // same on every arch
#endif

/*
 * To recalculate the checksums found in this file, do something like:
 * $ XDG_DATA_DIRS=$PWD/src/bridge/mock-resource/system/ XDG_DATA_HOME=/nonexistent ./cockpit-bridge --packages
 */
#define CHECKSUM "$9a9ee8f5711446a46289cd1451c2a7125fb586456884b96807401ac2f055e669"

#define PASSWORD "this is the password"

/* headers that are present in every request */
#define STATIC_HEADERS "X-Content-Type-Options: nosniff\r\nX-DNS-Prefetch-Control: off\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Resource-Policy: same-origin\r\nX-Frame-Options: sameorigin\r\n"

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

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer data)
{
  gboolean *flag = data;
  g_assert (flag != NULL);

  if (g_str_equal (command, "init"))
    *flag = TRUE;

  return FALSE;
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
  gulong handler;

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

  /* Manually created services won't be init'd yet, wait for that before sending data */
  handler = g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), &ready);

  while (!ready)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);

  cockpit_creds_unref (creds);

  input = g_memory_input_stream_new_from_data ("", 0, NULL);
  output = g_memory_output_stream_new (NULL, 0, g_realloc, g_free);
  tc->io = g_simple_io_stream_new (input, output);
  tc->output = G_MEMORY_OUTPUT_STREAM (output);
  g_object_unref (input);

  tc->headers = cockpit_web_server_new_table ();
  g_hash_table_insert (tc->headers, g_strdup ("Accept-Encoding"), g_strdup ("gzip, identity"));

  g_signal_handler_disconnect (transport, handler);
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

static gboolean
str_contains_strv (const gchar *haystack, const gchar *sewing_kit, const gchar *delim)
{
  gchar **needles;
  gboolean result = TRUE;
  if (strlen (haystack) != strlen (sewing_kit))
    {
      fprintf(stderr, "Length of '%s' doesn't match '%s'\n", haystack, sewing_kit);
      return FALSE;
    }

  needles = g_strsplit (sewing_kit, delim, 0);
  for (guint i = 0; i < g_strv_length (needles) && result; ++i)
    result &= strstr (haystack, needles[i]) != NULL;
  g_strfreev (needles);
  if (!result)
    fprintf(stderr, "String '%s' doesn't contain each element in '%s'\n",
            haystack, sewing_kit);
  return result;
}

static void
test_resource_simple (TestResourceCase *tc,
                      gconstpointer data)
{
  CockpitWebResponse *response;
  GError *error = NULL;
  GBytes *bytes;
  gconstpointer str;
  const gchar *url = "/@localhost/another/test.html";
  const gchar *expected =
    "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";


  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  const gchar *url = "/@localhost/another/test.html";
  const gchar *expected =
    "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://my.host; connect-src 'self' http://my.host ws://my.host; form-action 'self' http://my.host; base-uri 'self' http://my.host; object-src 'none'; font-src 'self' http://my.host data:; img-src 'self' http://my.host data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";

  g_hash_table_insert (tc->headers, g_strdup ("Host"), g_strdup ("my.host"));
  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  gchar *url = "/@localhost/another/test.html";
  const gchar *expected =  "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  g_hash_table_insert (tc->headers, g_strdup ("Accept-Language"), g_strdup ("pig, blah"));
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "60\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Inlay omehay irday</title>\n"
                           "</head>\n"
                           "<body>Inlay omehay irday</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");
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
  gconstpointer str;
  const gchar *url = "/@localhost/another/test.html";
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  g_hash_table_insert (tc->headers, g_strdup ("Cookie"), g_strdup ("CockpitLang=pig"));
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str, "*\r\n"
                           "60\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Inlay omehay irday</title>\n"
                           "</head>\n"
                           "<body>Inlay omehay irday</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  const gchar *url = "/cockpit/another@localhost/not-exist";
  const gchar *expected = "HTTP/1.1 404 Not Found\r\n"
    "Content-Type: text/html; charset=utf8\r\n"
    "Transfer-Encoding: chunked\r\n"
    STATIC_HEADERS
    "\r\n13\r\n"
    "<html><head><title>\r\n9\r\n"
    "Not Found\r\n15\r\n"
    "</title></head><body>\r\n9\r\n"
    "Not Found\r\nf\r\n"
    "</body></html>\n\r\n0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "another@localhost", "/not-exist");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str, "*\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n");

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
  gconstpointer str;
  const gchar *url = "/cockpit/another@localhost";
  const gchar *expected = "HTTP/1.1 404 Not Found\r\n"
    "Content-Type: text/html; charset=utf8\r\n"
    "Transfer-Encoding: chunked\r\n"
    STATIC_HEADERS
    "\r\n13\r\n"
    "<html><head><title>\r\n9\r\n"
    "Not Found\r\n15\r\n"
    "</title></head><body>\r\n9\r\n"
    "Not Found\r\nf\r\n"
    "</body></html>\n\r\n0\r\n\r\n";

  /* Missing path after package */
  response = cockpit_web_response_new (tc->io, url, url, NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "another@localhost", "");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str, "*\r\n13\r\n"
                           "<html><head><title>\r\n9\r\n"
                           "Not Found\r\n15\r\n"
                           "</title></head><body>\r\n9\r\n"
                           "Not Found\r\nf\r\n"
                           "</body></html>\n\r\n0\r\n\r\n");

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
  gconstpointer str;
  GPid pid;
  const gchar *expected = "HTTP/1.1 500 terminated\r\nContent-Type: text/html; charset=utf8\r\nTransfer-Encoding: chunked\r\n" STATIC_HEADERS "\r\n13\r\n<html><head><title>\r\na\r\nterminated\r\n15\r\n</title></head><body>\r\na\r\nterminated\r\nf\r\n</body></html>\n\r\n0\r\n\r\n";
  const gchar *expected_alt = "HTTP/1.1 502 disconnected\r\nContent-Type: text/html; charset=utf8\r\nTransfer-Encoding: chunked\r\n" STATIC_HEADERS "\r\n13\r\n<html><head><title>\r\nc\r\ndisconnected\r\n15\r\n</title></head><body>\r\nc\r\ndisconnected\r\nf\r\n</body></html>\n\r\n0\r\n\r\n";

  /* We need to skip this test under Valgrind because Valgrind doesn't
   * know about pidfd_open() yet.
   */
  if (cockpit_test_skip_slow ())
    return;

  cockpit_expect_possible_log ("cockpit-protocol", G_LOG_LEVEL_WARNING, "*: bridge program failed:*");
  cockpit_expect_possible_log ("cockpit-ws", G_LOG_LEVEL_MESSAGE, "*: external channel failed: *");

  /* Make a pidfd for the bridge */
  g_assert (cockpit_pipe_get_pid (tc->pipe, &pid));
  g_assert_cmpint (pid, >, 0);
  int pid_fd = syscall(SYS_pidfd_open, pid, 0);
  if (pid_fd < 0)
    {
      if (errno == ENOSYS)
	g_test_skip ("no pidfd_open support, skipping");
      else
        g_error ("pidfd_open call failed: %m");

      return;
    }

  /* Now kill the bridge */
  g_assert_cmpint (kill (pid, SIGTERM), ==, 0);

  /* The SIGTERM gets delivered to the bridge via a glib unix signal
   * handler, and it is theoretically possible that the request that we
   * send below could get delivered before the SIGTERM.  For that
   * reason, we need to make sure that the process actually properly
   * exited before sending the request.
   */
  struct pollfd pid_pfd = { .fd = pid_fd, .events = POLLIN };
  while (poll (&pid_pfd, 1, -1) != 1)
    ;
  close (pid_fd);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  /* Null terminate for str-match below */
  g_output_stream_write_all (G_OUTPUT_STREAM (tc->output), "\0", 1, NULL, NULL, &error);
  g_assert_no_error (error);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n") || str_contains_strv (str, expected_alt, "\n"));
  cockpit_assert_strmatch (str, "*\r\n\r\n13\r\n<html><head><title>\r\n*\r\n*\r\n15\r\n</title></head><body>\r\n*\r\n*\r\nf\r\n</body></html>\n\r\n0\r\n\r\n");

  g_bytes_unref (bytes);
  g_object_unref (response);
}

static const TestResourceFixture checksum_fixture = {
  .xdg_data_home = "/nonexistent"
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
  io = g_simple_io_stream_new (input, output);
  g_object_unref (input);

  /* Start the connection up, and poke it a bit */
  response = cockpit_web_response_new (io, "/unused", "/unused", NULL, "GET", NULL);
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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "ETag: \"" CHECKSUM "-c\"\r\n"
    "Access-Control-Allow-Origin: http://localhost\r\n"
    "Transfer-Encoding: chunked\r\n"
    "Cache-Control: max-age=86400, private\r\n"
    "Vary: Cookie\r\n"
    "\r\n"
    "32\r\n"
    "These are the contents of file.ext\nOh marmalaaade\n"
    "\r\n"
    "0\r\n\r\n";

  /* We require that no user packages are loaded, so we have a checksum */
  g_assert (data == &checksum_fixture);

  request_checksum (tc);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                CHECKSUM,
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  const gchar *expected = "HTTP/1.1 304 Not Modified\r\n"
    "ETag: \"" CHECKSUM "-c\"\r\n"
    STATIC_HEADERS
    "\r\n";

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"" CHECKSUM "-c\""));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", tc->headers, "GET", NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                CHECKSUM,
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  g_assert (str_contains_strv (g_bytes_get_data (bytes, NULL), expected, "\n"));

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "ETag: \"" CHECKSUM "-de\"\r\n"
    "Access-Control-Allow-Origin: http://localhost\r\n"
    "Transfer-Encoding: chunked\r\n"
    "Cache-Control: max-age=86400, private\r\n"
    "Vary: Cookie\r\n"
    "\r\n"
    "32\r\n"
    "These are the contents of file.ext\nOh marmalaaade\n"
    "\r\n"
    "0\r\n\r\n";

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"" CHECKSUM "-c\""));
  g_hash_table_insert (tc->headers, g_strdup ("Accept-Language"), g_strdup ("de"));

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", tc->headers, "GET", NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                CHECKSUM,
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  gchar *cookie;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "ETag: \"" CHECKSUM "-fr\"\r\n"
    "Access-Control-Allow-Origin: http://localhost\r\n"
    "Transfer-Encoding: chunked\r\n"
    "Cache-Control: max-age=86400, private\r\n"
    "Vary: Cookie\r\n"
    "\r\n"
    "32\r\n"
    "These are the contents of file.ext\nOh marmalaaade\n"
    "\r\n"
    "0\r\n\r\n";

  request_checksum (tc);

  g_hash_table_insert (tc->headers, g_strdup ("If-None-Match"),
                       g_strdup ("\"" CHECKSUM "-c\""));

  cookie = g_strdup_printf ("%s; CockpitLang=fr", (gchar *)g_hash_table_lookup (tc->headers, "Cookie"));
  g_hash_table_insert (tc->headers, g_strdup ("Cookie"), cookie);

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", tc->headers, "GET", NULL);
  cockpit_channel_response_serve (tc->service, tc->headers, response,
                                CHECKSUM,
                                "/test/sub/file.ext");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "32\r\n"
                           "These are the contents of file.ext\nOh marmalaaade\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 404 Not Found\r\n"
    "Content-Type: text/html; charset=utf8\r\n"
    "Transfer-Encoding: chunked\r\n"
    STATIC_HEADERS
    "\r\n13\r\n"
    "<html><head><title>\r\n9\r\n"
    "Not Found\r\n15\r\n"
    "</title></head><body>\r\n9\r\n"
    "Not Found\r\nf\r\n"
    "</body></html>\n\r\n0\r\n\r\n";

  /* Missing checksum */
  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "xxx", "/test");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n13\r\n*"
                           "*<html><head><title>\r\n9\r\n*"
                           "*Not Found\r\n15\r\n*"
                           "*</title></head><body>\r\n9\r\n*"
                           "*Not Found\r\nf\r\n*"
                           "*</body></html>\n\r\n0\r\n\r\n*");

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 404 Not Found\r\n"
    "Content-Type: text/html; charset=utf8\r\n"
    "Transfer-Encoding: chunked\r\n"
    STATIC_HEADERS
    "\r\n13\r\n"
    "<html><head><title>\r\n9\r\n"
    "Not Found\r\n15\r\n"
    "</title></head><body>\r\n9\r\n"
    "Not Found\r\nf\r\n"
    "</body></html>\n\r\n0\r\n\r\n";

  /* Missing checksum */
  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "09323094823029348", "/path");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n13\r\n*"
                           "*<html><head><title>\r\n9\r\n*"
                           "*Not Found\r\n15\r\n*"
                           "*</title></head><body>\r\n9\r\n*"
                           "*Not Found\r\nf\r\n*"
                           "*</body></html>\n\r\n0\r\n\r\n*");

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.de.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "62\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>Im Home-Verzeichnis</title>\n"
                           "</head>\n"
                           "<body>Im Home-Verzeichnis</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
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
    "0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);

  /* Language cookie overrides */
  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.fi.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "52\r\n"
                           "<html>\n"
                           "<head>\n"
                           "<title>In home dir</title>\n"
                           "</head>\n"
                           "<body>In home dir</body>\n"
                           "</html>\n"
                           "\r\n"
                           "0\r\n\r\n");

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
  gconstpointer str;
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
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
    "0\x0D\x0A\x0D\x0A";

  response = cockpit_web_response_new (tc->io, "/unused", "/unused", NULL, "GET", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test-file.txt");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "34\r\n"
                           "\x1F\x8B\x08\x08N1\x03U\x00\x03test-file.txt\x00sT(\xCEM\xCC\xC9Q(I-"
                           ".QH\xCB\xCCI\xE5\x02\x00>PjG\x12\x00\x00\x00\x0D\x0A"
                           "0\x0D\x0A\x0D\x0A");

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
  gconstpointer str;
  const gchar *url = "/@localhost/another/test.html";
  const gchar *expected = "HTTP/1.1 200 OK\r\n"
    STATIC_HEADERS
    "Content-Security-Policy: default-src 'self' http://localhost; connect-src 'self' http://localhost ws://localhost; form-action 'self' http://localhost; base-uri 'self' http://localhost; object-src 'none'; font-src 'self' http://localhost data:; img-src 'self' http://localhost data:; block-all-mixed-content\r\n"
    "Content-Type: text/html\r\n"
    "Cache-Control: no-cache, no-store\r\n"
    "Access-Control-Allow-Origin: http://localhost\r\n"
    "Transfer-Encoding: chunked\r\n"
    "Vary: Cookie\r\n"
    "\r\n"
    "0\r\n\r\n";

  response = cockpit_web_response_new (tc->io, url, url, NULL, "HEAD", NULL);

  cockpit_channel_response_serve (tc->service, tc->headers, response, "@localhost", "/another/test.html");

  while (cockpit_web_response_get_state (response) != COCKPIT_WEB_RESPONSE_SENT)
    g_main_context_iteration (NULL, TRUE);

  g_output_stream_close (G_OUTPUT_STREAM (tc->output), NULL, &error);
  g_assert_no_error (error);

  bytes = g_memory_output_stream_steal_as_bytes (tc->output);
  str = g_bytes_get_data (bytes, NULL);
  g_assert (str_contains_strv (str, expected, "\n"));
  cockpit_assert_strmatch (str,
                           "*\r\n"
                           "0\r\n\r\n");

  g_bytes_unref (bytes);
  g_object_unref (response);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  extern const gchar *cockpit_webresponse_fail_html_text;
  cockpit_webresponse_fail_html_text =
    "<html><head><title>@@message@@</title></head><body>@@message@@</body></html>\n";

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
