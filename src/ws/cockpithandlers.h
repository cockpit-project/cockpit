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

#ifndef __COCKPIT_HANDLERS_H__
#define __COCKPIT_HANDLERS_H__

#include "cockpitauth.h"
#include "cockpitwebserver.h"

typedef struct {
  GTlsCertificate *certificate;
  CockpitAuth *auth;
  const gchar *agent_program;
} CockpitHandlerData;

gboolean       cockpit_handler_socket            (CockpitWebServer *server,
                                                  CockpitWebServerRequestType reqtype,
                                                  const gchar *resource,
                                                  GIOStream *io_stream,
                                                  GHashTable *headers,
                                                  GDataInputStream *in,
                                                  GDataOutputStream *out,
                                                  CockpitHandlerData *data);

gboolean       cockpit_handler_login             (CockpitWebServer *server,
                                                  CockpitWebServerRequestType reqtype,
                                                  const gchar *resource,
                                                  GIOStream *io_stream,
                                                  GHashTable *headers,
                                                  GDataInputStream *in,
                                                  GDataOutputStream *out,
                                                  CockpitHandlerData *data);

gboolean       cockpit_handler_logout            (CockpitWebServer *server,
                                                  CockpitWebServerRequestType reqtype,
                                                  const gchar *resource,
                                                  GIOStream *io_stream,
                                                  GHashTable *headers,
                                                  GDataInputStream *in,
                                                  GDataOutputStream *out,
                                                  CockpitHandlerData *data);

gboolean       cockpit_handler_cockpitdyn        (CockpitWebServer *server,
                                                  CockpitWebServerRequestType reqtype,
                                                  const gchar *resource,
                                                  GIOStream *connection,
                                                  GHashTable *headers,
                                                  GDataInputStream *in,
                                                  GDataOutputStream *out,
                                                  CockpitHandlerData *data);

#endif /* __COCKPIT_HANDLERS_H__ */
