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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_JSON_H__
#define COCKPIT_JSON_H__

#include <glib.h>

#include <json-glib/json-glib.h>

G_BEGIN_DECLS

gsize          cockpit_json_skip              (const gchar *data,
                                               gsize length,
                                               gsize *spaces);

gboolean       cockpit_json_get_int           (JsonObject *object,
                                               const gchar *member,
                                               gint64 defawlt,
                                               gint64 *value);

gboolean       cockpit_json_get_string        (JsonObject *object,
                                               const gchar *member,
                                               const gchar *defawlt,
                                               const gchar **value);

guint          cockpit_json_int_hash          (gconstpointer v);

gboolean       cockpit_json_int_equal         (gconstpointer v1,
                                               gconstpointer v2);

#endif /* COCKPIT_JSON_H__ */
