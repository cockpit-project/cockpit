/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*- */
/*
 * Copyright (C) 2011 David Zeuthen <zeuthen@gmail.com>
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 */

#ifndef __UDISKS_CLIENT_H__
#define __UDISKS_CLIENT_H__

#include "org.freedesktop.UDisks2.h"

G_BEGIN_DECLS

struct _UDisksClient;
typedef struct _UDisksClient UDisksClient;

#define UDISKS_ERROR (udisks_error_quark ())

GQuark udisks_error_quark (void);

typedef enum
{
  UDISKS_ERROR_FAILED,                     /* org.freedesktop.UDisks2.Error.Failed */
  UDISKS_ERROR_CANCELLED,                  /* org.freedesktop.UDisks2.Error.Cancelled */
  UDISKS_ERROR_ALREADY_CANCELLED,          /* org.freedesktop.UDisks2.Error.AlreadyCancelled */
  UDISKS_ERROR_NOT_AUTHORIZED,             /* org.freedesktop.UDisks2.Error.NotAuthorized */
  UDISKS_ERROR_NOT_AUTHORIZED_CAN_OBTAIN,  /* org.freedesktop.UDisks2.Error.NotAuthorizedCanObtain */
  UDISKS_ERROR_NOT_AUTHORIZED_DISMISSED,   /* org.freedesktop.UDisks2.Error.NotAuthorizedDismissed */
  UDISKS_ERROR_ALREADY_MOUNTED,            /* org.freedesktop.UDisks2.Error.AlreadyMounted */
  UDISKS_ERROR_NOT_MOUNTED,                /* org.freedesktop.UDisks2.Error.NotMounted */
  UDISKS_ERROR_OPTION_NOT_PERMITTED,       /* org.freedesktop.UDisks2.Error.OptionNotPermitted */
  UDISKS_ERROR_MOUNTED_BY_OTHER_USER,      /* org.freedesktop.UDisks2.Error.MountedByOtherUser */
  UDISKS_ERROR_ALREADY_UNMOUNTING,         /* org.freedesktop.UDisks2.Error.AlreadyUnmounting */
  UDISKS_ERROR_NOT_SUPPORTED,              /* org.freedesktop.UDisks2.Error.NotSupported */
  UDISKS_ERROR_TIMED_OUT,                  /* org.freedesktop.UDisks2.Error.Timedout */
  UDISKS_ERROR_WOULD_WAKEUP,               /* org.freedesktop.UDisks2.Error.WouldWakeup */
  UDISKS_ERROR_DEVICE_BUSY                 /* org.freedesktop.UDisks2.Error.DeviceBusy */
} UDisksError;

#define UDISKS_ERROR_NUM_ENTRIES  (UDISKS_ERROR_DEVICE_BUSY + 1)

#define UDISKS_TYPE_CLIENT  (udisks_client_get_type ())
#define UDISKS_CLIENT(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), UDISKS_TYPE_CLIENT, UDisksClient))
#define UDISKS_IS_CLIENT(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), UDISKS_TYPE_CLIENT))

GType               udisks_client_get_type           (void) G_GNUC_CONST;
UDisksClient       *udisks_client_new_sync           (GCancellable        *cancellable,
                                                      GError             **error);
GDBusObjectManager *udisks_client_get_object_manager (UDisksClient        *client);
UDisksManager      *udisks_client_get_manager        (UDisksClient        *client);
void                udisks_client_settle             (UDisksClient        *client);
void                udisks_client_queue_changed      (UDisksClient        *client);

UDisksObject       *udisks_client_get_object          (UDisksClient        *client,
                                                       const gchar         *object_path);
UDisksObject       *udisks_client_peek_object         (UDisksClient        *client,
                                                       const gchar         *object_path);

UDisksBlock        *udisks_client_get_block_for_dev   (UDisksClient        *client,
                                                       dev_t                block_device_number);
GList              *udisks_client_get_block_for_label (UDisksClient        *client,
                                                       const gchar         *label);
UDisksBlock        *udisks_client_get_cleartext_block (UDisksClient        *client,
                                                       UDisksBlock         *block);
UDisksBlock        *udisks_client_get_block_for_mdraid (UDisksClient       *client,
                                                        UDisksMDRaid       *raid);
GList              *udisks_client_get_members_for_mdraid (UDisksClient       *client,
                                                          UDisksMDRaid       *raid);
UDisksPartitionTable *udisks_client_get_partition_table (UDisksClient        *client,
                                                         UDisksPartition     *partition);
GList              *udisks_client_get_partitions      (UDisksClient        *client,
                                                       UDisksPartitionTable *table);
G_END_DECLS

#endif /* __UDISKS_CLIENT_H__ */
