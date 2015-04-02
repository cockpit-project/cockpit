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
#include <glib/gi18n-lib.h>

#include <sys/types.h>
#include <sys/wait.h>

#include "block.h"
#include "job.h"
#include "udisksclient.h"

#define MAX_SAMPLES 100

typedef struct
{
  gint64 time_usec;
  gdouble value;
} Sample;

/**
 * SECTION:storagejob
 * @title: StorageJob
 * @short_description: Base class for jobs.
 *
 * This type provides common features needed by all job types.
 */

struct _StorageJobPrivate
{
  GCancellable *cancellable;

  gboolean auto_estimate;
  gulong notify_progress_signal_handler_id;

  Sample *samples;
  guint num_samples;
};

static void job_iface_init (UDisksJobIface *iface);

enum
{
  PROP_0,
  PROP_DAEMON,
  PROP_CANCELLABLE,
  PROP_AUTO_ESTIMATE,
};

G_DEFINE_ABSTRACT_TYPE_WITH_CODE (StorageJob, storage_job, UDISKS_TYPE_JOB_SKELETON,
                                  G_IMPLEMENT_INTERFACE (UDISKS_TYPE_JOB, job_iface_init)
);

static void
storage_job_finalize (GObject *object)
{
  StorageJob *self = STORAGE_JOB (object);

  g_free (self->priv->samples);

  if (self->priv->cancellable != NULL)
    {
      g_object_unref (self->priv->cancellable);
      self->priv->cancellable = NULL;
    }

  G_OBJECT_CLASS (storage_job_parent_class)->finalize (object);
}

static void
storage_job_get_property (GObject *object,
                          guint prop_id,
                          GValue *value,
                          GParamSpec *pspec)
{
  StorageJob *self = STORAGE_JOB (object);

  switch (prop_id)
    {
    case PROP_CANCELLABLE:
      g_value_set_object (value, self->priv->cancellable);
      break;

    case PROP_AUTO_ESTIMATE:
      g_value_set_boolean (value, self->priv->auto_estimate);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_job_set_property (GObject *object,
                          guint prop_id,
                          const GValue *value,
                          GParamSpec *pspec)
{
  StorageJob *self = STORAGE_JOB (object);

  switch (prop_id)
    {
    case PROP_CANCELLABLE:
      g_assert (self->priv->cancellable == NULL);
      self->priv->cancellable = g_value_dup_object (value);
      break;

    case PROP_AUTO_ESTIMATE:
      storage_job_set_auto_estimate (self, g_value_get_boolean (value));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_job_constructed (GObject *object)
{
  StorageJob *self = STORAGE_JOB (object);

  if (self->priv->cancellable == NULL)
    self->priv->cancellable = g_cancellable_new ();

  if (G_OBJECT_CLASS (storage_job_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_job_parent_class)->constructed (object);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_job_init (StorageJob *self)
{
  gint64 now_usec;

  self->priv = G_TYPE_INSTANCE_GET_PRIVATE (self, STORAGE_TYPE_JOB, StorageJobPrivate);

  now_usec = g_get_real_time ();
  udisks_job_set_start_time (UDISKS_JOB (self), now_usec);
}

static void
storage_job_class_init (StorageJobClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_job_finalize;
  gobject_class->constructed  = storage_job_constructed;
  gobject_class->set_property = storage_job_set_property;
  gobject_class->get_property = storage_job_get_property;

  /**
   * StorageJob:cancellable:
   *
   * The #GCancellable to use.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_CANCELLABLE,
                                   g_param_spec_object ("cancellable",
                                                        "Cancellable",
                                                        "The GCancellable to use",
                                                        G_TYPE_CANCELLABLE,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageJob:auto-estimate:
   *
   * If %TRUE, the #StorageJob:expected-end-time property will be
   * automatically updated every time the #StorageJob:progress property
   * is updated.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_AUTO_ESTIMATE,
                                   g_param_spec_boolean ("auto-estimate",
                                                         "Auto Estimate",
                                                         "Whether to automatically estimate end time",
                                                         FALSE,
                                                         G_PARAM_READABLE |
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_STATIC_STRINGS));

  g_type_class_add_private (klass, sizeof (StorageJobPrivate));
}

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_job_get_cancellable:
 * @self: A #StorageJob.
 *
 * Gets the #GCancellable for job.
 *
 * Returns: A #GCancellable. Do not free, the object belongs to job.
 */
GCancellable *
storage_job_get_cancellable (StorageJob *self)
{
  g_return_val_if_fail (STORAGE_IS_JOB (self), NULL);
  return self->priv->cancellable;
}

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_job_add_object:
 * @self: A #StorageJob.
 * @object: A #StorageObject.
 *
 * Adds the object path for @object to the <link
 * linkend="gdbus-property-org-freedesktop-UDisks2-Job.Objects">Objects</link>
 * array. If the object path is already in the array, does nothing.
 */
void
storage_job_add_thing (StorageJob *self,
                  gpointer object_or_interface)
{
  const gchar *object_path;
  const gchar *const *paths;
  const gchar **p;
  guint n;

  g_return_if_fail (STORAGE_IS_JOB (self));

  if (object_or_interface == NULL)
    return;
  else if (G_IS_DBUS_OBJECT (object_or_interface))
    object_path = g_dbus_object_get_object_path (object_or_interface);
  else if (G_IS_DBUS_INTERFACE_SKELETON (object_or_interface))
    object_path = g_dbus_interface_skeleton_get_object_path (object_or_interface);
  else if (STORAGE_IS_BLOCK (object_or_interface))
    object_path = storage_block_get_object_path (object_or_interface);
  else
    {
      g_critical ("Invalid interface or object passed to job: %s",
                  G_OBJECT_TYPE_NAME (object_or_interface));
      return;
    }

  paths = udisks_job_get_objects (UDISKS_JOB (self));
  for (n = 0; paths != NULL && paths[n] != NULL; n++)
    {
      if (g_strcmp0 (paths[n], object_path) == 0)
        goto out;
    }

  p = g_new0 (const gchar *, n + 2);
  p[n] = object_path;
  udisks_job_set_objects (UDISKS_JOB (self), p);
  g_free (p);

 out:
  ;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_cancel (UDisksJob *job,
               GDBusMethodInvocation *invocation,
               GVariant *options)
{
  StorageJob *self = STORAGE_JOB (job);

  if (!udisks_job_get_cancelable (job))
    {
      g_dbus_method_invocation_return_error (invocation,
                                             UDISKS_ERROR,
                                             UDISKS_ERROR_FAILED,
                                             "The job cannot be canceled");
      goto out;
    }

  if (g_cancellable_is_cancelled (self->priv->cancellable))
    {
      g_dbus_method_invocation_return_error (invocation,
                                             UDISKS_ERROR,
                                             UDISKS_ERROR_ALREADY_CANCELLED,
                                             "The job has already been cancelled");
    }
  else
    {
      g_cancellable_cancel (self->priv->cancellable);
      udisks_job_complete_cancel (job, invocation);
    }

 out:
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
job_iface_init (UDisksJobIface *iface)
{
  iface->handle_cancel   = handle_cancel;
}

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_job_get_auto_estimate:
 * @self: A #StorageJob.
 *
 * Gets whether auto-estimation is being used.
 *
 * Returns: %TRUE if auto-estimation is being used, %FALSE otherwise.
 */
gboolean
storage_job_get_auto_estimate (StorageJob *self)
{
  g_return_val_if_fail (STORAGE_IS_JOB (self), FALSE);
  return self->priv->auto_estimate;
}


static void
on_notify_progress (GObject     *object,
                    GParamSpec  *spec,
                    gpointer     user_data)
{
  StorageJob *self = STORAGE_JOB (user_data);
  Sample *sample;
  guint n;
  gdouble sum_of_speeds;
  guint num_speeds;
  gdouble avg_speed;
  gint64 usec_remaining;
  gint64 now;
  guint64 bytes;
  gdouble current_progress;

  now = g_get_real_time ();
  current_progress = udisks_job_get_progress (UDISKS_JOB (self));

  /* first add new sample... */
  if (self->priv->num_samples == MAX_SAMPLES)
    {
      memmove (self->priv->samples, self->priv->samples + 1, sizeof (Sample) * (MAX_SAMPLES - 1));
      self->priv->num_samples -= 1;
    }
  sample = &self->priv->samples[self->priv->num_samples++];
  sample->time_usec = now;
  sample->value = current_progress;

  /* ... then update expected-end-time from samples - we want at
   * least five samples before making an estimate...
   */
  if (self->priv->num_samples < 5)
    goto out;

  num_speeds = 0;
  sum_of_speeds = 0.0;
  for (n = 1; n < self->priv->num_samples; n++)
    {
      Sample *a = &self->priv->samples[n-1];
      Sample *b = &self->priv->samples[n];
      gdouble speed;
      speed = (b->value - a->value) / (b->time_usec - a->time_usec);
      sum_of_speeds += speed;
      num_speeds++;
    }
  avg_speed = sum_of_speeds / num_speeds;

  bytes = udisks_job_get_bytes (UDISKS_JOB (self));
  if (bytes > 0)
    {
      udisks_job_set_rate (UDISKS_JOB (self), bytes * avg_speed * G_USEC_PER_SEC);
    }
  else
    {
      udisks_job_set_rate (UDISKS_JOB (self), 0);
    }

  usec_remaining = (1.0 - current_progress) / avg_speed;
  udisks_job_set_expected_end_time (UDISKS_JOB (self), now + usec_remaining);

 out:
  ;
}

/**
 * storage_job_set_auto_estimate:
 * @self: A #StorageJob.
 * @value: %TRUE if auto-estimation is to be use, %FALSE otherwise.
 *
 * Sets whether auto-estimation is being used.
 */
void
storage_job_set_auto_estimate (StorageJob *self,
                               gboolean value)
{
  g_return_if_fail (STORAGE_IS_JOB (self));

  if (!!value == !!self->priv->auto_estimate)
    goto out;

  if (value)
    {
      if (self->priv->samples == NULL)
        self->priv->samples = g_new0 (Sample, MAX_SAMPLES);
      g_assert_cmpint (self->priv->notify_progress_signal_handler_id, ==, 0);
      self->priv->notify_progress_signal_handler_id = g_signal_connect (self,
                                                                        "notify::progress",
                                                                        G_CALLBACK (on_notify_progress),
                                                                        self);
      g_assert_cmpint (self->priv->notify_progress_signal_handler_id, !=, 0);
    }
  else
    {
      g_assert_cmpint (self->priv->notify_progress_signal_handler_id, !=, 0);
      g_signal_handler_disconnect (self, self->priv->notify_progress_signal_handler_id);
      self->priv->notify_progress_signal_handler_id = 0;
    }

  self->priv->auto_estimate = !!value;
  g_object_notify (G_OBJECT (self), "auto-estimate");

 out:
  ;
}
