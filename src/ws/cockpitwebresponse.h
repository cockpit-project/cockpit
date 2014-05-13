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

#ifndef __COCKPIT_WEB_RESPONSE_H__
#define __COCKPIT_WEB_RESPONSE_H__

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_RESPONSE         (cockpit_web_response_get_type ())
#define COCKPIT_WEB_RESPONSE(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_WEB_RESPONSE, CockpitWebResponse))

typedef struct _CockpitWebResponse        CockpitWebResponse;

GType                 cockpit_web_response_get_type      (void) G_GNUC_CONST;

CockpitWebResponse *  cockpit_web_response_new           (GIOStream *io,
                                                          const gchar *path);

const gchar *         cockpit_web_response_get_path      (CockpitWebResponse *self);

GIOStream *           cockpit_web_response_get_stream    (CockpitWebResponse *self);

void                  cockpit_web_response_headers       (CockpitWebResponse *self,
                                                          guint status,
                                                          const gchar *reason,
                                                          gssize length,
                                                          ...) G_GNUC_NULL_TERMINATED;

void                  cockpit_web_response_headers_full  (CockpitWebResponse *self,
                                                          guint status,
                                                          const gchar *reason,
                                                          gssize length,
                                                          GHashTable *headers);

gboolean              cockpit_web_response_queue         (CockpitWebResponse *self,
                                                          GBytes *block);

void                  cockpit_web_response_complete      (CockpitWebResponse *self);

void                  cockpit_web_response_content       (CockpitWebResponse *self,
                                                          GHashTable *headers,
                                                          GBytes *block,
                                                          ...) G_GNUC_NULL_TERMINATED;

void                  cockpit_web_response_error         (CockpitWebResponse *self,
                                                          guint status,
                                                          GHashTable *headers,
                                                          const char *format,
                                                          ...) G_GNUC_PRINTF (4, 5);

void                  cockpit_web_response_gerror        (CockpitWebResponse *self,
                                                          GHashTable *headers,
                                                          GError *error);

void                  cockpit_web_response_file          (CockpitWebResponse *response,
                                                          const gchar *escaped,
                                                          gboolean cache_forever,
                                                          const gchar **roots);

G_END_DECLS

#endif /* __COCKPIT_RESPONSE_H__ */
