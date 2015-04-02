/*
 * Copyright (C) 2012-2014 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation; either version 2 of the licence or (at
 * your option) any later version.
 *
 * See the included COPYING file for more information.
 *
 * Author: Stef Walter <stefw@gnome.org>
 */

#include "config.h"

#ifndef __STORAGE_INVOCATION_H__
#define __STORAGE_INVOCATION_H__

#include <gio/gio.h>

G_BEGIN_DECLS

typedef void (* StorageClientFunc) (const gchar *bus_name,
                                    gpointer user_data);

void                 storage_invocation_initialize        (GDBusConnection *connection,
                                                           StorageClientFunc client_appeared,
                                                           StorageClientFunc client_disappeared,
                                                           gpointer user_data);

uid_t                storage_invocation_get_caller_uid    (GDBusMethodInvocation *invocation);

void                 storage_invocation_cleanup           (void);

G_END_DECLS

#endif /* __STORAGE_INVOCATION_H__ */
