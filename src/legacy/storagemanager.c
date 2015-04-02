/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include <string.h>
#include <stdio.h>

#include "utils.h"
#include "daemon.h"
#include "storagemanager.h"
#include "storageprovider.h"
#include "storageobject.h"
#include "lvmutil.h"

#include "common/cockpitmemory.h"

typedef struct _StorageManagerClass StorageManagerClass;

struct _StorageManager
{
  CockpitStorageManagerSkeleton parent_instance;
  Daemon *daemon;

  UDisksClient *udisks;
  LvmManager *lvm_manager;
};

struct _StorageManagerClass
{
  CockpitStorageManagerSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON,
};

static void storage_manager_iface_init (CockpitStorageManagerIface *iface);

G_DEFINE_TYPE_WITH_CODE (StorageManager, storage_manager, COCKPIT_TYPE_STORAGE_MANAGER_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_MANAGER, storage_manager_iface_init));

static void
storage_manager_finalize (GObject *object)
{
  StorageManager *storage_manager = STORAGE_MANAGER (object);

  g_clear_object (&storage_manager->udisks);

  if (G_OBJECT_CLASS (storage_manager_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (storage_manager_parent_class)->finalize (object);
}

static void
storage_manager_get_property (GObject *object,
                              guint prop_id,
                              GValue *value,
                              GParamSpec *pspec)
{
  StorageManager *storage_manager = STORAGE_MANAGER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, storage_manager_get_daemon (storage_manager));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_manager_set_property (GObject *object,
                              guint prop_id,
                              const GValue *value,
                              GParamSpec *pspec)
{
  StorageManager *storage_manager = STORAGE_MANAGER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (storage_manager->daemon == NULL);
      storage_manager->daemon = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_manager_init (StorageManager *storage_manager)
{
}

static void
storage_manager_constructed (GObject *_object)
{
  StorageManager *storage_manager = STORAGE_MANAGER (_object);
  GError *error = NULL;

  storage_manager->udisks = udisks_client_new_sync (NULL, &error);
  if (storage_manager->udisks == NULL)
    {
      g_message ("error connecting to udisks: %s", error->message);
      g_clear_error (&error);
    }

  storage_manager->lvm_manager =
    lvm_manager_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                        0,
                                        "com.redhat.Cockpit.LVM",
                                        "/org/freedesktop/UDisks2/Manager",
                                        NULL,
                                        &error);
  if (storage_manager->lvm_manager == NULL)
    {
      g_message ("error connecting to storaged: %s", error->message);
      g_clear_error (&error);
    }

  g_dbus_proxy_set_default_timeout (G_DBUS_PROXY (storage_manager->lvm_manager), G_MAXINT);

  cockpit_storage_manager_set_have_udisks (COCKPIT_STORAGE_MANAGER (storage_manager),
                                           storage_manager->udisks != NULL &&
                                           g_dbus_object_manager_client_get_name_owner (
                                               G_DBUS_OBJECT_MANAGER_CLIENT (
                                                      udisks_client_get_object_manager (storage_manager->udisks))));

  cockpit_storage_manager_set_have_storaged (COCKPIT_STORAGE_MANAGER (storage_manager),
                                             storage_manager->lvm_manager != NULL &&
                                             g_dbus_proxy_get_name_owner (
                                                  G_DBUS_PROXY (storage_manager->lvm_manager)));

  G_OBJECT_CLASS (storage_manager_parent_class)->constructed (_object);
}

static void
storage_manager_class_init (StorageManagerClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_manager_finalize;
  gobject_class->constructed  = storage_manager_constructed;
  gobject_class->set_property = storage_manager_set_property;
  gobject_class->get_property = storage_manager_get_property;

  /**
   * StorageManager:daemon:
   *
   * The #Daemon to use.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_DAEMON,
                                   g_param_spec_object ("daemon",
                                                        "Daemon",
                                                        "The Daemon to use",
                                                        TYPE_DAEMON,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * storage_manager_new:
 * @daemon: A #Daemon.
 *
 * Create a new #StorageManager instance.
 *
 * Returns: A #StorageManager object. Free with g_object_unref().
 */
CockpitStorageManager *
storage_manager_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_STORAGE_MANAGER (g_object_new (TYPE_STORAGE_MANAGER,
                                                "daemon", daemon,
                                                NULL));
}

Daemon *
storage_manager_get_daemon (StorageManager *storage_manager)
{
  g_return_val_if_fail (IS_STORAGE_MANAGER (storage_manager), NULL);
  return storage_manager->daemon;
}

static GVariant *
null_asv (void)
{
  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));
  return g_variant_builder_end (&options);
}

/* MDRAID_CREATE */

static gboolean
handle_mdraid_create (CockpitStorageManager *object,
                      GDBusMethodInvocation *invocation,
                      const gchar *const *arg_blocks,
                      const gchar *arg_level,
                      const gchar *arg_name,
                      guint64 arg_chunk)
{
  StorageManager *storage_manager = STORAGE_MANAGER(object);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (storage_manager->daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  GError *error = NULL;

  int n_blocks = 0;
  for (int i = 0; arg_blocks[i]; i++)
    n_blocks += 1;

  const gchar *udisks_blocks[n_blocks + 1];

  for (int i = 0; arg_blocks[i]; i++)
    {
      StorageObject *stobj =
        STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_blocks[i]));
      UDisksBlock *block = storage_object_get_udisks_block (stobj);
      if (block)
        udisks_blocks[i] = g_dbus_proxy_get_object_path (G_DBUS_PROXY(block));
      else
        udisks_blocks[i] = "XXX";
    }

  udisks_blocks[n_blocks] = NULL;

  UDisksManager *manager = udisks_client_get_manager (storage_manager->udisks);
  if (manager == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "UDisks daemon is not running");
      return TRUE;
    }

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (!udisks_manager_call_mdraid_create_sync (manager,
                                               udisks_blocks,
                                               arg_level,
                                               arg_name,
                                               arg_chunk,
                                               null_asv (),
                                               NULL,
                                               NULL,
                                               &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
      return TRUE;
    }

  cockpit_storage_manager_complete_mdraid_create (object, invocation);
  return TRUE;
}

static gboolean
handle_volume_group_create (CockpitStorageManager *object,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_name,
                            const gchar *const *arg_blocks)
{
  StorageManager *storage_manager = STORAGE_MANAGER(object);
  GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (storage_manager->daemon);
  GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

  GError *error = NULL;

  int n_blocks = 0;
  for (int i = 0; arg_blocks[i]; i++)
    n_blocks += 1;

  const gchar *udisks_blocks[n_blocks + 1];

  for (int i = 0; arg_blocks[i]; i++)
    {
      StorageObject *stobj =
        STORAGE_OBJECT (g_dbus_object_manager_get_object (object_manager, arg_blocks[i]));
      UDisksBlock *block = storage_object_get_udisks_block (stobj);
      if (block)
        udisks_blocks[i] = g_dbus_proxy_get_object_path (G_DBUS_PROXY(block));
      else
        udisks_blocks[i] = "XXX";
    }

  udisks_blocks[n_blocks] = NULL;

  if (storage_manager->lvm_manager == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "storaged daemon is not running");
      return TRUE;
    }

  if (!lvm_manager_call_volume_group_create_sync (storage_manager->lvm_manager,
                                                  arg_name,
                                                  udisks_blocks,
                                                  null_asv (),
                                                  NULL,
                                                  NULL,
                                                  &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
      return TRUE;
    }

  cockpit_storage_manager_complete_volume_group_create (object, invocation);
  return TRUE;
}

/* INTERFACE */

static void
storage_manager_iface_init (CockpitStorageManagerIface *iface)
{
  iface->handle_mdraid_create = handle_mdraid_create;
  iface->handle_volume_group_create = handle_volume_group_create;
}

/* Utiltities */

static void
storage_remove_config (StorageProvider *provider,
                       UDisksBlock *block,
                       GVariant *config)
{
  GVariantIter iter;
  GVariant *item;
  GError *error = NULL;
  cleanup_unref_object UDisksBlock *block_to_use = NULL;

  if (block == NULL)
    {
      /* Any block can be used to add/remove any configuration item.
         Let's hope we have at least one...

         XXX - UDisks should offer a method for manipulating fstab and
               crypttab on the Manager.
      */

      UDisksClient *client = storage_provider_get_udisks_client (provider);
      GDBusObjectManager *manager = udisks_client_get_object_manager (client);
      GList *objects = g_dbus_object_manager_get_objects (manager);
      for (GList *l = objects; l; l = l->next)
        {
          UDisksObject *object = l->data;
          block_to_use = udisks_object_get_block (object);
          if (block_to_use)
            break;
        }
      g_list_free_full (objects, g_object_unref);

      if (block_to_use == NULL)
        {
          g_warning ("Can't remove config: no block object found.");
          return;
        }
    }
  else
    block_to_use = g_object_ref (block);

  g_variant_iter_init (&iter, config);
  while ((item = g_variant_iter_next_value (&iter)) != NULL)
    {
      if (!udisks_block_call_remove_configuration_item_sync (block_to_use,
                                                             item,
                                                             g_variant_new ("a{sv}", NULL),
                                                             NULL,
                                                             &error))
        {
          cleanup_free gchar *config_text = g_variant_print (config, FALSE);
          g_warning ("Can't remove storage configuration '%s': %s",
                     config_text, error->message);
          g_clear_error (&error);
        }
    }
}

gboolean
storage_remove_fstab_config (UDisksBlock *block,
                             GError **error)
{
  GVariant *conf = udisks_block_get_configuration (block);
  GVariantIter iter;
  GVariant *item;
  g_variant_iter_init (&iter, conf);
  while ((item = g_variant_iter_next_value (&iter)))
    {
      const gchar *type;
      g_variant_get (item, "(&s*)", &type, NULL);
      if (strcmp (type, "fstab") == 0)
        {
          if (!udisks_block_call_remove_configuration_item_sync (block,
                                                                 item,
                                                                 g_variant_new ("a{sv}", NULL),
                                                                 NULL,
                                                                 error))
            {
              g_variant_unref (item);
              return FALSE;
            }
          g_variant_unref (item);
        }
    }

  return TRUE;
}

gboolean
storage_remove_crypto_config (UDisksBlock *block,
                              GError **error)
{
  GVariant *conf = udisks_block_get_configuration (block);
  GVariantIter iter;
  GVariant *item;
  g_variant_iter_init (&iter, conf);
  while ((item = g_variant_iter_next_value (&iter)))
    {
      const gchar *type;
      g_variant_get (item, "(&s*)", &type, NULL);
      if (strcmp (type, "crypttab") == 0)
        {
          if (!udisks_block_call_remove_configuration_item_sync (block,
                                                                 item,
                                                                 g_variant_new ("a{sv}", NULL),
                                                                 NULL,
                                                                 error))
            {
              g_variant_unref (item);
              return FALSE;
            }
          g_variant_unref (item);
        }
    }

  return TRUE;
}

typedef gboolean BlockWalker (UDisksClient *client,
                              UDisksBlock *block,
                              gboolean is_leaf,
                              gpointer user_data,
                              GError **error);

static gboolean
walk_block (UDisksClient *client,
            UDisksBlock *block,
            BlockWalker *walker,
            gpointer user_data,
            GError **error)
{
  gboolean is_leaf = TRUE;

  UDisksObject *object = (UDisksObject *)g_dbus_interface_get_object (G_DBUS_INTERFACE(block));
  if (object != NULL)
    {
      // Recurse for all primary and extended partitions if this is a
      // partition table, or for all logical partitions if this is a
      // extended partition.

      UDisksPartitionTable *table;
      gboolean is_container;

      UDisksPartition *partition = udisks_object_peek_partition (object);
      if (partition && udisks_partition_get_is_container (partition))
        {
          table = udisks_client_get_partition_table (client, partition);
          is_container = TRUE;
        }
      else
        {
          table = udisks_object_peek_partition_table (object);
          is_container = FALSE;
        }

      if (table)
        {
          GList *ps, *l;
          ps = udisks_client_get_partitions (client, table);
          for (l = ps; l != NULL; l = l->next)
            {
              UDisksPartition *p = UDISKS_PARTITION (l->data);
              UDisksObject *o = (UDisksObject *) g_dbus_interface_get_object (G_DBUS_INTERFACE (p));
              UDisksBlock *b = o ? udisks_object_peek_block (o) : NULL;
              if (b && !is_container == !udisks_partition_get_is_contained (p))
                {
                  is_leaf = FALSE;
                  if (!walk_block (client, b, walker, user_data, error))
                    {
                      g_list_free_full (ps, g_object_unref);
                      return FALSE;
                    }
                }
            }
          g_list_free_full (ps, g_object_unref);
        }
    }

  cleanup_unref_object UDisksBlock *cleartext = udisks_client_get_cleartext_block (client, block);
  if (cleartext)
    {
      is_leaf = FALSE;
      if (!walk_block (client, cleartext, walker, user_data, error))
        return FALSE;
    }

  return walker (client, block, is_leaf, user_data, error);
}

typedef gboolean LogicalVolumeWalker (GDBusObjectManager *objman,
                                      LvmLogicalVolume *logical_volume,
                                      gpointer user_data,
                                      GError **error);

static gboolean
walk_logical_volume (GDBusObjectManager *objman,
                     LvmLogicalVolume *vol,
                     LogicalVolumeWalker *walker,
                     gpointer user_data,
                     GError **error)
{
  if (!walker (objman, vol, user_data, error))
    return FALSE;

  const gchar *vol_objpath = g_dbus_object_get_object_path (g_dbus_interface_get_object (G_DBUS_INTERFACE (vol)));
  LvmVolumeGroup *group = lvm_util_get_volume_group_for_logical_volume (objman, vol);
  GList *siblings = group ? lvm_util_get_logical_volumes_for_volume_group (objman, group) : NULL;
  gboolean ret = TRUE;

  for (GList *l = siblings; l; l = l->next)
    {
      LvmLogicalVolume *s = l->data;

      if ((g_strcmp0 (lvm_logical_volume_get_type_ (s), "snapshot") == 0
           && g_strcmp0 (lvm_logical_volume_get_origin (s), vol_objpath) == 0)
          || (g_strcmp0 (lvm_logical_volume_get_type_ (s), "thin") == 0
              && g_strcmp0 (lvm_logical_volume_get_thin_pool (s), vol_objpath) == 0))
        {
          if (!walk_logical_volume (objman, s, walker, user_data, error))
            {
              ret = FALSE;
              break;
            }
        }
    }

  g_list_free_full (siblings, g_object_unref);
  return ret;
}

static gboolean
walk_volume_group (GDBusObjectManager *objman,
                   LvmVolumeGroup *group,
                   LogicalVolumeWalker *walker,
                   gpointer user_data,
                   GError **error)
{
  GList *lvs = group ? lvm_util_get_logical_volumes_for_volume_group (objman, group) : NULL;
  gboolean ret = TRUE;

  for (GList *l = lvs; l; l = l->next)
    {
      LvmLogicalVolume *s = l->data;

      if (g_strcmp0 (lvm_logical_volume_get_type_ (s), "thin-pool") == 0)
        continue;

      if (!walker (objman, s, user_data, error))
        {
          ret = FALSE;
          break;
        }
    }

  g_list_free_full (lvs, g_object_unref);
  return ret;
}

static gboolean
cleanup_block_walker (UDisksClient *client,
                      UDisksBlock *block,
                      gboolean is_leaf,
                      gpointer user_data,
                      GError **error)
{
  StorageProvider *provider = user_data;
  UDisksObject *object = UDISKS_OBJECT (g_dbus_interface_get_object (G_DBUS_INTERFACE (block)));
  UDisksEncrypted *enc = udisks_object_peek_encrypted (object);

  if (enc)
    {
      UDisksBlock *cleartext = udisks_client_get_cleartext_block (client, block);
      if (cleartext)
        {
          /* The crypto backing device is unlocked and the cleartext
             device has been cleaned up.  Lock the backing device so
             that we can format or wipe it later.
          */
          if (enc && !udisks_encrypted_call_lock_sync (enc,
                                                       g_variant_new ("a{sv}", NULL),
                                                       NULL,
                                                       error))
            return FALSE;
        }
      else
        {
          /* The crypto backing device is locked and the cleartext
             device has not been cleaned up (since it doesn't exist).
             Remove its remembered configs.
          */
          GList *remembered_configs = storage_provider_get_and_forget_remembered_configs
              (provider, g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));
          for (GList *l = remembered_configs; l; l = l->next)
            {
              GVariant *config = l->data;
              storage_remove_config (provider, block, config);
            }
          g_list_free_full (remembered_configs, (GDestroyNotify)g_variant_unref);
        }
    }

  storage_remove_config (provider, block, udisks_block_get_configuration (block));

  return TRUE;
}

static gboolean
cleanup_block (StorageProvider *provider,
               UDisksBlock *block,
               GError **error)
{
  gboolean ret = walk_block (storage_provider_get_udisks_client (provider),
                             block, cleanup_block_walker, provider, error);
  storage_provider_save_remembered_configs (provider);
  return ret;
}

static gboolean
cleanup_logical_volume_walker (GDBusObjectManager *objman,
                               LvmLogicalVolume *logical_volume,
                               gpointer user_data,
                               GError **error)
{
  StorageProvider *provider = user_data;
  UDisksBlock *block = lvm_util_peek_block_for_logical_volume (storage_provider_get_lvm_object_manager (provider),
                                                               storage_provider_get_udisks_client (provider),
                                                               logical_volume);
  if (block)
    {
      /* The logical volume is active, let's clean it up by walking
         the tree of block devices hanging off of it.
       */
      return cleanup_block (provider, block, error);
    }
  else
    {
      /* The logical volume is inactive, let's clean it up by removing
         the remembered configs from its children.
      */
      LvmObject *object = LVM_OBJECT (g_dbus_interface_get_object (G_DBUS_INTERFACE (logical_volume)));
      GList *remembered_configs = storage_provider_get_and_forget_remembered_configs
        (provider, g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));
      for (GList *l = remembered_configs; l; l = l->next)
        {
          GVariant *config = l->data;
          storage_remove_config (provider, NULL, config);
        }
      g_list_free_full (remembered_configs, (GDestroyNotify)g_variant_unref);
      return TRUE;
    }
}

static gboolean
cleanup_logical_volume (StorageProvider *provider,
                        LvmLogicalVolume *logical_volume,
                        GError **error)
{
  gboolean ret = walk_logical_volume (storage_provider_get_lvm_object_manager (provider), logical_volume,
                                      cleanup_logical_volume_walker, provider, error);
  storage_provider_save_remembered_configs (provider);
  return ret;
}

static gboolean
cleanup_volume_group (StorageProvider *provider,
                      LvmVolumeGroup *group,
                      GError **error)
{
  gboolean ret = walk_volume_group (storage_provider_get_lvm_object_manager (provider), group,
                                    cleanup_logical_volume_walker, provider, error);
  storage_provider_save_remembered_configs (provider);
  return ret;
}

static gboolean
block_is_unused_walker (UDisksClient *client,
                        UDisksBlock *block,
                        gboolean is_leaf,
                        gpointer user_data,
                        GError **error)
{
  if (is_leaf)
    {
      Daemon *daemon = daemon_get ();
      StorageProvider *provider = daemon_get_storage_provider (daemon);
      GDBusObjectManagerServer *object_manager_server = daemon_get_object_manager (daemon);
      GDBusObjectManager *object_manager = G_DBUS_OBJECT_MANAGER (object_manager_server);

      CockpitObject *cockpit_object =
        COCKPIT_OBJECT (storage_provider_lookup_for_udisks_block (provider, block));

      if (cockpit_object)
        {
          CockpitStorageBlock *cockpit_block = cockpit_object_peek_storage_block (cockpit_object);
          if (cockpit_block)
            {
              const gchar *const *mounted_at = cockpit_storage_block_get_mounted_at (cockpit_block);
              if (mounted_at && mounted_at[0])
                {
                  g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                               "Device %s is in use: mounted at %s",
                               cockpit_storage_block_get_device (cockpit_block),
                               mounted_at[0]);
                  return FALSE;
                }

              const gchar *mdraid_member = cockpit_storage_block_get_mdraid_member (cockpit_block);
              if (mdraid_member && strcmp (mdraid_member, "/") != 0)
                {
                  CockpitObject *raid_object =
                    COCKPIT_OBJECT (g_dbus_object_manager_get_object (object_manager, mdraid_member));
                  CockpitStorageMDRaid *raid =
                    cockpit_object_peek_storage_mdraid (raid_object);

                  g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                               "Device %s is in use: member of RAID device %s",
                               cockpit_storage_block_get_device (cockpit_block),
                               cockpit_storage_mdraid_get_name (raid));
                  return FALSE;
                }

              const gchar *pv_group = cockpit_storage_block_get_pv_group (cockpit_block);
              if (pv_group && strcmp (pv_group, "/") != 0)
                {
                  CockpitObject *group_object =
                    COCKPIT_OBJECT (g_dbus_object_manager_get_object (object_manager, pv_group));
                  CockpitStorageVolumeGroup *group =
                    cockpit_object_peek_storage_volume_group (group_object);

                  g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                               "Device %s is in use: physical volume of %s",
                               cockpit_storage_block_get_device (cockpit_block),
                               cockpit_storage_volume_group_get_name (group));
                  return FALSE;
                }
            }
        }
    }

  return TRUE;
}

static gboolean
block_is_unused (UDisksClient *client,
                 UDisksBlock *block,
                 GError **error)
{
  return walk_block (client, block, block_is_unused_walker, NULL, error);
}

static gboolean
logical_volume_is_unused_walker (GDBusObjectManager *objman,
                                 LvmLogicalVolume *logical_volume,
                                 gpointer user_data,
                                 GError **error)
{
  StorageProvider *provider = user_data;
  UDisksBlock *block = lvm_util_peek_block_for_logical_volume (storage_provider_get_lvm_object_manager (provider),
                                                               storage_provider_get_udisks_client (provider),
                                                               logical_volume);
  if (block)
    return block_is_unused (storage_provider_get_udisks_client (provider), block, error);
  else
    return TRUE;
}

static gboolean
logical_volume_is_unused (StorageProvider *provider,
                          LvmLogicalVolume *vol,
                          GError **error)
{
  return walk_logical_volume (storage_provider_get_lvm_object_manager (provider), vol,
                              logical_volume_is_unused_walker, provider, error);
}

static gboolean
volume_group_is_unused (StorageProvider *provider,
                        LvmVolumeGroup *group,
                        GError **error)
{
  return walk_volume_group (storage_provider_get_lvm_object_manager (provider), group,
                            logical_volume_is_unused_walker, provider, error);
}

static gboolean
reload_systemd (GError **error)
{
  // XXX - do it.
  return TRUE;
}

gboolean
storage_cleanup_block (StorageProvider *provider,
                       UDisksBlock *block,
                       GError **error)
{
  return (block_is_unused (storage_provider_get_udisks_client (provider), block, error)
          && cleanup_block (provider, block, error)
          && reload_systemd (error));
}

gboolean
storage_cleanup_logical_volume (StorageProvider *provider,
                                LvmLogicalVolume *volume,
                                GError **error)
{
  return (logical_volume_is_unused (provider, volume, error)
          && cleanup_logical_volume (provider, volume, error)
          && reload_systemd (error));
}

gboolean
storage_cleanup_volume_group (StorageProvider *provider,
                              LvmVolumeGroup *group,
                              GError **error)
{
  return (volume_group_is_unused (provider, group, error)
          && cleanup_volume_group (provider, group, error)
          && reload_systemd (error));
}

typedef gboolean ObjectWalker (UDisksClient *client,
                               GDBusObject *object,
                               gpointer user_data,
                               GError **error);

static gboolean
walk_block_parents (UDisksClient *client,
                    GDBusObjectManager  *objman,
                    UDisksBlock *block,
                    ObjectWalker *walker,
                    gpointer user_data,
                    GError **error)
{
  /* Parents are
     - of a block that is a logical volume, the logical volume object
     - of a clear text device, the encrypted device.

     XXX - support the whole tree.
  */

  while (block)
    {
      const gchar *path = g_dbus_proxy_get_object_path (G_DBUS_PROXY (block));
      LvmLogicalVolumeBlock *lvm_block =
        LVM_LOGICAL_VOLUME_BLOCK (g_dbus_object_manager_get_interface (objman, path,
                                                                       "com.redhat.lvm2.LogicalVolumeBlock"));

      const gchar *logical_volume_path =
        (lvm_block ? lvm_logical_volume_block_get_logical_volume (lvm_block) : "/");
      const gchar *crypto_path = udisks_block_get_crypto_backing_device (block);

      if (g_strcmp0 (logical_volume_path, "/") != 0)
        {
          cleanup_unref_object LvmObject *logical_volume_object =
            LVM_OBJECT (g_dbus_object_manager_get_object (objman, logical_volume_path));

          if (logical_volume_object)
            {
              if (!walker (client, G_DBUS_OBJECT (logical_volume_object), user_data, error))
                return FALSE;
            }
          block = NULL;
        }
      else if (g_strcmp0 (crypto_path, "/") != 0)
        {
          UDisksObject *crypto_object = udisks_client_peek_object (client, crypto_path);
          if (crypto_object)
            {
              if (!walker (client, G_DBUS_OBJECT (crypto_object), user_data, error))
                return FALSE;
            }
          block = udisks_object_peek_block (crypto_object);
        }
      else
        block = NULL;
    }

  return TRUE;
}

struct RememberData {
  StorageProvider *provider;
  const gchar *child_path;
  GVariant *config;
};

static gboolean
remember_configs (UDisksClient *client,
                  GDBusObject *object,
                  gpointer user_data,
                  GError **error)
{
  struct RememberData *data = user_data;
  const gchar *parent_path = g_dbus_object_get_object_path (object);
  storage_provider_remember_config (data->provider, parent_path, data->child_path, data->config);
  return TRUE;
}

void
storage_remember_block_configs (StorageProvider *provider,
                                UDisksBlock *block)
{
  GVariant *config = udisks_block_get_configuration (block);
  if (g_variant_n_children (config) > 0)
    {
      UDisksClient *client = storage_provider_get_udisks_client (provider);
      GDBusObjectManager *objman = storage_provider_get_lvm_object_manager (provider);
      GDBusObject *object = g_dbus_interface_get_object (G_DBUS_INTERFACE (block));
      struct RememberData data;
      data.provider = provider;
      data.child_path = g_dbus_object_get_object_path (object);
      data.config = config;
      walk_block_parents (client, objman, block, remember_configs, &data, NULL);
    }
}
