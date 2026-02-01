/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_SYSTEM_H__
#define __COCKPIT_SYSTEM_H__

#include <glib.h>
#include "cockpitjson.h"

G_BEGIN_DECLS

GHashTable *         cockpit_system_load_os_release            (void);

const gchar **       cockpit_system_os_release_fields          (void);

void                 cockpit_setenv_check                     (const char *variable,
                                                               const char *value,
                                                               gboolean overwrite);

G_END_DECLS

#endif /* __COCKPIT_SYSTEM_H__ */
