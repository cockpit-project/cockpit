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
#include "storageprovider.h"
#include "storageobject.h"
#include "storagejob.h"
#include "storageblock.h"
#include "com.redhat.lvm2.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:storageprovider
 * @title: StorageProvider
 * @short_description: Provider of storage objects.
 *
 * Object for providing storage objects.
 */

typedef struct _StorageProviderClass StorageProviderClass;

/**
 * StorageProvider:
 *
 * The #StorageProvider structure contains only private data and
 * should only be accessed using the provided API.
 */
struct _StorageProvider
{
  GObject parent_instance;
  Daemon *daemon;

  UDisksClient *udisks_client;
  GDBusObjectManager *lvm_objman;

  GHashTable *hash_interface_to_storage_object;
  GHashTable *hash_job_to_storage_job;

  GMutex remembered_configs_mutex;
  GHashTable *remembered_configs;
  gboolean remembered_configs_need_save;

  GList *ifaces;
  GList *jobs;
};

struct _StorageProviderClass
{
  GObjectClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON,
};

G_DEFINE_TYPE (StorageProvider, storage_provider, G_TYPE_OBJECT);

static void
storage_provider_finalize (GObject *object)
{
  StorageProvider *provider = STORAGE_PROVIDER (object);

  g_hash_table_unref (provider->hash_interface_to_storage_object);
  g_hash_table_unref (provider->hash_job_to_storage_job);

  g_hash_table_unref (provider->remembered_configs);
  g_mutex_clear (&provider->remembered_configs_mutex);

  g_list_free_full (provider->ifaces, g_object_unref);
  g_list_free_full (provider->jobs, g_object_unref);
  g_clear_object (&provider->udisks_client);

  if (G_OBJECT_CLASS (storage_provider_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (storage_provider_parent_class)->finalize (object);
}

static void
storage_provider_get_property (GObject *object,
                               guint prop_id,
                               GValue *value,
                               GParamSpec *pspec)
{
  StorageProvider *provider = STORAGE_PROVIDER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, storage_provider_get_daemon (provider));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_provider_set_property (GObject *object,
                               guint prop_id,
                               const GValue *value,
                               GParamSpec *pspec)
{
  StorageProvider *provider = STORAGE_PROVIDER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (provider->daemon == NULL);
      provider->daemon = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_provider_init (StorageProvider *provider)
{
  provider->hash_interface_to_storage_object = g_hash_table_new_full (g_direct_hash,
                                                                            g_direct_equal,
                                                                            g_object_unref,
                                                                            g_object_unref);
  provider->hash_job_to_storage_job = g_hash_table_new_full (g_direct_hash,
                                                                   g_direct_equal,
                                                                   g_object_unref,
                                                                   g_object_unref);

  provider->remembered_configs = g_hash_table_new_full (g_str_hash,
                                                        g_str_equal,
                                                        g_free,
                                                        (GDestroyNotify)g_hash_table_unref);
  g_mutex_init (&provider->remembered_configs_mutex);

  storage_provider_load_remembered_configs (provider);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
diff_sorted_lists (GList *list1,
                   GList *list2,
                   GCompareFunc compare,
                   GList **added,
                   GList **removed,
                   GList **unchanged)
{
  int order;

  *added = *removed = NULL;
  if (unchanged != NULL)
    *unchanged = NULL;

  while (list1 != NULL &&
         list2 != NULL)
    {
      order = (*compare) (list1->data, list2->data);
      if (order < 0)
        {
          *removed = g_list_prepend (*removed, list1->data);
          list1 = list1->next;
        }
      else if (order > 0)
        {
          *added = g_list_prepend (*added, list2->data);
          list2 = list2->next;
        }
      else
        { /* same item */
          if (unchanged != NULL)
            *unchanged = g_list_prepend (*unchanged, list1->data);
          list1 = list1->next;
          list2 = list2->next;
        }
    }

  while (list1 != NULL)
    {
      *removed = g_list_prepend (*removed, list1->data);
      list1 = list1->next;
    }
  while (list2 != NULL)
    {
      *added = g_list_prepend (*added, list2->data);
      list2 = list2->next;
    }
}

/* ---------------------------------------------------------------------------------------------------- */

static gint
udisks_iface_compare_func (GDBusInterface *a,
                           GDBusInterface *b)
{
  return (char *)a - (char *)b;
}

static gint
_udisks_job_compare_func (UDisksJob *a,
                          UDisksJob *b)
{
  return (char *)a - (char *)b;
}

static GDBusInterface *
get_udisk_iface (UDisksObject *object)
{
  UDisksBlock *block = udisks_object_peek_block (object);
  if (block)
    {
      /* don't include unused loop or nbd devices */
      if (udisks_block_get_size (block) == 0 &&
          (g_str_has_prefix (udisks_block_get_device (block), "/dev/loop") ||
           g_str_has_prefix (udisks_block_get_device (block), "/dev/nbd")))
        return NULL;

      return G_DBUS_INTERFACE (block);
    }

  UDisksDrive *drive = udisks_object_peek_drive (object);
  if (drive)
    {
      return G_DBUS_INTERFACE (drive);
    }

  UDisksMDRaid *mdraid = udisks_object_peek_mdraid (object);
  if (mdraid)
    {
      return G_DBUS_INTERFACE (mdraid);
    }

  return NULL;
}

static GDBusInterface *
get_lvm_iface (LvmObject *object)
{
  LvmVolumeGroup *volume_group = lvm_object_peek_volume_group (object);
  if (volume_group)
    return G_DBUS_INTERFACE (volume_group);

  LvmLogicalVolume *logical_volume = lvm_object_peek_logical_volume (object);
  if (logical_volume)
    return G_DBUS_INTERFACE (logical_volume);

  // g_debug ("Unwanted LVM object %s", g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));

  return NULL;
}

static StorageObject *
make_storage_object (StorageProvider *provider,
                     GDBusInterface *iface)
{
  UDisksBlock *block = UDISKS_IS_BLOCK (iface) ? UDISKS_BLOCK (iface) : NULL;
  UDisksDrive *drive = UDISKS_IS_DRIVE (iface) ? UDISKS_DRIVE (iface) : NULL;
  UDisksMDRaid *mdraid = UDISKS_IS_MDRAID (iface) ? UDISKS_MDRAID (iface) : NULL;
  LvmVolumeGroup *volume_group = LVM_IS_VOLUME_GROUP (iface) ? LVM_VOLUME_GROUP (iface) : NULL;
  LvmLogicalVolume *logical_volume = LVM_IS_LOGICAL_VOLUME (iface) ? LVM_LOGICAL_VOLUME (iface) : NULL;
  return storage_object_new (provider, block, drive, mdraid, volume_group, logical_volume);
}

static void
provider_update_objects (StorageProvider *provider)
{
  GDBusObjectManagerServer *object_manager;
  GList *udisks_objects;
  GList *lvm_objects;
  GList *wanted;
  GList *added, *removed;
  GList *l;

  object_manager = G_DBUS_OBJECT_MANAGER_SERVER (daemon_get_object_manager (provider->daemon));
  udisks_objects = g_dbus_object_manager_get_objects (udisks_client_get_object_manager (provider->udisks_client));
  lvm_objects = g_dbus_object_manager_get_objects (provider->lvm_objman);

  wanted = NULL;
  for (l = udisks_objects; l != NULL; l = l->next)
    {
      GDBusInterface *iface = get_udisk_iface (UDISKS_OBJECT (l->data));
      if (iface == NULL)
        continue;

      wanted = g_list_prepend (wanted, g_object_ref (iface));
    }
  for (l = lvm_objects; l != NULL; l = l->next)
    {
      if (!LVM_IS_OBJECT (l->data))
        continue;

      GDBusInterface *iface = get_lvm_iface (LVM_OBJECT (l->data));
      if (iface == NULL)
        continue;

      wanted = g_list_prepend (wanted, g_object_ref (iface));
    }

  wanted = g_list_sort (wanted, (GCompareFunc)udisks_iface_compare_func);
  provider->ifaces = g_list_sort (provider->ifaces, (GCompareFunc)udisks_iface_compare_func);
  diff_sorted_lists (provider->ifaces, wanted, (GCompareFunc)udisks_iface_compare_func,
                     &added, &removed, NULL);

  for (l = removed; l != NULL; l = l->next)
    {
      GDBusInterface *iface = G_DBUS_INTERFACE (l->data);
      StorageObject *object;

      object = g_hash_table_lookup (provider->hash_interface_to_storage_object, iface);
      g_warn_if_fail (object != NULL);
      if (object)
        {
          g_warn_if_fail (g_dbus_object_manager_server_unexport (object_manager,
                          g_dbus_object_get_object_path (G_DBUS_OBJECT (object))));
        }

      g_hash_table_remove (provider->hash_interface_to_storage_object, iface);
      provider->ifaces = g_list_remove (provider->ifaces, iface);
      g_object_unref (iface);
    }

  for (l = added; l != NULL; l = l->next)
    {
      GDBusInterface *iface = G_DBUS_INTERFACE (l->data);
      StorageObject *object = make_storage_object (provider, iface);

      g_warn_if_fail (g_hash_table_lookup (provider->hash_interface_to_storage_object, iface) == NULL);
      g_hash_table_insert (provider->hash_interface_to_storage_object,
                           g_object_ref (iface),
                           object);

      cleanup_free gchar *object_path = storage_object_make_object_path (object);
      g_dbus_object_skeleton_set_object_path (G_DBUS_OBJECT_SKELETON (object), object_path);
      g_dbus_object_manager_server_export_uniquely (object_manager, G_DBUS_OBJECT_SKELETON (object));

      provider->ifaces = g_list_prepend (provider->ifaces, g_object_ref (iface));
    }

  g_list_free (added);
  g_list_free (removed);
  g_list_free_full (udisks_objects, g_object_unref);
  g_list_free_full (lvm_objects, g_object_unref);
  g_list_free_full (wanted, g_object_unref);
}

static void
provider_update_jobs (StorageProvider *provider)
{
  GDBusObjectManagerServer *object_manager;
  GList *udisks_objects;
  GList *lvm_objects;
  GList *all_objects;
  GList *wanted;
  GList *added, *removed;
  GList *l;

  object_manager = G_DBUS_OBJECT_MANAGER_SERVER (daemon_get_object_manager (provider->daemon));
  udisks_objects = g_dbus_object_manager_get_objects (udisks_client_get_object_manager (provider->udisks_client));
  lvm_objects = g_dbus_object_manager_get_objects (provider->lvm_objman);
  all_objects = g_list_concat (udisks_objects, lvm_objects);

  wanted = NULL;
  for (l = all_objects; l != NULL; l = l->next)
    {
      if (!UDISKS_IS_OBJECT (l->data))
        continue;

      UDisksObject *object = UDISKS_OBJECT (l->data);
      UDisksJob *job;

      job = udisks_object_peek_job (object);
      if (job == NULL)
        continue;

      const gchar *operation = udisks_job_get_operation (job);

      if (strcmp (operation, "format-mkfs") != 0
          && strcmp (operation, "format-erase") != 0
          && strcmp (operation, "lvm-vg-empty-device") != 0)
        continue;

      wanted = g_list_prepend (wanted, g_object_ref (job));
    }

  wanted = g_list_sort (wanted, (GCompareFunc)_udisks_job_compare_func);
  provider->jobs = g_list_sort (provider->jobs, (GCompareFunc)_udisks_job_compare_func);
  diff_sorted_lists (provider->jobs, wanted, (GCompareFunc)_udisks_job_compare_func,
                     &added, &removed, NULL);

  for (l = removed; l != NULL; l = l->next)
    {
      UDisksJob *job = UDISKS_JOB (l->data);
      CockpitJob *object;

      object = g_hash_table_lookup (provider->hash_job_to_storage_job, job);
      if (object == NULL)
        {
          g_warning ("No object for job %p", job);
        }
      else
        {
          g_warn_if_fail (g_dbus_object_manager_server_unexport (object_manager,
                                                                 g_dbus_object_get_object_path (G_DBUS_OBJECT (object))));
          g_hash_table_remove (provider->hash_job_to_storage_job, job);
        }

      provider->jobs = g_list_remove (provider->jobs, job);
      g_object_unref (job);
    }

  for (l = added; l != NULL; l = l->next)
    {
      UDisksJob *job = UDISKS_JOB (l->data);
      CockpitObjectSkeleton *object;
      CockpitJob *cockpit_job;
      gchar *object_path;

      object_path = utils_generate_object_path ("/com/redhat/Cockpit/Jobs",
                                                udisks_job_get_operation (job));

      cockpit_job = storage_job_new (provider, job);
      object = cockpit_object_skeleton_new (object_path);
      cockpit_object_skeleton_set_job (object, cockpit_job);
      g_object_unref (cockpit_job);

      g_free (object_path);

      g_warn_if_fail (g_hash_table_lookup (provider->hash_job_to_storage_job, job) == NULL);
      g_hash_table_insert (provider->hash_job_to_storage_job,
                           g_object_ref (job),
                           object);

      g_dbus_object_manager_server_export_uniquely (object_manager, G_DBUS_OBJECT_SKELETON (object));

      provider->jobs = g_list_prepend (provider->jobs, g_object_ref (job));
    }

  g_list_free (added);
  g_list_free (removed);
  g_list_free_full (all_objects, g_object_unref);
  g_list_free_full (wanted, g_object_unref);
}

static void
provider_update (StorageProvider *provider)
{
  provider_update_objects (provider);

  for (GList *l = provider->ifaces; l != NULL; l = l->next)
    {
      GDBusInterface *iface = G_DBUS_INTERFACE (l->data);
      StorageObject *object;
      object = g_hash_table_lookup (provider->hash_interface_to_storage_object,
                                    iface);
      g_assert (object != NULL);
      storage_object_update (object);
    }

  storage_provider_save_remembered_configs (provider);
}

static void
provider_update_block (StorageProvider *provider,
                       const gchar *path)
{
  UDisksObject *udisks_object = udisks_client_peek_object (provider->udisks_client, path);
  if (udisks_object == NULL)
    return;

  UDisksBlock *udisks_block = udisks_object_peek_block (udisks_object);
  if (udisks_block == NULL)
    return;

  StorageObject *storage_object = storage_provider_lookup_for_udisks_block (provider, udisks_block);
  if (storage_object == NULL)
    return;

  CockpitStorageBlock *storage_block = cockpit_object_peek_storage_block (COCKPIT_OBJECT (storage_object));
  if (storage_block == NULL)
    return;

  storage_block_update (STORAGE_BLOCK (storage_block));
}

static void
on_udisks_client_changed (UDisksClient *client,
                          gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  provider_update (provider);
}

static void
on_object_added (GDBusObjectManager *manager,
                 GDBusObject *object,
                 gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  provider_update_jobs (provider);
}

static void
on_object_removed (GDBusObjectManager *manager,
                   GDBusObject *object,
                   gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  provider_update_jobs (provider);
}

static void
lvm_object_changed (StorageProvider *provider,
                    GDBusObject *object)
{
  const gchar *path = g_dbus_object_get_object_path (object);

  if (g_str_has_prefix (path, "/org/freedesktop/UDisks2/block_devices/"))
    provider_update_block (provider, path);
  else if (g_str_has_prefix (path, "/org/freedesktop/UDisks2/jobs/"))
    provider_update_jobs (provider);
  else
    provider_update (provider);
}

static void
on_lvm_object_added (GDBusObjectManager *manager,
                     GDBusObject *object,
                     gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  lvm_object_changed (provider, object);
}

static void
on_lvm_object_removed (GDBusObjectManager *manager,
                       GDBusObject *object,
                       gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  lvm_object_changed (provider, object);
}

static void
on_lvm_interface_added (GDBusObjectManager *manager,
                        GDBusObject *object,
                        GDBusInterface *iface,
                        gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  lvm_object_changed (provider, object);
}

static void
on_lvm_interface_removed (GDBusObjectManager *manager,
                       GDBusObject *object,
                       GDBusInterface *iface,
                       gpointer user_data)
{
  StorageProvider *provider = STORAGE_PROVIDER (user_data);
  lvm_object_changed (provider, object);
}

static void
on_lvm_properties_changed (GDBusConnection *connection,
                           const gchar *sender_name,
                           const gchar *object_path,
                           const gchar *interface_name,
                           const gchar *signal_name,
                           GVariant *parameters,
                           gpointer user_data)
{
  StorageProvider *provider = user_data;
  provider_update_block (provider, object_path);
}

static GType
lvm_get_proxy_type (GDBusObjectManagerClient *manager,
                    const gchar *object_path,
                    const gchar *interface_name,
                    gpointer user_data)
{
  g_debug ("P %s %s", object_path, interface_name);
  if (g_str_has_prefix (object_path, "/org/freedesktop/UDisks2/jobs/"))
    return udisks_object_manager_client_get_proxy_type (manager, object_path, interface_name, NULL);
  else
    return lvm_object_manager_client_get_proxy_type (manager, object_path, interface_name, NULL);
}

static void
storage_provider_constructed (GObject *_object)
{
  StorageProvider *provider = STORAGE_PROVIDER (_object);
  GError *error = NULL;

  /* TODO: use GInitable/GAsyncInitable or start() pattern here */

  provider->udisks_client = udisks_client_new_sync (NULL, &error);
  if (provider->udisks_client == NULL)
    {
      g_warning ("Error connecting to udisks: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_clear_error (&error);
      goto out;
    }

  provider->lvm_objman =
    g_dbus_object_manager_client_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                                   0,
                                                   "com.redhat.Cockpit.LVM",
                                                   "/org/freedesktop/UDisks2",
                                                   lvm_get_proxy_type,
                                                   NULL,
                                                   NULL,
                                                   NULL,
                                                   &error);
  if (provider->lvm_objman == NULL)
    {
      g_warning ("Error connecting to storaged: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_clear_error (&error);
      goto out;
    }

  /* HACK: Kill the object manager client when storaged isn't running
     and bail out.  Otherwise it will erroneously pick up signals
     intended for the UDisks2 object manager with the same object path
     (730440).  It will then create proxies for unknown interfaces and
     bad things will happen (730442).

     https://bugzilla.gnome.org/show_bug.cgi?id=730440
     https://bugzilla.gnome.org/show_bug.cgi?id=730442
  */

  if (g_dbus_object_manager_client_get_name_owner (G_DBUS_OBJECT_MANAGER_CLIENT (provider->lvm_objman)) == NULL)
    {
      g_message ("storaged not running");
      g_clear_object (&provider->lvm_objman);
      goto out;
    }

  g_signal_connect (provider->lvm_objman,
                    "object-added",
                    G_CALLBACK (on_lvm_object_added),
                    provider);
  g_signal_connect (provider->lvm_objman,
                    "object-removed",
                    G_CALLBACK (on_lvm_object_removed),
                    provider);
  g_signal_connect (provider->lvm_objman,
                    "interface-added",
                    G_CALLBACK (on_lvm_interface_added),
                    provider);
  g_signal_connect (provider->lvm_objman,
                    "interface-removed",
                    G_CALLBACK (on_lvm_interface_removed),
                    provider);

  GDBusConnection *connection = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, NULL);
  if (connection)
    {
      g_dbus_connection_signal_subscribe (connection,
                                          "com.redhat.Cockpit.LVM",
                                          "org.freedesktop.DBus.Properties",
                                          "PropertiesChanged",
                                          NULL,
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_lvm_properties_changed,
                                          provider,
                                          NULL);
    }

  /* init */
  provider_update (provider);
  provider_update_jobs (provider);

  g_signal_connect (provider->udisks_client,
                    "changed",
                    G_CALLBACK (on_udisks_client_changed),
                    provider);

  /* We don't use the "changed" signal to watch jobs since we might
     miss some that only exist for a very short period, but we still
     want to report their failures.
   */
  GDBusObjectManager *object_manager;
  object_manager = udisks_client_get_object_manager (provider->udisks_client);
  g_signal_connect (object_manager,
                    "object-added",
                    G_CALLBACK (on_object_added),
                    provider);
  g_signal_connect (object_manager,
                    "object-removed",
                    G_CALLBACK (on_object_removed),
                    provider);

out:
  if (G_OBJECT_CLASS (storage_provider_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_provider_parent_class)->constructed (_object);
}

static void
storage_provider_class_init (StorageProviderClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_provider_finalize;
  gobject_class->constructed  = storage_provider_constructed;
  gobject_class->set_property = storage_provider_set_property;
  gobject_class->get_property = storage_provider_get_property;

  /**
   * StorageProvider:daemon:
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
 * storage_provider_new:
 * @daemon: A #Daemon.
 *
 * Create a new #StorageProvider instance.
 *
 * Returns: A #StorageProvider object. Free with g_object_unref().
 */
StorageProvider *
storage_provider_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return STORAGE_PROVIDER (g_object_new (TYPE_STORAGE_PROVIDER,
                                         "daemon", daemon,
                                         NULL));
}

Daemon *
storage_provider_get_daemon (StorageProvider *provider)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  return provider->daemon;
}

UDisksClient *
storage_provider_get_udisks_client (StorageProvider *provider)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  return provider->udisks_client;
}

GDBusObjectManager *
storage_provider_get_lvm_object_manager (StorageProvider *provider)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  return provider->lvm_objman;
}

StorageObject *
storage_provider_lookup_for_udisks_block (StorageProvider *provider,
                                          UDisksBlock *udisks_block)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  g_return_val_if_fail (UDISKS_IS_BLOCK (udisks_block), NULL);
  return g_hash_table_lookup (provider->hash_interface_to_storage_object,
                              udisks_block);
}

StorageObject *
storage_provider_lookup_for_udisks_drive (StorageProvider *provider,
                                          UDisksDrive *udisks_drive)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  g_return_val_if_fail (UDISKS_IS_DRIVE (udisks_drive), NULL);
  return g_hash_table_lookup (provider->hash_interface_to_storage_object,
                              udisks_drive);
}

StorageObject *
storage_provider_lookup_for_udisks_mdraid (StorageProvider *provider,
                                           UDisksMDRaid *udisks_mdraid)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  g_return_val_if_fail (UDISKS_IS_MDRAID (udisks_mdraid), NULL);
  return g_hash_table_lookup (provider->hash_interface_to_storage_object,
                              udisks_mdraid);
}

StorageObject *
storage_provider_lookup_for_lvm_volume_group (StorageProvider *provider,
                                              LvmVolumeGroup *lvm_volume_group)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  g_return_val_if_fail (LVM_IS_VOLUME_GROUP (lvm_volume_group), NULL);
  return g_hash_table_lookup (provider->hash_interface_to_storage_object,
                              lvm_volume_group);
}

StorageObject *
storage_provider_lookup_for_lvm_logical_volume (StorageProvider *provider,
                                                LvmLogicalVolume *lvm_logical_volume)
{
  g_return_val_if_fail (IS_STORAGE_PROVIDER (provider), NULL);
  g_return_val_if_fail (LVM_IS_LOGICAL_VOLUME (lvm_logical_volume), NULL);
  return g_hash_table_lookup (provider->hash_interface_to_storage_object,
                              lvm_logical_volume);
}

const gchar *
storage_provider_translate_path (StorageProvider *provider,
                                 const gchar *udisks_or_lvm_path)
{
  StorageObject *object = NULL;

  if (udisks_or_lvm_path == NULL)
    udisks_or_lvm_path = "/";

  cleanup_unref_object UDisksObject *udisks_object = udisks_client_get_object (provider->udisks_client,
                                                                          udisks_or_lvm_path);
  if (udisks_object != NULL)
    {

      UDisksDrive *udisks_drive = udisks_object_peek_drive (udisks_object);
      if (udisks_drive != NULL)
        object = storage_provider_lookup_for_udisks_drive (provider, udisks_drive);

      UDisksBlock *udisks_block = udisks_object_peek_block (udisks_object);
      if (udisks_block != NULL)
        object = storage_provider_lookup_for_udisks_block (provider, udisks_block);

      UDisksMDRaid *udisks_raid = udisks_object_peek_mdraid (udisks_object);
      if (udisks_raid != NULL)
        object = storage_provider_lookup_for_udisks_mdraid (provider, udisks_raid);
    }

  cleanup_unref_object LvmObject *lvm_object = LVM_OBJECT (g_dbus_object_manager_get_object (provider->lvm_objman,
                                                                                        udisks_or_lvm_path));
  if (lvm_object)
    {
      LvmVolumeGroup *lvm_volume_group = lvm_object_peek_volume_group (lvm_object);
      if (lvm_volume_group != NULL)
        object = storage_provider_lookup_for_lvm_volume_group (provider, lvm_volume_group);

      LvmLogicalVolume *lvm_logical_volume = lvm_object_peek_logical_volume (lvm_object);
      if (lvm_logical_volume != NULL)
        object = storage_provider_lookup_for_lvm_logical_volume (provider, lvm_logical_volume);
    }

  if (object != NULL)
    {
      // g_debug ("%s -> %s", udisks_or_lvm_path, g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));
      return g_dbus_object_get_object_path (G_DBUS_OBJECT (object));
    }
  else
    {
      // g_debug ("%s -> nothing", udisks_or_lvm_path);
      return "/";
    }
}

static void
remember_config_inlock (StorageProvider *provider,
                        const gchar *parent_path,
                        const gchar *child_path,
                        GVariant *config)
{
  GHashTable *child_configs = g_hash_table_lookup (provider->remembered_configs, parent_path);
  if (child_configs == NULL)
    {
      child_configs = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, (GDestroyNotify)g_variant_unref);
      g_hash_table_insert (provider->remembered_configs, g_strdup (parent_path), child_configs);
    }

  GVariant *old = g_hash_table_lookup (child_configs, child_path);
  if (old == NULL || !g_variant_equal (old, config))
    {
      g_hash_table_insert (child_configs, g_strdup (child_path), g_variant_ref (config));
      provider->remembered_configs_need_save = TRUE;
    }
}

void
storage_provider_remember_config (StorageProvider *provider,
                                  const gchar *parent_path,
                                  const gchar *child_path,
                                  GVariant *config)
{
  g_mutex_lock (&provider->remembered_configs_mutex);
  remember_config_inlock (provider, parent_path, child_path, config);
  g_mutex_unlock (&provider->remembered_configs_mutex);
}

void
storage_provider_save_remembered_configs (StorageProvider *provider)
{
  g_mutex_lock (&provider->remembered_configs_mutex);

  if (!provider->remembered_configs_need_save)
    {
      g_mutex_unlock (&provider->remembered_configs_mutex);
      return;
    }

  GVariantBuilder parent_builder;
  GHashTableIter parent_iter;
  gpointer parent_key, parent_value;

  g_variant_builder_init (&parent_builder, G_VARIANT_TYPE("a{sa{sv}}"));
  g_hash_table_iter_init (&parent_iter, provider->remembered_configs);
  while (g_hash_table_iter_next (&parent_iter, &parent_key, &parent_value))
    {
      const gchar *parent_path = parent_key;
      GHashTable *child_configs = parent_value;

      GVariantBuilder child_builder;
      GHashTableIter child_iter;
      gpointer child_key, child_value;

      g_variant_builder_init (&child_builder, G_VARIANT_TYPE("a{sv}"));
      g_hash_table_iter_init (&child_iter, child_configs);
      while (g_hash_table_iter_next (&child_iter, &child_key, &child_value))
        {
          const gchar *child_path = child_key;
          GVariant *config = child_value;
          g_variant_builder_add (&child_builder, "{sv}", child_path, config);
        }

      g_variant_builder_add (&parent_builder, "{sa{sv}}", parent_path, &child_builder);
    }

  cleanup_unref_variant GVariant *info = g_variant_builder_end (&parent_builder);
  gconstpointer info_data = g_variant_get_data (info);
  gsize info_size = g_variant_get_size (info);
  GError *error = NULL;

  if (!g_file_set_contents (PACKAGE_LOCALSTATE_DIR "/lib/cockpit/hidden-configs",
                            info_data, info_size,
                            &error))
    {
      g_warning ("Can't save hidden configs: %s", error->message);
      g_clear_error (&error);
    }

  g_mutex_unlock (&provider->remembered_configs_mutex);
}

void
storage_provider_load_remembered_configs (StorageProvider *provider)
{
  gchar *info_data;
  gsize info_size;
  GError *error = NULL;

  g_mutex_lock (&provider->remembered_configs_mutex);

  if (!g_file_get_contents (PACKAGE_LOCALSTATE_DIR "/lib/cockpit/hidden-configs",
                            &info_data, &info_size,
                            &error))
    {
      if (!g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        g_warning ("Can't load hidden configs: %s", error->message);
      g_clear_error (&error);
      g_mutex_unlock (&provider->remembered_configs_mutex);
      return;
    }

  cleanup_unref_variant GVariant *info = g_variant_new_from_data (G_VARIANT_TYPE ("a{sa{sv}}"),
                                                             info_data, info_size, TRUE,
                                                             g_free, NULL);

  GVariantIter parent_iter, *child_iter;
  const gchar *parent_path, *child_path;
  GVariant *config;

  g_hash_table_remove_all (provider->remembered_configs);
  g_variant_iter_init (&parent_iter, info);
  while (g_variant_iter_next (&parent_iter, "{&sa{sv}}", &parent_path, &child_iter))
    {
      while (g_variant_iter_next (child_iter, "{&sv}", &child_path, &config))
        {
          remember_config_inlock (provider, parent_path, child_path, config);
          g_variant_unref (config);
        }
      g_variant_iter_free (child_iter);
    }
  provider->remembered_configs_need_save = FALSE;

  g_mutex_unlock (&provider->remembered_configs_mutex);
}

GList *
storage_provider_get_and_forget_remembered_configs (StorageProvider *provider,
                                                    const gchar *parent_path)
{
  g_mutex_lock (&provider->remembered_configs_mutex);

  GList *result = NULL;
  GHashTable *child_configs = g_hash_table_lookup (provider->remembered_configs, parent_path);
  if (child_configs)
    {
      result = g_hash_table_get_values (child_configs);
      for (GList *l = result; l; l = l->next)
        g_variant_ref ((GVariant *)l->data);
      g_hash_table_remove (provider->remembered_configs, parent_path);
      provider->remembered_configs_need_save = TRUE;
    }

  g_mutex_unlock (&provider->remembered_configs_mutex);
  return result;
}
