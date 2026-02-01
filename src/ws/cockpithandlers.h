/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_HANDLERS_H__
#define __COCKPIT_HANDLERS_H__

#include "cockpitauth.h"

#include "cockpitwebserver.h"
#include "cockpitwebresponse.h"

extern const gchar *cockpit_ws_shell_component;

typedef struct {
  CockpitAuth *auth;
  const gchar *login_html;
  const gchar *login_po_js;
  const gchar **branding_roots;
  GHashTable *os_release;
} CockpitHandlerData;

gboolean       cockpit_handler_socket            (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  CockpitHandlerData *data);

gboolean       cockpit_handler_external          (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  CockpitHandlerData *data);

gboolean       cockpit_handler_root              (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  const gchar *path,
                                                  GHashTable *headers,
                                                  CockpitWebResponse *response,
                                                  CockpitHandlerData *ws);

gboolean       cockpit_handler_default           (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  const gchar *path,
                                                  GHashTable *headers,
                                                  CockpitWebResponse *response,
                                                  CockpitHandlerData *ws);

gboolean       cockpit_handler_ping              (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  const gchar *path,
                                                  GHashTable *headers,
                                                  CockpitWebResponse *response,
                                                  CockpitHandlerData *ws);

gboolean       cockpit_handler_ca_cert           (CockpitWebServer *server,
                                                  CockpitWebRequest *request,
                                                  const gchar *path,
                                                  GHashTable *headers,
                                                  CockpitWebResponse *response,
                                                  CockpitHandlerData *ws);

#endif /* __COCKPIT_HANDLERS_H__ */
