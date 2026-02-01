/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_BRANDING_H__
#define __COCKPIT_BRANDING_H__

G_BEGIN_DECLS

#include "cockpitwebservice.h"

gchar **        cockpit_branding_calculate_static_roots     (const gchar *os_id,
                                                             const gchar *os_variant_id,
                                                             const gchar *os_id_like,
                                                             gboolean is_local);

void            cockpit_branding_serve                      (CockpitWebService *service,
                                                             CockpitWebResponse *response,
                                                             const gchar *full_path,
                                                             const gchar *static_path,
                                                             GHashTable *local_os_release,
                                                             const gchar **local_roots);

G_END_DECLS

#endif /* __COCKPIT_BRANDING_H__ */
