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

#ifndef SESSION_CONTROLLER_H__
#define SESSION_CONTROLLER_H__

#include <glib-object.h>
#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define SESSION_TYPE_CONTROLLER         (session_controller_get_type ())

G_DECLARE_FINAL_TYPE (SessionController, session_controller, SESSION, CONTROLLER, GObject)

SessionController *session_controller_new (gint timeout,
                                            CockpitTransport *transport);

SessionController *session_controller_get_instance (void);
void               session_controller_set_instance (SessionController *instance);

void               session_controller_register_channel (SessionController *self,
                                                         const gchar *channel_name);
void               session_controller_unregister_channel (SessionController *self,
                                                           const gchar *channel_name);
gboolean           session_controller_has_channel (SessionController *self,
                                                    const gchar *channel_name);
guint              session_controller_get_channel_count (SessionController *self);

void               session_controller_send_control_to_all (SessionController *self,
                                                            const gchar *command,
                                                            ...) G_GNUC_NULL_TERMINATED;
void               session_controller_close_all_channels (SessionController *self,
                                                           const gchar *problem);

const gchar *      session_controller_get_state_name (SessionController *self);
void               session_controller_reset_timeout (SessionController *self);
void               session_controller_notify_activity (void);
gint               session_controller_get_timeout (SessionController *self);

G_END_DECLS

#endif /* SESSION_CONTROLLER_H__ */