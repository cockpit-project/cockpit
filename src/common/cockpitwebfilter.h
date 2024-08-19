/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_WEB_FILTER_H__
#define COCKPIT_WEB_FILTER_H__

#include <glib-object.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_FILTER            (cockpit_web_filter_get_type ())
G_DECLARE_INTERFACE(CockpitWebFilter, cockpit_web_filter, COCKPIT, WEB_FILTER, GObject)

struct _CockpitWebFilterInterface {
  GTypeInterface parent_iface;

  void       (* push)            (CockpitWebFilter *filter,
                                  GBytes *block,
                                  void (* function) (gpointer, GBytes *),
                                  gpointer data);
};

void                cockpit_web_filter_push         (CockpitWebFilter *filter,
                                                     GBytes *queue,
                                                     void (* function) (gpointer, GBytes *),
                                                     gpointer data);

G_END_DECLS

#endif /* COCKPIT_WEB_FILTER_H__ */
