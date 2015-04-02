/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <david@fubar.dk>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include "daemon.h"
#include "spawnedjob.h"
#include "threadedjob.h"

#include <sys/types.h>
#include <sys/wait.h>
#include <stdlib.h>
#include <string.h>

static GMainLoop *loop;
static GThread *main_thread;

/* ---------------------------------------------------------------------------------------------------- */

static void
on_completed_expect_success (UDisksJob *object,
                             gboolean success,
                             const gchar *message,
                             gpointer user_data)
{
  g_assert (g_thread_self () == main_thread);
  g_assert (success);
}

static void
on_completed_expect_failure (UDisksJob *object,
                             gboolean success,
                             const gchar *message,
                             gpointer user_data)
{
  const gchar *expected_message = user_data;
  gchar *e1, *e2, *msg;

  g_assert (g_thread_self () == main_thread);
  if (expected_message != NULL)
    {
      if (!g_pattern_match_simple (expected_message, message))
        {
          e1 = g_strescape (expected_message, NULL);
          e2 = g_strescape (message, NULL);
          msg = g_strdup_printf ("did not match: (\"%s\" ~= \"%s\")", e1, e2);
          g_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, msg);
          g_free (msg);
          g_free (e1);
          g_free (e2);
        }
    }
  g_assert (!success);
}

typedef struct
{
  GMainLoop *loop;
  gboolean   timed_out;
} SignalReceivedData;

static void
on_signal_received (gpointer user_data)
{
  SignalReceivedData *data = user_data;
  g_main_loop_quit (data->loop);
}

static gboolean
on_signal_received_timeout (gpointer user_data)
{
  SignalReceivedData *data = user_data;
  data->timed_out = TRUE;
  g_main_loop_quit (data->loop);
  return TRUE;
}

static gboolean
assert_signal_received_run (gpointer object,
                            const gchar *signal_name,
                            GCallback callback,
                            gpointer user_data)
{
  gulong handler_id;
  gulong caller_handler_id;
  guint timeout_id;
  SignalReceivedData data;

  data.loop = g_main_loop_new (g_main_context_get_thread_default (), FALSE);
  data.timed_out = FALSE;
  caller_handler_id = 0;
  if (callback != NULL)
    caller_handler_id = g_signal_connect (object,
                                          signal_name,
                                          G_CALLBACK (callback),
                                          user_data);
  handler_id = g_signal_connect_swapped (object,
                                         signal_name,
                                         G_CALLBACK (on_signal_received),
                                         &data);
  timeout_id = g_timeout_add (5 * 1000,
                              on_signal_received_timeout,
                              &data);
  g_main_loop_run (data.loop);
  g_signal_handler_disconnect (object, handler_id);
  if (caller_handler_id != 0)
    g_signal_handler_disconnect (object, caller_handler_id);
  g_source_remove (timeout_id);
  g_main_loop_unref (data.loop);

  return data.timed_out;
}

#define assert_signal_received(object, signal_name, callback, user_data) \
  do                                                                    \
    {                                                                   \
      if (!G_IS_OBJECT (object))                                        \
        {                                                               \
          g_assertion_message (G_LOG_DOMAIN,                            \
                               __FILE__,                                \
                               __LINE__,                                \
                               G_STRFUNC,                               \
                               "Not a GObject instance");               \
        }                                                               \
      if (g_signal_lookup (signal_name,                                 \
                           G_TYPE_FROM_INSTANCE (object)) == 0)         \
        {                                                               \
          g_assertion_message (G_LOG_DOMAIN,                            \
                               __FILE__,                                \
                               __LINE__,                                \
                               G_STRFUNC,                               \
                               "Signal '" signal_name "' does not "     \
                               "exist on object");                      \
        }                                                               \
      if (assert_signal_received_run (object, signal_name, callback, user_data)) \
        {                                                               \
          g_assertion_message (G_LOG_DOMAIN,                            \
                               __FILE__,                                \
                               __LINE__,                                \
                               G_STRFUNC,                               \
                               "Timed out waiting for signal '"         \
                               signal_name "'");                        \
        }                                                               \
    }                                                                   \
  while (FALSE)

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_successful (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { "/bin/true", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_success), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_failure (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { "/bin/false", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "/bin/false exited with non-zero exit status 1");
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_missing_program (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { "/path/to/unknown/file", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Error spawning command-line `/path/to/unknown/file': Failed to execute child process \"/path/to/unknown/file\" (No such file or directory) (g-exec-error-quark, 8)");
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_cancelled_at_start (void)
{
  StorageSpawnedJob *job;
  GCancellable *cancellable;
  const gchar *argv[] = { "/bin/true", NULL };

  cancellable = g_cancellable_new ();
  g_cancellable_cancel (cancellable);
  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), cancellable);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Operation was cancelled (g-io-error-quark, 19)");
  g_object_unref (job);
  g_object_unref (cancellable);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_timeout (gpointer user_data)
{
  GCancellable *cancellable = G_CANCELLABLE (user_data);
  g_cancellable_cancel (cancellable);
  g_main_loop_quit (loop);
  return FALSE;
}

static void
test_spawned_job_cancelled_midway (void)
{
  StorageSpawnedJob *job;
  GCancellable *cancellable;
  const gchar *argv[] = { "/bin/sleep 0.5", NULL };

  cancellable = g_cancellable_new ();
  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), cancellable);
  g_timeout_add (10, on_timeout, cancellable); /* 10 msec */
  g_main_loop_run (loop);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Operation was cancelled (g-io-error-quark, 19)");
  g_object_unref (job);
  g_object_unref (cancellable);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_spawned_job_completed (StorageSpawnedJob *job,
                          GError *error,
                          gint status,
                          GString *standard_output,
                          GString *standard_error,
                          gpointer user_data)
{
  gboolean *handler_ran = user_data;
  g_assert_error (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT);
  g_assert (!*handler_ran);
  *handler_ran = TRUE;
  return FALSE; /* allow other handlers to run (otherwise assert_signal_received() will not work) */
}

static void
test_spawned_job_override_signal_handler (void)
{
  StorageSpawnedJob *job;
  gboolean handler_ran;
  const gchar *argv[] = { "/path/to/unknown/file", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL /* GCancellable */);
  handler_ran = FALSE;
  g_signal_connect (job, "spawned-job-completed", G_CALLBACK (on_spawned_job_completed), &handler_ran);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Error spawning command-line `/path/to/unknown/file': Failed to execute child process \"/path/to/unknown/file\" (No such file or directory) (g-exec-error-quark, 8)");
  g_assert (handler_ran);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_premature_termination (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { "/bin/sleep", "1000", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL /* GCancellable */);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
read_stdout_on_spawned_job_completed (StorageSpawnedJob *job,
                                      GError *error,
                                      gint status,
                                      GString *standard_output,
                                      GString *standard_error,
                                      gpointer user_data)
{
  g_assert_no_error (error);
  g_assert_cmpstr (standard_output->str, ==,
                   "Hello Stdout\n"
                   "Line 2\n");
  g_assert_cmpstr (standard_error->str, ==, "");
  g_assert (WIFEXITED (status));
  g_assert (WEXITSTATUS (status) == 0);
  return FALSE;
}

static void
test_spawned_job_read_stdout (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { BUILDDIR "/frob-helper", "0", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (read_stdout_on_spawned_job_completed), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
read_stderr_on_spawned_job_completed (StorageSpawnedJob *job,
                                      GError *error,
                                      gint status,
                                      GString *standard_output,
                                      GString *standard_error,
                                      gpointer user_data)
{
  g_assert_no_error (error);
  g_assert_cmpstr (standard_output->str, ==, "");
  g_assert_cmpstr (standard_error->str, ==,
                   "Hello Stderr\n"
                   "Line 2\n");
  g_assert (WIFEXITED (status));
  g_assert (WEXITSTATUS (status) == 0);
  return FALSE;
}

static void
test_spawned_job_read_stderr (void)
{
  StorageSpawnedJob *job;
  const gchar *argv[] = { BUILDDIR "/frob-helper", "1", NULL };

  job = storage_spawned_job_new (argv, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (read_stderr_on_spawned_job_completed), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
exit_status_on_spawned_job_completed (StorageSpawnedJob *job,
                                      GError *error,
                                      gint status,
                                      GString *standard_output,
                                      GString *standard_error,
                                      gpointer user_data)
{
  g_assert_no_error (error);
  g_assert_cmpstr (standard_output->str, ==, "");
  g_assert_cmpstr (standard_error->str, ==, "");
  g_assert (WIFEXITED (status));
  g_assert (WEXITSTATUS (status) == GPOINTER_TO_INT (user_data));
  return FALSE;
}

static void
test_spawned_job_exit_status (void)
{
  StorageSpawnedJob *job;
  const gchar *argv2[] = { BUILDDIR "/frob-helper", "2", NULL };
  const gchar *argv3[] = { BUILDDIR "/frob-helper", "3", NULL };

  job = storage_spawned_job_new (argv2, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (exit_status_on_spawned_job_completed),
                          GINT_TO_POINTER (1));
  g_object_unref (job);

  job = storage_spawned_job_new (argv3, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (exit_status_on_spawned_job_completed),
                          GINT_TO_POINTER (2));
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_spawned_job_abnormal_termination (void)
{
  StorageSpawnedJob *job;
  const gchar *argv4[] = { BUILDDIR "/frob-helper", "4", NULL };
  const gchar *argv5[] = { BUILDDIR "/frob-helper", "5", NULL };

  job = storage_spawned_job_new (argv4, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) BUILDDIR "/frob-helper was signaled with signal *: "
                          "OK, deliberately causing a segfault\n");
  g_object_unref (job);

  job = storage_spawned_job_new (argv5, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                             (gpointer) BUILDDIR "/frob-helper was signaled with signal SIGABRT (6): "
                                 "OK, deliberately abort()'ing\n");
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
binary_output_on_spawned_job_completed (StorageSpawnedJob *job,
                                        GError *error,
                                        gint status,
                                        GString *standard_output,
                                        GString *standard_error,
                                        gpointer user_data)
{
  guint n;

  g_assert_no_error (error);
  g_assert_cmpstr (standard_error->str, ==, "");
  g_assert (WIFEXITED (status));
  g_assert (WEXITSTATUS (status) == 0);

  g_assert_cmpint (standard_output->len, ==, 200);
  for (n = 0; n < 100; n++)
    {
      g_assert_cmpint (standard_output->str[n*2+0], ==, n);
      g_assert_cmpint (standard_output->str[n*2+1], ==, 0);
    }
  return FALSE;
}

static void
test_spawned_job_binary_output (void)
{
  StorageSpawnedJob *job;
  const gchar *argv6[] = { BUILDDIR "/frob-helper", "6", NULL };

  job = storage_spawned_job_new (argv6, NULL, getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (binary_output_on_spawned_job_completed), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
input_string_on_spawned_job_completed (StorageSpawnedJob *job,
                                       GError *error,
                                       gint status,
                                       GString *standard_output,
                                       GString *standard_error,
                                       gpointer user_data)
{
  g_assert_no_error (error);
  g_assert_cmpstr (standard_error->str, ==, "");
  g_assert (WIFEXITED (status));
  g_assert (WEXITSTATUS (status) == 0);
  g_assert_cmpstr (standard_output->str, ==, "Woah, you said `foobar', partner!\n");
  return FALSE;
}

static void
test_spawned_job_input_string (void)
{
  StorageSpawnedJob *job;
  const gchar *argv7[] = { BUILDDIR "/frob-helper", "7", NULL };

  job = storage_spawned_job_new (argv7, "foobar", getuid (), geteuid (), NULL);
  assert_signal_received (job, "spawned-job-completed", G_CALLBACK (input_string_on_spawned_job_completed), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
threaded_job_successful_func (GCancellable *cancellable,
                              gpointer user_data,
                              GError **error)
{
  g_assert (g_thread_self () != main_thread);
  return TRUE;
}

static void
test_threaded_job_successful (void)
{
  StorageThreadedJob *job;

  job = storage_threaded_job_new (threaded_job_successful_func, NULL, NULL, NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_success), NULL);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
threaded_job_failure_func (GCancellable *cancellable,
                           gpointer user_data,
                           GError **error)
{
  g_assert (g_thread_self () != main_thread);
  g_set_error (error,
               G_KEY_FILE_ERROR,
               G_KEY_FILE_ERROR_INVALID_VALUE,
               "some error");
  return FALSE;
}

static void
test_threaded_job_failure (void)
{
  StorageThreadedJob *job;

  job = storage_threaded_job_new (threaded_job_failure_func, NULL, NULL, NULL);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Threaded job failed with error: some error (g-key-file-error-quark, 5)");
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
test_threaded_job_cancelled_at_start (void)
{
  StorageThreadedJob *job;
  GCancellable *cancellable;

  cancellable = g_cancellable_new ();
  g_cancellable_cancel (cancellable);
  job = storage_threaded_job_new (threaded_job_successful_func, NULL, NULL, cancellable);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Threaded job failed with error: Operation was cancelled (g-io-error-quark, 19)");
  g_object_unref (job);
  g_object_unref (cancellable);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
threaded_job_sleep_until_cancelled (GCancellable *cancellable,
                                    gpointer user_data,
                                    GError **error)
{
  gint *count = user_data;

  /* could probably do this a lot more elegantly... */
  while (TRUE)
    {
      *count += 1;
      if (g_cancellable_set_error_if_cancelled (cancellable, error))
        {
          break;
        }
      g_usleep (G_USEC_PER_SEC / 100);
    }
  return FALSE;
}

static void
test_threaded_job_cancelled_midway (void)
{
  StorageThreadedJob *job;
  GCancellable *cancellable;
  gint count;

  cancellable = g_cancellable_new ();
  count = 0;
  job = storage_threaded_job_new (threaded_job_sleep_until_cancelled, &count, NULL, cancellable);
  g_timeout_add (10, on_timeout, cancellable); /* 10 msec */
  g_main_loop_run (loop);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Threaded job failed with error: Operation was cancelled (g-io-error-quark, 19)");
  g_assert_cmpint (count, >, 0);
  g_object_unref (job);
  g_object_unref (cancellable);
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_threaded_job_completed (StorageThreadedJob  *job,
                           gboolean            result,
                           GError             *error,
                           gpointer            user_data)
{
  gboolean *handler_ran = user_data;
  g_assert (g_thread_self () == main_thread);
  g_assert (!result);
  g_assert_error (error, G_KEY_FILE_ERROR, G_KEY_FILE_ERROR_INVALID_VALUE);
  g_assert (!*handler_ran);
  *handler_ran = TRUE;
  return FALSE; /* allow other handlers to run (otherwise assert_signal_received() will not work) */
}

static void
test_threaded_job_override_signal_handler (void)
{
  StorageThreadedJob *job;
  gboolean handler_ran;

  job = storage_threaded_job_new (threaded_job_failure_func, NULL, NULL, NULL);
  handler_ran = FALSE;
  g_signal_connect (job, "threaded-job-completed", G_CALLBACK (on_threaded_job_completed), &handler_ran);
  assert_signal_received (job, "completed", G_CALLBACK (on_completed_expect_failure),
                          (gpointer) "Threaded job failed with error: some error (g-key-file-error-quark, 5)");
  g_assert (handler_ran);
  g_object_unref (job);
}

/* ---------------------------------------------------------------------------------------------------- */

int
main (int    argc,
      char **argv)
{
  int ret;

#if !GLIB_CHECK_VERSION(2,36,0)
  g_type_init ();
#endif

  g_test_init (&argc, &argv, NULL);

  loop = g_main_loop_new (NULL, FALSE);
  main_thread = g_thread_self ();

  g_test_add_func ("/storaged/spawned-job/successful", test_spawned_job_successful);
  g_test_add_func ("/storaged/spawned-job/failure", test_spawned_job_failure);
  g_test_add_func ("/storaged/spawned-job/missing-program", test_spawned_job_missing_program);
  g_test_add_func ("/storaged/spawned-job/cancelled-at-start", test_spawned_job_cancelled_at_start);
  g_test_add_func ("/storaged/spawned-job/cancelled-midway", test_spawned_job_cancelled_midway);
  g_test_add_func ("/storaged/spawned-job/override-signal-handler", test_spawned_job_override_signal_handler);
  g_test_add_func ("/storaged/spawned-job/premature-termination", test_spawned_job_premature_termination);
  g_test_add_func ("/storaged/spawned-job/read-stdout", test_spawned_job_read_stdout);
  g_test_add_func ("/storaged/spawned-job/read-stderr", test_spawned_job_read_stderr);
  g_test_add_func ("/storaged/spawned-job/exit-status", test_spawned_job_exit_status);
  g_test_add_func ("/storaged/spawned-job/abnormal-termination", test_spawned_job_abnormal_termination);
  g_test_add_func ("/storaged/spawned-job/binary-output", test_spawned_job_binary_output);
  g_test_add_func ("/storaged/spawned-job/input-string", test_spawned_job_input_string);
  g_test_add_func ("/storaged/threaded-job/successful", test_threaded_job_successful);
  g_test_add_func ("/storaged/threaded-job/failure", test_threaded_job_failure);
  g_test_add_func ("/storaged/threaded-job/cancelled-at-start", test_threaded_job_cancelled_at_start);
  g_test_add_func ("/storaged/threaded-job/cancelled-midway", test_threaded_job_cancelled_midway);
  g_test_add_func ("/storaged/threaded-job/override-signal-handler", test_threaded_job_override_signal_handler);

  ret = g_test_run();

  g_main_loop_unref (loop);
  return ret;
}
