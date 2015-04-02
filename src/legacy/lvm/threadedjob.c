/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
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

#include "job.h"
#include "threadedjob.h"

#include <glib/gi18n-lib.h>

#include <sys/types.h>
#include <sys/wait.h>

/**
 * SECTION:storagethreadedjob
 * @title: StorageThreadedJob
 * @short_description: Job that runs in a thread
 *
 * This type provides an implementation of the #UDisksJob interface
 * for jobs that run in a thread.
 */

typedef struct _StorageThreadedJobClass   StorageThreadedJobClass;

/**
 * StorageThreadedJob:
 *
 * The #StorageThreadedJob structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageThreadedJob
{
  StorageJob parent_instance;

  StorageJobFunc job_func;
  gpointer user_data;
  GDestroyNotify user_data_free_func;

  gboolean job_result;
  GError *job_error;
};

struct _StorageThreadedJobClass
{
  StorageJobClass parent_class;

  gboolean (* threaded_job_completed) (StorageThreadedJob *job,
                                       gboolean result,
                                       GError *error);
};

static void job_iface_init (UDisksJobIface *iface);

enum
{
  PROP_0,
  PROP_JOB_FUNC,
  PROP_USER_DATA,
  PROP_USER_DATA_FREE_FUNC
};

enum
{
  THREADED_JOB_COMPLETED_SIGNAL,
  LAST_SIGNAL
};

static gulong signals[LAST_SIGNAL] = { 0 };

static gboolean storage_threaded_job_threaded_job_completed_default (StorageThreadedJob *job,
                                                                     gboolean result,
                                                                     GError *error);

G_DEFINE_TYPE_WITH_CODE (StorageThreadedJob, storage_threaded_job, STORAGE_TYPE_JOB,
                         G_IMPLEMENT_INTERFACE (UDISKS_TYPE_JOB, job_iface_init)
);

static void
storage_threaded_job_finalize (GObject *object)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (object);

  if (job->job_error != NULL)
    g_error_free (job->job_error);

  if (job->user_data_free_func != NULL)
    job->user_data_free_func (job->user_data);

  G_OBJECT_CLASS (storage_threaded_job_parent_class)->finalize (object);
}

static void
storage_threaded_job_get_property (GObject *object,
                                   guint prop_id,
                                   GValue *value,
                                   GParamSpec *pspec)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (object);

  switch (prop_id)
    {
    case PROP_JOB_FUNC:
      g_value_set_pointer (value, job->job_func);
      break;

    case PROP_USER_DATA:
      g_value_set_pointer (value, job->user_data);
      break;

    case PROP_USER_DATA_FREE_FUNC:
      g_value_set_pointer (value, job->user_data_free_func);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_threaded_job_set_property (GObject *object,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (object);

  switch (prop_id)
    {
    case PROP_JOB_FUNC:
      g_assert (job->job_func == NULL);
      job->job_func = g_value_get_pointer (value);
      break;

    case PROP_USER_DATA:
      g_assert (job->user_data == NULL);
      job->user_data = g_value_get_pointer (value);
      break;

    case PROP_USER_DATA_FREE_FUNC:
      g_assert (job->user_data_free_func == NULL);
      job->user_data_free_func = g_value_get_pointer (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
job_complete (gpointer user_data)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (user_data);
  gboolean ret;

  /* take a reference so it's safe for a signal-handler to release the last one */
  g_object_ref (job);
  g_signal_emit (job,
                 signals[THREADED_JOB_COMPLETED_SIGNAL],
                 0,
                 job->job_result,
                 job->job_error,
                 &ret);
  g_object_unref (job);
  return FALSE;
}

static gboolean
run_io_scheduler_job (GIOSchedulerJob *io_scheduler_job,
                      GCancellable *cancellable,
                      gpointer user_data)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (user_data);

  /* TODO: probably want to create a GMainContext dedicated to the thread */

  g_assert (!job->job_result);
  g_assert_no_error (job->job_error);

  if (!g_cancellable_set_error_if_cancelled (cancellable, &job->job_error))
    {
      job->job_result = job->job_func (cancellable,
                                       job->user_data,
                                       &job->job_error);
    }

  g_io_scheduler_job_send_to_mainloop (io_scheduler_job,
                                       job_complete,
                                       job,
                                       NULL);

  return FALSE; /* job is complete (or cancelled) */
}

static void
storage_threaded_job_constructed (GObject *object)
{
  StorageThreadedJob *job = STORAGE_THREADED_JOB (object);

  if (G_OBJECT_CLASS (storage_threaded_job_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_threaded_job_parent_class)->constructed (object);

  g_assert (g_thread_supported ());
  g_io_scheduler_push_job (run_io_scheduler_job, job, NULL, G_PRIORITY_DEFAULT,
                           storage_job_get_cancellable (STORAGE_JOB (job)));
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_threaded_job_init (StorageThreadedJob *job)
{
}

static void
storage_threaded_job_class_init (StorageThreadedJobClass *klass)
{
  GObjectClass *gobject_class;

  klass->threaded_job_completed = storage_threaded_job_threaded_job_completed_default;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_threaded_job_finalize;
  gobject_class->constructed  = storage_threaded_job_constructed;
  gobject_class->set_property = storage_threaded_job_set_property;
  gobject_class->get_property = storage_threaded_job_get_property;

  /**
   * StorageThreadedJob:job-func:
   *
   * The #StorageThreadedJobFunc to use.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_JOB_FUNC,
                                   g_param_spec_pointer ("job-func",
                                                         "Job Function",
                                                         "The Job Function",
                                                         G_PARAM_READABLE |
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));

  /**
   * StorageThreadedJob:user-data:
   *
   * User data for the #StorageThreadedJobFunc.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_USER_DATA,
                                   g_param_spec_pointer ("user-data",
                                                         "Job Function's user data",
                                                         "The Job Function user data",
                                                         G_PARAM_READABLE |
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));

  /**
   * StorageThreadedJob:user-data-free-func:
   *
   * Free function for user data for the #StorageThreadedJobFunc.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_USER_DATA_FREE_FUNC,
                                   g_param_spec_pointer ("user-data-free-func",
                                                         "Job Function's user data free function",
                                                         "The Job Function user data free function",
                                                         G_PARAM_READABLE |
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));

  /**
   * StorageThreadedJob::threaded-job-completed:
   * @job: The #StorageThreadedJob emitting the signal.
   * @result: The #gboolean returned by the #StorageThreadedJobFunc.
   * @error: The #GError set by the #StorageThreadedJobFunc.
   *
   * Emitted when the threaded job is complete.
   *
   * The default implementation simply emits the #UDisksJob::completed
   * signal with @success set to %TRUE if, and only if, @error is
   * %NULL. Otherwise, @message on that signal is set to a string
   * describing @error. You can avoid the default implementation by
   * returning %TRUE from your signal handler.
   *
   * This signal is emitted in the
   * <link linkend="g-main-context-push-thread-default">thread-default main loop</link>
   * of the thread that @job was created in.
   *
   * Returns: %TRUE if the signal was handled, %FALSE to let other
   * handlers run.
   */
  signals[THREADED_JOB_COMPLETED_SIGNAL] =
    g_signal_new ("threaded-job-completed",
                  STORAGE_TYPE_THREADED_JOB,
                  G_SIGNAL_RUN_LAST,
                  G_STRUCT_OFFSET (StorageThreadedJobClass, threaded_job_completed),
                  g_signal_accumulator_true_handled,
                  NULL,
                  g_cclosure_marshal_generic,
                  G_TYPE_BOOLEAN,
                  2,
                  G_TYPE_BOOLEAN,
                  G_TYPE_ERROR);
}

/**
 * storage_threaded_job_new:
 * @job_func: The function to run in another thread.
 * @user_data: User data to pass to @job_func.
 * @user_data_free_func: Function to free @user_data with or %NULL.
 * @cancellable: A #GCancellable or %NULL.
 *
 * Creates a new #StorageThreadedJob instance.
 *
 * The job is started immediately - connect to the
 * #StorageThreadedJob::threaded-job-completed or #UDisksJob::completed
 * signals to get notified when the job is done.
 *
 * Returns: A new #StorageThreadedJob. Free with g_object_unref().
 */
StorageThreadedJob *
storage_threaded_job_new (StorageJobFunc job_func,
                          gpointer user_data,
                          GDestroyNotify user_data_free_func,
                          GCancellable *cancellable)
{
  g_return_val_if_fail (cancellable == NULL || G_IS_CANCELLABLE (cancellable), NULL);

  return g_object_new (STORAGE_TYPE_THREADED_JOB,
                       "job-func", job_func,
                       "user-data", user_data,
                       "user-data-free-func", user_data_free_func,
                       "cancellable", cancellable,
                       NULL);
}

/**
 * storage_threaded_job_get_user_data:
 * @job: A #StorageThreadedJob.
 *
 * Gets the @user_data parameter that @job was constructed with.
 *
 * Returns: A #gpointer owned by @job.
 */
gpointer
storage_threaded_job_get_user_data (StorageThreadedJob *job)
{
  g_return_val_if_fail (STORAGE_IS_THREADED_JOB (job), NULL);
  return job->user_data;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
job_iface_init (UDisksJobIface *iface)
{
  /* For Cancel(), just use the implementation from our super class (StorageBaseJob) */
  /* iface->handle_cancel   = handle_cancel; */
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
storage_threaded_job_threaded_job_completed_default (StorageThreadedJob *job,
                                                     gboolean result,
                                                     GError *error)
{
  if (result)
    {
      udisks_job_emit_completed (UDISKS_JOB (job), TRUE, "");
    }
  else
    {
      GString *message;

      g_assert (error != NULL);

      message = g_string_new (NULL);
      g_string_append_printf (message,
                              "Threaded job failed with error: %s (%s, %d)",
                              error->message,
                              g_quark_to_string (error->domain),
                              error->code);
      udisks_job_emit_completed (UDISKS_JOB (job),
                                 FALSE,
                                 message->str);
      g_string_free (message, TRUE);
    }

  return TRUE;
}
