/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include <gio/gio.h>

#ifndef __MOCK_SERVICE_H__
#define __MOCK_SERVICE_H__

GObject *   mock_service_create_and_export    (GDBusConnection *connection,
                                               const gchar *object_manager_path);

#endif /* __MOCK_SERVICE_H__ */
