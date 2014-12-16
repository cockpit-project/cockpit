/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#include "cockpitfsread.h"
#include "cockpitfswrite.h"
#include "cockpitfswatch.h"
#include "cockpitfsdir.h"
#include "mock-transport.h"

#include "common/cockpittest.h"
#include "common/cockpitjson.h"

#include <string.h>
#include <stdio.h>
#include <errno.h>
#include <sys/stat.h>

typedef struct {
  MockTransport *transport;
  CockpitChannel *channel;
  gchar *test_dir;
  gchar *test_path;
  gchar *test_path_2;
  gchar *problem;
  gboolean channel_closed;
} TestCase;

static void
on_channel_close (CockpitChannel *channel,
                  const gchar *problem,
                  gpointer user_data)
{
  TestCase *tc = user_data;
  g_assert (tc->channel_closed == FALSE);
  tc->channel_closed = TRUE;
}

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  g_assert_not_reached ();
}

static void
setup (TestCase *tc,
       gconstpointer data)
{
  tc->transport = mock_transport_new ();
  g_signal_connect (tc->transport, "closed", G_CALLBACK (on_transport_closed), NULL);
  tc->channel = NULL;

  tc->test_dir = g_dir_make_tmp (NULL, NULL);
  g_assert (tc->test_dir != NULL);
  tc->test_path = g_strdup_printf ("%s/%s", tc->test_dir, "foo");
  tc->test_path_2 = g_strdup_printf ("%s/%s", tc->test_dir, "bar");

  g_assert (unlink (tc->test_path) >= 0 || errno == ENOENT);
  g_assert (unlink (tc->test_path_2) >= 0 || errno == ENOENT);
}

static void
setup_fsread_channel (TestCase *tc,
                      const gchar *path)
{
  tc->channel = cockpit_fsread_open (COCKPIT_TRANSPORT (tc->transport), "1234", path);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
  cockpit_channel_prepare (tc->channel);
}

static void
setup_fswrite_channel (TestCase *tc,
                       const gchar *path,
                       const gchar *tag)
{
  tc->channel = cockpit_fswrite_open (COCKPIT_TRANSPORT (tc->transport), "1234", path, tag);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
  cockpit_channel_prepare (tc->channel);
}

static void
setup_fswatch_channel (TestCase *tc,
                       const gchar *path)
{
  tc->channel = cockpit_fswatch_open (COCKPIT_TRANSPORT (tc->transport), "1234", path);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
  cockpit_channel_prepare (tc->channel);
}

static void
setup_fsdir_channel (TestCase *tc,
                     const gchar *path)
{
  tc->channel = cockpit_fsdir_open (COCKPIT_TRANSPORT (tc->transport), "1234", path);
  tc->channel_closed = FALSE;
  g_signal_connect (tc->channel, "closed", G_CALLBACK (on_channel_close), tc);
}

static void
send_string (TestCase *tc,
             const gchar *str)
{
  GBytes *bytes = g_bytes_new_static (str, strlen (str));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), "1234", bytes);
  g_bytes_unref (bytes);
}

static void
send_done (TestCase *tc)
{
  const gchar *message = "{ \"command\": \"done\", \"channel\": \"1234\" }";
  GBytes *bytes = g_bytes_new_static (message, strlen (message));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), NULL, bytes);
  g_bytes_unref (bytes);
}

static GBytes *
recv_bytes (TestCase *tc)
{
  GBytes *msg;
  while ((msg = mock_transport_pop_channel (tc->transport, "1234")) == NULL)
    g_main_context_iteration (NULL, TRUE);
  return msg;
}

static JsonObject *
recv_json (TestCase *tc)
{
  GBytes *msg = recv_bytes (tc);
  JsonObject *res = cockpit_json_parse_bytes (msg, NULL);
  g_assert (res != NULL);
  return res;
}

static void
close_channel (TestCase *tc,
               const gchar *problem)
{
  cockpit_channel_close (tc->channel, problem);
}

static void
wait_channel_closed (TestCase *tc)
{
  while (tc->channel_closed == FALSE)
    g_main_context_iteration (NULL, TRUE);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  cockpit_assert_expected ();

  g_object_unref (tc->transport);

  if (tc->channel)
    {
      g_object_add_weak_pointer (G_OBJECT (tc->channel), (gpointer *)&tc->channel);
      g_object_unref (tc->channel);
      g_assert (tc->channel == NULL);
    }

  g_assert (unlink (tc->test_path) >= 0 || errno == ENOENT);
  g_assert (unlink (tc->test_path_2) >= 0 || errno == ENOENT);
  g_assert (rmdir (tc->test_dir) >= 0);

  g_free (tc->test_path);
  g_free (tc->test_path_2);
  g_free (tc->test_dir);

  g_free (tc->problem);
}

static GBytes *
combine_output (TestCase *tc,
                guint *count)
{
  GByteArray *combined;
  GBytes *block;

  if (count)
    *count = 0;

  combined = g_byte_array_new ();
  for (;;)
    {
      block = mock_transport_pop_channel (tc->transport, "1234");
      if (!block)
        break;

      g_byte_array_append (combined, g_bytes_get_data (block, NULL), g_bytes_get_size (block));
      if (count)
        (*count)++;
    }
  return g_byte_array_free_to_bytes (combined);
}

static void
assert_received (TestCase *tc,
                 const gchar *str)
{
  GBytes *data;

  data = combine_output (tc, NULL);
  cockpit_assert_bytes_eq (data, str, -1);
  g_bytes_unref (data);
}

static void
set_contents (const gchar *path,
              const gchar *str)
{
  g_assert (g_file_set_contents (path, str, -1, NULL));
}

static void
assert_contents (const gchar *path,
                 const gchar *str)
{
  gchar *contents;
  g_assert (g_file_get_contents (path, &contents, NULL, NULL));
  g_assert_cmpstr (contents, ==, str);
  g_free (contents);
}

static void
test_read_simple (TestCase *tc,
                  gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");
  tag = cockpit_get_file_tag (tc->test_path);

  setup_fsread_channel (tc, tc->test_path);
  wait_channel_closed (tc);

  assert_received (tc, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "done");

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_read_non_existent (TestCase *tc,
                        gconstpointer unused)
{
  JsonObject *control;

  setup_fsread_channel (tc, "/non/existent");
  wait_channel_closed (tc);

  assert_received (tc, "");

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, "-");
}

static void
test_read_denied (TestCase *tc,
                  gconstpointer unused)
{
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");
  g_assert (chmod (tc->test_path, 0) >= 0);

  setup_fsread_channel (tc, tc->test_path);
  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "not-authorized");
}

static void
test_read_changed (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");
  setup_fsread_channel (tc, tc->test_path);

  {
    sleep(1);
    FILE *f = fopen (tc->test_path, "w");
    g_assert (f != NULL);
    fputs ("Goodbye!", f);
    fclose (f);
  }

  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "done");

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "change-conflict");
}

static void
test_read_replaced (TestCase *tc,
                    gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");
  tag = cockpit_get_file_tag (tc->test_path);

  setup_fsread_channel (tc, tc->test_path);

  {
    FILE *f = fopen (tc->test_path_2, "w");
    g_assert (f != NULL);
    g_assert (fputs ("Goodbye!", f) != EOF);
    g_assert (fclose (f) != EOF);
    g_assert (rename (tc->test_path_2, tc->test_path) >= 0);
  }

  wait_channel_closed (tc);

  assert_received (tc, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "done");

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_read_removed (TestCase *tc,
                   gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");
  tag = cockpit_get_file_tag (tc->test_path);

  setup_fsread_channel (tc, tc->test_path);

  {
    g_assert (unlink (tc->test_path) >= 0);
  }

  wait_channel_closed (tc);

  assert_received (tc, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "command"), ==, "done");

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_simple (TestCase *tc,
                   gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  setup_fswrite_channel (tc, tc->test_path, NULL);
  send_string (tc, "Hello!");
  send_done (tc);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_multiple (TestCase *tc,
                     gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  setup_fswrite_channel (tc, tc->test_path, NULL);
  send_string (tc, "Hel");
  send_string (tc, "lo!");
  send_done (tc);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_remove (TestCase *tc,
                   gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Goodbye!");
  tag = cockpit_get_file_tag (tc->test_path);
  setup_fswrite_channel (tc, tc->test_path, tag);
  send_done (tc);
  close_channel (tc, NULL);
  g_free (tag);

  wait_channel_closed (tc);

  g_assert (g_file_test (tc->test_path, G_FILE_TEST_EXISTS) == FALSE);

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, "-");
}

static void
test_write_remove_nonexistent (TestCase *tc,
                               gconstpointer unused)
{
  JsonObject *control;

  g_assert (g_file_test (tc->test_path, G_FILE_TEST_EXISTS) == FALSE);

  setup_fswrite_channel (tc, tc->test_path, "-");
  send_done (tc);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  g_assert (g_file_test (tc->test_path, G_FILE_TEST_EXISTS) == FALSE);

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, "-");
}

static void
test_write_empty (TestCase *tc,
                  gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Goodbye!");
  tag = cockpit_get_file_tag (tc->test_path);
  setup_fswrite_channel (tc, tc->test_path, tag);
  send_string (tc, "");
  send_done (tc);
  close_channel (tc, NULL);
  g_free (tag);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_denied (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *control;

  g_assert (chmod (tc->test_dir, 0) >= 0);

  setup_fswrite_channel (tc, tc->test_path, NULL);
  send_string (tc, "Hello!");
  send_done (tc);
  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "not-authorized");

  g_assert (chmod (tc->test_dir, 0777) >= 0);
}

static void
test_write_expect_non_existent (TestCase *tc,
                                gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  setup_fswrite_channel (tc, tc->test_path, "-");
  send_string (tc, "Hello!");
  send_done (tc);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_expect_non_existent_fail (TestCase *tc,
                                     gconstpointer unused)
{
  JsonObject *control;

  set_contents (tc->test_path, "Goodbye!");

  setup_fswrite_channel (tc, tc->test_path, "-");
  send_string (tc, "Hello!");
  send_done (tc);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Goodbye!");

  control = mock_transport_pop_control (tc->transport);
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "change-conflict");
}

static void
test_write_expect_tag (TestCase *tc,
                       gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Goodbye!");
  tag = cockpit_get_file_tag (tc->test_path);
  setup_fswrite_channel (tc, tc->test_path, tag);
  send_string (tc, "Hello!");
  send_done (tc);
  close_channel (tc, NULL);
  g_free (tag);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Hello!");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert (json_object_get_member (control, "problem") == NULL);
  g_assert_cmpstr (json_object_get_string_member (control, "tag"), ==, tag);
  g_free (tag);
}

static void
test_write_expect_tag_fail (TestCase *tc,
                            gconstpointer unused)
{
  gchar *tag;
  JsonObject *control;

  set_contents (tc->test_path, "Goodbye!");
  tag = cockpit_get_file_tag (tc->test_path);
  setup_fswrite_channel (tc, tc->test_path, tag);
  send_string (tc, "Hello!");
  set_contents (tc->test_path, "Tschüss!");
  send_done (tc);
  close_channel (tc, NULL);
  g_free (tag);

  wait_channel_closed (tc);

  assert_contents (tc->test_path, "Tschüss!");

  control = mock_transport_pop_control (tc->transport);
  tag = cockpit_get_file_tag (tc->test_path);
  g_assert_cmpstr (json_object_get_string_member (control, "problem"), ==, "out-of-date");
  g_free (tag);
}

static void
test_watch_simple (TestCase *tc,
                   gconstpointer unused)
{
  gchar *tag;
  JsonObject *event;

  setup_fswatch_channel (tc, tc->test_path);

  set_contents (tc->test_path, "Wake up!");
  tag = cockpit_get_file_tag (tc->test_path);

  event = recv_json (tc);
  g_assert_cmpstr (json_object_get_string_member (event, "event"), ==, "created");
  g_assert_cmpstr (json_object_get_string_member (event, "path"), ==, tc->test_path);
  g_assert_cmpstr (json_object_get_string_member (event, "tag"), ==, tag);
  json_object_unref (event);
  g_free (tag);
}

static void
test_watch_remove (TestCase *tc,
                   gconstpointer unused)
{
  JsonObject *event;

  set_contents (tc->test_path, "Hello!");

  setup_fswatch_channel (tc, tc->test_path);

  g_assert (unlink (tc->test_path) >= 0);

  event = recv_json (tc);
  g_assert_cmpstr (json_object_get_string_member (event, "event"), ==, "deleted");
  g_assert_cmpstr (json_object_get_string_member (event, "path"), ==, tc->test_path);
  g_assert_cmpstr (json_object_get_string_member (event, "tag"), ==, "-");
  json_object_unref (event);
}

static void
test_watch_directory (TestCase *tc,
                      gconstpointer unused)
{
  JsonObject *event;

  setup_fswatch_channel (tc, tc->test_dir);

  set_contents (tc->test_path, "Hello!");
  g_assert (unlink (tc->test_path) >= 0);

  /* We want to see at least "created" and "deleted" for the path, in
     that order.
   */

  gboolean saw_created = FALSE;
  gboolean saw_deleted = FALSE;

  while (!(saw_created && saw_deleted) && !tc->channel_closed)
    {
      event = recv_json (tc);
      if (g_strcmp0 (json_object_get_string_member (event, "path"), tc->test_path) == 0)
        {
          if (g_strcmp0 (json_object_get_string_member (event, "event"), "created") == 0)
            {
              g_assert (!saw_deleted);
              saw_created = TRUE;
            }
          else if (g_strcmp0 (json_object_get_string_member (event, "event"), "deleted") == 0)
            {
              g_assert (saw_created);
              saw_deleted= TRUE;
            }
        }
      json_object_unref (event);
    }

  g_assert (saw_created && saw_deleted);
}

static void
test_dir_simple (TestCase *tc,
                 gconstpointer unused)
{
  JsonObject *event, *control;
  gchar *base = g_path_get_basename (tc->test_path);

  set_contents (tc->test_path, "Hello!");

  setup_fsdir_channel (tc, tc->test_dir);

  event = recv_json (tc);
  g_assert_cmpstr (json_object_get_string_member (event, "event"), ==, "present");
  g_assert_cmpstr (json_object_get_string_member (event, "path"), ==, base);
  json_object_unref (event);

  event = recv_json (tc);
  g_assert_cmpstr (json_object_get_string_member (event, "event"), ==, "present-done");
  json_object_unref (event);

  g_free (base);

  close_channel (tc, NULL);
  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
}

static void
test_dir_early_close (TestCase *tc,
                      gconstpointer unused)
{
  JsonObject *control;

  set_contents (tc->test_path, "Hello!");

  setup_fsdir_channel (tc, tc->test_dir);
  close_channel (tc, NULL);

  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
}

static void
test_dir_watch (TestCase *tc,
                gconstpointer unused)
{
  JsonObject *event, *control;

  setup_fsdir_channel (tc, tc->test_dir);

  event = recv_json (tc);
  g_assert_cmpstr (json_object_get_string_member (event, "event"), ==, "present-done");
  json_object_unref (event);

  set_contents (tc->test_path, "Hello!");
  g_assert (unlink (tc->test_path) >= 0);

  /* We want to see at least "created" and "deleted" for the path, in
     that order.
   */

  gboolean saw_created = FALSE;
  gboolean saw_deleted = FALSE;

  while (!(saw_created && saw_deleted) && !tc->channel_closed)
    {
      event = recv_json (tc);
      if (g_strcmp0 (json_object_get_string_member (event, "path"), tc->test_path) == 0)
        {
          if (g_strcmp0 (json_object_get_string_member (event, "event"), "created") == 0)
            {
              g_assert (!saw_deleted);
              saw_created = TRUE;
            }
          else if (g_strcmp0 (json_object_get_string_member (event, "event"), "deleted") == 0)
            {
              g_assert (saw_created);
              saw_deleted= TRUE;
            }
        }
      json_object_unref (event);
    }

  g_assert (saw_created && saw_deleted);

  close_channel (tc, NULL);
  wait_channel_closed (tc);

  control = mock_transport_pop_control (tc->transport);
  g_assert (json_object_get_member (control, "problem") == NULL);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/fsread/simple", TestCase, NULL,
              setup, test_read_simple, teardown);
  g_test_add ("/fsread/non-existent", TestCase, NULL,
              setup, test_read_non_existent, teardown);
  g_test_add ("/fsread/denied", TestCase, NULL,
              setup, test_read_denied, teardown);
  g_test_add ("/fsread/changed", TestCase, NULL,
              setup, test_read_changed, teardown);
  g_test_add ("/fsread/replaced", TestCase, NULL,
              setup, test_read_replaced, teardown);
  g_test_add ("/fsread/removed", TestCase, NULL,
              setup, test_read_removed, teardown);

  g_test_add ("/fswrite/simple", TestCase, NULL,
              setup, test_write_simple, teardown);
  g_test_add ("/fswrite/multiple", TestCase, NULL,
              setup, test_write_multiple, teardown);
  g_test_add ("/fswrite/remove", TestCase, NULL,
              setup, test_write_remove, teardown);
  g_test_add ("/fswrite/remove-nonexistent", TestCase, NULL,
              setup, test_write_remove_nonexistent, teardown);
  g_test_add ("/fswrite/empty", TestCase, NULL,
              setup, test_write_empty, teardown);
  g_test_add ("/fswrite/denied", TestCase, NULL,
              setup, test_write_denied, teardown);
  g_test_add ("/fswrite/expect-non-existent", TestCase, NULL,
              setup, test_write_expect_non_existent, teardown);
  g_test_add ("/fswrite/expect-non-existent-fail", TestCase, NULL,
              setup, test_write_expect_non_existent_fail, teardown);
  g_test_add ("/fswrite/expect-tag", TestCase, NULL,
              setup, test_write_expect_tag, teardown);
  g_test_add ("/fswrite/expect-tag-fail", TestCase, NULL,
              setup, test_write_expect_tag_fail, teardown);

  g_test_add ("/fswatch/simple", TestCase, NULL,
              setup, test_watch_simple, teardown);
  g_test_add ("/fswatch/remove", TestCase, NULL,
              setup, test_watch_remove, teardown);
  g_test_add ("/fswatch/directory", TestCase, NULL,
              setup, test_watch_directory, teardown);

  g_test_add ("/fsdir/simple", TestCase, NULL,
              setup, test_dir_simple, teardown);
  g_test_add ("/fsdir/early-close", TestCase, NULL,
              setup, test_dir_early_close, teardown);
  g_test_add ("/fsdir/watch", TestCase, NULL,
              setup, test_dir_watch, teardown);

  return g_test_run ();
}
