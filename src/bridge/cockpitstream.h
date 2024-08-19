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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#pragma once

#include <gio/gio.h>

#include "cockpitconnect.h"

#include "common/cockpitjson.h"

#define COCKPIT_TYPE_STREAM (cockpit_stream_get_type ())
G_DECLARE_DERIVABLE_TYPE(CockpitStream, cockpit_stream, COCKPIT, STREAM, GObject)

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
