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

#include "daemon.h"
#include "storageprovider.h"
#include "storageobject.h"
#include "storagedrive.h"

/**
 * SECTION:storagedrive
 * @title: Drives
 * @short_description: Implementation of #CockpitStorageDrive
 *
 * Instances of the #CockpitStorageDrive type are drives (typically hard
 * disks).
 */

typedef struct _StorageDriveClass StorageDriveClass;

/**
 * <private>
 * StorageDrive:
 *
 * Private.
 */
struct _StorageDrive
{
  CockpitStorageDriveSkeleton parent_instance;

  UDisksDrive *udisks_drive;
  UDisksDriveAta *udisks_drive_ata; /* may be NULL */

  StorageObject *object;
};

struct _StorageDriveClass
{
  CockpitStorageDriveSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_OBJECT
};

static void storage_drive_iface_init (CockpitStorageDriveIface *iface);

static void on_udisks_drive_notify (GObject    *object,
                                    GParamSpec *pspec,
                                    gpointer    user_data);

G_DEFINE_TYPE_WITH_CODE (StorageDrive, storage_drive, COCKPIT_TYPE_STORAGE_DRIVE_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_STORAGE_DRIVE, storage_drive_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_drive_finalize (GObject *object)
{
  StorageDrive *drive = STORAGE_DRIVE (object);

  g_signal_handlers_disconnect_by_func (drive->udisks_drive,
                                        G_CALLBACK (on_udisks_drive_notify),
                                        drive);
  g_object_unref (drive->udisks_drive);
  if (drive->udisks_drive_ata != NULL)
    {
      g_signal_handlers_disconnect_by_func (drive->udisks_drive_ata,
                                            G_CALLBACK (on_udisks_drive_notify),
                                            drive);
      g_object_unref (drive->udisks_drive_ata);
    }

  G_OBJECT_CLASS (storage_drive_parent_class)->finalize (object);
}

static void
storage_drive_get_property (GObject *object,
                            guint prop_id,
                            GValue *value,
                            GParamSpec *pspec)
{
  StorageDrive *drive = STORAGE_DRIVE (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_value_set_object (value, drive->object);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_drive_set_property (GObject *object,
                            guint prop_id,
                            const GValue *value,
                            GParamSpec *pspec)
{
  StorageDrive *drive = STORAGE_DRIVE (object);

  switch (prop_id)
    {
    case PROP_OBJECT:
      g_assert (drive->object == NULL);
      drive->object = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

void
storage_drive_update (StorageDrive *drive)
{
  CockpitStorageDrive *iface = COCKPIT_STORAGE_DRIVE (drive);
  const gchar *classification = "";
  const gchar *vendor;
  const gchar *model;
  const gchar *serial;
  const gchar *wwn;
  GString *s;

  cockpit_storage_drive_set_vendor   (iface, udisks_drive_get_vendor (drive->udisks_drive));
  cockpit_storage_drive_set_model    (iface, udisks_drive_get_model (drive->udisks_drive));
  cockpit_storage_drive_set_revision (iface, udisks_drive_get_revision (drive->udisks_drive));
  cockpit_storage_drive_set_serial   (iface, udisks_drive_get_serial (drive->udisks_drive));
  cockpit_storage_drive_set_wwn      (iface, udisks_drive_get_wwn (drive->udisks_drive));
  cockpit_storage_drive_set_size     (iface, udisks_drive_get_size (drive->udisks_drive));
  cockpit_storage_drive_set_sort_key (iface, udisks_drive_get_sort_key (drive->udisks_drive));

  /* sort out name */
  vendor = udisks_drive_get_vendor (drive->udisks_drive);
  model  = udisks_drive_get_model  (drive->udisks_drive);
  serial = udisks_drive_get_serial (drive->udisks_drive);
  wwn = udisks_drive_get_wwn (drive->udisks_drive);
  s = g_string_new (NULL);
  if (strlen (vendor) > 0 && strlen (model) > 0)
    g_string_append_printf (s, "%s %s", vendor, model);
  else if (strlen (vendor) > 0)
    g_string_append (s, vendor);
  else
    g_string_append (s, model);
  /* user may have tens of this kind of drive - append something unique */
  if (strlen (serial) > 0)
    {
      g_string_append_printf (s, " (%s)", serial);
    }
  else if (strlen (wwn) > 0)
    {
      g_string_append_printf (s, " (%s)", wwn);
    }
#if 0
  /* disabled for now, because if you have a lot of similar drives (same vendor/model), then
   * they probably have serial/wwn anyway
   */
  else
    {
      UDisksClient *client;
      UDisksBlock *block;
      client = storage_provider_get_udisks_client (storage_object_get_provider (drive->object));
      block = udisks_client_get_block_for_drive (client,
                                                 drive->udisks_drive,
                                                 TRUE);
      if (block != NULL)
        {
          const gchar *device_file;
          device_file = udisks_block_get_preferred_device (block);
          g_string_append_printf (s, " (%s)", strrchr (device_file, '/') + 1);
          g_object_unref (block);
        }
    }
#endif
  cockpit_storage_drive_set_name (iface, s->str);
  g_string_free (s, TRUE);

  /* sort out classification */
  if (udisks_drive_get_rotation_rate (drive->udisks_drive) == 0)
    {
      if (udisks_drive_get_media_removable (drive->udisks_drive))
        classification = "removable";
      else
        classification = "ssd";
    }
  else
    {
      if (udisks_drive_get_media_removable (drive->udisks_drive))
        {
          gboolean optical = FALSE;
          const gchar *const *media_compat;
          guint n;
          media_compat = udisks_drive_get_media_compatibility (drive->udisks_drive);
          for (n = 0; media_compat != NULL && media_compat[n] != NULL; n++)
            {
              if (g_str_has_prefix (media_compat[n], "optical"))
                {
                  optical = TRUE;
                  break;
                }
            }
          if (optical)
            classification = "optical";
          else
            classification = "removable";
        }
      else
        {
          if (g_strcmp0 (udisks_drive_get_media (drive->udisks_drive), "") == 0)
            classification = "hdd";
          else
            classification = "removable";
        }
    }
  cockpit_storage_drive_set_classification (iface, classification);

  if (drive->udisks_drive_ata != NULL)
    {
      cockpit_storage_drive_set_temperature (iface, udisks_drive_ata_get_smart_temperature (drive->udisks_drive_ata));
      cockpit_storage_drive_set_failing (iface, udisks_drive_ata_get_smart_failing (drive->udisks_drive_ata));
      cockpit_storage_drive_set_failing_valid (iface, TRUE);
    }
  else
    {
      cockpit_storage_drive_set_failing_valid (iface, FALSE);
    }
}

static void
on_udisks_drive_notify (GObject *object,
                        GParamSpec *pspec,
                        gpointer user_data)
{
  StorageDrive *drive = STORAGE_DRIVE (user_data);
  storage_drive_update (drive);
}

static void
storage_drive_constructed (GObject *_object)
{
  StorageDrive *drive = STORAGE_DRIVE(_object);
  UDisksObject *object;

  drive->udisks_drive = g_object_ref (storage_object_get_udisks_drive (drive->object));
  g_signal_connect (drive->udisks_drive,
                    "notify",
                    G_CALLBACK (on_udisks_drive_notify),
                    drive);

  object = UDISKS_OBJECT (g_dbus_interface_get_object (G_DBUS_INTERFACE (drive->udisks_drive)));
  drive->udisks_drive_ata = udisks_object_get_drive_ata (object);
  if (drive->udisks_drive_ata != NULL)
    {
      g_signal_connect (drive->udisks_drive_ata,
                        "notify",
                        G_CALLBACK (on_udisks_drive_notify),
                        drive);
    }

  storage_drive_update (drive);

  if (G_OBJECT_CLASS (storage_drive_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (storage_drive_parent_class)->constructed (_object);
}

static void
storage_drive_init (StorageDrive *drive)
{
}

static void
storage_drive_class_init (StorageDriveClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = storage_drive_finalize;
  gobject_class->constructed  = storage_drive_constructed;
  gobject_class->set_property = storage_drive_set_property;
  gobject_class->get_property = storage_drive_get_property;

  /**
   * StorageDrive:object:
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
 * storage_drive_new:
 * @object: A #CockpitStorageObject
 *
 * Creates a new #StorageDrive instance.
 *
 * Returns: A new #StorageDrive. Free with g_object_unref().
 */
CockpitStorageDrive *
storage_drive_new (StorageObject *object)
{
  g_return_val_if_fail (IS_STORAGE_OBJECT (object), NULL);
  return COCKPIT_STORAGE_DRIVE (g_object_new (TYPE_STORAGE_DRIVE,
                                              "object", object,
                                              NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static void
storage_drive_iface_init (CockpitStorageDriveIface *iface)
{
}
