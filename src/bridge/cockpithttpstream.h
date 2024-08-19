/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef COCKPIT_HTTP_STREAM_H__
#define COCKPIT_HTTP_STREAM_H__

#include <gio/gio.h>

#include "common/cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_HTTP_STREAM         (cockpit_http_stream_get_type ())

GType              cockpit_http_stream_get_type           (void) G_GNUC_CONST;

gboolean           cockpit_http_stream_parse_keep_alive   (const gchar *version,
                                                           GHashTable *headers);

#endif /* COCKPIT_HTTP_STREAM_H__ */
