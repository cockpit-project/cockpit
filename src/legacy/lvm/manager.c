/*
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
 */

#include "config.h"

#include "manager.h"

#include "block.h"
#include "daemon.h"
#include "invocation.h"
#include "udisksclient.h"
#include "util.h"
#include "volumegroup.h"

#include <gudev/gudev.h>
#include <glib/gi18n.h>

struct _StorageManager
{
  LvmManagerSkeleton parent;

  UDisksClient *udisks_client;
  GUdevClient *udev_client;

  /* maps from volume group name to StorageVolumeGroupObject
     instances.
  */
  GHashTable *name_to_volume_group;

  /* maps from UDisks object paths to StorageBlock instances.
   */
  GHashTable *udisks_path_to_block;

  gint lvm_delayed_update_id;

  /* GDBusObjectManager is that special kind of ugly */
  gulong sig_object_added;
  gulong sig_object_removed;
  gulong sig_interface_added;
  gulong sig_interface_removed;
};

typedef struct
{
  LvmManagerSkeletonClass parent;
} StorageManagerClass;

enum
{
  COLDPLUG_COMPLETED_SIGNAL,
  LAST_SIGNAL
};

static guint signals[LAST_SIGNAL] = { 0 };

static void lvm_manager_iface_init (LvmManagerIface *iface);
static void async_initable_iface_init (GAsyncInitableIface *iface);

G_DEFINE_TYPE_WITH_CODE (StorageManager, storage_manager, LVM_TYPE_MANAGER_SKELETON,
                         G_IMPLEMENT_INTERFACE (LVM_TYPE_MANAGER, lvm_manager_iface_init);
                         G_IMPLEMENT_INTERFACE (G_TYPE_ASYNC_INITABLE, async_initable_iface_init);
);

struct UpdateData {
  StorageManager *self;
  gboolean ignore_locks;
  GSimpleAsyncResult *task;

  int pending_vg_updates;
};

static void trigger_delayed_lvm_update (StorageManager *self);

static void
lvm_update_done (struct UpdateData *data)
{
  if (data->ignore_locks)
    {
      // Do a warmplug right away because we might have gotten invalid
      // data when ignoring locking during coldplug.

      trigger_delayed_lvm_update (data->self);
    }

  if (data->task)
    {
      g_simple_async_result_complete_in_idle (data->task);
      g_object_unref (data->task);
    }

  g_free (data);
}

static void
lvm_vg_update_done (StorageVolumeGroup *unused,
                    gpointer user_data)
{
  struct UpdateData *data = user_data;

  data->pending_vg_updates -= 1;
  if (data->pending_vg_updates == 0)
    lvm_update_done (data);
}

static void
lvm_update_from_variant (GPid pid,
                         GVariant *volume_groups,
                         GError *error,
                         gpointer user_data)
{
  struct UpdateData *data = user_data;
  StorageManager *self = data->self;
  GVariantIter var_iter;
  GHashTableIter vg_name_iter;
  gpointer key, value;
  const gchar *name;

  if (error != NULL)
    {
      g_critical ("%s", error->message);
      lvm_update_done (data);
      return;
    }

  /* Remove obsolete groups */
  g_hash_table_iter_init (&vg_name_iter, self->name_to_volume_group);
  while (g_hash_table_iter_next (&vg_name_iter, &key, &value))
    {
      const gchar *vg;
      StorageVolumeGroup *group;
      gboolean found = FALSE;

      name = key;
      group = value;

      g_variant_iter_init (&var_iter, volume_groups);
      while (g_variant_iter_next (&var_iter, "&s", &vg))
        {
          if (g_strcmp0 (vg, name) == 0)
            {
              found = TRUE;
              break;
            }
        }

      if (!found)
        {
          /* Object unpublishes itself */
          g_object_run_dispose (G_OBJECT (group));
          g_hash_table_iter_remove (&vg_name_iter);
        }
    }

  /* Add new groups and update existing groups */
  g_variant_iter_init (&var_iter, volume_groups);
  while (g_variant_iter_next (&var_iter, "&s", &name))
    {
      StorageVolumeGroup *group;
      group = g_hash_table_lookup (self->name_to_volume_group, name);

      if (group == NULL)
        {
          group = storage_volume_group_new (self, name);
          g_debug ("adding volume group: %s", name);

          g_hash_table_insert (self->name_to_volume_group, g_strdup (name), group);
        }

      data->pending_vg_updates += 1;
      storage_volume_group_update (group, data->ignore_locks, lvm_vg_update_done, data);
    }

  if (data->pending_vg_updates == 0)
    lvm_update_done (data);
}

static void
lvm_update (StorageManager *self,
            gboolean ignore_locks,
            GSimpleAsyncResult *task)
{
  struct UpdateData *data;
  const gchar *args[] = {
      "cockpit-lvm-helper", "-b", "list",
      NULL
  };

  data = g_new0 (struct UpdateData, 1);
  data->self = self;
  data->task = task;
  data->ignore_locks = ignore_locks;
  data->pending_vg_updates = 0;

  storage_daemon_spawn_for_variant (storage_daemon_get (), args, G_VARIANT_TYPE("as"),
                                    lvm_update_from_variant, data);
}

static gboolean
delayed_lvm_update (gpointer user_data)
{
  StorageManager *self = STORAGE_MANAGER (user_data);

  lvm_update (self, FALSE, NULL);
  self->lvm_delayed_update_id = 0;

  return FALSE;
}

static void
trigger_delayed_lvm_update (StorageManager *self)
{
  if (self->lvm_delayed_update_id > 0)
    return;

  self->lvm_delayed_update_id =
    g_timeout_add (100, delayed_lvm_update, self);
}

static gboolean
is_logical_volume (GUdevDevice *device)
{
  const gchar *dm_vg_name = g_udev_device_get_property (device, "DM_VG_NAME");
  return dm_vg_name && *dm_vg_name;
}

static gboolean
has_physical_volume_label (GUdevDevice *device)
{
  const gchar *id_fs_type = g_udev_device_get_property (device, "ID_FS_TYPE");
  return g_strcmp0 (id_fs_type, "LVM2_member") == 0;
}

static StorageBlock *
find_block (StorageManager *self,
            dev_t device_number)
{
  StorageBlock *our_block = NULL;
  UDisksBlock *real_block;
  GDBusObject *object;
  const gchar *path;

  real_block = udisks_client_get_block_for_dev (self->udisks_client, device_number);
  if (real_block != NULL)
    {
      object = g_dbus_interface_get_object (G_DBUS_INTERFACE (real_block));
      path = g_dbus_object_get_object_path (object);

      our_block = storage_manager_find_block (self, path);
      g_object_unref (real_block);
    }

  return our_block;
}

static gboolean
is_recorded_as_physical_volume (StorageManager *self,
                                GUdevDevice *device)
{
  StorageBlock *block;
  gboolean ret = FALSE;

  block = find_block (self, g_udev_device_get_device_number (device));
  if (block != NULL)
    {
      ret = (storage_block_get_physical_volume_block (block) != NULL);
      g_object_unref (block);
    }

  return ret;
}

static void
handle_block_uevent_for_lvm (StorageManager *self,
                             const gchar *action,
                             GUdevDevice *device)
{
  if (is_logical_volume (device)
      || has_physical_volume_label (device)
      || is_recorded_as_physical_volume (self, device))
    trigger_delayed_lvm_update (self);
}

static void
on_uevent (GUdevClient *client,
           const gchar *action,
           GUdevDevice *device,
           gpointer user_data)
{
  g_debug ("udev event '%s' for %s", action,
           device ? g_udev_device_get_name (device) : "???");
  handle_block_uevent_for_lvm (user_data, action, device);
}

static void
update_block_from_all_volume_groups (StorageManager *self,
                                     StorageBlock *block)
{
  GHashTableIter iter;
  gpointer value;

  g_hash_table_iter_init (&iter, self->name_to_volume_group);
  while (g_hash_table_iter_next (&iter, NULL, &value))
    storage_volume_group_update_block (STORAGE_VOLUME_GROUP (value), block);
}

static void
on_udisks_interface_added (GDBusObjectManager *udisks_object_manager,
                           GDBusObject *object,
                           GDBusInterface *interface,
                           gpointer user_data)
{
  StorageManager *self = user_data;
  StorageBlock *overlay;
  const gchar *path;

  if (!UDISKS_IS_BLOCK (interface))
    return;

  /* Same path as the original real udisks block */
  path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (interface));

  overlay = g_object_new (STORAGE_TYPE_BLOCK,
                          "real-block", interface,
                          "udev-client", self->udev_client,
                          NULL);

  g_hash_table_insert (self->udisks_path_to_block, g_strdup (path), overlay);

  update_block_from_all_volume_groups (self, overlay);
}

static void
on_udisks_object_added (GDBusObjectManager *udisks_object_manager,
                        GDBusObject *object,
                        gpointer user_data)
{
  GList *interfaces, *l;

  /* Yes, GDBusObjectManager really is this awkward */
  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = g_list_next (l))
    on_udisks_interface_added (udisks_object_manager, object, l->data, user_data);
  g_list_free_full (interfaces, g_object_unref);
}

static void
on_udisks_interface_removed (GDBusObjectManager *udisks_object_manager,
                             GDBusObject *object,
                             GDBusInterface *interface,
                             gpointer user_data)
{
  StorageManager *self = user_data;
  const gchar *path;
  StorageBlock *overlay;

  if (!UDISKS_IS_BLOCK (interface))
    return;

  /* Same path as the original real udisks block */
  path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (interface));

  overlay = g_hash_table_lookup (self->udisks_path_to_block, path);
  if (overlay)
    {
      g_object_run_dispose (G_OBJECT (overlay));
      g_hash_table_remove (self->udisks_path_to_block, path);
    }
}

static void
on_udisks_object_removed (GDBusObjectManager *udisks_object_manager,
                          GDBusObject *object,
                          gpointer user_data)
{
  GList *interfaces, *l;

  /* Yes, GDBusObjectManager really is this awkward */
  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = g_list_next (l))
    on_udisks_interface_removed (udisks_object_manager, object, l->data, user_data);
  g_list_free_full (interfaces, g_object_unref);
}

GList *
storage_manager_get_blocks (StorageManager *self)
{
  GList *blocks, *l;

  blocks = g_hash_table_get_values (self->udisks_path_to_block);
  for (l = blocks; l; l = l->next)
    g_object_ref (l->data);
  return blocks;
}

StorageBlock *
storage_manager_find_block (StorageManager *self,
                       const gchar *udisks_path)
{
  StorageBlock *block;
  block = g_hash_table_lookup (self->udisks_path_to_block, udisks_path);
  if (block)
    return g_object_ref (block);
  else
    return NULL;
}

static void
storage_manager_init (StorageManager *self)
{
  GDBusObjectManager *object_manager;
  GError *error = NULL;
  GList *objects, *o;
  GList *interfaces, *i;

  const gchar *subsystems[] = {
      "block",
      "iscsi_connection",
      "scsi",
      NULL
  };

  self->name_to_volume_group = g_hash_table_new_full (g_str_hash, g_str_equal, g_free,
                                                      (GDestroyNotify) g_object_unref);

  self->udisks_path_to_block = g_hash_table_new_full (g_str_hash, g_str_equal, g_free,
                                                      (GDestroyNotify) g_object_unref);

  /* get ourselves an udev client */
  self->udev_client = g_udev_client_new (subsystems);
  g_signal_connect (self->udev_client, "uevent", G_CALLBACK (on_uevent), self);

  self->udisks_client = udisks_client_new_sync (NULL, &error);
  if (error != NULL)
    {
      g_critical ("Couldn't connect to the main udisksd: %s", error->message);
      g_clear_error (&error);
    }
  else
    {
      object_manager = udisks_client_get_object_manager (self->udisks_client);
      objects = g_dbus_object_manager_get_objects (object_manager);
      for (o = objects; o != NULL; o = g_list_next (o))
        {
          interfaces = g_dbus_object_get_interfaces (o->data);
          for (i = interfaces; i != NULL; i = g_list_next (i))
            on_udisks_interface_added (object_manager, o->data, i->data, self);
          g_list_free_full (interfaces, g_object_unref);
        }
      g_list_free_full (objects, g_object_unref);

      self->sig_object_added = g_signal_connect (object_manager, "object-added",
                                                 G_CALLBACK (on_udisks_object_added), self);
      self->sig_interface_added = g_signal_connect (object_manager, "interface-added",
                                                    G_CALLBACK (on_udisks_interface_added), self);
      self->sig_object_removed = g_signal_connect (object_manager, "object-removed",
                                                   G_CALLBACK (on_udisks_object_removed), self);
      self->sig_interface_removed = g_signal_connect (object_manager, "interface-removed",
                                                      G_CALLBACK (on_udisks_interface_removed), self);
    }
}

static void
storage_manager_constructed (GObject *object)
{
  StorageManager *self = STORAGE_MANAGER (object);

  G_OBJECT_CLASS (storage_manager_parent_class)->constructed (object);

  udisks_client_settle (self->udisks_client);
}

static void
storage_manager_init_async (GAsyncInitable       *initable,
                            int                   io_priority,
                            GCancellable         *cancellable,
                            GAsyncReadyCallback   callback,
                            gpointer              user_data)
{
  StorageManager *self = STORAGE_MANAGER (initable);
  GSimpleAsyncResult *task;

  task = g_simple_async_result_new (G_OBJECT (initable), callback, user_data, storage_manager_init_async);
  lvm_update (self, TRUE, task);
}

static gboolean
storage_manager_init_async_finish (GAsyncInitable       *initable,
                                   GAsyncResult         *result,
                                   GError              **error)
{
  return !g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error);
}

static void
storage_manager_finalize (GObject *object)
{
  StorageManager *self = STORAGE_MANAGER (object);
  GDBusObjectManager *objman;

  if (self->udisks_client)
    {
      objman = udisks_client_get_object_manager (self->udisks_client);
      if (self->sig_object_added)
        g_signal_handler_disconnect (objman, self->sig_object_added);
      if (self->sig_interface_added)
        g_signal_handler_disconnect (objman, self->sig_interface_added);
      if (self->sig_object_removed)
        g_signal_handler_disconnect (objman, self->sig_object_removed);
      if (self->sig_interface_removed)
        g_signal_handler_disconnect (objman, self->sig_interface_removed);
      g_object_unref (self->udisks_client);
    }

  g_clear_object (&self->udev_client);
  g_hash_table_unref (self->name_to_volume_group);
  g_hash_table_unref (self->udisks_path_to_block);

  G_OBJECT_CLASS (storage_manager_parent_class)->finalize (object);
}

static void
storage_manager_class_init (StorageManagerClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->constructed = storage_manager_constructed;
  object_class->finalize = storage_manager_finalize;

  signals[COLDPLUG_COMPLETED_SIGNAL] =
    g_signal_new ("coldplug-completed",
                  STORAGE_TYPE_MANAGER,
                  G_SIGNAL_RUN_LAST,
                  0,
                  NULL,
                  NULL,
                  NULL,
                  G_TYPE_NONE,
                  0);
}

typedef struct {
  gchar **devices;
  gchar *vgname;
} VolumeGroupCreateJobData;

static gboolean
volume_group_create_job_thread (GCancellable *cancellable,
                                gpointer user_data,
                                GError **error)
{
  VolumeGroupCreateJobData *data = user_data;
  gchar *standard_output;
  gchar *standard_error;
  gint exit_status;
  GPtrArray *argv;
  gboolean ret;
  gint i;

  for (i = 0; data->devices[i] != NULL; i++)
    {
      if (!storage_util_wipe_block (data->devices[i], error))
        return FALSE;
    }

  argv = g_ptr_array_new ();
  g_ptr_array_add (argv, (gchar *)"vgcreate");
  g_ptr_array_add (argv, data->vgname);
  for (i = 0; data->devices[i] != NULL; i++)
    g_ptr_array_add (argv, data->devices[i]);
  g_ptr_array_add (argv, NULL);

  ret = g_spawn_sync (NULL, (gchar **)argv->pdata, NULL,
                      G_SPAWN_SEARCH_PATH, NULL, NULL,
                      &standard_output, &standard_error,
                      &exit_status, error);

  g_ptr_array_free (argv, TRUE);

  if (ret)
    {
      ret = storage_util_check_status_and_output ("vgcreate",
                                             exit_status, standard_output,
                                             standard_error, error);
    }

  if (ret)
    {
      // https://bugzilla.redhat.com/show_bug.cgi?id=1084944
      for (i = 0; data->devices[i] != NULL; i++)
        storage_util_trigger_udev (data->devices[i]);
    }

  g_free (standard_output);
  g_free (standard_error);
  return ret;
}

typedef struct {
  /* This part only accessed by thread */
  VolumeGroupCreateJobData data;

  GDBusMethodInvocation *invocation;
  gulong wait_sig;
} CompleteClosure;

static void
complete_closure_free (gpointer user_data,
                       GClosure *unused)
{
  CompleteClosure *complete = user_data;
  VolumeGroupCreateJobData *data = &complete->data;
  g_strfreev (data->devices);
  g_free (data->vgname);
  g_object_unref (complete->invocation);
  g_free (complete);
}

static void
on_create_volume_group (StorageDaemon *daemon,
                        StorageVolumeGroup *group,
                        gpointer user_data)
{
  CompleteClosure *complete = user_data;

  if (g_str_equal (storage_volume_group_get_name (group), complete->data.vgname))
    {
      lvm_manager_complete_volume_group_create (NULL, complete->invocation,
                                                storage_volume_group_get_object_path (group));
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
                                         UDISKS_ERROR_FAILED, "Error creating volume group: %s", message);
  g_signal_handler_disconnect (storage_daemon_get (), complete->wait_sig);
}

static gboolean
handle_volume_group_create (LvmManager *manager,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_name,
                            const gchar *const *arg_blocks,
                            GVariant *arg_options)
{
  StorageManager *self = STORAGE_MANAGER (manager);
  GError *error = NULL;
  GList *blocks = NULL;
  GList *l;
  guint n;
  StorageDaemon *daemon;
  gchar *encoded_name = NULL;
  CompleteClosure *complete;
  StorageJob *job;

  daemon = storage_daemon_get ();

  /* Collect and validate block objects
   *
   * Also, check we can open the block devices at the same time - this
   * is to avoid start deleting half the block devices while the other
   * half is already in use.
   */
  for (n = 0; arg_blocks != NULL && arg_blocks[n] != NULL; n++)
    {
      StorageBlock *block = NULL;

      block = storage_manager_find_block (self, arg_blocks[n]);

      /* Assumes ref, do this early for memory management */
      blocks = g_list_prepend (blocks, block);

      if (block == NULL)
        {
          g_dbus_method_invocation_return_error (invocation,
                                                 UDISKS_ERROR,
                                                 UDISKS_ERROR_FAILED,
                                                 "Invalid object path %s at index %d",
                                                 arg_blocks[n], n);
          goto out;
        }

      if (!storage_block_is_unused (block, &error))
        {
          g_dbus_method_invocation_take_error (invocation, error);
          goto out;
        }
    }

  blocks = g_list_reverse (blocks);

  /* Create the volume group... */
  complete = g_new0 (CompleteClosure, 1);
  complete->invocation = g_object_ref (invocation);
  complete->data.vgname = g_strdup (arg_name);
  complete->data.devices = g_new0 (gchar *, n + 1);
  for (n = 0, l = blocks; l != NULL; l = g_list_next (l), n++)
    {
      g_assert (arg_blocks[n] != NULL);
      complete->data.devices[n] = g_strdup (storage_block_get_device (l->data));
    }

  job = storage_daemon_launch_threaded_job (daemon, NULL,
                                       "lvm-vg-create",
                                       storage_invocation_get_caller_uid (invocation),
                                       volume_group_create_job_thread,
                                       &complete->data,
                                       NULL, NULL);

  /* Wait for the job to finish */
  g_signal_connect (job, "completed", G_CALLBACK (on_create_complete), complete);

  /* Wait for the object to appear */
  complete->wait_sig = g_signal_connect_data (daemon,
                                              "published::StorageVolumeGroup",
                                              G_CALLBACK (on_create_volume_group),
                                              complete, complete_closure_free, 0);

out:
  g_list_free_full (blocks, g_object_unref);
  g_free (encoded_name);

  return TRUE; /* returning TRUE means that we handled the method invocation */
}

static void
lvm_manager_iface_init (LvmManagerIface *iface)
{
  iface->handle_volume_group_create = handle_volume_group_create;
}

static void
async_initable_iface_init (GAsyncInitableIface *iface)
{
  iface->init_async = storage_manager_init_async;
  iface->init_finish = storage_manager_init_async_finish;
}

void
storage_manager_new_async (GAsyncReadyCallback callback,
                           gpointer user_data)
{
  return g_async_initable_new_async (STORAGE_TYPE_MANAGER, 0, NULL,
                                     callback, user_data,
                                     NULL);
}

StorageManager *
storage_manager_new_finish (GObject *source,
                            GAsyncResult *res)
{
  return STORAGE_MANAGER (g_async_initable_new_finish (G_ASYNC_INITABLE (source), res, NULL));
}
