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

#ifndef __STORAGE_JOB_H__
#define __STORAGE_JOB_H__

#include "types.h"
#include "org.freedesktop.UDisks2.h"

G_BEGIN_DECLS

#define STORAGE_TYPE_JOB         (storage_job_get_type ())
#define STORAGE_JOB(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), STORAGE_TYPE_JOB, StorageJob))
#define STORAGE_JOB_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST((k), STORAGE_TYPE_JOB, StorageJobClass))
#define STORAGE_JOB_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), STORAGE_TYPE_JOB, StorageJobClass))
#define STORAGE_IS_JOB(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), STORAGE_TYPE_JOB))
#define STORAGE_IS_JOB_CLASS(k)  (G_TYPE_CHECK_CLASS_TYPE ((k), STORAGE_TYPE_JOB))

typedef struct _StorageJobClass     StorageJobClass;
typedef struct _StorageJobPrivate   StorageJobPrivate;

/**
 * StorageJob:
 *
 * The #StorageJob structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _StorageJob
{
  /*< private >*/
  UDisksJobSkeleton parent_instance;
  StorageJobPrivate *priv;
};

/**
 * StorageJobClass:
 * @parent_class: Parent class.
 *
 * Class structure for #StorageJob.
 */
struct _StorageJobClass
{
  UDisksJobSkeletonClass parent_class;
  /*< private >*/
  gpointer padding[8];
};

typedef gboolean   (* StorageJobFunc)            (GCancellable *cancellable,
                                                  gpointer user_data,
                                                  GError **error);

GType              storage_job_get_type          (void) G_GNUC_CONST;

GCancellable *     storage_job_get_cancellable   (StorageJob *self);

gboolean           storage_job_get_auto_estimate (StorageJob *self);

void               storage_job_set_auto_estimate (StorageJob *self,
                                                  gboolean value);

void               storage_job_add_thing         (StorageJob *self,
                                                  gpointer object_or_interface);

G_END_DECLS

#endif /* __STORAGE_JOB_H__ */
