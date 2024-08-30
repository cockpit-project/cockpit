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

#ifndef __COCKPIT_WEB_RESPONSE_H__
#define __COCKPIT_WEB_RESPONSE_H__

#include <gio/gio.h>

#include "cockpitwebfilter.h"

G_BEGIN_DECLS

#define COCKPIT_RESOURCE_PACKAGE_VALID "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

#define COCKPIT_TYPE_WEB_RESPONSE         (cockpit_web_response_get_type ())
G_DECLARE_FINAL_TYPE(CockpitWebResponse, cockpit_web_response, COCKPIT, WEB_RESPONSE, GObject)

typedef enum {
  COCKPIT_WEB_RESPONSE_READY = 1,
  COCKPIT_WEB_RESPONSE_QUEUING,
  COCKPIT_WEB_RESPONSE_COMPLETE,
  COCKPIT_WEB_RESPONSE_SENT,
} CockpitWebResponding;

typedef enum {
  COCKPIT_WEB_RESPONSE_CACHE_UNSET,
  COCKPIT_WEB_RESPONSE_NO_CACHE,
  COCKPIT_WEB_RESPONSE_CACHE,
} CockpitCacheType;

#define COCKPIT_CHECKSUM_HEADER "X-Cockpit-Pkg-Checksum"

typedef struct _CockpitWebResponse        CockpitWebResponse;

extern const gchar *  cockpit_web_exception_escape_root;

CockpitWebResponse *  cockpit_web_response_new           (GIOStream *io,
                                                          const gchar *original_path,
                                                          const gchar *path,
                                                          GHashTable *in_headers,
                                                          const gchar *method,
                                                          const gchar *protocol);


const gchar *         cockpit_web_response_get_path      (CockpitWebResponse *self);

GIOStream *           cockpit_web_response_get_stream    (CockpitWebResponse *self);

CockpitWebResponding  cockpit_web_response_get_state     (CockpitWebResponse *self);

gboolean              cockpit_web_response_skip_path     (CockpitWebResponse *self);

gchar *               cockpit_web_response_pop_path      (CockpitWebResponse *self);

void                  cockpit_web_response_add_filter    (CockpitWebResponse *self,
                                                          CockpitWebFilter *filter);

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

void                  cockpit_web_response_abort         (CockpitWebResponse *self);

void                  cockpit_web_response_content       (CockpitWebResponse *self,
                                                          GHashTable *headers,
                                                          GBytes *block,
                                                          ...) G_GNUC_NULL_TERMINATED;

void                  cockpit_web_response_error_with_body (CockpitWebResponse *self,
                                                            guint code,
                                                            const gchar *reason,
                                                            GHashTable *headers,
                                                            GBytes *body);
void                  cockpit_web_response_error         (CockpitWebResponse *self,
                                                          guint status,
                                                          GHashTable *headers,
                                                          const char *format,
                                                          ...) G_GNUC_PRINTF (4, 5);

void                  cockpit_web_response_gerror        (CockpitWebResponse *self,
                                                          GHashTable *headers,
                                                          GError *error);

gchar **              cockpit_web_response_resolve_roots (const gchar **roots);

void                  cockpit_web_response_file          (CockpitWebResponse *response,
                                                          const gchar *escaped,
                                                          const gchar **roots);

void                  cockpit_web_response_file_or_gz    (CockpitWebResponse *response,
                                                          gboolean accepts_gz,
                                                          const gchar *escaped,
                                                          const gchar **roots);

GBytes *              cockpit_web_response_gunzip        (GBytes *bytes,
                                                          GError **error);

GBytes *              cockpit_web_response_negotiation   (const gchar *path,
                                                          GHashTable *existing,
                                                          const gchar *language,
                                                          gboolean *out_is_language_specific,
                                                          gboolean *out_is_compressed,
                                                          GError **error);

const gchar *         cockpit_web_response_content_type  (const gchar *path);

gboolean     cockpit_web_should_suppress_output_error    (const gchar *logname,
                                                          GError *error);

gboolean     cockpit_web_response_is_simple_token        (const gchar *string);

gboolean     cockpit_web_response_is_header_value        (const gchar *string);

void         cockpit_web_response_set_cache_type         (CockpitWebResponse *self,
                                                          CockpitCacheType cache_type);

const gchar *  cockpit_web_response_get_url_root         (CockpitWebResponse *response);

const gchar *  cockpit_web_response_get_origin           (CockpitWebResponse *response);

const gchar *  cockpit_web_response_get_protocol         (CockpitWebResponse *response);

void           cockpit_web_response_template             (CockpitWebResponse *response,
                                                          const gchar *escaped,
                                                          const gchar **roots,
                                                          GHashTable *values);

gchar *      cockpit_web_response_security_policy        (const gchar *content_security_policy,
                                                          const gchar *self_origin);

G_END_DECLS

#endif /* __COCKPIT_RESPONSE_H__ */
