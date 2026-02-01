/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_HASH_H__
#define __COCKPIT_HASH_H__

#include <glib.h>

G_BEGIN_DECLS

guint         cockpit_str_case_hash         (gconstpointer v);

gboolean      cockpit_str_case_equal        (gconstpointer v1,
                                             gconstpointer v2);

G_END_DECLS

#endif /* __COCKPIT_HASH_H__ */
