/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_WS_H__
#define __COCKPIT_WS_H__

#include <gio/gio.h>

G_BEGIN_DECLS

/* Some tunables that can be set from tests. */

/* From cockpitwebsocket.c */
extern const gchar *cockpit_ws_session_program;
extern guint cockpit_ws_ping_interval;
extern guint cockpit_ws_auth_process_timeout;
extern guint cockpit_ws_auth_response_timeout;

/* From cockpitauth.c */
extern guint cockpit_ws_service_idle;
extern const gchar *cockpit_ws_max_startups;

G_END_DECLS

#endif /* __COCKPIT_WS_H__ */
