/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef COCKPIT_TEMPLATE_H__
#define COCKPIT_TEMPLATE_H__

#include <glib.h>
#include <json-glib/json-glib.h>

typedef GBytes * (* CockpitTemplateFunc)          (const gchar *variable,
                                                   gpointer user_data);

GList *           cockpit_template_expand         (GBytes *input,
                                                   const gchar *start_marker,
                                                   const gchar *end_marker,
                                                   CockpitTemplateFunc func,
                                                   gpointer user_data);

#endif /* COCKPIT_TEMPLATE_H__ */
