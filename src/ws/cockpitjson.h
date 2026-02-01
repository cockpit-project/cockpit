/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef COCKPIT_JSON_H__
#define COCKPIT_JSON_H__

#include <glib.h>

#include <json-glib/json-glib.h>

G_BEGIN_DECLS

JsonNode *     cockpit_json_parse             (const char *data,
                                               gssize length,
                                               GError **error);

JsonObject *   cockpit_json_parse_object      (const gchar *data,
                                               gssize length,
                                               GError **error);

JsonObject *   cockpit_json_parse_bytes       (GBytes *data,
                                               GError **error);

gchar *        cockpit_json_write             (JsonNode *node,
                                               gsize *length);

GBytes *       cockpit_json_write_bytes       (JsonObject *object);

gboolean       cockpit_json_get_int           (JsonObject *object,
                                               const gchar *member,
                                               gint64 defawlt,
                                               gint64 *value);

gboolean       cockpit_json_get_bool          (JsonObject *object,
                                               const gchar *member,
                                               gboolean defawlt,
                                               gboolean *value);

gboolean       cockpit_json_get_string        (JsonObject *object,
                                               const gchar *member,
                                               const gchar *defawlt,
                                               const gchar **value);

gboolean       cockpit_json_get_strv          (JsonObject *object,
                                               const gchar *member,
                                               const gchar **defawlt,
                                               const gchar ***value);

gboolean       cockpit_json_get_object        (JsonObject *options,
                                               const gchar *member,
                                               JsonObject *defawlt,
                                               JsonObject **value);

GHashTable *   cockpit_json_to_hash_table     (JsonObject *object,
                                               const gchar **fields);

#endif /* COCKPIT_JSON_H__ */
