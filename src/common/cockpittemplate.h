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

#ifndef COCKPIT_TEMPLATE_H__
#define COCKPIT_TEMPLATE_H__

#include <glib.h>

typedef GBytes * (* CockpitTemplateFunc)          (const gchar *variable,
                                                   gpointer user_data);

GList *           cockpit_template_expand         (GBytes *input,
                                                   CockpitTemplateFunc func,
                                                   const gchar *start_marker,
                                                   const gchar *end_marker,
                                                   gpointer user_data);

#endif /* COCKPIT_TEMPLATE_H__ */
