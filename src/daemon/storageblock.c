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

#include "daemon.h"
#include "storagemanager.h"
#include "storageprovider.h"
#include "storageobject.h"
#include "storageblock.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:storageblock
 * @title: Block devices
 * @short_description: Implementation of #CockpitStorageBlock
 *
 * Instances of the #CockpitStorageBlock type are block devices.
 */

typedef struct _StorageBlockClass StorageBlockClass;

/**
 * <private>
 * StorageBlock:
 *
 * Private.
 */
struct _StorageBlock
{
  CockpitStorageBlockSkeleton parent_instance;

  UDisksBlock *udisks_block;

  StorageObject *object;
};

struct _StorageBlockClass
{
  CockpitStorageBlockSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_OBJECT
};

static void storage_block_iface_init (CockpitStorageBlockIface *iface);

static void on_udisks_block_notify (GObject    *object,
                                    GParamSpec *pspec,
                                    gpointer    user_data);

G_DEFINE_TYPE_WITH_CODE (StorageBlock, storage_block, COCKPIT_TYPE_STORAGE_BLOCK_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_BLOCK, storage_block_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_block_finalize (GObject *object)
{
  StorageBlock *block = STORAGE_BLOCK (object);

  g_signal_handlers_disconnect_by_func (block->udisks_block,
                                        G_CALLBACK (on_udisks_block_notify),
                                        block);
  g_object_unref (block->udisks_block);

  G_OBJECT_CLASS (storage_block_parent_class)->finalize (object);
}

static void
storage_block_get_property (GObject *object,
                            guint prop_id,
                            GValue *value,
                            GParamSpec *pspec)
{
  StorageBlock *block = STORAGE_BLOCK (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_value_set_object (value, block->object);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_block_set_property (GObject *object,
                            guint prop_id,
                            const GValue *value,
                            GParamSpec *pspec)
{
  StorageBlock *block = STORAGE_BLOCK (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_assert (block->object == NULL);
      block->object = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static const gchar *
variant_lookup (GVariant *dictionary,
                const gchar *key)
{
  const gchar *v;

  if (dictionary == NULL
      || !g_variant_lookup (dictionary, key, "^&ay", &v)
      || v[0] == '\0')
    return NULL;

  return v;
}

void
storage_block_update (StorageBlock *block)
{
  CockpitStorageBlock *iface = COCKPIT_STORAGE_BLOCK (block);
  StorageProvider *provider;
  UDisksClient *udisks_client;
  UDisksObject *udisks_object;
  UDisksBlock *udisks_block;
  UDisksPartition *udisks_partition = NULL;
  UDisksPartitionTable *udisks_partition_table = NULL;
  UDisksFilesystem *udisks_filesystem = NULL;

  provider = storage_object_get_provider (block->object);
  udisks_client = storage_provider_get_udisks_client (provider);
  udisks_block = block->udisks_block;
  udisks_object = (UDisksObject *)g_dbus_interface_get_object (G_DBUS_INTERFACE (udisks_block));
  if (udisks_object != NULL)
    {
      udisks_partition = udisks_object_peek_partition (udisks_object);
      udisks_partition_table = udisks_object_peek_partition_table (udisks_object);
      udisks_filesystem = udisks_object_peek_filesystem (udisks_object);
    }

  {
    cleanup_free gchar *d =
      g_filename_display_name (udisks_block_get_preferred_device (udisks_block));
    cockpit_storage_block_set_device (iface, d);
    cockpit_storage_block_set_device_number (iface, udisks_block_get_device_number (udisks_block));
  }

  cockpit_storage_block_set_size       (iface, udisks_block_get_size (udisks_block));
  cockpit_storage_block_set_id_usage   (iface, udisks_block_get_id_usage   (udisks_block));
  cockpit_storage_block_set_id_type    (iface, udisks_block_get_id_type    (udisks_block));
  cockpit_storage_block_set_id_version (iface, udisks_block_get_id_version (udisks_block));
  cockpit_storage_block_set_id_label   (iface, udisks_block_get_id_label   (udisks_block));
  cockpit_storage_block_set_id_uuid    (iface, udisks_block_get_id_uuid    (udisks_block));

  cockpit_storage_block_set_hint_ignore (iface, udisks_block_get_hint_ignore (udisks_block));
  cockpit_storage_block_set_read_only  (iface, udisks_block_get_read_only  (udisks_block));

  if (udisks_partition == NULL)
    {
      cockpit_storage_block_set_partition_number (iface, 0);
      cockpit_storage_block_set_partition_table (iface, "/");
    }
  else
    {
      UDisksPartitionTable *table_for_partition;
      const gchar *objpath = "/";
      GDBusObject *o;
      UDisksBlock *b;
      StorageObject *so;

      table_for_partition = udisks_client_get_partition_table (udisks_client, udisks_partition);
      if (table_for_partition != NULL)
        {
          o = g_dbus_interface_get_object (G_DBUS_INTERFACE (table_for_partition));
          if (o != NULL)
            {
              b = udisks_object_peek_block (UDISKS_OBJECT (o));
              if (b != NULL)
                {
                  so = storage_provider_lookup_for_udisks_block (provider, b);
                  if (so != NULL)
                    {
                      objpath = g_dbus_object_get_object_path (G_DBUS_OBJECT (so));
                    }
                }
            }
        }
      cockpit_storage_block_set_partition_table (iface, objpath);
      cockpit_storage_block_set_partition_number (iface, udisks_partition_get_number (udisks_partition));
    }

  GVariantBuilder partitions;
  g_variant_builder_init (&partitions, G_VARIANT_TYPE ("a(otts)"));

  if (udisks_partition_table != NULL)
    {
      GList *ps, *l;
      ps = udisks_client_get_partitions (udisks_client, udisks_partition_table);
      for (l = ps; l != NULL; l = l->next)
        {
          UDisksPartition *p = UDISKS_PARTITION (l->data);
          GDBusObject *o;
          UDisksBlock *b;
          StorageObject *so;

          o = g_dbus_interface_get_object (G_DBUS_INTERFACE (p));
          if (o != NULL)
            {
              b = udisks_object_peek_block (UDISKS_OBJECT (o));
              if (b != NULL)
                {
                  so = storage_provider_lookup_for_udisks_block (provider, b);
                  if (so != NULL)
                    {
                      const gchar *type = "p";
                      if (udisks_partition_get_is_container (p))
                        type = "x";
                      else if (udisks_partition_get_is_contained (p))
                        type = "l";
                      g_variant_builder_add (&partitions, "(otts)",
                                             g_dbus_object_get_object_path (G_DBUS_OBJECT (so)),
                                             udisks_partition_get_offset (p),
                                             udisks_partition_get_size (p),
                                             type);
                    }
                }
            }
        }
      g_list_free_full (ps, g_object_unref);
      const gchar *type = udisks_partition_table_get_type_ (udisks_partition_table);
      if (type == NULL || type[0] == '\0')
        type = "unknown";
      cockpit_storage_block_set_partition_table_type (iface, type);
    }
  else
    cockpit_storage_block_set_partition_table_type (iface, "");

  cockpit_storage_block_set_partitions (iface, g_variant_builder_end (&partitions));

  cockpit_storage_block_set_drive
    (iface, storage_provider_translate_path (provider, udisks_block_get_drive (udisks_block)));
  cockpit_storage_block_set_crypto_backing_device
    (iface, storage_provider_translate_path (provider, udisks_block_get_crypto_backing_device (udisks_block)));
  cockpit_storage_block_set_mdraid
    (iface, storage_provider_translate_path (provider, udisks_block_get_mdraid (udisks_block)));
  cockpit_storage_block_set_mdraid_member
    (iface, storage_provider_translate_path (provider, udisks_block_get_mdraid_member (udisks_block)));

  if (udisks_filesystem)
    {
      const gchar *const *p = udisks_filesystem_get_mount_points (udisks_filesystem);
      gchar *u[g_strv_length ((gchar **)p) + 1];
      int i;
      for (i = 0; p[i]; i++)
        u[i] = g_filename_display_name (p[i]);
      u[i] = NULL;
      cockpit_storage_block_set_mounted_at (iface, (const gchar *const *)u);
      for (i = 0; u[i]; i++)
        g_free (u[i]);
    }

  GVariantIter iter;
  g_variant_iter_init (&iter, udisks_block_get_configuration (udisks_block));
  const gchar *type;
  GVariant *details;
  gboolean got_fstab = FALSE, got_crypttab = FALSE;

  cleanup_free gchar *mount_point = NULL;
  cleanup_free gchar *mount_opts = NULL;
  cleanup_free gchar *crypt_opts = NULL;

  while (g_variant_iter_next (&iter, "(&s*)", &type, &details))
    {
      if (strcmp (type, "fstab") == 0 && !got_fstab)
        {
          got_fstab = TRUE;
          const gchar *dir = variant_lookup (details, "dir");
          if (dir)
            mount_point = g_filename_display_name (dir);
          const gchar *opts = variant_lookup (details, "opts");
          if (opts)
            {
              mount_opts = g_locale_to_utf8 (opts, -1, NULL, NULL, NULL);
              if (!mount_opts)
                g_warning ("Can't convert fstab options into UTF8");
            }
        }
      else if (strcmp (type, "crypttab") == 0 && !got_crypttab)
        {
          got_crypttab = TRUE;
          const gchar *opts = variant_lookup (details, "options");
          if (opts)
            {
              crypt_opts = g_locale_to_utf8 (opts, -1, NULL, NULL, NULL);
              if (!crypt_opts)
                g_warning ("Can't convert crypttab options into UTF8");
            }
        }
      g_variant_unref (details);
    }

  cockpit_storage_block_set_mount_point (iface, mount_point);
  cockpit_storage_block_set_mount_options (iface, mount_opts);
  cockpit_storage_block_set_crypto_options (iface, crypt_opts);

  /* Now the com.redhat.lvm2 overlays.  The StorageProvider makes sure
     that we are called whenever something changes about them.
   */

  LvmLogicalVolumeBlock *lv = NULL;
  LvmPhysicalVolumeBlock *pv = NULL;

  GDBusObjectManager *objman = storage_provider_get_lvm_object_manager (provider);
  GDBusObject *lvm_object =
    g_dbus_object_manager_get_object (objman,
                                      g_dbus_object_get_object_path (G_DBUS_OBJECT (udisks_object)));
  if (lvm_object)
    {
      lv = lvm_object_peek_logical_volume_block (LVM_OBJECT (lvm_object));
      pv = lvm_object_peek_physical_volume_block (LVM_OBJECT (lvm_object));
    }

  if (lv)
    {
      cockpit_storage_block_set_logical_volume
        (iface,
         storage_provider_translate_path
         (provider,
          lvm_logical_volume_block_get_logical_volume (lv)));
    }
  else
    cockpit_storage_block_set_logical_volume (iface, "/");

  if (pv)
    {
      cockpit_storage_block_set_pv_group
        (iface,
         storage_provider_translate_path (provider,
                                          lvm_physical_volume_block_get_volume_group (pv)));
      cockpit_storage_block_set_pv_size (iface,
                                         lvm_physical_volume_block_get_size (pv));
      cockpit_storage_block_set_pv_free_size (iface,
                                              lvm_physical_volume_block_get_free_size (pv));
    }
  else
    {
      cockpit_storage_block_set_pv_group (iface, "/");
      cockpit_storage_block_set_pv_size (iface, 0);
      cockpit_storage_block_set_pv_free_size (iface, 0);
    }
}

static void
on_udisks_block_notify (GObject *object,
                        GParamSpec *pspec,
                        gpointer user_data)
{
  StorageBlock *block = STORAGE_BLOCK (user_data);
  storage_block_update (block);
}

static void
storage_block_constructed (GObject *object)
{
  StorageBlock *block = STORAGE_BLOCK (object);

  block->udisks_block = g_object_ref (storage_object_get_udisks_block (block->object));
  g_signal_connect (block->udisks_block,
                    "notify",
                    G_CALLBACK (on_udisks_block_notify),
                    block);

  storage_block_update (block);

  if (G_OBJECT_CLASS (storage_block_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_block_parent_class)->constructed (object);
}

static void
storage_block_init (StorageBlock *block)
{
}

static void
storage_block_class_init (StorageBlockClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_block_finalize;
  gobject_class->constructed  = storage_block_constructed;
  gobject_class->set_property = storage_block_set_property;
  gobject_class->get_property = storage_block_get_property;

  /**
   * StorageBlock:object:
   *
   * The #CockpitStorageObject for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_OBJECT,
                                   g_param_spec_object ("object",
                                                        NULL,
                                                        NULL,
                                                        TYPE_STORAGE_OBJECT,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * storage_block_new:
 * @object: A #CockpitStorageObject
 *
 * Creates a new #StorageBlock instance.
 *
 * Returns: A new #StorageBlock. Free with g_object_unref().
 */
CockpitStorageBlock *
storage_block_new (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return COCKPIT_STORAGE_BLOCK (g_object_new (TYPE_STORAGE_BLOCK,
                                              "object", object,
                                              NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static UDisksBlock *
create_partition (StorageBlock *block,
                  guint64 offset,
                  guint64 size,
                  const gchar *type,
                  GError **error)
{
  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object (G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "No object!?");
      return NULL;
    }

  UDisksPartitionTable *table = udisks_object_peek_partition_table (udisks_object);
  if (table == NULL)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Block device has no partition table");
      return NULL;
    }

  cleanup_free gchar *part_object_path = NULL;

  if (!udisks_partition_table_call_create_partition_sync (table,
                                                          offset,
                                                          size,
                                                          type,
                                                          "",
                                                          g_variant_new ("a{sv}", NULL),
                                                          &part_object_path,
                                                          NULL,
                                                          error))
    return NULL;

  StorageProvider *provider = storage_object_get_provider (block->object);
  UDisksClient *client = storage_provider_get_udisks_client (provider);
  udisks_client_settle (client);

  cleanup_unref_object UDisksObject *partition_object =
      udisks_client_get_object (client, part_object_path);
  UDisksBlock *partition_block = udisks_object_peek_block (partition_object);
  if (partition_block == NULL)
    {
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "Partition has no associated block device");
      return NULL;
    }

  return partition_block;
}

static gboolean
set_fstab_config (UDisksBlock *block,
                  const gchar *mount_point,
                  const gchar *mount_options,
                  GError **error)
{
  if (mount_point && *mount_point)
    {
      cleanup_unref_object UDisksClient *client = udisks_client_new_sync (NULL, error);
      if (client == NULL)
        return FALSE;

      UDisksBlock *cleartext = udisks_client_get_cleartext_block (client, block);
      if (cleartext)
        return set_fstab_config (cleartext, mount_point, mount_options, error);

      GVariantBuilder item;
      g_variant_builder_init (&item, G_VARIANT_TYPE("a{sv}"));

      cleanup_free gchar *fsname = NULL;
      const gchar *uuid = udisks_block_get_id_uuid (block);
      if (uuid && *uuid)
        fsname = g_strdup_printf ("UUID=%s", uuid);
      else
        {
          // XXX - find a more stable name among the symlinks.
          fsname = udisks_block_dup_device (block);
        }
      g_variant_builder_add (&item, "{sv}", "fsname", g_variant_new_bytestring (fsname));

      cleanup_free gchar *dir = g_filename_from_utf8 (mount_point, -1, NULL, NULL, error);
      if (dir == NULL)
        return FALSE;
      g_variant_builder_add (&item, "{sv}", "dir", g_variant_new_bytestring (dir));

      if (mount_options && *mount_options)
        {
          cleanup_free gchar *opts = g_locale_from_utf8 (mount_options, -1, NULL, NULL, error);
          if (opts == NULL)
            return FALSE;
          g_variant_builder_add (&item, "{sv}", "opts", g_variant_new_bytestring (opts));
        }
      else
        g_variant_builder_add (&item, "{sv}", "opts", g_variant_new_bytestring ("defaults"));

      g_variant_builder_add (&item, "{sv}", "type", g_variant_new_bytestring ("auto"));
      g_variant_builder_add (&item, "{sv}", "freq", g_variant_new_int32 (0));
      g_variant_builder_add (&item, "{sv}", "passno", g_variant_new_int32 (0));

      if (!udisks_block_call_add_configuration_item_sync (block,
                                                          g_variant_new ("(sa{sv})",
                                                                         "fstab",
                                                                         &item),
                                                          g_variant_new ("a{sv}", NULL),
                                                          NULL,
                                                          error))
        return FALSE;
    }

  return TRUE;
}

static gboolean
set_crypto_config (UDisksBlock *block,
                   const gchar *crypto_passphrase,
                   const gchar *crypto_options,
                   GError **error)
{
  if (g_strcmp0 (udisks_block_get_id_usage (block), "crypto") != 0)
    return TRUE;

  GVariantBuilder item;
  g_variant_builder_init (&item, G_VARIANT_TYPE("a{sv}"));

  const gchar *uuid = udisks_block_get_id_uuid (block);
  cleanup_free gchar *name = NULL;
  if (uuid && *uuid)
    name = g_strdup_printf ("luks-%s", uuid);
  else
    {
      // just make something up and hope it is unique
      name = g_strdup_printf ("luks-%u", g_random_int ());
    }
  g_variant_builder_add (&item, "{sv}", "name", g_variant_new_bytestring (name));

  cleanup_free gchar *device = NULL;
  if (uuid && *uuid)
    device = g_strdup_printf ("UUID=%s", uuid);
  else
    {
      // XXX - find a more stable name among the symlinks.
      device = udisks_block_dup_device (block);
    }
  g_variant_builder_add (&item, "{sv}", "device", g_variant_new_bytestring (device));

  cleanup_free gchar *opts = g_locale_from_utf8 (crypto_options, -1, NULL, NULL, error);
  if (opts == NULL)
    return FALSE;
  g_variant_builder_add (&item, "{sv}", "options", g_variant_new_bytestring (opts));

  if (crypto_passphrase && *crypto_passphrase)
    {
      cleanup_free gchar *path = g_strdup_printf ("/etc/luks-keys/%s", name);
      g_variant_builder_add (&item, "{sv}", "passphrase-path",
                             g_variant_new_bytestring (path));
      g_variant_builder_add (&item, "{sv}", "passphrase-contents",
                             g_variant_new_bytestring (crypto_passphrase));
    }
  else
    {
      g_variant_builder_add (&item, "{sv}", "passphrase-path", g_variant_new_bytestring (""));
      g_variant_builder_add (&item, "{sv}", "passphrase-contents", g_variant_new_bytestring (""));
    }

  if (!udisks_block_call_add_configuration_item_sync (block,
                                                      g_variant_new ("(sa{sv})",
                                                                     "crypttab", &item),
                                                      g_variant_new ("a{sv}", NULL),
                                                      NULL,
                                                      error))
    return FALSE;

  return TRUE;
}

/* Formatting and configuring a block device

   We want the Format and CreatePartition method calls to return as
   soon as the parameters have been validated and the real action
   begins.  We also want to write the fstab and crypttab entries when
   the real action is complete because only then do we know whether we
   really want to write them and with what UUID.

   In order to achieve this, we call UDisks Format method without
   "no-block", and while it is running, we watch for the appearance of
   a suitable Job object.  As soon as one appears, we complete our
   D-Bus method call successfully.  When the Format method call
   returns, we write the fstab and crypttab entries.
*/

typedef struct {
  GDBusObjectManager *udisks_object_manager;
  UDisksBlock *block;
  GDBusMethodInvocation *invocation;
  gchar *mount_point;
  gchar *mount_options;
  gchar *crypto_passphrase;
  gchar *crypto_options;

  gint object_added_handler_id;
} FormatData;

static void on_format_done (GObject *source_object, GAsyncResult *res, gpointer user_data);
static void on_udisks_object_added (GDBusObjectManager *manager, GDBusObject *object, gpointer user_data);

static void
start_format_and_configure_block (StorageProvider *provider,
                                  UDisksBlock *block,
                                  GDBusMethodInvocation *invocation,
                                  const gchar *type,
                                  const gchar *erase,
                                  const gchar *label,
                                  const gchar *passphrase,
                                  const gchar *mount_point,
                                  const gchar *mount_options,
                                  const gchar *crypto_passphrase,
                                  const gchar *crypto_options)
{
  GError *error = NULL;

  if (!storage_cleanup_block (provider,
                              block,
                              &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
      return;
    }

  FormatData *data = g_new0(FormatData, 1);
  data->block = g_object_ref (block);
  data->invocation = g_object_ref (invocation);
  data->mount_point = g_strdup (mount_point);
  data->mount_options = g_strdup (mount_options);
  data->crypto_passphrase = g_strdup (crypto_passphrase);
  data->crypto_options = g_strdup (crypto_options);
  data->udisks_object_manager = udisks_client_get_object_manager (storage_provider_get_udisks_client (provider));

  data->object_added_handler_id = g_signal_connect (data->udisks_object_manager,
                                                    "object-added",
                                                    G_CALLBACK (on_udisks_object_added),
                                                    data);

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  if (erase && strcmp (erase, "no") != 0)
    g_variant_builder_add (&options, "{sv}", "erase", g_variant_new_string (erase));
  if (label && *label)
    g_variant_builder_add (&options, "{sv}", "label", g_variant_new_string (label));
  if (passphrase && *passphrase)
    g_variant_builder_add (&options, "{sv}", "encrypt.passphrase", g_variant_new_string (passphrase));

  udisks_block_call_format (block,
                            type,
                            g_variant_builder_end (&options),
                            NULL,
                            on_format_done,
                            data);
}

static void
on_udisks_object_added (GDBusObjectManager *manager,
                        GDBusObject *object,
                        gpointer user_data)
{
  FormatData *data = user_data;

  if (data->invocation == NULL)
    return;

  UDisksObject *udisks_object = UDISKS_OBJECT (object);
  UDisksJob *udisks_job = udisks_object_peek_job (udisks_object);
  if (udisks_job)
    {
      const gchar *us = g_dbus_proxy_get_object_path (G_DBUS_PROXY (data->block));
      const gchar *const *them = udisks_job_get_objects (udisks_job);
      for (int i = 0; them[i]; i++)
        {
          if (strcmp (them[i], us) == 0)
            {
              g_dbus_method_invocation_return_value (data->invocation, g_variant_new ("()"));
              g_clear_object (&data->invocation);
              break;
            }
        }
    }
}

static void
on_format_done (GObject *source_object,
                GAsyncResult *res,
                gpointer user_data)
{
  FormatData *data = user_data;
  GError *error = NULL;
  gboolean success;

  success = (udisks_block_call_format_finish (UDISKS_BLOCK (source_object), res, &error)
             && set_crypto_config (data->block,
                                   data->crypto_passphrase,
                                   data->crypto_options,
                                   &error)
             && set_fstab_config (data->block,
                                  data->mount_point,
                                  data->mount_options,
                                  &error));

  if (data->invocation)
    {
      if (!success)
        {
          g_dbus_error_strip_remote_error (error);
          g_dbus_method_invocation_return_error (data->invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s", error->message);
          g_error_free (error);
        }
      else
        g_dbus_method_invocation_return_value (data->invocation, g_variant_new ("()"));
    }

  g_signal_handler_disconnect (data->udisks_object_manager, data->object_added_handler_id);
  g_free (data->mount_point);
  g_free (data->mount_options);
  g_free (data->crypto_passphrase);
  g_free (data->crypto_options);
  g_clear_object (&data->invocation);
  g_object_unref (data->block);
}

static gboolean
handle_format (CockpitStorageBlock *object,
               GDBusMethodInvocation *invocation,
               const gchar *arg_type,
               const gchar *arg_erase,
               const gchar *arg_label,
               const gchar *arg_passphrase,
               const gchar *arg_mount_point,
               const gchar *arg_mount_options,
               const gchar *arg_crypto_passphrase,
               const gchar *arg_crypto_options)
{
  StorageBlock *block = STORAGE_BLOCK(object);

  start_format_and_configure_block (storage_object_get_provider (block->object),
                                    block->udisks_block,
                                    invocation,
                                    arg_type,
                                    arg_erase,
                                    arg_label,
                                    arg_passphrase,
                                    arg_mount_point,
                                    arg_mount_options,
                                    arg_crypto_passphrase,
                                    arg_crypto_options);
  return TRUE;
}

static gboolean
handle_create_partition (CockpitStorageBlock *object,
                         GDBusMethodInvocation *invocation,
                         guint64 arg_offset,
                         guint64 arg_size,
                         const gchar *arg_type,
                         const gchar *arg_erase,
                         const gchar *arg_label,
                         const gchar *arg_passphrase,
                         const gchar *arg_mount_point,
                         const gchar *arg_mount_options,
                         const gchar *arg_crypto_passphrase,
                         const gchar *arg_crypto_options)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;
  gboolean is_extended = (g_strcmp0 (arg_type, "dos-extended") == 0);

  UDisksBlock *partition_block = create_partition (block,
                                                   arg_offset,
                                                   arg_size,
                                                   (is_extended ? "0x05" : ""),
                                                   &error);
  if (partition_block == NULL)
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
      return TRUE;
    }

  if (!is_extended)
    {
      start_format_and_configure_block (storage_object_get_provider (block->object),
                                        partition_block,
                                        invocation,
                                        arg_type,
                                        arg_erase,
                                        arg_label,
                                        arg_passphrase,
                                        arg_mount_point,
                                        arg_mount_options,
                                        arg_crypto_passphrase,
                                        arg_crypto_options);
    }
  else
    cockpit_storage_block_complete_create_partition (object, invocation);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_delete_partition (CockpitStorageBlock *object,
                         GDBusMethodInvocation *invocation)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  StorageProvider *provider = storage_object_get_provider (block->object);

  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksPartition *part = udisks_object_peek_partition (udisks_object);
  if (part == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not a partition");
      g_error_free (error);
      return TRUE;
    }

  if (!storage_cleanup_block (provider,
                              block->udisks_block,
                              &error)
      || !udisks_partition_call_delete_sync (part,
                                             g_variant_new ("a{sv}", NULL),
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

  cockpit_storage_block_complete_delete_partition (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_mount (CockpitStorageBlock *object,
              GDBusMethodInvocation *invocation)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksFilesystem *fsys = udisks_object_peek_filesystem (udisks_object);
  if (fsys == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not a filesystem");
      g_error_free (error);
      return TRUE;
    }

  if (!udisks_filesystem_call_mount_sync (fsys,
                                          g_variant_new ("a{sv}", NULL),
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

  cockpit_storage_block_complete_mount (object, invocation);
  return TRUE;
}

static gboolean
handle_unmount (CockpitStorageBlock *object,
                GDBusMethodInvocation *invocation)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksFilesystem *fsys = udisks_object_peek_filesystem (udisks_object);
  if (fsys == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not a filesystem");
      g_error_free (error);
      return TRUE;
    }

  if (!udisks_filesystem_call_unmount_sync (fsys,
                                            g_variant_new ("a{sv}", NULL),
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

  cockpit_storage_block_complete_unmount (object, invocation);
  return TRUE;
}
/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_lock (CockpitStorageBlock *object,
             GDBusMethodInvocation *invocation)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksEncrypted *enc = udisks_object_peek_encrypted (udisks_object);
  if (enc == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not encrypted");
      g_error_free (error);
      return TRUE;
    }

  if (!udisks_encrypted_call_lock_sync (enc,
                                        g_variant_new ("a{sv}", NULL),
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

  cockpit_storage_block_complete_lock (object, invocation);
  return TRUE;
}

static gboolean
handle_unlock (CockpitStorageBlock *object,
               GDBusMethodInvocation *invocation,
               const gchar *arg_passphrase)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksEncrypted *enc = udisks_object_peek_encrypted (udisks_object);
  if (enc == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not encrypted");
      g_error_free (error);
      return TRUE;
    }

  if (!udisks_encrypted_call_unlock_sync (enc,
                                          arg_passphrase,
                                          g_variant_new ("a{sv}", NULL),
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

  cockpit_storage_block_complete_unlock (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_set_filesystem_options (CockpitStorageBlock *object,
                               GDBusMethodInvocation *invocation,
                               const gchar *arg_label,
                               const gchar *arg_mount_point,
                               const gchar *arg_mount_options)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  UDisksObject *udisks_object =
    (UDisksObject *) g_dbus_interface_get_object(G_DBUS_INTERFACE (block->udisks_block));
  if (udisks_object == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "No object!?");
      g_error_free (error);
      return TRUE;
    }

  UDisksFilesystem *fsys = udisks_object_peek_filesystem (udisks_object);
  if (fsys == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Block device is not a filesystem");
      g_error_free (error);
      return TRUE;
    }

  if (!udisks_filesystem_call_set_label_sync (fsys,
                                              arg_label,
                                              g_variant_new ("a{sv}", NULL),
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

  if (g_strcmp0 (arg_mount_point, cockpit_storage_block_get_mount_point (COCKPIT_STORAGE_BLOCK(block))) != 0
      || g_strcmp0 (arg_mount_options, cockpit_storage_block_get_mount_options (COCKPIT_STORAGE_BLOCK(block))) != 0)
    {
      if (!(storage_remove_fstab_config (block->udisks_block,
                                         &error)
            && set_fstab_config (block->udisks_block,
                                 arg_mount_point,
                                 arg_mount_options,
                                 &error)))
        {
          g_dbus_error_strip_remote_error (error);
          g_dbus_method_invocation_return_error (invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s", error->message);
          g_error_free (error);
          return TRUE;
        }
    }

  cockpit_storage_block_complete_set_filesystem_options (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_set_crypto_options (CockpitStorageBlock *object,
                           GDBusMethodInvocation *invocation,
                           const gchar *arg_passphrase,
                           const gchar *arg_options)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  if (!(storage_remove_crypto_config (block->udisks_block,
                                      &error)
        && set_crypto_config (block->udisks_block,
                              arg_passphrase,
                              arg_options,
                              &error)))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_error_free (error);
      return TRUE;
    }

  cockpit_storage_block_complete_set_crypto_options (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_get_crypto_passphrase (CockpitStorageBlock *object,
                              GDBusMethodInvocation *invocation)
{
  StorageBlock *block = STORAGE_BLOCK(object);
  GError *error = NULL;

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE("a{sv}"));

  GVariant *conf = NULL;
  if (!udisks_block_call_get_secret_configuration_sync (block->udisks_block,
                                                        g_variant_builder_end (&options),
                                                        &conf,
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

  GVariantIter iter;
  g_variant_iter_init (&iter, conf);
  const gchar *type;
  GVariant *details;
  while (g_variant_iter_next (&iter, "(&s*)", &type, &details))
    {
      if (strcmp (type, "crypttab") == 0)
        {
          const gchar *phrase = variant_lookup (details, "passphrase-contents");
          if (phrase)
            {
              cleanup_free gchar *phrase_locale = g_locale_to_utf8 (phrase, -1, NULL, NULL, NULL);
              if (phrase_locale)
                cockpit_storage_block_complete_get_crypto_passphrase (object, invocation,
                                                                      phrase_locale);
              else
                g_dbus_method_invocation_return_error (invocation,
                                                       COCKPIT_ERROR,
                                                       COCKPIT_ERROR_FAILED,
                                                       "Can't convert passphrase into UTF8");
              g_variant_unref (details);
              return TRUE;
            }
        }
      g_variant_unref (details);
    }

  cockpit_storage_block_complete_get_crypto_passphrase (object, invocation, "");
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_block_iface_init (CockpitStorageBlockIface *iface)
{
  iface->handle_format = handle_format;
  iface->handle_create_partition = handle_create_partition;
  iface->handle_delete_partition = handle_delete_partition;
  iface->handle_mount = handle_mount;
  iface->handle_unmount = handle_unmount;
  iface->handle_lock = handle_lock;
  iface->handle_unlock = handle_unlock;
  iface->handle_set_filesystem_options = handle_set_filesystem_options;
  iface->handle_set_crypto_options = handle_set_crypto_options;
  iface->handle_get_crypto_passphrase = handle_get_crypto_passphrase;
}
