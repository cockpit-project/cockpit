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

#ifndef __STORAGE_DAEMON_H__
#define __STORAGE_DAEMON_H__

#include <gio/gio.h>

#include "types.h"
#include "job.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_DAEMON         (storage_daemon_get_type ())
#define STORAGE_DAEMON(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_DAEMON, StorageDaemon))
#define STORAGE_IS_DAEMON(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_DAEMON))

GType                      storage_daemon_get_type            (void) G_GNUC_CONST;

StorageDaemon *            storage_daemon_get                 (void);

StorageBlock *             storage_daemon_find_block          (StorageDaemon *self,
                                                               dev_t block_device_number);

gpointer                   storage_daemon_find_thing          (StorageDaemon *self,
                                                               const gchar *object_path,
                                                               GType type_of_thing);

GList *                    storage_daemon_get_jobs            (StorageDaemon *self);

StorageManager *           storage_daemon_get_manager         (StorageDaemon *self);

gchar *                    storage_daemon_get_resource_path   (StorageDaemon *self,
                                                               gboolean arch_specific,
                                                               const gchar *path);

void                       storage_daemon_publish             (StorageDaemon *self,
                                                               const gchar *path,
                                                               gboolean uniquely,
                                                               gpointer thing);

void                       storage_daemon_unpublish           (StorageDaemon *self,
                                                               const gchar *path,
                                                               gpointer thing);

StorageJob *               storage_daemon_launch_spawned_job  (StorageDaemon *self,
                                                               gpointer object_or_interface,
                                                               const gchar *job_operation,
                                                               uid_t job_started_by_uid,
                                                               GCancellable *cancellable,
                                                               uid_t run_as_uid,
                                                               uid_t run_as_euid,
                                                               const gchar *input_string,
                                                               const gchar *first_arg,
                                                               ...) G_GNUC_NULL_TERMINATED;

StorageJob *               storage_daemon_launch_spawned_jobv (StorageDaemon *self,
                                                               gpointer object_or_interface,
                                                               const gchar *job_operation,
                                                               uid_t job_started_by_uid,
                                                               GCancellable *cancellable,
                                                               uid_t run_as_uid,
                                                               uid_t run_as_euid,
                                                               const gchar *input_string,
                                                               const gchar **argv);

StorageJob *               storage_daemon_launch_threaded_job (StorageDaemon *daemon,
                                                               gpointer object_or_interface,
                                                               const gchar *job_operation,
                                                               uid_t job_started_by_uid,
                                                               StorageJobFunc job_func,
                                                               gpointer user_data,
                                                               GDestroyNotify user_data_free_func,
                                                               GCancellable *cancellable);

GPid                       storage_daemon_spawn_for_variant   (StorageDaemon *self,
                                                               const gchar **argv,
                                                               const GVariantType *type,
                                                               void (*callback) (GPid, GVariant *, GError *, gpointer),
                                                               gpointer user_data);

G_END_DECLS

#endif /* __STORAGE_DAEMON_H__ */
