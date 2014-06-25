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

#include "lvmutil.h"

LvmVolumeGroup *
lvm_util_get_volume_group_for_logical_volume (GDBusObjectManager *objman,
                                              LvmLogicalVolume *volume)
{
  LvmVolumeGroup *ret = NULL;
  GDBusObject *object;

  g_return_val_if_fail (G_IS_DBUS_OBJECT_MANAGER (objman), NULL);
  g_return_val_if_fail (LVM_IS_LOGICAL_VOLUME (volume), NULL);

  object = g_dbus_object_manager_get_object (objman, lvm_logical_volume_get_volume_group (volume));
  if (object != NULL)
    ret = lvm_object_get_volume_group (LVM_OBJECT (object));
  return ret;
}

GList *
lvm_util_get_logical_volumes_for_volume_group (GDBusObjectManager *objman,
                                               LvmVolumeGroup *group)
{
  GList *ret = NULL;
  GList *l, *object_proxies = NULL;
  GDBusObject *group_object;
  const gchar *group_objpath;

  g_return_val_if_fail (G_IS_DBUS_OBJECT_MANAGER (objman), NULL);
  g_return_val_if_fail (LVM_IS_VOLUME_GROUP (group), NULL);

  group_object = g_dbus_interface_get_object (G_DBUS_INTERFACE (group));
  if (group_object == NULL)
    goto out;

  group_objpath = g_dbus_object_get_object_path (group_object);

  object_proxies = g_dbus_object_manager_get_objects (objman);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      LvmObject *object = LVM_OBJECT (l->data);
      LvmLogicalVolume *volume;

      volume = lvm_object_get_logical_volume (object);
      if (volume == NULL)
        continue;

      if (g_strcmp0 (lvm_logical_volume_get_volume_group (volume), group_objpath) == 0)
        {
          ret = g_list_prepend (ret, volume); /* adopts reference to block */
        }
      else
        {
          g_object_unref (volume);
        }
    }

 out:
  g_list_free_full (object_proxies, g_object_unref);
  return ret;
}

UDisksBlock *
lvm_util_peek_block_for_logical_volume (GDBusObjectManager *objman,
                                        UDisksClient *client,
                                        LvmLogicalVolume *volume)
{
  UDisksBlock *ret = NULL;
  GList *l, *object_proxies = NULL;
  GDBusObject *volume_object;
  const gchar *volume_objpath;

  g_return_val_if_fail (UDISKS_IS_CLIENT (client), NULL);
  g_return_val_if_fail (LVM_IS_LOGICAL_VOLUME (volume), NULL);

  volume_object = g_dbus_interface_get_object (G_DBUS_INTERFACE (volume));
  if (volume_object == NULL)
    goto out;

  volume_objpath = g_dbus_object_get_object_path (volume_object);

  object_proxies = g_dbus_object_manager_get_objects (objman);
  for (l = object_proxies; l != NULL; l = l->next)
    {
      LvmObject *lvm_object = LVM_OBJECT (l->data);
      LvmLogicalVolumeBlock *lvm_block;

      lvm_block = lvm_object_peek_logical_volume_block (lvm_object);
      if (lvm_block == NULL)
        continue;

      if (g_strcmp0 (lvm_logical_volume_block_get_logical_volume (lvm_block), volume_objpath) == 0)
        {
          UDisksObject *udisks_object =
            udisks_client_peek_object (client,
                                       g_dbus_object_get_object_path (G_DBUS_OBJECT (lvm_object)));
          ret = udisks_object ? udisks_object_peek_block (udisks_object) : NULL;
          goto out;
        }
    }

 out:
  g_list_free_full (object_proxies, g_object_unref);
  return ret;
}
