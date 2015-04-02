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

#ifndef __STORAGE_THREADED_JOB_H__
#define __STORAGE_THREADED_JOB_H__

#include "types.h"
#include "job.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_THREADED_JOB         (storage_threaded_job_get_type ())
#define STORAGE_THREADED_JOB(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_THREADED_JOB, StorageThreadedJob))
#define STORAGE_IS_THREADED_JOB(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_THREADED_JOB))

GType                 storage_threaded_job_get_type       (void) G_GNUC_CONST;

StorageThreadedJob *  storage_threaded_job_new            (StorageJobFunc job_func,
                                                           gpointer user_data,
                                                           GDestroyNotify user_data_free_func,
                                                           GCancellable *cancellable);

gpointer              storage_threaded_job_get_user_data  (StorageThreadedJob *job);

G_END_DECLS

#endif /* __STORAGE_THREADED_JOB_H__ */
