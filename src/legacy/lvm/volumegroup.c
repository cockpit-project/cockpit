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

#include "volumegroup.h"
#include "udisksclient.h"

#include "block.h"
#include "daemon.h"
#include "invocation.h"
#include "logicalvolume.h"
#include "manager.h"
#include "util.h"

#include <glib/gi18n-lib.h>
#include <glib/gstdio.h>

#include <sys/types.h>
#include <pwd.h>
#include <grp.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <mntent.h>

/**
 * SECTION:storagevolume_group
 * @title: StorageVolumeGroup
 * @short_description: Linux implementation of #LvmVolumeGroup
 *
 * This type provides an implementation of the #LvmVolumeGroup interface
 * on Linux.
 */

typedef struct _StorageVolumeGroupClass   StorageVolumeGroupClass;

/**
 * StorageVolumeGroup:
 *
 * The #StorageVolumeGroup structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageVolumeGroup
{
  LvmVolumeGroupSkeleton parent_instance;

  StorageManager *manager;

  gchar *name;
  gboolean need_publish;

  GVariant *info;                 // output of cockpit-lvm-helper
  GHashTable *logical_volumes;    // lv name -> StorageLogicalVolume
  GHashTable *physical_volumes;   // device path -> GVariant *, output of cockpit-lvm-helper

  GPid poll_pid;
  guint poll_timeout_id;
  gboolean poll_requested;
};

struct _StorageVolumeGroupClass
{
  LvmVolumeGroupSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_NAME,
  PROP_MANAGER,
};

static void volume_group_iface_init (LvmVolumeGroupIface *iface);

G_DEFINE_TYPE_WITH_CODE (StorageVolumeGroup, storage_volume_group, LVM_TYPE_VOLUME_GROUP_SKELETON,
                         G_IMPLEMENT_INTERFACE (LVM_TYPE_VOLUME_GROUP, volume_group_iface_init)
);

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_volume_group_init (StorageVolumeGroup *self)
{
  self->logical_volumes = g_hash_table_new_full (g_str_hash, g_str_equal, g_free,
                                                 (GDestroyNotify) g_object_unref);
  self->physical_volumes = g_hash_table_new_full (g_str_hash, g_str_equal, g_free,
                                                  (GDestroyNotify) g_variant_unref);
  self->need_publish = TRUE;
}

static void update_all_blocks (StorageVolumeGroup *self);

static void
storage_volume_group_dispose (GObject *obj)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (obj);
  GHashTableIter iter;
  const gchar *path;
  gpointer value;

  self->need_publish = FALSE;

  /* Dispose all the volumes, should unpublish */
  g_hash_table_iter_init (&iter, self->logical_volumes);
  while (g_hash_table_iter_next (&iter, NULL, &value))
      g_object_run_dispose (value);
  g_hash_table_remove_all (self->logical_volumes);
  g_hash_table_remove_all (self->physical_volumes);

  if (self->info)
    {
      g_variant_unref (self->info);
      self->info = NULL;
    }

  update_all_blocks (self);

  path = storage_volume_group_get_object_path (self);
  if (path != NULL)
    storage_daemon_unpublish (storage_daemon_get (), path, self);

  G_OBJECT_CLASS (storage_volume_group_parent_class)->dispose (obj);
}

static void
storage_volume_group_finalize (GObject *obj)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (obj);

  g_hash_table_unref (self->logical_volumes);
  g_free (self->name);

  G_OBJECT_CLASS (storage_volume_group_parent_class)->finalize (obj);
}

static void
storage_volume_group_get_property (GObject *obj,
                              guint prop_id,
                              GValue *value,
                              GParamSpec *pspec)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (obj);

  switch (prop_id)
    {
    case PROP_NAME:
      g_value_set_string (value, storage_volume_group_get_name (self));
      break;

    case PROP_MANAGER:
      g_value_set_object (value, self->manager);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
storage_volume_group_set_property (GObject *obj,
                              guint prop_id,
                              const GValue *value,
                              GParamSpec *pspec)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (obj);

  switch (prop_id)
    {
    case PROP_NAME:
      g_free (self->name);
      self->name = g_value_dup_string (value);
      break;

    case PROP_MANAGER:
      g_assert (self->manager == NULL);
      self->manager = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
storage_volume_group_class_init (StorageVolumeGroupClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = storage_volume_group_dispose;
  gobject_class->finalize = storage_volume_group_finalize;
  gobject_class->set_property = storage_volume_group_set_property;
  gobject_class->get_property = storage_volume_group_get_property;

  /**
   * StorageVolumeGroupObject:name:
   *
   * The name of the volume group.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_NAME,
                                   g_param_spec_string ("name",
                                                        "Name",
                                                        "The name of the volume group",
                                                        NULL,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * StorageVolumeGroupObject:manager:
   *
   * The manager of the volume group.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_MANAGER,
                                   g_param_spec_object ("manager",
                                                        "Manager",
                                                        "The manager of the volume group",
                                                        STORAGE_TYPE_MANAGER,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * storage_volume_group_new:
 *
 * Creates a new #StorageVolumeGroup instance.
 *
 * Returns: A new #StorageVolumeGroup. Free with g_object_unref().
 */
StorageVolumeGroup *
storage_volume_group_new (StorageManager *manager,
                          const gchar *name)
{
  return g_object_new (STORAGE_TYPE_VOLUME_GROUP,
                       "manager", manager,
                       "name", name,
                       NULL);
}

/**
 * storage_volume_group_update:
 * @self: A #StorageVolumeGroup.
 * @object: The enclosing #StorageVolumeGroupObject instance.
 *
 * Updates the interface.
 */
static void
volume_group_update_props (StorageVolumeGroup *self,
                           GVariant *info,
                           gboolean *needs_polling_ret)
{
  LvmVolumeGroup *iface = LVM_VOLUME_GROUP (self);
  const gchar *str;
  guint64 num;

  if (g_variant_lookup (info, "uuid", "&s", &str))
    lvm_volume_group_set_uuid (iface, str);

  if (g_variant_lookup (info, "size", "t", &num))
    lvm_volume_group_set_size (iface, num);

  if (g_variant_lookup (info, "free-size", "t", &num))
    lvm_volume_group_set_free_size (iface, num);

  if (g_variant_lookup (info, "extent-size", "t", &num))
    lvm_volume_group_set_extent_size (iface, num);
}

static gboolean
lv_is_pvmove_volume (const gchar *name)
{
  return name && g_str_has_prefix (name, "pvmove");
}

static gboolean
lv_is_visible (const gchar *name)
{
  return name && !storage_util_lvm_name_is_reserved (name);
}

static void
update_progress_for_device (const gchar *operation,
                            const gchar *dev,
                            double progress)
{
  StorageDaemon *daemon;
  StorageManager *manager;
  GList *jobs, *l;

  daemon = storage_daemon_get ();
  manager = storage_daemon_get_manager (daemon);
  jobs = storage_daemon_get_jobs (daemon);

  for (l = jobs; l; l = g_list_next (l))
    {
      UDisksJob *job = l->data;
      const gchar *const *job_objects;
      int i;

      if (g_strcmp0 (udisks_job_get_operation (job), operation) != 0)
        continue;

      job_objects = udisks_job_get_objects (job);
      for (i = 0; job_objects[i]; i++)
        {
          StorageBlock *block;
          gboolean found = FALSE;

          block = storage_manager_find_block (manager, job_objects[i]);
          if (block)
            {
              if (g_strcmp0 (storage_block_get_device (block), dev) == 0)
                {
                  found = TRUE;
                }
              else
                {
                  const gchar **symlinks;
                  int j;

                  symlinks = storage_block_get_symlinks (block);
                  for (j = 0; symlinks[j]; j++)
                    {
                      if (g_strcmp0 (symlinks[j], dev) == 0)
                        {
                          found = TRUE;
                          break;
                        }
                    }
                }
            }

          if (found)
            {
              udisks_job_set_progress (job, progress);
              udisks_job_set_progress_valid (job, TRUE);
            }
        }
    }

  g_list_free_full (jobs, g_object_unref);
}

static void
update_operations (const gchar *lv_name,
                   GVariant *lv_info,
                   gboolean *needs_polling_ret)
{
  const gchar *move_pv;
  guint64 copy_percent;

  if (lv_is_pvmove_volume (lv_name)
      && g_variant_lookup (lv_info, "move_pv", "&s", &move_pv)
      && g_variant_lookup (lv_info, "copy_percent", "t", &copy_percent))
    {
      update_progress_for_device ("lvm-vg-empty-device",
                                  move_pv,
                                  copy_percent/100000000.0);
      *needs_polling_ret = TRUE;
    }
}


void
storage_volume_group_update_block (StorageVolumeGroup *self,
                                   StorageBlock *block)
{

  GUdevDevice *device;
  StorageLogicalVolume *volume;
  const gchar *block_vg_name;
  const gchar *block_lv_name;
  GVariant *pv_info;

  device = storage_block_get_udev (block);
  if (device)
    {
      block_vg_name = g_udev_device_get_property (device, "DM_VG_NAME");
      block_lv_name = g_udev_device_get_property (device, "DM_LV_NAME");

      if (g_strcmp0 (block_vg_name, storage_volume_group_get_name (self)) == 0)
        {
          volume = g_hash_table_lookup (self->logical_volumes, block_lv_name);
          storage_block_update_lv (block, volume);
        }
      g_object_unref (device);
    }

  pv_info = g_hash_table_lookup (self->physical_volumes, storage_block_get_device (block));
  if (!pv_info)
    {
      const gchar *const *symlinks;
      int i;
      symlinks = storage_block_get_symlinks (block);
      for (i = 0; symlinks[i]; i++)
        {
          pv_info = g_hash_table_lookup (self->physical_volumes, symlinks[i]);
          if (pv_info)
            break;
        }
    }

  if (pv_info)
    {
      storage_block_update_pv (block, self, pv_info);
    }
  else
    {
      LvmPhysicalVolumeBlock *pv = storage_block_get_physical_volume_block (block);
      if (pv && g_strcmp0 (lvm_physical_volume_block_get_volume_group (pv),
                           storage_volume_group_get_object_path (self)) == 0)
        storage_block_update_pv (block, NULL, NULL);
    }
}

static void
update_all_blocks (StorageVolumeGroup *self)
{
  GList *blocks, *l;

  blocks = storage_manager_get_blocks (self->manager);
  for (l = blocks; l != NULL; l = g_list_next (l))
    storage_volume_group_update_block (self, l->data);
  g_list_free_full (blocks, g_object_unref);
}

struct UpdateData {
  StorageVolumeGroup *self;
  StorageVolumeGroupCallback *done;
  gpointer done_user_data;
};

static void
update_with_variant (GPid pid,
                     GVariant *info,
                     GError *error,
                     gpointer user_data)
{
  struct UpdateData *data = user_data;
  StorageVolumeGroup *self = data->self;
  GVariantIter *iter;
  GHashTableIter volume_iter;
  gpointer key, value;
  GHashTable *new_lvs;
  gboolean needs_polling = FALSE;
  StorageDaemon *daemon;
  gchar *path;

  daemon = storage_daemon_get ();

  if (!error)
      volume_group_update_props (self, info, &needs_polling);

  /* After basic props, publish group, if not already done */
  if (self->need_publish)
    {
      self->need_publish = FALSE;
      path = storage_util_build_object_path ("/org/freedesktop/UDisks2/lvm",
                                        storage_volume_group_get_name (self), NULL);
      storage_daemon_publish (daemon, path, FALSE, self);
      g_free (path);
    }

  if (error)
    {
      g_message ("Failed to update LVM volume group %s: %s",
                 storage_volume_group_get_name (self), error->message);
      g_object_unref (self);
      return;
    }

  if (self->info && g_variant_equal (self->info, info))
    {
      g_debug ("%s updated without changes", self->name);
      g_object_unref (self);
      return;
    }

  if (self->info)
    g_variant_unref (self->info);
  self->info = g_variant_ref (info);

  new_lvs = g_hash_table_new (g_str_hash, g_str_equal);

  if (g_variant_lookup (info, "lvs", "aa{sv}", &iter))
    {
      GVariant *lv_info = NULL;
      while (g_variant_iter_loop (iter, "@a{sv}", &lv_info))
        {
          const gchar *name;
          StorageLogicalVolume *volume;

          g_variant_lookup (lv_info, "name", "&s", &name);

          update_operations (name, lv_info, &needs_polling);

          if (lv_is_pvmove_volume (name))
            needs_polling = TRUE;

          if (!lv_is_visible (name))
            continue;

          volume = g_hash_table_lookup (self->logical_volumes, name);
          if (volume == NULL)
            {
              volume = storage_logical_volume_new (self, name);
              storage_logical_volume_update (volume, self, lv_info, &needs_polling);

              g_hash_table_insert (self->logical_volumes, g_strdup (name), g_object_ref (volume));
            }
          else
            storage_logical_volume_update (volume, self, lv_info, &needs_polling);

          g_hash_table_insert (new_lvs, (gchar *)name, volume);
        }
      g_variant_iter_free (iter);
    }

  g_hash_table_iter_init (&volume_iter, self->logical_volumes);
  while (g_hash_table_iter_next (&volume_iter, &key, &value))
    {
      const gchar *name = key;
      StorageLogicalVolume *volume = value;

      if (!g_hash_table_contains (new_lvs, name))
        {
          /* Volume unpublishes itself */
          g_object_run_dispose (G_OBJECT (volume));
          g_hash_table_iter_remove (&volume_iter);
        }
    }

  lvm_volume_group_set_needs_polling (LVM_VOLUME_GROUP (self), needs_polling);

  /* Update physical volumes. */

  g_hash_table_remove_all (self->physical_volumes);

  if (g_variant_lookup (info, "pvs", "aa{sv}", &iter))
    {
      const gchar *name;
      GVariant *pv_info;
      while (g_variant_iter_next (iter, "@a{sv}", &pv_info))
        {
          if (g_variant_lookup (pv_info, "device", "&s", &name))
            g_hash_table_insert (self->physical_volumes, g_strdup (name), pv_info);
          else
            g_variant_unref (pv_info);
        }
    }

  /* Make sure above is published before updating blocks to point at volume group */
  update_all_blocks (self);

  if (data->done)
    data->done (self, data->done_user_data);

  g_hash_table_destroy (new_lvs);
  g_object_unref (self);
  g_free (data);
}

void
storage_volume_group_update (StorageVolumeGroup *self,
                             gboolean ignore_locks,
                             StorageVolumeGroupCallback *done,
                             gpointer done_user_data)
{
  struct UpdateData *data;
  const gchar *args[6];
  int i;

  i = 0;
  args[i++] = "cockpit-lvm-helper";
  args[i++] = "-b";
  if (ignore_locks)
    args[i++] = "-f";
  args[i++] = "show";
  args[i++] = self->name;
  args[i++] = NULL;

  data = g_new0 (struct UpdateData, 1);
  data->self = g_object_ref (self);
  data->done = done;
  data->done_user_data = done_user_data;

  storage_daemon_spawn_for_variant (storage_daemon_get (), args, G_VARIANT_TYPE ("a{sv}"),
                                    update_with_variant, data);
}

static void
poll_with_variant (GPid pid,
                   GVariant *info,
                   GError *error,
                   gpointer user_data)
{
  StorageVolumeGroup *self = user_data;
  GVariantIter *iter;
  gboolean needs_polling;

  if (pid != self->poll_pid)
    {
      g_object_unref (self);
      return;
    }

  self->poll_pid = 0;

  if (error)
    {
      g_message ("Failed to poll LVM volume group %s: %s",
                 storage_volume_group_get_name (self), error->message);
      g_object_unref (self);
      return;
    }

  volume_group_update_props (self, info, &needs_polling);

  if (g_variant_lookup (info, "lvs", "aa{sv}", &iter))
    {
      GVariant *lv_info = NULL;
      while (g_variant_iter_loop (iter, "@a{sv}", &lv_info))
        {
          const gchar *name;
          StorageLogicalVolume *volume;

          g_variant_lookup (lv_info, "name", "&s", &name);
          update_operations (name, lv_info, &needs_polling);
          volume = g_hash_table_lookup (self->logical_volumes, name);
          if (volume)
            storage_logical_volume_update (volume, self, lv_info, &needs_polling);
        }
      g_variant_iter_free (iter);
    }

  g_object_unref (self);
}

static void   poll_now  (StorageVolumeGroup *self);

static gboolean
poll_in_main (gpointer user_data)
{
  StorageVolumeGroup *self = user_data;

  if (self->poll_timeout_id)
    self->poll_requested = TRUE;
  else
    poll_now (self);

  g_object_unref (self);
  return FALSE;
}

static gboolean
poll_timeout (gpointer user_data)
{
  StorageVolumeGroup *self = user_data;

  self->poll_timeout_id = 0;
  if (self->poll_requested)
    {
      self->poll_requested = FALSE;
      poll_now (self);
    }

  g_object_unref (self);
  return FALSE;
}

static void
poll_now (StorageVolumeGroup *self)
{
  const gchar *args[] = {
      "cockpit-lvm-helper",
      "-b", "show", self->name, NULL
  };

  self->poll_timeout_id = g_timeout_add (5000, poll_timeout, g_object_ref (self));

  if (self->poll_pid)
    kill (self->poll_pid, SIGINT);

  self->poll_pid = storage_daemon_spawn_for_variant (storage_daemon_get (), args, G_VARIANT_TYPE ("a{sv}"),
                                                     poll_with_variant, g_object_ref (self));
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_poll (LvmVolumeGroup *group,
             GDBusMethodInvocation *invocation)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);

  storage_volume_group_poll (self);
  lvm_volume_group_complete_poll (group, invocation);

  return TRUE;
}

typedef struct {
  GDBusMethodInvocation *invocation;
  gpointer wait_thing;
  gchar *wait_name;
  guint wait_sig;
} CompleteClosure;

static void
complete_closure_free (gpointer data,
                       GClosure *unused)
{
  CompleteClosure *complete = data;
  g_free (complete->wait_name);
  g_clear_object (&complete->wait_thing);
  g_object_unref (complete->invocation);
  g_free (complete);
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  gchar **devices;
  gchar *vgname;
} VolumeGroupDeleteJobData;

static void
volume_group_delete_job_free (gpointer user_data)
{
  VolumeGroupDeleteJobData *data = user_data;
  g_strfreev (data->devices);
  g_free (data->vgname);
  g_free (data);
}

static gboolean
volume_group_delete_job_thread (GCancellable *cancellable,
                                gpointer user_data,
                                GError **error)
{
  VolumeGroupDeleteJobData *data = user_data;
  gchar *standard_output;
  gchar *standard_error;
  gint exit_status;
  gboolean ret;
  gint i;

  const gchar *argv[] = { "vgremove", "-f", data->vgname, NULL };

  ret = g_spawn_sync (NULL, (gchar **)argv, NULL,
                      G_SPAWN_SEARCH_PATH, NULL, NULL,
                      &standard_output, &standard_error,
                      &exit_status, error);

  if (ret)
    {
      ret = storage_util_check_status_and_output ("vgremove",
                                                  exit_status, standard_output,
                                                  standard_error, error);
    }

  g_free (standard_output);
  g_free (standard_error);

  if (ret)
    {
      for (i = 0; data->devices && data->devices[i] != NULL; i++)
        {
          if (!storage_util_wipe_block (data->devices[i], error))
            {
              ret = FALSE;
              break;
            }
        }
    }

  return ret;
}

static void
on_delete_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_volume_group_complete_delete (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error deleting volume group: %s", message);
    }
}

static gboolean
handle_delete (LvmVolumeGroup *group,
               GDBusMethodInvocation *invocation,
               gboolean arg_wipe,
               GVariant *arg_options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  VolumeGroupDeleteJobData *data;
  StorageDaemon *daemon;
  StorageJob *job;
  GList *l;

  daemon = storage_daemon_get ();

  data = g_new0 (VolumeGroupDeleteJobData, 1);
  data->vgname = g_strdup (storage_volume_group_get_name (self));

  /* Find physical volumes to wipe. */
  if (arg_wipe)
    {
      GPtrArray *devices = g_ptr_array_new ();
      GList *blocks = storage_manager_get_blocks (storage_daemon_get_manager (daemon));
      for (l = blocks; l; l = l->next)
        {
          LvmPhysicalVolumeBlock *physical_volume;
          physical_volume = storage_block_get_physical_volume_block (l->data);
          if (physical_volume
              && g_strcmp0 (lvm_physical_volume_block_get_volume_group (physical_volume),
                            storage_volume_group_get_object_path (self)) == 0)
            g_ptr_array_add (devices, g_strdup (storage_block_get_device (l->data)));
        }
      g_list_free_full (blocks, g_object_unref);
      g_ptr_array_add (devices, NULL);
      data->devices = (gchar **)g_ptr_array_free (devices, FALSE);
    }

  job = storage_daemon_launch_threaded_job (daemon, self,
                                            "lvm-vg-delete",
                                            storage_invocation_get_caller_uid (invocation),
                                            volume_group_delete_job_thread,
                                            data,
                                            volume_group_delete_job_free,
                                            NULL);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_delete_complete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_rename_volume_group (StorageDaemon *daemon,
                        StorageVolumeGroup *group,
                        gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (g_str_equal (storage_volume_group_get_name (group), complete->wait_name))
    {
      lvm_volume_group_complete_rename (NULL, complete->invocation,
                                        storage_volume_group_get_object_path (group));
      g_signal_handler_disconnect (daemon, complete->wait_sig);
    }
}

static void
on_rename_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (success)
    return;

  g_dbus_method_invocation_return_error (complete->invocation, UDISKS_ERROR,
                                         UDISKS_ERROR_FAILED, "Error renaming volume group: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_rename (LvmVolumeGroup *group,
               GDBusMethodInvocation *invocation,
               const gchar *new_name,
               GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  CompleteClosure *complete;
  StorageJob *job;
  StorageDaemon *daemon;

  daemon = storage_daemon_get ();

  job = storage_daemon_launch_spawned_job (daemon, self,
                                           "lvm-vg-rename",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "vgrename",
                                           storage_volume_group_get_name (self),
                                           new_name,
                                           NULL);

  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->wait_name = g_strdup (new_name);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_rename_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageVolumeGroup",
                                              G_CALLBACK (on_rename_volume_group),
                                              complete, complete_closure_free, 0);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_adddev_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_volume_group_complete_add_device (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error adding device to volume group: %s", message);
    }
}

static gboolean
handle_add_device (LvmVolumeGroup *group,
                   GDBusMethodInvocation  *invocation,
                   const gchar *new_member_device_objpath,
                   GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  StorageJob *job;
  StorageDaemon *daemon;
  StorageManager *manager;
  GError *error = NULL;
  StorageBlock *new_member_device = NULL;

  daemon = storage_daemon_get ();
  manager = storage_daemon_get_manager (daemon);

  new_member_device = storage_manager_find_block (manager, new_member_device_objpath);
  if (new_member_device == NULL)
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "The given object is not a valid block");
    }
  else if (!storage_block_is_unused (new_member_device, &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
    }
  else if (!storage_util_wipe_block (storage_block_get_device (new_member_device), &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
    }
  else
    {
      job = storage_daemon_launch_spawned_job (daemon, self,
                                               "lvm-vg-add-device",
                                               storage_invocation_get_caller_uid (invocation),
                                               NULL, /* GCancellable */
                                               0,    /* uid_t run_as_uid */
                                               0,    /* uid_t run_as_euid */
                                               NULL,  /* input_string */
                                               "vgextend",
                                               storage_volume_group_get_name (self),
                                               storage_block_get_device (new_member_device),
                                               NULL);

      g_signal_connect_data (job, "completed", G_CALLBACK (on_adddev_complete),
                             g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);
    }

  g_clear_object (&new_member_device);
  return TRUE; /* returning TRUE means that we handled the method invocation */
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  gchar *vgname;
  gchar *pvname;
  gboolean wipe;
} VolumeGroupRemdevJobData;

static void
volume_group_remdev_job_free (gpointer user_data)
{
  VolumeGroupRemdevJobData *data = user_data;
  g_free (data->vgname);
  g_free (data->pvname);
  g_free (data);
}

static gboolean
volume_group_remdev_job_thread (GCancellable *cancellable,
                                gpointer user_data,
                                GError **error)
{
  VolumeGroupRemdevJobData *data = user_data;
  gchar *standard_output;
  gchar *standard_error;
  gint exit_status;
  gboolean ret;

  const gchar *vgreduce[] = { "vgreduce", data->vgname, data->pvname, NULL };

  ret = g_spawn_sync (NULL, (gchar **)vgreduce, NULL,
                      G_SPAWN_SEARCH_PATH, NULL, NULL,
                      &standard_output, &standard_error,
                      &exit_status, error);

  if (ret)
    {
      ret = storage_util_check_status_and_output ("vgreduce",
                                                  exit_status, standard_output,
                                                  standard_error, error);
    }

  g_free (standard_output);
  g_free (standard_error);

  if (ret && data->wipe)
    {
      const gchar *wipefs[] = { "wipefs", "-a", data->pvname, NULL };

      ret = g_spawn_sync (NULL, (gchar **)wipefs, NULL,
                          G_SPAWN_SEARCH_PATH, NULL, NULL,
                          &standard_output, &standard_error,
                          &exit_status, error);

      if (ret)
        {
          ret = storage_util_check_status_and_output ("wipefs",
                                                      exit_status, standard_output,
                                                      standard_error, error);
        }

      g_free (standard_output);
      g_free (standard_error);
    }

  return ret;
}

static void
on_remdev_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_volume_group_complete_remove_device (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error removing device from volume group: %s", message);
    }
}

static gboolean
handle_remove_device (LvmVolumeGroup *group,
                      GDBusMethodInvocation *invocation,
                      const gchar *member_device_objpath,
                      gboolean wipe,
                      GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  VolumeGroupRemdevJobData *data;
  StorageDaemon *daemon;
  StorageManager *manager;
  StorageBlock *member_device;
  StorageJob *job;

  daemon = storage_daemon_get ();
  manager = storage_daemon_get_manager (daemon);

  member_device = storage_manager_find_block (manager, member_device_objpath);
  if (member_device == NULL)
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "The given object is not a valid block");
      return TRUE;
    }

  data = g_new0 (VolumeGroupRemdevJobData, 1);
  data->wipe = wipe;
  data->vgname = g_strdup (storage_volume_group_get_name (self));
  data->pvname = g_strdup (storage_block_get_device (member_device));

  job = storage_daemon_launch_threaded_job (daemon, self,
                                            "lvm-vg-rem-device",
                                            storage_invocation_get_caller_uid (invocation),
                                            volume_group_remdev_job_thread,
                                            data,
                                            volume_group_remdev_job_free,
                                            NULL);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_remdev_complete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  g_object_unref (member_device);
  return TRUE; /* returning TRUE means that we handled the method invocation */
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_empty_complete (UDisksJob *job,
                   gboolean success,
                   gchar *message,
                   gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_volume_group_complete_empty_device (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error emptying device in volume group: %s", message);
    }
}

static gboolean
handle_empty_device (LvmVolumeGroup *group,
                     GDBusMethodInvocation *invocation,
                     const gchar *member_device_objpath,
                     GVariant *options)
{
  StorageJob *job;
  StorageDaemon *daemon;
  StorageManager *manager;
  const gchar *member_device_file = NULL;
  StorageBlock *member_device = NULL;

  daemon = storage_daemon_get ();
  manager = storage_daemon_get_manager (daemon);

  member_device = storage_manager_find_block (manager, member_device_objpath);
  if (member_device == NULL)
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "The given object is not a valid block");
      return TRUE;
    }

  member_device_file = storage_block_get_device (member_device);

  job = storage_daemon_launch_spawned_job (daemon, member_device,
                                           "lvm-vg-empty-device",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "pvmove", member_device_file,
                                           NULL);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_empty_complete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  g_object_unref (member_device);
  return TRUE; /* returning TRUE means that we handled the method invocation */
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_create_logical_volume (StorageDaemon *daemon,
                          StorageLogicalVolume *volume,
                          gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (g_str_equal (storage_logical_volume_get_name (volume), complete->wait_name) &&
      storage_logical_volume_get_volume_group (volume) == STORAGE_VOLUME_GROUP (complete->wait_thing))
    {
      /* All creates have the same signature */
      lvm_volume_group_complete_create_plain_volume (NULL, complete->invocation,
                                                     storage_logical_volume_get_object_path (volume));
      g_signal_handler_disconnect (daemon, complete->wait_sig);
    }
}

static void
on_create_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (success)
    return;

  g_dbus_method_invocation_return_error (complete->invocation, UDISKS_ERROR,
                                         UDISKS_ERROR_FAILED, "Error creating logical volume: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_create_plain_volume (LvmVolumeGroup *group,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_name,
                            guint64 arg_size,
                            GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  CompleteClosure *complete;
  StorageJob *job;
  StorageDaemon *daemon;
  GPtrArray *argv;

  daemon = storage_daemon_get ();

  arg_size -= arg_size % 512;

  argv = g_ptr_array_new_with_free_func (g_free);
  g_ptr_array_add (argv, g_strdup ("lvcreate"));
  g_ptr_array_add (argv, g_strdup (storage_volume_group_get_name (self)));
  g_ptr_array_add (argv, g_strdup_printf ("-L%" G_GUINT64_FORMAT "b", arg_size));
  g_ptr_array_add (argv, g_strdup ("-n"));
  g_ptr_array_add (argv, g_strdup (arg_name));
  g_ptr_array_add (argv, NULL);

  job = storage_daemon_launch_spawned_jobv (daemon, self,
                                            "lvm-vg-create-volume",
                                            storage_invocation_get_caller_uid (invocation),
                                            NULL, /* GCancellable */
                                            0,    /* uid_t run_as_uid */
                                            0,    /* uid_t run_as_euid */
                                            NULL,  /* input_string */
                                            (const gchar **)argv->pdata);

  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->wait_thing = g_object_ref (self);
  complete->wait_name = g_strdup (arg_name);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_create_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageLogicalVolume",
                                              G_CALLBACK (on_create_logical_volume),
                                              complete, complete_closure_free, 0);

  g_ptr_array_free (argv, TRUE);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_create_thin_pool_volume (LvmVolumeGroup *group,
                                GDBusMethodInvocation *invocation,
                                const gchar *arg_name,
                                guint64 arg_size,
                                GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  CompleteClosure *complete;
  StorageJob *job;
  StorageDaemon *daemon;
  gchar *size;

  daemon = storage_daemon_get ();

  arg_size -= arg_size % 512;

  size = g_strdup_printf ("%" G_GUINT64_FORMAT "b", arg_size);

  job = storage_daemon_launch_spawned_job (daemon, self,
                                           "lvm-vg-create-volume",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "lvcreate",
                                           storage_volume_group_get_name (self),
                                           "-T", "-L", size, "--thinpool",
                                           arg_name, NULL);

  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->wait_thing = g_object_ref (self);
  complete->wait_name = g_strdup (arg_name);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_create_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageLogicalVolume",
                                              G_CALLBACK (on_create_logical_volume),
                                              complete, complete_closure_free, 0);

  g_free (size);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_create_thin_volume (LvmVolumeGroup *group,
                           GDBusMethodInvocation *invocation,
                           const gchar *arg_name,
                           guint64 arg_size,
                           const gchar *arg_pool,
                           GVariant *options)
{
  StorageVolumeGroup *self = STORAGE_VOLUME_GROUP (group);
  CompleteClosure *complete;
  StorageJob *job;
  StorageDaemon *daemon;
  StorageLogicalVolume *pool;
  gchar *size;

  daemon = storage_daemon_get ();

  pool = storage_daemon_find_thing (daemon, arg_pool, STORAGE_TYPE_LOGICAL_VOLUME);
  if (pool == NULL)
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Not a valid logical volume");
      return TRUE;
    }

  arg_size -= arg_size % 512;

  size = g_strdup_printf ("%" G_GUINT64_FORMAT "b", arg_size);

  job = storage_daemon_launch_spawned_job (daemon, self,
                                           "lvm-vg-create-volume",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "lvcreate",
                                           storage_volume_group_get_name (self),
                                           "--thinpool", storage_logical_volume_get_name (pool),
                                           "-V", size, "-n", arg_name, NULL);

  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->wait_thing = g_object_ref (self);
  complete->wait_name = g_strdup (arg_name);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_create_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageLogicalVolume",
                                              G_CALLBACK (on_create_logical_volume),
                                              complete, complete_closure_free, 0);

  g_free (size);
  g_object_unref (pool);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
volume_group_iface_init (LvmVolumeGroupIface *iface)
{
  iface->handle_poll = handle_poll;

  iface->handle_delete = handle_delete;
  iface->handle_rename = handle_rename;

  iface->handle_add_device = handle_add_device;
  iface->handle_remove_device = handle_remove_device;
  iface->handle_empty_device = handle_empty_device;

  iface->handle_create_plain_volume = handle_create_plain_volume;
  iface->handle_create_thin_pool_volume = handle_create_thin_pool_volume;
  iface->handle_create_thin_volume = handle_create_thin_volume;
}


void
storage_volume_group_poll (StorageVolumeGroup *self)
{
  g_idle_add (poll_in_main, g_object_ref (self));
}

StorageLogicalVolume *
storage_volume_group_find_logical_volume (StorageVolumeGroup *self,
                                          const gchar *name)
{
  return g_hash_table_lookup (self->logical_volumes, name);
}

/**
 * storage_volume_group_object_get_name:
 * @self: A #StorageVolumeGroupObject.
 *
 * Gets the name for @object.
 *
 * Returns: (transfer none): The name for object. Do not free, the
 *          string belongs to object.
 */
const gchar *
storage_volume_group_get_name (StorageVolumeGroup *self)
{
  g_return_val_if_fail (STORAGE_IS_VOLUME_GROUP (self), NULL);
  return self->name;
}

const gchar *
storage_volume_group_get_object_path (StorageVolumeGroup *self)
{
  g_return_val_if_fail (STORAGE_IS_VOLUME_GROUP (self), NULL);
  return g_dbus_interface_skeleton_get_object_path (G_DBUS_INTERFACE_SKELETON (self));
}
