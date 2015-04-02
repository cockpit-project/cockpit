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
#include <fcntl.h>

#include "logicalvolume.h"

#include "block.h"
#include "daemon.h"
#include "invocation.h"
#include "util.h"
#include "udisksclient.h"
#include "volumegroup.h"

/**
 * SECTION:storagelogicalvolume
 * @title: StorageLogicalVolume
 * @short_description: Linux implementation of #LvmLogicalVolume
 *
 * This type provides an implementation of the #LvmLogicalVolume
 * interface on Linux.
 */

typedef struct _StorageLogicalVolumeClass   StorageLogicalVolumeClass;

/**
 * StorageLogicalVolume:
 *
 * The #StorageLogicalVolume structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageLogicalVolume
{
  LvmLogicalVolumeSkeleton parent_instance;

  gchar *name;
  gboolean needs_publish;
  gboolean needs_udev_hack;
  StorageVolumeGroup *volume_group;
};

struct _StorageLogicalVolumeClass
{
  LvmLogicalVolumeSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_NAME,
  PROP_GROUP,
  PROP_VOLUME_GROUP,
};

static void logical_volume_iface_init (LvmLogicalVolumeIface *iface);

G_DEFINE_TYPE_WITH_CODE (StorageLogicalVolume, storage_logical_volume, LVM_TYPE_LOGICAL_VOLUME_SKELETON,
                         G_IMPLEMENT_INTERFACE (LVM_TYPE_LOGICAL_VOLUME, logical_volume_iface_init)
);

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_logical_volume_init (StorageLogicalVolume *self)
{
  self->needs_publish = TRUE;
  self->needs_udev_hack = TRUE;
}

static void
storage_logical_volume_dispose (GObject *obj)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (obj);
  const gchar *path;

  self->needs_publish = FALSE;
  path = storage_logical_volume_get_object_path (self);
  if (path != NULL)
    storage_daemon_unpublish (storage_daemon_get (), path, self);

  G_OBJECT_CLASS (storage_logical_volume_parent_class)->dispose (obj);
}

static void
storage_logical_volume_finalize (GObject *obj)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (obj);

  g_free (self->name);

  G_OBJECT_CLASS (storage_logical_volume_parent_class)->finalize (obj);
}

static void
storage_logical_volume_get_property (GObject *obj,
                                     guint prop_id,
                                     GValue *value,
                                     GParamSpec *pspec)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (obj);

  switch (prop_id)
    {
    case PROP_NAME:
      g_value_set_string (value, storage_logical_volume_get_name (self));
      break;
    case PROP_GROUP:
      g_value_set_object (value, storage_logical_volume_get_volume_group (self));
      break;
    case PROP_VOLUME_GROUP:
      if (self->volume_group)
        g_value_set_string (value, storage_volume_group_get_object_path (self->volume_group));
      else
        g_value_set_string (value, "/");
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
storage_logical_volume_set_property (GObject *obj,
                                     guint prop_id,
                                     const GValue *value,
                                     GParamSpec *pspec)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (obj);

  switch (prop_id)
    {
    case PROP_NAME:
      g_free (self->name);
      self->name = g_value_dup_string (value);
      break;
    case PROP_GROUP:
      storage_logical_volume_set_volume_group (self, g_value_get_object (value));
      break;
    case PROP_VOLUME_GROUP:
      g_assert_not_reached ();
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
storage_logical_volume_class_init (StorageLogicalVolumeClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = storage_logical_volume_dispose;
  gobject_class->finalize = storage_logical_volume_finalize;
  gobject_class->set_property = storage_logical_volume_set_property;
  gobject_class->get_property = storage_logical_volume_get_property;

  /**
   * StorageLogicalVolumeObject:name:
   *
   * The name of the logical volume.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_NAME,
                                   g_param_spec_string ("name",
                                                        "Name",
                                                        "The name of the volume group",
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_READABLE |
                                                        G_PARAM_STATIC_STRINGS));

  /**
    * StorageLogicalVolume:group:
    *
    * The volume group.
    */
   g_object_class_install_property (gobject_class,
                                    PROP_GROUP,
                                    g_param_spec_object ("group",
                                                         "Volume Group",
                                                         "The volume group as an object",
                                                         STORAGE_TYPE_VOLUME_GROUP,
                                                         G_PARAM_READABLE |
                                                         G_PARAM_WRITABLE |
                                                         G_PARAM_STATIC_STRINGS));

   /**
     * StorageLogicalVolume:volume_group:
     *
     * The volume group.
     */
    g_object_class_install_property (gobject_class,
                                     PROP_VOLUME_GROUP,
                                     g_param_spec_string ("volume-group",
                                                          "Volume Group",
                                                          "The volume group as an object path",
                                                          "/",
                                                          G_PARAM_READABLE |
                                                          G_PARAM_WRITABLE |
                                                          G_PARAM_STATIC_STRINGS));
}

/**
 * storage_logical_volume_new:
 *
 * Creates a new #StorageLogicalVolume instance.
 *
 * Returns: A new #StorageLogicalVolume. Free with g_object_unref().
 */
StorageLogicalVolume *
storage_logical_volume_new (StorageVolumeGroup *group,
                            const gchar *name)
{
  g_return_val_if_fail (STORAGE_IS_VOLUME_GROUP (group), NULL);
  g_return_val_if_fail (name != NULL, NULL);

  return g_object_new (STORAGE_TYPE_LOGICAL_VOLUME,
                       "group", group,
                       "name", name,
                       NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

/**
 * storage_logical_volume_update:
 * @logical_volume: A #StorageLogicalVolume.
 * @vg: LVM volume group
 * @lv: LVM logical volume
 *
 * Updates the interface.
 */
void
storage_logical_volume_update (StorageLogicalVolume *self,
                               StorageVolumeGroup *group,
                               GVariant *info,
                               gboolean *needs_polling_ret)
{
  LvmLogicalVolume *iface;
  const char *type;
  gboolean active;
  const char *pool_objpath;
  const char *origin_objpath;
  const gchar *dev_file;
  const gchar *str;
  guint64 num;
  gchar *path;

  iface = LVM_LOGICAL_VOLUME (self);

  if (g_variant_lookup (info, "uuid", "&s", &str))
    lvm_logical_volume_set_uuid (iface, str);

  if (g_variant_lookup (info, "size", "t", &num))
    lvm_logical_volume_set_size (iface, num);

  type = "block";
  active = FALSE;
  if (g_variant_lookup (info, "lv_attr", "&s", &str)
      && str && strlen (str) > 6)
    {
      char volume_type = str[0];
      char state =       str[4];
      char target_type = str[6];

      if (target_type == 't')
        *needs_polling_ret = TRUE;

      if (target_type == 't' && volume_type == 't')
        type = "pool";

      if (state == 'a')
        active = TRUE;
    }
  lvm_logical_volume_set_type_ (iface, type);
  lvm_logical_volume_set_active (iface, active);

  if (g_variant_lookup (info, "data_percent", "t", &num)
      && (int64_t)num >= 0)
    lvm_logical_volume_set_data_allocated_ratio (iface, num/100000000.0);

  if (g_variant_lookup (info, "metadata_percent", "t", &num)
      && (int64_t)num >= 0)
    lvm_logical_volume_set_metadata_allocated_ratio (iface, num/100000000.0);

  pool_objpath = "/";
  if (g_variant_lookup (info, "pool_lv", "&s", &str)
      && str != NULL && *str)
    {
      StorageLogicalVolume *pool = storage_volume_group_find_logical_volume (group, str);
      if (pool)
        pool_objpath = storage_logical_volume_get_object_path (pool);
    }
  lvm_logical_volume_set_thin_pool (iface, pool_objpath);

  origin_objpath = "/";
  if (g_variant_lookup (info, "origin", "&s", &str)
      && str != NULL && *str)
    {
      StorageLogicalVolume *origin = storage_volume_group_find_logical_volume (group, str);
      if (origin)
        origin_objpath = storage_logical_volume_get_object_path (origin);
    }
  lvm_logical_volume_set_origin (iface, origin_objpath);

  storage_logical_volume_set_volume_group (self, group);

  dev_file = NULL;
  if (self->needs_udev_hack
      && g_variant_lookup (info, "lv_path", "&s", &dev_file))
    {
      // LVM2 versions before 2.02.105 sometimes incorrectly leave the
      // DM_UDEV_DISABLE_OTHER_RULES flag set for thin volumes.  As a
      // workaround, we trigger an extra udev "change" event which
      // will clear this up.
      //
      // https://www.redhat.com/archives/linux-lvm/2014-January/msg00030.html

      storage_util_trigger_udev (dev_file);
      self->needs_udev_hack = FALSE;
    }

  if (self->needs_publish)
    {
      self->needs_publish = FALSE;
      path = storage_util_build_object_path (storage_volume_group_get_object_path (group),
                                             storage_logical_volume_get_name (self), NULL);
      storage_daemon_publish (storage_daemon_get (), path, FALSE, self);
      g_free (path);
    }
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

static void
on_complete_delete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_logical_volume_complete_delete (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error deleting logical volume: %s", message);
    }
}

static gboolean
handle_delete (LvmLogicalVolume *volume,
               GDBusMethodInvocation *invocation,
               GVariant *options)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  gchar *full_name = NULL;
  StorageVolumeGroup *group;
  StorageDaemon *daemon;
  StorageJob *job;

  daemon = storage_daemon_get ();

  group = storage_logical_volume_get_volume_group (self);
  full_name = g_strdup_printf ("%s/%s",
                               storage_volume_group_get_name (group),
                               storage_logical_volume_get_name (self));

  job = storage_daemon_launch_spawned_job (daemon, self,
                                      "lvm-lvol-delete",
                                      storage_invocation_get_caller_uid (invocation),
                                      NULL, /* GCancellable */
                                      0,    /* uid_t run_as_uid */
                                      0,    /* uid_t run_as_euid */
                                      NULL,  /* input_string */
                                      "lvremove", "-f", full_name, NULL);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_complete_delete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  g_free (full_name);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_rename_logical_volume (StorageDaemon *daemon,
                          StorageLogicalVolume *volume,
                          gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (g_str_equal (storage_logical_volume_get_name (volume), complete->wait_name) &&
      storage_logical_volume_get_volume_group (volume) == STORAGE_VOLUME_GROUP (complete->wait_thing))
    {
      lvm_logical_volume_complete_rename (NULL, complete->invocation,
                                          storage_logical_volume_get_object_path (volume));
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
                                         UDISKS_ERROR_FAILED, "Error renaming logical volume: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_rename (LvmLogicalVolume *volume,
               GDBusMethodInvocation *invocation,
               const gchar *new_name,
               GVariant *options)
{
  StorageDaemon *daemon;
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  StorageVolumeGroup *group;
  gchar *full_name = NULL;
  gchar *error_message = NULL;
  CompleteClosure *complete;
  StorageJob *job;

  daemon = storage_daemon_get ();

  group = storage_logical_volume_get_volume_group (self);
  full_name = g_strdup_printf ("%s/%s",
                               storage_volume_group_get_name (group),
                               storage_logical_volume_get_name (self));

  job = storage_daemon_launch_spawned_job (daemon, self,
                                      "lvm-vg-rename",
                                      storage_invocation_get_caller_uid (invocation),
                                      NULL, /* GCancellable */
                                      0,    /* uid_t run_as_uid */
                                      0,    /* uid_t run_as_euid */
                                      NULL,  /* input_string */
                                      "lvrename", full_name, new_name, NULL);

  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->wait_thing = g_object_ref (group);
  complete->wait_name = g_strdup (new_name);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_rename_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageLogicalVolume",
                                              G_CALLBACK (on_rename_logical_volume),
                                              complete, complete_closure_free, 0);

  g_free (error_message);
  g_free (full_name);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_resize_complete (UDisksJob *job,
                    gboolean success,
                    gchar *message,
                    gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_logical_volume_complete_resize (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error resizing logical volume: %s", message);
    }
}

static gboolean
handle_resize (LvmLogicalVolume *volume,
               GDBusMethodInvocation *invocation,
               guint64 new_size,
               GVariant *options)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  StorageVolumeGroup *group;
  StorageDaemon *daemon;
  StorageJob *job;
  GPtrArray *args;
  gboolean resize_fsys = FALSE;

  daemon = storage_daemon_get ();

  group = storage_logical_volume_get_volume_group (self);
  new_size -= new_size % 512;

  g_variant_lookup (options, "resize_fsys", "b", &resize_fsys);

  args = g_ptr_array_new_with_free_func (g_free);
  g_ptr_array_add (args, g_strdup ("lvresize"));
  g_ptr_array_add (args, g_strdup_printf ("%s/%s",
                                          storage_volume_group_get_name (group),
                                          storage_logical_volume_get_name (self)));
  g_ptr_array_add (args, g_strdup_printf ("-L%" G_GUINT64_FORMAT "b", new_size));
  if (resize_fsys)
    g_ptr_array_add (args, g_strdup_printf ("-r"));
  g_ptr_array_add (args, NULL);

  job = storage_daemon_launch_spawned_jobv (daemon, self,
                                            "lvm-vg-resize",
                                            storage_invocation_get_caller_uid (invocation),
                                            NULL, /* GCancellable */
                                            0,    /* uid_t run_as_uid */
                                            0,    /* uid_t run_as_euid */
                                            NULL,  /* input_string */
                                            (const gchar **)args->pdata);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_resize_complete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  g_ptr_array_free (args, TRUE);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_activate_logical_volume_block (StorageDaemon *daemon,
                                  LvmLogicalVolumeBlock *block,
                                  gpointer user_data)
{
  CompleteClosure *complete = user_data;
  StorageLogicalVolume *volume = complete->wait_thing;
  const gchar *path;

  if (g_strcmp0 (lvm_logical_volume_block_get_logical_volume (block),
                 storage_logical_volume_get_object_path (volume)) == 0)
    {
      path = g_dbus_interface_skeleton_get_object_path (G_DBUS_INTERFACE_SKELETON (block));
      lvm_logical_volume_complete_activate (NULL, complete->invocation, path);
      g_signal_handler_disconnect (daemon, complete->wait_sig);
    }
}

static void
on_activate_complete (UDisksJob *job,
                      gboolean success,
                      gchar *message,
                      gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (success)
    return;

  g_dbus_method_invocation_return_error (complete->invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                         "Error activating logical volume: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_activate (LvmLogicalVolume *volume,
                 GDBusMethodInvocation *invocation,
                 GVariant *options)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  StorageVolumeGroup *group;
  StorageDaemon *daemon;
  gchar *full_name = NULL;
  CompleteClosure *complete;
  StorageJob *job;

  daemon = storage_daemon_get ();
  group = storage_logical_volume_get_volume_group (self);
  full_name = g_strdup_printf ("%s/%s", storage_volume_group_get_name (group),
                               storage_logical_volume_get_name (self));

  job = storage_daemon_launch_spawned_job (daemon, self,
                                           "lvm-lvol-activate",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "lvchange", full_name, "-ay", "-K", "--yes", NULL);

  complete = g_new0 (CompleteClosure, 1);
  complete->wait_thing = g_object_ref (self);
  complete->invocation = g_object_ref (invocation);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_activate_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::LvmLogicalVolumeBlockSkeleton",
                                              G_CALLBACK (on_activate_logical_volume_block),
                                              complete, complete_closure_free, 0);

  g_free (full_name);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_deactivate_complete (UDisksJob *job,
                        gboolean success,
                        gchar *message,
                        gpointer user_data)
{
  GDBusMethodInvocation *invocation = user_data;
  if (success)
    {
      lvm_logical_volume_complete_deactivate (NULL, invocation);
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                                             "Error deactivating logical volume: %s", message);
    }
}

static gboolean
handle_deactivate (LvmLogicalVolume *volume,
                   GDBusMethodInvocation *invocation,
                   GVariant *options)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  StorageVolumeGroup *group;
  StorageDaemon *daemon;
  gchar *full_name = NULL;
  StorageJob *job = NULL;

  daemon = storage_daemon_get ();

  group = storage_logical_volume_get_volume_group (self);
  full_name = g_strdup_printf ("%s/%s", storage_volume_group_get_name (group),
                               storage_logical_volume_get_name (self));

  job = storage_daemon_launch_spawned_job (daemon, self,
                                           "lvm-lvol-deactivate",
                                           storage_invocation_get_caller_uid (invocation),
                                           NULL, /* GCancellable */
                                           0,    /* uid_t run_as_uid */
                                           0,    /* uid_t run_as_euid */
                                           NULL,  /* input_string */
                                           "lvchange", full_name, "-an", "-K", "--yes", NULL);

  g_signal_connect_data (job, "completed", G_CALLBACK (on_deactivate_complete),
                         g_object_ref (invocation), (GClosureNotify)g_object_unref, 0);

  g_free (full_name);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_snapshot_logical_volume (StorageDaemon *daemon,
                            StorageLogicalVolume *volume,
                            gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (g_str_equal (storage_logical_volume_get_name (volume), complete->wait_name) &&
      storage_logical_volume_get_volume_group (volume) == STORAGE_VOLUME_GROUP (complete->wait_thing))
    {
      lvm_logical_volume_complete_rename (NULL, complete->invocation,
                                          storage_logical_volume_get_object_path (volume));
      g_signal_handler_disconnect (daemon, complete->wait_sig);
    }
}

static void
on_snapshot_complete (UDisksJob *job,
                      gboolean success,
                      gchar *message,
                      gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (success)
    return;

  g_dbus_method_invocation_return_error (complete->invocation, UDISKS_ERROR,
                                         UDISKS_ERROR_FAILED, "Error creating snapshot: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_create_snapshot (LvmLogicalVolume *volume,
                        GDBusMethodInvocation *invocation,
                        const gchar *name,
                        guint64 size,
                        GVariant *options)
{
  StorageLogicalVolume *self = STORAGE_LOGICAL_VOLUME (volume);
  StorageVolumeGroup *group;
  StorageDaemon *daemon;
  CompleteClosure *complete;
  StorageJob *job;
  GPtrArray *args;

  daemon = storage_daemon_get ();

  group = storage_logical_volume_get_volume_group (self);

  args = g_ptr_array_new_with_free_func (g_free);
  g_ptr_array_add (args, g_strdup ("lvcreate"));
  g_ptr_array_add (args, g_strdup ("-s"));
  g_ptr_array_add (args, g_strdup_printf ("%s/%s", storage_volume_group_get_name (group),
                                          storage_logical_volume_get_name (self)));
  g_ptr_array_add (args, g_strdup ("-n"));
  g_ptr_array_add (args, g_strdup (name));

  if (size > 0)
    {
      size -= size % 512;
      g_ptr_array_add (args, g_strdup_printf ("-L%" G_GUINT64_FORMAT "b", size));
    }

  g_ptr_array_add (args, NULL);
  job = storage_daemon_launch_spawned_jobv (daemon, self,
                                            "lvm-lvol-snapshot",
                                            storage_invocation_get_caller_uid (invocation),
                                            NULL, /* GCancellable */
                                            0,    /* uid_t run_as_uid */
                                            0,    /* uid_t run_as_euid */
                                            NULL,  /* input_string */
                                            (const gchar **)args->pdata);

  complete = g_new0 (CompleteClosure, 1);
  complete->wait_name = g_strdup (name);
  complete->wait_thing = g_object_ref (group);
  complete->invocation = g_object_ref (invocation);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_snapshot_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageLogicalVolume",
                                              G_CALLBACK (on_snapshot_logical_volume),
                                              complete, complete_closure_free, 0);

  g_ptr_array_free (args, TRUE);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
logical_volume_iface_init (LvmLogicalVolumeIface *iface)
{
  iface->handle_delete = handle_delete;
  iface->handle_rename = handle_rename;
  iface->handle_resize = handle_resize;
  iface->handle_activate = handle_activate;
  iface->handle_deactivate = handle_deactivate;
  iface->handle_create_snapshot = handle_create_snapshot;
}

const gchar *
storage_logical_volume_get_name (StorageLogicalVolume *self)
{
  g_return_val_if_fail (STORAGE_IS_LOGICAL_VOLUME (self), NULL);
  return self->name;
}

const gchar *
storage_logical_volume_get_object_path (StorageLogicalVolume *self)
{
  g_return_val_if_fail (STORAGE_IS_LOGICAL_VOLUME (self), NULL);
  return g_dbus_interface_skeleton_get_object_path (G_DBUS_INTERFACE_SKELETON (self));
}

StorageVolumeGroup *
storage_logical_volume_get_volume_group (StorageLogicalVolume *self)
{
  g_return_val_if_fail (STORAGE_IS_LOGICAL_VOLUME (self), NULL);
  return self->volume_group;
}

void
storage_logical_volume_set_volume_group (StorageLogicalVolume *self,
                                         StorageVolumeGroup *group)
{
  g_return_if_fail (STORAGE_IS_LOGICAL_VOLUME (self));

  g_clear_object (&self->volume_group);
  if (group != NULL)
    self->volume_group = g_object_ref (group);
  g_object_notify (G_OBJECT (self), "group");
  g_object_notify (G_OBJECT ( self), "volume-group");
}
