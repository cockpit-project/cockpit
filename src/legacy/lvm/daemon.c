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

#include "block.h"
#include "daemon.h"
#include "invocation.h"
#include "job.h"
#include "manager.h"
#include "spawnedjob.h"
#include "threadedjob.h"
#include "util.h"
#include "volumegroup.h"

#include <glib/gi18n-lib.h>

#include <polkit/polkit.h>

#include <pwd.h>
#include <stdio.h>

/**
 * SECTION:storaged-daemon
 * @title: StorageDaemon
 * @short_description: Main daemon object
 *
 * Object holding all global state.
 */

enum {
  PUBLISHED,
  FINISHED,
  NUM_SIGNALS
};

static guint signals[NUM_SIGNALS] = { 0, };

/* The only daemon that should be created is tracked here */
static StorageDaemon *default_daemon = NULL;

typedef struct _StorageDaemonClass   StorageDaemonClass;

/**
 * StorageDaemon:
 *
 * The #StorageDaemon structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageDaemon
{
  GObject parent_instance;
  GDBusConnection *connection;
  gint name_owner_id;
  GBusNameOwnerFlags name_flags;
  gboolean name_owned;
  guint num_clients;
  guint num_jobs;
  gboolean persist;

  GDBusObjectManagerServer *object_manager;
  StorageManager *manager;

  /* may be NULL if polkit is masked */
  PolkitAuthority *authority;

  /* The libdir if overridden */
  gchar *resource_dir;
};

struct _StorageDaemonClass
{
  GObjectClass parent_class;
};

enum
{
  PROP_0,
  PROP_CONNECTION,
  PROP_OBJECT_MANAGER,
  PROP_RESOURCE_DIR,
  PROP_REPLACE_NAME,
  PROP_PERSIST,
};

G_DEFINE_TYPE (StorageDaemon, storage_daemon, G_TYPE_OBJECT);

static void
storage_daemon_finalize (GObject *object)
{
  StorageDaemon *self = STORAGE_DAEMON (object);

  if (self->name_owner_id)
    g_bus_unown_name (self->name_owner_id);
  g_clear_object (&self->authority);
  g_object_unref (self->connection);
  g_object_unref (self->manager);
  g_object_unref (self->object_manager);
  g_free (self->resource_dir);

  storage_invocation_cleanup ();

  G_OBJECT_CLASS (storage_daemon_parent_class)->finalize (object);

  default_daemon = NULL;
}

static void
storage_daemon_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  StorageDaemon *self = STORAGE_DAEMON (object);

  switch (prop_id)
    {
    case PROP_OBJECT_MANAGER:
      g_value_set_object (value, self->object_manager);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_daemon_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  StorageDaemon *self = STORAGE_DAEMON (object);

  switch (prop_id)
    {
    case PROP_CONNECTION:
      g_assert (self->connection == NULL);
      self->connection = g_value_dup_object (value);
      break;

    case PROP_RESOURCE_DIR:
      g_assert (self->resource_dir == NULL);
      self->resource_dir = g_value_dup_string (value);
      break;

    case PROP_REPLACE_NAME:
      self->name_flags |= (g_value_get_boolean (value) ? G_BUS_NAME_OWNER_FLAGS_REPLACE : 0);
      break;

    case PROP_PERSIST:
      self->persist = g_value_get_boolean (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_daemon_init (StorageDaemon *self)
{
  g_assert (default_daemon == NULL);
  default_daemon = self;

  self->name_flags = G_BUS_NAME_OWNER_FLAGS_ALLOW_REPLACEMENT;
}

static void
maybe_finished (StorageDaemon *self)
{
  if (!self->persist && !self->name_owned &&
      self->num_clients == 0 && self->num_jobs == 0)
    {
      g_debug ("Daemon has finished");
      g_signal_emit (self, signals[FINISHED], 0);
    }
}

static void
on_name_lost (GDBusConnection *connection,
              const gchar *name,
              gpointer user_data)
{
  StorageDaemon *self = user_data;
  g_message ("Lost (or failed to acquire) the name %s on the system message bus", name);
  self->name_owned = FALSE;
  maybe_finished (self);
}

static void
on_name_acquired (GDBusConnection *connection,
                  const gchar *bus_name,
                  gpointer user_data)
{
  StorageDaemon *self = user_data;
  g_info ("Acquired the name %s on the system message bus", bus_name);
  self->name_owned = TRUE;
}

static void
on_client_appeared (const gchar *bus_name,
                    gpointer user_data)
{
  StorageDaemon *self = user_data;
  g_debug ("Saw new client: %s", bus_name);
  self->num_clients++;
}

static void
on_client_disappeared (const gchar *bus_name,
                       gpointer user_data)
{
  StorageDaemon *self = user_data;

  g_assert (self->num_clients > 0);
  self->num_clients--;

  if (self->num_clients > 0)
    {
      g_debug ("Client went away: %s", bus_name);
    }
  else
    {
      g_info ("Last client went away: %s", bus_name);

      /* When last client, force release of name */
      if (!self->persist && self->name_owner_id)
        {
          g_bus_unown_name (self->name_owner_id);
          self->name_owner_id = 0;
          self->name_owned = FALSE;
        }
    }

  maybe_finished (self);
}

static void
on_manager_ready (GObject *source,
                  GAsyncResult *res,
                  gpointer user_data)
{
  StorageDaemon *self = user_data;

  self->manager = storage_manager_new_finish (source, res);
  storage_daemon_publish (self, "/org/freedesktop/UDisks2/Manager", FALSE, self->manager);

  self->name_owner_id = g_bus_own_name_on_connection (self->connection,
                                                      "com.redhat.Cockpit.LVM",
                                                      self->name_flags,
                                                      on_name_acquired,
                                                      on_name_lost,
                                                      self,
                                                      NULL);
}

static void
storage_daemon_constructed (GObject *object)
{
  StorageDaemon *self = STORAGE_DAEMON (object);
  GError *error;

  G_OBJECT_CLASS (storage_daemon_parent_class)->constructed (object);

  storage_invocation_initialize (self->connection,
                            on_client_appeared,
                            on_client_disappeared,
                            self);

  error = NULL;
  self->authority = polkit_authority_get_sync (NULL, &error);
  if (self->authority == NULL)
    {
      g_warning ("Error initializing polkit authority: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
    }

  /* Yes, we use the same paths as the main udisks daemon on purpose */
  self->object_manager = g_dbus_object_manager_server_new ("/org/freedesktop/UDisks2");

  /* Export the ObjectManager */
  g_dbus_object_manager_server_set_connection (self->object_manager, self->connection);

  storage_manager_new_async (on_manager_ready, self);
}

static void
storage_daemon_class_init (StorageDaemonClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = storage_daemon_finalize;
  gobject_class->constructed = storage_daemon_constructed;
  gobject_class->set_property = storage_daemon_set_property;
  gobject_class->get_property = storage_daemon_get_property;

  /**
   * StorageDaemon:connection:
   *
   * The #GDBusConnection the daemon is for.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_CONNECTION,
                                   g_param_spec_object ("connection",
                                                        "Connection",
                                                        "The D-Bus connection the daemon is for",
                                                        G_TYPE_DBUS_CONNECTION,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageDaemon:object-manager:
   *
   * The #GDBusObjectManager used by the daemon
   */
  g_object_class_install_property (gobject_class,
                                   PROP_OBJECT_MANAGER,
                                   g_param_spec_object ("object-manager",
                                                        "Object Manager",
                                                        "The D-Bus Object Manager server used by the daemon",
                                                        G_TYPE_DBUS_OBJECT_MANAGER_SERVER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_RESOURCE_DIR,
                                   g_param_spec_string ("resource-dir",
                                                        "Resource Directory",
                                                        "Override directory to use resources from",
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_REPLACE_NAME,
                                   g_param_spec_boolean ("replace-name",
                                                         "Replace Name",
                                                         "Replace DBus service name",
                                                         FALSE,
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_PERSIST,
                                   g_param_spec_boolean ("persist",
                                                         "Persist",
                                                         "Don't stop daemon automatically",
                                                         FALSE,
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_CONSTRUCT_ONLY |
                                                         G_PARAM_STATIC_STRINGS));

  signals[PUBLISHED] = g_signal_new ("published",
                                     STORAGE_TYPE_DAEMON,
                                     G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                     0, NULL, NULL,
                                     g_cclosure_marshal_generic,
                                     G_TYPE_NONE, 1, G_TYPE_DBUS_OBJECT);

  signals[FINISHED] = g_signal_new ("finished",
                                     STORAGE_TYPE_DAEMON,
                                     G_SIGNAL_RUN_LAST,
                                     0, NULL, NULL,
                                     g_cclosure_marshal_generic,
                                     G_TYPE_NONE, 0);

}

StorageDaemon *
storage_daemon_get (void)
{
  g_assert (default_daemon != NULL);
  return default_daemon;
}

StorageManager *
storage_daemon_get_manager (StorageDaemon *self)
{
  g_return_val_if_fail (STORAGE_IS_DAEMON (self), NULL);
  return self->manager;
}

gchar *
storage_daemon_get_resource_path (StorageDaemon *self,
                                  gboolean arch_specific,
                                  const gchar *file)
{
  g_return_val_if_fail (STORAGE_IS_DAEMON (self), NULL);

  if (self->resource_dir)
      return g_build_filename (self->resource_dir, file, NULL);
  else if (arch_specific)
      return g_build_filename (PACKAGE_LIBEXEC_DIR, file, NULL);
  else
      return g_build_filename (DATADIR, "cockpit", file, NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_job_completed (UDisksJob *job,
                  gboolean success,
                  const gchar *message,
                  gpointer user_data)
{
  StorageDaemon *self = STORAGE_DAEMON (user_data);
  GDBusObject *object;

  object = g_dbus_interface_get_object (G_DBUS_INTERFACE (job));
  g_assert (object != NULL);

  /* Unexport job */
  g_dbus_object_manager_server_unexport (self->object_manager,
                                         g_dbus_object_get_object_path (object));

  /* free the allocated job object */
  g_object_unref (job);

  /* returns the reference we took when connecting to the
   * UDisksJob::completed signal in storage_daemon_launch_{spawned,threaded}_job()
   * below
   */
  g_object_unref (self);

  g_assert (self->num_jobs > 0);
  self->num_jobs--;
  maybe_finished (self);
}

/* ---------------------------------------------------------------------------------------------------- */

static guint job_id = 0;

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_daemon_launch_spawned_job:
 * @self: A #StorageDaemon.
 * @object: (allow-none): A #LvmObject to add to the job or %NULL.
 * @job_operation: The operation for the job.
 * @job_started_by_uid: The user who started the job.
 * @cancellable: A #GCancellable or %NULL.
 * @run_as_uid: The #uid_t to run the command as.
 * @run_as_euid: The effective #uid_t to run the command as.
 * @input_string: A string to write to stdin of the spawned program or %NULL.
 * @command_line_format: printf()-style format for the command line to spawn.
 * @...: Arguments for @command_line_format.
 *
 * Launches a new job for @command_line_format.
 *
 * The job is started immediately - connect to the
 * #UDisksSpawnedJob::spawned-job-completed or #UDisksJob::completed
 * signals to get notified when the job is done.
 *
 * The returned object will be exported on the bus until the
 * #UDisksJob::completed signal is emitted on the object. It is not
 * valid to use the returned object after this signal fires.
 *
 * Returns: A #UDisksSpawnedJob object. Do not free, the object
 * belongs to @manager.
 */
StorageJob *
storage_daemon_launch_spawned_job (StorageDaemon *self,
                                   gpointer object_or_interface,
                                   const gchar *job_operation,
                                   uid_t job_started_by_uid,
                                   GCancellable *cancellable,
                                   uid_t run_as_uid,
                                   uid_t run_as_euid,
                                   const gchar *input_string,
                                   const gchar *first_arg,
                                   ...)
{
  GPtrArray *args;
  StorageJob *job;
  va_list var_args;

  g_return_val_if_fail (STORAGE_IS_DAEMON (self), NULL);
  g_return_val_if_fail (cancellable == NULL || G_IS_CANCELLABLE (cancellable), NULL);
  g_return_val_if_fail (first_arg != NULL, NULL);

  args = g_ptr_array_new ();
  va_start (var_args, first_arg);
  while (first_arg != NULL)
    {
      g_ptr_array_add (args, g_strdup (first_arg));
      first_arg = va_arg (var_args, gchar *);
    }
  va_end (var_args);
  g_ptr_array_add (args, NULL);

  job = storage_daemon_launch_spawned_jobv (self, object_or_interface, job_operation,
                                            job_started_by_uid, cancellable, run_as_uid,
                                            run_as_euid, input_string,
                                            (const gchar **)args->pdata);

  g_ptr_array_free (args, TRUE);

  return job;
}

StorageJob *
storage_daemon_launch_spawned_jobv (StorageDaemon *self,
                                    gpointer object_or_interface,
                                    const gchar *job_operation,
                                    uid_t job_started_by_uid,
                                    GCancellable *cancellable,
                                    uid_t run_as_uid,
                                    uid_t run_as_euid,
                                    const gchar *input_string,
                                    const gchar **argv)
{
  StorageSpawnedJob *job;
  GDBusObjectSkeleton *job_object;
  gchar *job_object_path;

  g_return_val_if_fail (STORAGE_IS_DAEMON (self), NULL);
  g_return_val_if_fail (cancellable == NULL || G_IS_CANCELLABLE (cancellable), NULL);

  job = storage_spawned_job_new (argv, input_string,
                                 run_as_uid, run_as_euid, cancellable);

  if (object_or_interface != NULL)
    storage_job_add_thing (STORAGE_JOB (job), object_or_interface);

  /* TODO: protect job_id by a mutex */
  job_object_path = g_strdup_printf ("/org/freedesktop/UDisks2/jobs/%d", job_id++);
  job_object = g_dbus_object_skeleton_new (job_object_path);
  g_dbus_object_skeleton_add_interface (job_object, G_DBUS_INTERFACE_SKELETON (job));
  g_free (job_object_path);

  udisks_job_set_cancelable (UDISKS_JOB (job), TRUE);
  udisks_job_set_operation (UDISKS_JOB (job), job_operation);
  udisks_job_set_started_by_uid (UDISKS_JOB (job), job_started_by_uid);

  g_dbus_object_manager_server_export (self->object_manager, G_DBUS_OBJECT_SKELETON (job_object));

  self->num_jobs++;
  g_signal_connect_after (job,
                          "completed",
                          G_CALLBACK (on_job_completed),
                          g_object_ref (self));

  g_object_unref (job_object);
  return STORAGE_JOB (job);
}

/**
 * storage_daemon_launch_threaded_job:
 * @daemon: A #StorageDaemon.
 * @object: (allow-none): An object to add to the job or %NULL.
 * @job_operation: The operation for the job.
 * @job_started_by_uid: The user who started the job.
 * @job_func: The function to run in another thread.
 * @user_data: User data to pass to @job_func.
 * @user_data_free_func: Function to free @user_data with or %NULL.
 * @cancellable: A #GCancellable or %NULL.
 *
 * Launches a new job by running @job_func in a new dedicated thread.
 *
 * The job is started immediately - connect to the
 * #StorageThreadedJob::threaded-job-completed or #StorageJob::completed
 * signals to get notified when the job is done.
 *
 * Long-running jobs should periodically check @cancellable to see if
 * they have been cancelled.
 *
 * The returned object will be exported on the bus until the
 * #StorageJob::completed signal is emitted on the object. It is not
 * valid to use the returned object after this signal fires.
 *
 * Returns: A #StorageThreadedJob object. Do not free, the object
 * belongs to @manager.
 */
StorageJob *
storage_daemon_launch_threaded_job  (StorageDaemon *daemon,
                                     gpointer object_or_interface,
                                     const gchar *job_operation,
                                     uid_t job_started_by_uid,
                                     StorageJobFunc job_func,
                                     gpointer user_data,
                                     GDestroyNotify user_data_free_func,
                                     GCancellable *cancellable)
{
  StorageThreadedJob *job;
  GDBusObjectSkeleton *job_object;
  gchar *job_object_path;

  g_return_val_if_fail (STORAGE_IS_DAEMON (daemon), NULL);
  g_return_val_if_fail (job_func != NULL, NULL);

  job = storage_threaded_job_new (job_func,
                             user_data,
                             user_data_free_func,
                             cancellable);
  if (object_or_interface != NULL)
    storage_job_add_thing (STORAGE_JOB (job), object_or_interface);

  /* TODO: protect job_id by a mutex */
  job_object_path = g_strdup_printf ("/org/freedesktop/UDisks2/jobs/%d", job_id++);
  job_object = g_dbus_object_skeleton_new (job_object_path);
  g_dbus_object_skeleton_add_interface (job_object, G_DBUS_INTERFACE_SKELETON (job));
  g_free (job_object_path);

  udisks_job_set_cancelable (UDISKS_JOB (job), TRUE);
  udisks_job_set_operation (UDISKS_JOB (job), job_operation);
  udisks_job_set_started_by_uid (UDISKS_JOB (job), job_started_by_uid);

  g_dbus_object_manager_server_export (daemon->object_manager, G_DBUS_OBJECT_SKELETON (job_object));

  daemon->num_jobs++;
  g_signal_connect_after (job,
                          "completed",
                          G_CALLBACK (on_job_completed),
                          g_object_ref (daemon));

  g_object_unref (job_object);
  return STORAGE_JOB (job);
}

gpointer
storage_daemon_find_thing (StorageDaemon *daemon,
                           const gchar *object_path,
                           GType type_of_thing)
{
  GDBusObject *object;
  GList *interfaces, *l;
  gpointer ret = NULL;

  object = g_dbus_object_manager_get_object (G_DBUS_OBJECT_MANAGER (daemon->object_manager), object_path);
  if (object == NULL ||
      type_of_thing == G_TYPE_INVALID ||
      G_TYPE_CHECK_INSTANCE_TYPE (object, type_of_thing))
    {
      return object;
    }

  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; ret == NULL && l != NULL; l = g_list_next (l))
    {
      if (G_TYPE_CHECK_INSTANCE_TYPE (l->data, type_of_thing))
        ret = g_object_ref (l->data);
    }

  g_list_free_full (interfaces, g_object_unref);
  g_object_unref (object);
  return ret;
}

GList *
storage_daemon_get_jobs (StorageDaemon *self)
{
  GList *objects, *l;
  GList *jobs = NULL;

  objects = g_dbus_object_manager_get_objects (G_DBUS_OBJECT_MANAGER (self->object_manager));
  for (l = objects; l != NULL; l = g_list_next (l))
    {
      StorageJob *job = STORAGE_JOB (g_dbus_object_get_interface (l->data, "org.freedesktop.UDisks2.Job"));
      if (job)
        jobs = g_list_prepend (jobs, job);
    }
  g_list_free_full (objects, g_object_unref);

  return jobs;
}

struct VariantReaderData {
  const GVariantType *type;
  void (*callback) (GPid pid, GVariant *result, GError *error, gpointer user_data);
  gpointer user_data;
  GPid pid;
  GIOChannel *output_channel;
  GByteArray *output;
  gint output_watch;
};

static gboolean
variant_reader_child_output (GIOChannel *source,
                             GIOCondition condition,
                             gpointer user_data)
{
  struct VariantReaderData *data = user_data;
  guint8 buf[1024];
  gsize bytes_read;

  g_io_channel_read_chars (source, (gchar *)buf, sizeof buf, &bytes_read, NULL);
  g_byte_array_append (data->output, buf, bytes_read);
  return TRUE;
}

static void
variant_reader_watch_child (GPid     pid,
                            gint     status,
                            gpointer user_data)
{
  struct VariantReaderData *data = user_data;
  guint8 *buf;
  gsize buf_size;
  GVariant *result;
  GError *error = NULL;

  data->pid = 0;

  if (!g_spawn_check_exit_status (status, &error))
    {
      data->callback (pid, NULL, error, data->user_data);
      g_error_free (error);
      g_byte_array_free (data->output, TRUE);
    }
  else
    {
      if (g_io_channel_read_to_end (data->output_channel, (gchar **)&buf, &buf_size, NULL) == G_IO_STATUS_NORMAL)
        {
          g_byte_array_append (data->output, buf, buf_size);
          g_free (buf);
        }

      result = g_variant_new_from_data (data->type,
                                        data->output->data,
                                        data->output->len,
                                        TRUE,
                                        g_free, NULL);
      g_byte_array_free (data->output, FALSE);
      data->callback (pid, result, NULL, data->user_data);
      g_variant_unref (result);
    }
}

static void
variant_reader_destroy (gpointer user_data)
{
  struct VariantReaderData *data = user_data;

  g_source_remove (data->output_watch);
  g_io_channel_unref (data->output_channel);
  g_free (data);
}

GPid
storage_daemon_spawn_for_variant (StorageDaemon *daemon,
                                  const gchar **argv,
                                  const GVariantType *type,
                                  void (*callback) (GPid, GVariant *, GError *, gpointer),
                                  gpointer user_data)
{
  GError *error = NULL;
  struct VariantReaderData *data;
  gchar *prog = NULL;
  GPid pid;
  gint output_fd;
  gchar *cmd;

  /*
   * This is so we can override the location of cockpit-lvm-helper
   * during testing.
   */

  if (!strchr (argv[0], '/'))
    {
      prog = storage_daemon_get_resource_path (daemon, TRUE, argv[0]);
      argv[0] = prog;
    }

  cmd = g_strjoinv (" ", (gchar **)argv);
  g_debug ("spawning for variant: %s", cmd);
  g_free (cmd);

  if (!g_spawn_async_with_pipes (NULL,
                                 (gchar **)argv,
                                 NULL,
                                 G_SPAWN_DO_NOT_REAP_CHILD,
                                 NULL,
                                 NULL,
                                 &pid,
                                 NULL,
                                 &output_fd,
                                 NULL,
                                 &error))
    {
      callback (0, NULL, error, user_data);
      g_error_free (error);
      return 0;
    }

  data = g_new0 (struct VariantReaderData, 1);

  data->type = type;
  data->callback = callback;
  data->user_data = user_data;

  data->pid = pid;
  data->output = g_byte_array_new ();
  data->output_channel = g_io_channel_unix_new (output_fd);
  g_io_channel_set_encoding (data->output_channel, NULL, NULL);
  g_io_channel_set_flags (data->output_channel, G_IO_FLAG_NONBLOCK, NULL);
  data->output_watch = g_io_add_watch (data->output_channel, G_IO_IN, variant_reader_child_output, data);

  g_child_watch_add_full (G_PRIORITY_DEFAULT_IDLE,
                          pid, variant_reader_watch_child, data, variant_reader_destroy);

  g_free (prog);
  return pid;
}

void
storage_daemon_publish (StorageDaemon *self,
                        const gchar *path,
                        gboolean uniquely,
                        gpointer thing)
{
  GDBusInterface *prev;
  GDBusInterfaceInfo *info;
  GDBusObjectSkeleton *object;
  GQuark detail;

  g_return_if_fail (STORAGE_IS_DAEMON (self));
  g_return_if_fail (path != NULL);

  if (G_IS_DBUS_INTERFACE (thing))
    {
      g_debug ("%spublishing iface: %s %s", uniquely ? "uniquely " : "", path,
               g_dbus_interface_get_info(thing)->name);

      object = G_DBUS_OBJECT_SKELETON (g_dbus_object_manager_get_object (G_DBUS_OBJECT_MANAGER (self->object_manager), path));
      if (object != NULL)
        {
          if (uniquely)
            {
              info = g_dbus_interface_get_info (thing);
              prev = g_dbus_object_get_interface (G_DBUS_OBJECT (object), info->name);
              if (prev)
                {
                  g_object_unref (prev);
                  g_object_unref (object);
                  object = NULL;
                }
            }
        }

      if (object == NULL)
          object = g_dbus_object_skeleton_new (path);

      g_dbus_object_skeleton_add_interface (object, thing);
    }
  else
    {
      g_critical ("Unsupported type to publish: %s", G_OBJECT_TYPE_NAME (thing));
      return;
    }

  if (uniquely)
    g_dbus_object_manager_server_export_uniquely (self->object_manager, object);
  else
    g_dbus_object_manager_server_export (self->object_manager, object);

  detail = g_quark_from_static_string (G_OBJECT_TYPE_NAME (thing));
  g_signal_emit (self, signals[PUBLISHED], detail, thing);

  g_object_unref (object);
}

void
storage_daemon_unpublish (StorageDaemon *self,
                          const gchar *path,
                          gpointer thing)
{
  GDBusObject *object;
  gboolean unexport = FALSE;
  GList *interfaces, *l;

  g_return_if_fail (STORAGE_IS_DAEMON (self));
  g_return_if_fail (path != NULL);

  object = g_dbus_object_manager_get_object (G_DBUS_OBJECT_MANAGER (self->object_manager), path);
  if (object == NULL)
    return;

  path = g_dbus_object_get_object_path (G_DBUS_OBJECT (object));

  if (G_IS_DBUS_INTERFACE (thing))
    {
      g_debug ("unpublishing interface: %s %s", path,
               g_dbus_interface_get_info(thing)->name);

      unexport = TRUE;

      interfaces = g_dbus_object_get_interfaces (object);
      for (l = interfaces; l != NULL; l = g_list_next (l))
        {
          if (G_DBUS_INTERFACE (l->data) != G_DBUS_INTERFACE (thing))
            unexport = FALSE;
        }
      g_list_free_full (interfaces, g_object_unref);

      /*
       * HACK: GDBusObjectManagerServer is broken ... and sends InterfaceRemoved
       * too many times, if you remove all interfaces manually, and then unexport
       * a GDBusObject. So only do it here if we're not unexporting the object.
       */
      if (!unexport)
        g_dbus_object_skeleton_remove_interface (G_DBUS_OBJECT_SKELETON (object), thing);
      else
        g_debug ("(unpublishing object, too)");

    }
  else if (thing == NULL)
    {
      unexport = TRUE;
    }
  else
    {
      g_critical ("Unsupported type to unpublish: %s", G_OBJECT_TYPE_NAME (thing));
    }

  if (unexport)
    g_dbus_object_manager_server_unexport (self->object_manager, path);

  g_object_unref (object);
}
