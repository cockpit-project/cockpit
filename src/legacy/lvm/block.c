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
#include "logicalvolume.h"
#include "physicalvolume.h"
#include "udisksclient.h"
#include "volumegroup.h"

#include "daemon.h"

#include "com.redhat.lvm2.h"

#include <glib/gi18n-lib.h>

#include <gudev/gudev.h>

#include <fcntl.h>

struct _StorageBlock
{
  GObject parent;
  UDisksBlock *real_block;
  GUdevClient *udev_client;
  StoragePhysicalVolume *iface_physical_volume;
  LvmLogicalVolumeBlock *iface_logical_volume;
};

typedef struct
{
  GObjectClass parent;
} StorageBlockClass;

enum
{
  PROP_0,
  PROP_UDEV_CLIENT,
  PROP_REAL_BLOCK,
};

G_DEFINE_TYPE (StorageBlock, storage_block, G_TYPE_OBJECT);

static void
storage_block_dispose (GObject *object)
{
  StorageBlock *self = STORAGE_BLOCK (object);
  StorageDaemon *daemon;

  daemon = storage_daemon_get ();

  if (self->iface_physical_volume)
    {
      storage_daemon_unpublish (daemon, storage_block_get_object_path (self), self->iface_physical_volume);
      g_object_unref (self->iface_physical_volume);
      self->iface_physical_volume = NULL;
    }

  if (self->iface_logical_volume)
    {
      storage_daemon_unpublish (daemon, storage_block_get_object_path (self), self->iface_logical_volume);
      g_object_unref (self->iface_logical_volume);
      self->iface_logical_volume = NULL;
    }

  G_OBJECT_CLASS (storage_block_parent_class)->dispose (object);
}

static void
storage_block_finalize (GObject *object)
{
  StorageBlock *self = STORAGE_BLOCK (object);

  g_clear_object (&self->real_block);
  g_clear_object (&self->udev_client);
  g_clear_object (&self->iface_physical_volume);
  g_clear_object (&self->iface_logical_volume);

  G_OBJECT_CLASS (storage_block_parent_class)->finalize (object);
}

static void
storage_block_set_property (GObject *object,
                            guint prop_id,
                            const GValue *value,
                            GParamSpec *pspec)
{
  StorageBlock *self = STORAGE_BLOCK (object);

  switch (prop_id)
    {
    case PROP_REAL_BLOCK:
      self->real_block = g_value_dup_object (value);
      g_assert (self->real_block != NULL);
      break;

    case PROP_UDEV_CLIENT:
      self->udev_client = g_value_dup_object (value);
      g_assert (self->udev_client != NULL);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
storage_block_init (StorageBlock *self)
{

}

static void
storage_block_class_init (StorageBlockClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = storage_block_dispose;
  gobject_class->finalize = storage_block_finalize;
  gobject_class->set_property = storage_block_set_property;

  g_object_class_install_property (gobject_class,
                                   PROP_REAL_BLOCK,
                                   g_param_spec_object ("real-block", "Real Block", "Real Block",
                                                        UDISKS_TYPE_BLOCK,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_UDEV_CLIENT,
                                   g_param_spec_object ("udev-client", "GUDev Client", "GUDev Client",
                                                        G_UDEV_TYPE_CLIENT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

const gchar *
storage_block_get_object_path (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  g_return_val_if_fail (self->real_block != NULL, NULL);
  return g_dbus_proxy_get_object_path (G_DBUS_PROXY (self->real_block));
}

GUdevDevice *
storage_block_get_udev (StorageBlock *self)
{
  dev_t num;

  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);

  num = udisks_block_get_device_number (self->real_block);
  return g_udev_client_query_by_device_number (self->udev_client,
                                               G_UDEV_DEVICE_TYPE_BLOCK, num);
}

const gchar *
storage_block_get_device (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_device (self->real_block);
}

const gchar **
storage_block_get_symlinks (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return (const gchar **)udisks_block_get_symlinks (self->real_block);
}

const gchar *
storage_block_get_id_type (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_id_type (self->real_block);
}

const gchar *
storage_block_get_id_usage (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_id_usage (self->real_block);
}

const gchar *
storage_block_get_id_version (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_id_version (self->real_block);
}

const gchar *
storage_block_get_id_label (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_id_label (self->real_block);
}

const gchar *
storage_block_get_id_uuid (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return udisks_block_get_id_uuid (self->real_block);
}

gboolean
storage_block_is_unused (StorageBlock *self,
                    GError **error)
{
  const gchar *device_file;
  int fd;

  g_return_val_if_fail (STORAGE_IS_BLOCK (self), FALSE);

  device_file = storage_block_get_device (self);
  fd = open (device_file, O_RDONLY | O_EXCL);
  if (fd < 0)
    {
      g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                   "Error opening device %s: %m",
                   device_file);
      return FALSE;
    }
  close (fd);
  return TRUE;
}

void
storage_block_update_lv (StorageBlock *self,
                         StorageLogicalVolume *lv)
{
  const gchar *logical_volume_path;
  StorageDaemon *daemon;

  g_return_if_fail (STORAGE_IS_BLOCK (self));

  daemon = storage_daemon_get ();

  if (lv == NULL)
    {
      if (self->iface_logical_volume)
        {
          storage_daemon_unpublish (daemon, storage_block_get_object_path (self), self->iface_logical_volume);
          g_object_unref (self->iface_logical_volume);
          self->iface_logical_volume = NULL;
        }
    }
  else
    {
      logical_volume_path = storage_logical_volume_get_object_path (lv);
      if (self->iface_logical_volume)
        {
          lvm_logical_volume_block_set_logical_volume (self->iface_logical_volume,
                                                       logical_volume_path);
        }
      else
        {
          self->iface_logical_volume = lvm_logical_volume_block_skeleton_new ();
          lvm_logical_volume_block_set_logical_volume (self->iface_logical_volume,
                                                       logical_volume_path);
          storage_daemon_publish (daemon, storage_block_get_object_path (self), FALSE, self->iface_logical_volume);
        }
    }
}

void
storage_block_update_pv (StorageBlock *self,
                         StorageVolumeGroup *group,
                         GVariant *pv_info)
{
  StorageDaemon *daemon;

  g_return_if_fail (STORAGE_IS_BLOCK (self));

  daemon = storage_daemon_get ();

  if (group)
    {
     if (self->iface_physical_volume == NULL)
        {
          self->iface_physical_volume = storage_physical_volume_new ();
          storage_physical_volume_update (self->iface_physical_volume, group, pv_info);
          storage_daemon_publish (daemon, storage_block_get_object_path (self), FALSE, self->iface_physical_volume);
        }
      else
        {
          storage_physical_volume_update (self->iface_physical_volume, group, pv_info);
        }
    }
  else
    {
      if (self->iface_physical_volume != NULL)
        {
          storage_daemon_unpublish (daemon, storage_block_get_object_path (self), self->iface_physical_volume);
          g_object_unref (self->iface_physical_volume);
          self->iface_physical_volume = NULL;
        }
    }

}

LvmLogicalVolumeBlock *
storage_block_get_logical_volume_block (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return self->iface_logical_volume;
}

LvmPhysicalVolumeBlock *
storage_block_get_physical_volume_block (StorageBlock *self)
{
  g_return_val_if_fail (STORAGE_IS_BLOCK (self), NULL);
  return LVM_PHYSICAL_VOLUME_BLOCK (self->iface_physical_volume);
}

void
storage_block_trigger_uevent (StorageBlock *self)
{
  GUdevDevice *device;
  gchar* path = NULL;
  gint fd = -1;

  g_return_if_fail (STORAGE_IS_BLOCK (self));

  /* TODO: would be nice with a variant to wait until the request uevent has been received by ourselves */

  device = storage_block_get_udev (self);
  if (device == NULL)
    {
      g_debug ("skipping trigger of udev event for block object");
      return;
    }

  path = g_strconcat (g_udev_device_get_sysfs_path (device), "/uevent", NULL);
  g_debug ("trigerring udev event '%s' for %s", "change", g_udev_device_get_name (device));
  g_object_unref (device);

  fd = open (path, O_WRONLY);
  if (fd < 0)
    {
      g_message ("Error opening %s: %m", path);
      goto out;
    }

  if (write (fd, "change", sizeof "change" - 1) != sizeof "change" - 1)
    {
      g_message ("Error writing 'change' to file %s: %m", path);
      goto out;
    }

 out:
  if (fd >= 0)
    close (fd);
  g_free (path);
}
