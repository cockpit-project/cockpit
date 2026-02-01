/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_UNICODE_H__
#define __COCKPIT_UNICODE_H__

#include <glib.h>

G_BEGIN_DECLS

GBytes *      cockpit_unicode_force_utf8    (GBytes *input);

gboolean      cockpit_unicode_has_incomplete_ending (GBytes *input);

G_END_DECLS

#endif /* __COCKPIT_UNICODE_H__ */
