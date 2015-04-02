/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
 * Copyright (C) 2013 Marius Vollmer <marius.vollmer@gmail.com>
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

#include "spawnedjob.h"

#include "job.h"
#include "util.h"

#include <glib/gi18n-lib.h>

#include <stdio.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <string.h>
#include <unistd.h>
#include <pwd.h>
#include <grp.h>
#include <stdlib.h>

/**
 * SECTION:storagespawnedjob
 * @title: StorageSpawnedJob
 * @short_description: Job that spawns a command
 *
 * This type provides an implementation of the #StorageJob interface
 * for jobs that are implemented by spawning a command line.
 */

typedef struct _StorageSpawnedJobClass   StorageSpawnedJobClass;

/**
 * StorageSpawnedJob:
 *
 * The #StorageSpawnedJob structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageSpawnedJob
{
  StorageJob parent_instance;

  gchar **argv;
  gulong cancellable_handler_id;

  GMainContext *main_context;

  gchar *input_string;
  uid_t run_as_uid;
  uid_t run_as_euid;
  const gchar *input_string_cursor;

  GPid child_pid;
  gint child_stdin_fd;
  gint child_stdout_fd;
  gint child_stderr_fd;

  GIOChannel *child_stdin_channel;
  GIOChannel *child_stdout_channel;
  GIOChannel *child_stderr_channel;

  GSource *child_watch_source;
  GSource *child_stdin_source;
  GSource *child_stdout_source;
  GSource *child_stderr_source;

  GString *child_stdout;
  GString *child_stderr;
};

struct _StorageSpawnedJobClass
{
  StorageJobClass parent_class;

  gboolean (*spawned_job_completed) (StorageSpawnedJob *self,
                                     GError *error,
                                     gint status,
                                     GString *standard_output,
                                     GString *standard_error);
};

static void job_iface_init (UDisksJobIface *iface);

enum
{
  PROP_0,
  PROP_ARGV,
  PROP_INPUT_STRING,
  PROP_RUN_AS_UID,
  PROP_RUN_AS_EUID
};

enum
{
  SPAWNED_JOB_COMPLETED_SIGNAL,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

static gboolean storage_spawned_job_completed_default (StorageSpawnedJob *self,
                                                       GError *error,
                                                       gint status,
                                                       GString *standard_output,
                                                       GString *standard_error);

static void storage_spawned_job_release_resources (StorageSpawnedJob *self);

G_DEFINE_TYPE_WITH_CODE (StorageSpawnedJob, storage_spawned_job, STORAGE_TYPE_JOB,
                         G_IMPLEMENT_INTERFACE (UDISKS_TYPE_JOB, job_iface_init)
);

static void
storage_spawned_job_finalize (GObject *object)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (object);

  storage_spawned_job_release_resources (self);

  if (self->main_context != NULL)
    g_main_context_unref (self->main_context);

  g_strfreev (self->argv);

  /* input string may contain key material - nuke contents */
  if (self->input_string != NULL)
    {
      memset (self->input_string, '\0', strlen (self->input_string));
      g_free (self->input_string);
    }

  G_OBJECT_CLASS (storage_spawned_job_parent_class)->finalize (object);
}

static void
storage_spawned_job_get_property (GObject *object,
                                  guint prop_id,
                                  GValue *value,
                                  GParamSpec *pspec)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (object);

  switch (prop_id)
    {
    case PROP_ARGV:
      g_value_set_boxed (value, storage_spawned_job_get_argv (self));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_spawned_job_set_property (GObject *object,
                                  guint prop_id,
                                  const GValue *value,
                                  GParamSpec *pspec)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (object);

  switch (prop_id)
    {
    case PROP_ARGV:
      g_assert (self->argv == NULL);
      self->argv = g_value_dup_boxed (value);
      break;

    case PROP_INPUT_STRING:
      g_assert (self->input_string == NULL);
      self->input_string = g_value_dup_string (value);
      break;

    case PROP_RUN_AS_UID:
      self->run_as_uid = g_value_get_uint (value);
      break;

    case PROP_RUN_AS_EUID:
      self->run_as_euid = g_value_get_uint (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct
{
  StorageSpawnedJob *job;
  GError *error;
} EmitCompletedData;

static gboolean
emit_completed_with_error_in_idle_cb (gpointer user_data)
{
  EmitCompletedData *data = user_data;
  gboolean ret;

  g_signal_emit (data->job,
                 signals[SPAWNED_JOB_COMPLETED_SIGNAL],
                 0,
                 data->error,
                 0,                        /* status */
                 data->job->child_stdout,  /* standard_output */
                 data->job->child_stderr,  /* standard_error */
                 &ret);
  g_object_unref (data->job);
  g_error_free (data->error);
  g_free (data);
  return FALSE;
}

static void
emit_completed_with_error_in_idle (StorageSpawnedJob *self,
                                   GError *error)
{
  EmitCompletedData *data;
  GSource *idle_source;

  g_return_if_fail (STORAGE_IS_SPAWNED_JOB (self));
  g_return_if_fail (error != NULL);

  data = g_new0 (EmitCompletedData, 1);
  data->job = g_object_ref (self);
  data->error = g_error_copy (error);
  idle_source = g_idle_source_new ();
  g_source_set_priority (idle_source, G_PRIORITY_DEFAULT);
  g_source_set_callback (idle_source,
                         emit_completed_with_error_in_idle_cb,
                         data,
                         NULL);
  g_source_attach (idle_source, self->main_context);
  g_source_unref (idle_source);
}

/* called in the thread where @cancellable was cancelled */
static void
on_cancelled (GCancellable *cancellable,
              gpointer      user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  GError *error;

  error = NULL;
  g_warn_if_fail (g_cancellable_set_error_if_cancelled (cancellable, &error));
  emit_completed_with_error_in_idle (self, error);
  g_error_free (error);
}

static gboolean
read_child_stderr (GIOChannel *channel,
                   GIOCondition condition,
                   gpointer user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  gchar buf[1024];
  gsize bytes_read;

  g_io_channel_read_chars (channel, buf, sizeof buf, &bytes_read, NULL);
  g_string_append_len (self->child_stderr, buf, bytes_read);
  return TRUE;
}

static gboolean
read_child_stdout (GIOChannel *channel,
                   GIOCondition condition,
                   gpointer user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  gchar buf[1024];
  gsize bytes_read;

  g_io_channel_read_chars (channel, buf, sizeof buf, &bytes_read, NULL);
  g_string_append_len (self->child_stdout, buf, bytes_read);
  return TRUE;
}

static gboolean
write_child_stdin (GIOChannel *channel,
                   GIOCondition condition,
                   gpointer user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  gsize bytes_written;

  if (self->input_string_cursor == NULL || *self->input_string_cursor == '\0')
    {
      /* nothing left to write; close our end so the child will get EOF */
      g_io_channel_unref (self->child_stdin_channel);
      g_source_destroy (self->child_stdin_source);
      g_warn_if_fail (close (self->child_stdin_fd) == 0);
      self->child_stdin_channel = NULL;
      self->child_stdin_source = NULL;
      self->child_stdin_fd = -1;
      return FALSE;
    }

  g_io_channel_write_chars (channel,
                            self->input_string_cursor,
                            strlen (self->input_string_cursor),
                            &bytes_written,
                            NULL);
  g_io_channel_flush (channel, NULL);
  self->input_string_cursor += bytes_written;

  /* keep writing */
  return TRUE;
}

static void
child_watch_cb (GPid     pid,
                gint     status,
                gpointer user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  gchar *buf;
  gsize buf_size;
  gboolean ret;

  if (g_io_channel_read_to_end (self->child_stdout_channel, &buf, &buf_size, NULL) == G_IO_STATUS_NORMAL)
    {
      g_string_append_len (self->child_stdout, buf, buf_size);
      g_free (buf);
    }
  if (g_io_channel_read_to_end (self->child_stderr_channel, &buf, &buf_size, NULL) == G_IO_STATUS_NORMAL)
    {
      g_string_append_len (self->child_stderr, buf, buf_size);
      g_free (buf);
    }

  /* take a reference so it's safe for a signal-handler to release the last one */
  g_object_ref (self);
  g_signal_emit (self,
                 signals[SPAWNED_JOB_COMPLETED_SIGNAL],
                 0,
                 NULL, /* GError */
                 status,
                 self->child_stdout,
                 self->child_stderr,
                 &ret);
  self->child_pid = 0;
  self->child_watch_source = NULL;
  storage_spawned_job_release_resources (self);
  g_object_unref (self);
}

/* careful, this is in the fork()'ed child so all utility threads etc are not available */
static void
child_setup (gpointer user_data)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (user_data);
  struct passwd *pw;
  gid_t egid;

  if (self->run_as_uid == getuid () && self->run_as_euid == geteuid ())
    goto out;

  pw = getpwuid (self->run_as_euid);
  if (pw == NULL)
   {
     g_printerr ("No password record for uid %d: %m\n", (gint) self->run_as_euid);
     abort ();
   }
  egid = pw->pw_gid;

  pw = getpwuid (self->run_as_uid);
  if (pw == NULL)
   {
     g_printerr ("No password record for uid %d: %m\n", (gint) self->run_as_uid);
     abort ();
   }

  /* become the user...
   *
   * TODO: this might need to involve running the whole PAM 'session'
   * stack as done by e.g. pkexec(1) and various login managers
   * otherwise things like the SELinux context might not be entirely
   * right. What we really need is some library function to
   * impersonate a pid or uid. What a mess.
   */
  if (setgroups (0, NULL) != 0)
    {
      g_printerr ("Error resetting groups: %m\n");
      abort ();
    }
  if (initgroups (pw->pw_name, pw->pw_gid) != 0)
    {
      g_printerr ("Error initializing groups for user %s and group %d: %m\n",
                  pw->pw_name, (gint) pw->pw_gid);
      abort ();
    }
  if (setregid (pw->pw_gid, egid) != 0)
    {
      g_printerr ("Error setting real+effective gid %d and %d: %m\n",
                  (gint) pw->pw_gid, (gint) egid);
      abort ();
    }
  if (setreuid (pw->pw_uid, self->run_as_euid) != 0)
    {
      g_printerr ("Error setting real+effective uid %d and %d: %m\n",
                  (gint) pw->pw_uid, (gint) self->run_as_euid);
      abort ();
    }

 out:
  ;
}

static void
storage_spawned_job_constructed (GObject *object)
{
  StorageSpawnedJob *self = STORAGE_SPAWNED_JOB (object);
  GError *error;
  gchar *cmd;

  G_OBJECT_CLASS (storage_spawned_job_parent_class)->constructed (object);

  cmd = g_strjoinv (" ", self->argv);
  g_debug ("spawned job: %s", cmd);

  self->main_context = g_main_context_get_thread_default ();
  if (self->main_context != NULL)
    g_main_context_ref (self->main_context);

  /* could already be cancelled */
  error = NULL;
  if (g_cancellable_set_error_if_cancelled (storage_job_get_cancellable (STORAGE_JOB (self)), &error))
    {
      emit_completed_with_error_in_idle (self, error);
      g_error_free (error);
      goto out;
    }

  self->cancellable_handler_id = g_cancellable_connect (storage_job_get_cancellable (STORAGE_JOB (self)),
                                                        G_CALLBACK (on_cancelled),
                                                        self,
                                                        NULL);

  error = NULL;
  if (!g_spawn_async_with_pipes (NULL, /* working directory */
                                 self->argv,
                                 NULL, /* envp */
                                 G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                                 child_setup, /* child_setup */
                                 self, /* child_setup's user_data */
                                 &(self->child_pid),
                                 self->input_string != NULL ? &(self->child_stdin_fd) : NULL,
                                 &(self->child_stdout_fd),
                                 &(self->child_stderr_fd),
                                 &error))
    {
      g_prefix_error (&error, "Error spawning command-line `%s': ", cmd);
      emit_completed_with_error_in_idle (self, error);
      g_error_free (error);
      goto out;
    }

  self->child_watch_source = g_child_watch_source_new (self->child_pid);
  g_source_set_callback (self->child_watch_source, (GSourceFunc) child_watch_cb, self, NULL);
  g_source_attach (self->child_watch_source, self->main_context);
  g_source_unref (self->child_watch_source);

  if (self->child_stdin_fd != -1)
    {
      self->input_string_cursor = self->input_string;

      self->child_stdin_channel = g_io_channel_unix_new (self->child_stdin_fd);
      g_io_channel_set_flags (self->child_stdin_channel, G_IO_FLAG_NONBLOCK, NULL);
      self->child_stdin_source = g_io_create_watch (self->child_stdin_channel, G_IO_OUT);
      g_source_set_callback (self->child_stdin_source, (GSourceFunc) write_child_stdin, self, NULL);
      g_source_attach (self->child_stdin_source, self->main_context);
      g_source_unref (self->child_stdin_source);
    }

  self->child_stdout_channel = g_io_channel_unix_new (self->child_stdout_fd);
  g_io_channel_set_flags (self->child_stdout_channel, G_IO_FLAG_NONBLOCK, NULL);
  self->child_stdout_source = g_io_create_watch (self->child_stdout_channel, G_IO_IN);
  g_source_set_callback (self->child_stdout_source, (GSourceFunc) read_child_stdout, self, NULL);
  g_source_attach (self->child_stdout_source, self->main_context);
  g_source_unref (self->child_stdout_source);

  self->child_stderr_channel = g_io_channel_unix_new (self->child_stderr_fd);
  g_io_channel_set_flags (self->child_stderr_channel, G_IO_FLAG_NONBLOCK, NULL);
  self->child_stderr_source = g_io_create_watch (self->child_stderr_channel, G_IO_IN);
  g_source_set_callback (self->child_stderr_source, (GSourceFunc) read_child_stderr, self, NULL);
  g_source_attach (self->child_stderr_source, self->main_context);
  g_source_unref (self->child_stderr_source);

out:
  g_free (cmd);
}

static void
storage_spawned_job_init (StorageSpawnedJob *self)
{
  self->child_stdout = g_string_new (NULL);
  self->child_stderr = g_string_new (NULL);
  self->child_stdin_fd = -1;
  self->child_stdout_fd = -1;
  self->child_stderr_fd = -1;
}

static void
storage_spawned_job_class_init (StorageSpawnedJobClass *klass)
{
  GObjectClass *gobject_class;

  klass->spawned_job_completed = storage_spawned_job_completed_default;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = storage_spawned_job_finalize;
  gobject_class->constructed = storage_spawned_job_constructed;
  gobject_class->set_property = storage_spawned_job_set_property;
  gobject_class->get_property = storage_spawned_job_get_property;

  /**
   * StorageSpawnedJob:argv:
   *
   * The command-line to run.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_ARGV,
                                   g_param_spec_boxed ("argv",
                                                       "Arguments",
                                                       "Argument vector",
                                                       G_TYPE_STRV,
                                                       G_PARAM_READABLE |
                                                       G_PARAM_WRITABLE |
                                                       G_PARAM_CONSTRUCT_ONLY |
                                                       G_PARAM_STATIC_STRINGS));

  /**
   * StorageSpawnedJob:input-string:
   *
   * String that will be written to stdin of the spawned program or
   * %NULL to not write anything.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_INPUT_STRING,
                                   g_param_spec_string ("input-string",
                                                        "Input String",
                                                        "String to write to stdin of the spawned program",
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageSpawnedJob:run-as-uid:
   *
   * The #uid_t to run the program as.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_RUN_AS_UID,
                                   g_param_spec_uint ("run-as-uid",
                                                      "Run As",
                                                      "The uid_t to run the program as",
                                                      0, G_MAXUINT, 0,
                                                      G_PARAM_WRITABLE |
                                                      G_PARAM_CONSTRUCT_ONLY |
                                                      G_PARAM_STATIC_STRINGS));

  /**
   * StorageSpawnedJob:run-as-euid:
   *
   * The effective #uid_t to run the program as.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_RUN_AS_EUID,
                                   g_param_spec_uint ("run-as-euid",
                                                      "Run As (effective)",
                                                      "The effective uid_t to run the program as",
                                                      0, G_MAXUINT, 0,
                                                      G_PARAM_WRITABLE |
                                                      G_PARAM_CONSTRUCT_ONLY |
                                                      G_PARAM_STATIC_STRINGS));

  /**
   * StorageSpawnedJob::spawned-job-completed:
   * @job: The #StorageSpawnedJob emitting the signal.
   * @error: %NULL if running the whole command line succeeded, otherwise a #GError that is set.
   * @status: The exit status of the command line that was run.
   * @standard_output: Standard output from the command line that was run.
   * @standard_error: Standard error output from the command line that was run.
   *
   * Emitted when the spawned job is complete. If spawning the command
   * failed or if the job was cancelled, @error will
   * non-%NULL. Otherwise you can use macros such as WIFEXITED() and
   * WEXITSTATUS() on the @status integer to obtain more information.
   *
   * The default implementation simply emits the #StorageJob::completed
   * signal with @success set to %TRUE if, and only if, @error is
   * %NULL, WIFEXITED() evaluates to %TRUE and WEXITSTATUS() is
   * zero. Additionally, @message on that signal is set to
   * @standard_error regards of whether @success is %TRUE or %FALSE.
   *
   * You can avoid the default implementation by returning %TRUE from
   * your signal handler.
   *
   * This signal is emitted in the
   * <link linkend="g-main-context-push-thread-default">thread-default main loop</link>
   * of the thread that @job was created in.
   *
   * Returns: %TRUE if the signal was handled, %FALSE to let other
   * handlers run.
   */
  signals[SPAWNED_JOB_COMPLETED_SIGNAL] =
    g_signal_new ("spawned-job-completed",
                  STORAGE_TYPE_SPAWNED_JOB,
                  G_SIGNAL_RUN_LAST,
                  G_STRUCT_OFFSET (StorageSpawnedJobClass, spawned_job_completed),
                  g_signal_accumulator_true_handled,
                  NULL,
                  g_cclosure_marshal_generic,
                  G_TYPE_BOOLEAN,
                  4,
                  G_TYPE_ERROR,
                  G_TYPE_INT,
                  G_TYPE_GSTRING,
                  G_TYPE_GSTRING);
}

/**
 * storage_spawned_job_new:
 * @argv: The command line to run.
 * @input_string: A string to write to stdin of the spawned program or %NULL.
 * @run_as_uid: The #uid_t to run the program as.
 * @run_as_euid: The effective #uid_t to run the program as.
 * @cancellable: A #GCancellable or %NULL.
 *
 * Creates a new #StorageSpawnedJob instance.
 *
 * The job is started immediately - connect to the
 * #StorageSpawnedJob::spawned-job-completed or #StorageJob::completed
 * signals to get notified when the job is done.
 *
 * Returns: A new #StorageSpawnedJob. Free with g_object_unref().
 */
StorageSpawnedJob *
storage_spawned_job_new (const gchar **argv,
                         const gchar *input_string,
                         uid_t run_as_uid,
                         uid_t run_as_euid,
                         GCancellable *cancellable)
{
  g_return_val_if_fail (argv != NULL, NULL);
  g_return_val_if_fail (cancellable == NULL || G_IS_CANCELLABLE (cancellable), NULL);

  return g_object_new (STORAGE_TYPE_SPAWNED_JOB,
                       "argv", argv,
                       "input-string", input_string,
                       "run-as-uid", run_as_uid,
                       "run-as-euid", run_as_euid,
                       "cancellable", cancellable,
                       NULL);
}

/**
 * udisks_spawned_job_get_argv:
 * @job: A #StorageSpawnedJob.
 *
 * Gets the command line that @job was constructed with.
 *
 * Returns: A string owned by @job. Do not free.
 */
const gchar **
storage_spawned_job_get_argv (StorageSpawnedJob *self)
{
  g_return_val_if_fail (STORAGE_IS_SPAWNED_JOB (self), NULL);
  return (const gchar **)self->argv;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
job_iface_init (UDisksJobIface *iface)
{
  /* For Cancel(), just use the implementation from our super class (StorageJob) */
  /* iface->handle_cancel   = handle_cancel; */
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
storage_spawned_job_completed_default (StorageSpawnedJob *self,
                                       GError *error,
                                       gint status,
                                       GString *standard_output,
                                       GString *standard_error)
{
  g_debug ("spawned job completed: "
           " status=%d (WIFEXITED=%d WEXITSTATUS=%d) "
           " standard_output=`%s' (%d bytes)\n"
           " standard_error=`%s' (%d bytes)\n",
           status,
           WIFEXITED (status), WEXITSTATUS (status),
           standard_output->str, (gint) standard_output->len,
           standard_error->str, (gint) standard_error->len);

  if (error != NULL)
    {
      gchar *message;
      message = g_strdup_printf ("%s (%s, %d)",
                                 error->message,
                                 g_quark_to_string (error->domain),
                                 error->code);
      udisks_job_emit_completed (UDISKS_JOB (self),
                                 FALSE,
                                 message);
      g_free (message);
    }
  else if (storage_util_check_status_and_output (self->argv[0],
                                            status,
                                            standard_error->str,
                                            standard_output->str,
                                            &error))
    {
      udisks_job_emit_completed (UDISKS_JOB (self),
                                 TRUE, standard_error->str);
    }
  else
    {
      udisks_job_emit_completed (UDISKS_JOB (self),
                                 FALSE, error->message);
      g_error_free (error);
    }

  return TRUE;
}

static void
child_watch_from_release_cb (GPid pid,
                             gint status,
                             gpointer user_data)
{
}

/* called when we're done running the command line */
static void
storage_spawned_job_release_resources (StorageSpawnedJob *self)
{
  /* Nuke the child, if necessary */
  if (self->child_watch_source != NULL)
    {
      g_source_destroy (self->child_watch_source);
      self->child_watch_source = NULL;
    }

  if (self->child_pid != 0)
    {
      GSource *source;

      g_debug ("ugh, need to kill %d", (gint) self->child_pid);
      kill (self->child_pid, SIGTERM);

      /* OK, we need to reap for the child ourselves - we don't want
       * to use waitpid() because that might block the calling
       * thread (the child might handle SIGTERM and use several
       * seconds for cleanup/rollback).
       *
       * So we use GChildWatch instead.
       *
       * Note that we might be called from the finalizer so avoid
       * taking references to ourselves. We do need to pass the
       * GSource so we can nuke it once handled.
       */
      source = g_child_watch_source_new (self->child_pid);
      g_source_set_callback (source,
                             (GSourceFunc) child_watch_from_release_cb,
                             source,
                             (GDestroyNotify) g_source_destroy);
      g_source_attach (source, self->main_context);
      g_source_unref (source);

      self->child_pid = 0;
    }

  if (self->child_stdout != NULL)
    {
      g_string_free (self->child_stdout, TRUE);
      self->child_stdout = NULL;
    }

  if (self->child_stderr != NULL)
    {
      g_string_free (self->child_stderr, TRUE);
      self->child_stderr = NULL;
    }

  if (self->child_stdin_channel != NULL)
    {
      g_io_channel_unref (self->child_stdin_channel);
      self->child_stdin_channel = NULL;
    }
  if (self->child_stdout_channel != NULL)
    {
      g_io_channel_unref (self->child_stdout_channel);
      self->child_stdout_channel = NULL;
    }
  if (self->child_stderr_channel != NULL)
    {
      g_io_channel_unref (self->child_stderr_channel);
      self->child_stderr_channel = NULL;
    }

  if (self->child_stdin_source != NULL)
    {
      g_source_destroy (self->child_stdin_source);
      self->child_stdin_source = NULL;
    }
  if (self->child_stdout_source != NULL)
    {
      g_source_destroy (self->child_stdout_source);
      self->child_stdout_source = NULL;
    }
  if (self->child_stderr_source != NULL)
    {
      g_source_destroy (self->child_stderr_source);
      self->child_stderr_source = NULL;
    }

  if (self->child_stdin_fd != -1)
    {
      g_warn_if_fail (close (self->child_stdin_fd) == 0);
      self->child_stdin_fd = -1;
    }
  if (self->child_stdout_fd != -1)
    {
      g_warn_if_fail (close (self->child_stdout_fd) == 0);
      self->child_stdout_fd = -1;
    }
  if (self->child_stderr_fd != -1)
    {
      g_warn_if_fail (close (self->child_stderr_fd) == 0);
      self->child_stderr_fd = -1;
    }

  if (self->cancellable_handler_id > 0)
    {
      g_cancellable_disconnect (storage_job_get_cancellable (STORAGE_JOB (self)),
                                self->cancellable_handler_id);
      self->cancellable_handler_id = 0;
    }
}
