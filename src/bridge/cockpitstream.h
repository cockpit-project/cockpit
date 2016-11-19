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

#ifndef __COCKPIT_STREAM_H__
#define __COCKPIT_STREAM_H__

#include <gio/gio.h>

#include "cockpitconnect.h"

#include "common/cockpitjson.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_STREAM         (cockpit_stream_get_type ())
#define COCKPIT_STREAM(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_STREAM, CockpitStream))
#define COCKPIT_IS_STREAM(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_STREAM))
#define COCKPIT_STREAM_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST ((k), COCKPIT_TYPE_STREAM, CockpitStreamClass))
#define COCKPIT_STREAM_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_STREAM, CockpitStreamClass))

typedef struct _CockpitStream        CockpitStream;
typedef struct _CockpitStreamClass   CockpitStreamClass;
typedef struct _CockpitStreamPrivate CockpitStreamPrivate;

struct _CockpitStream {
  GObject parent_instance;
  CockpitStreamPrivate *priv;
};

struct _CockpitStreamClass {
  GObjectClass parent_class;

  /* signals */

  void        (* open)        (CockpitStream *stream);

  void        (* read)        (CockpitStream *pipe,
                               GByteArray *buffer,
                               gboolean eof);

  void        (* close)       (CockpitStream *pipe,
                               const gchar *problem);
};

GType              cockpit_stream_get_type     (void) G_GNUC_CONST;

CockpitStream *    cockpit_stream_new          (const gchar *name,
                                                GIOStream *stream);

CockpitStream *    cockpit_stream_connect      (const gchar *name,
                                                CockpitConnectable *connectable);

void               cockpit_stream_write        (CockpitStream *self,
                                                GBytes *data);

void               cockpit_stream_close        (CockpitStream *self,
                                                const gchar *problem);

const gchar *      cockpit_stream_get_name     (CockpitStream *self);

GByteArray *       cockpit_stream_get_buffer   (CockpitStream *self);

const gchar *      cockpit_stream_problem      (GError *error,
                                                const gchar *name,
                                                const gchar *summary,
                                                JsonObject *object);

G_END_DECLS

#endif /* __COCKPIT_STREAM_H__ */
