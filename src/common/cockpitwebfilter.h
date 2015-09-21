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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_WEB_FILTER_H__
#define COCKPIT_WEB_FILTER_H__

#include <glib-object.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_FILTER            (cockpit_web_filter_get_type ())
#define COCKPIT_WEB_FILTER(inst)            (G_TYPE_CHECK_INSTANCE_CAST ((inst), COCKPIT_TYPE_WEB_FILTER, CockpitWebFilter))
#define COCKPIT_IS_WEB_FILTER(inst)         (G_TYPE_CHECK_INSTANCE_TYPE ((inst), COCKPIT_TYPE_WEB_FILTER))
#define COCKPIT_WEB_FILTER_GET_IFACE(inst)  (G_TYPE_INSTANCE_GET_INTERFACE ((inst), COCKPIT_TYPE_WEB_FILTER, CockpitWebFilterIface))

typedef struct _CockpitWebFilter CockpitWebFilter;
typedef struct _CockpitWebFilterIface CockpitWebFilterIface;

struct _CockpitWebFilterIface {
  GTypeInterface parent_iface;

  void       (* push)            (CockpitWebFilter *filter,
                                  GBytes *block,
                                  void (* function) (gpointer, GBytes *),
                                  gpointer data);
};

GType               cockpit_web_filter_get_type     (void) G_GNUC_CONST;

void                cockpit_web_filter_push         (CockpitWebFilter *filter,
                                                     GBytes *queue,
                                                     void (* function) (gpointer, GBytes *),
                                                     gpointer data);

G_END_DECLS

#endif /* COCKPIT_WEB_FILTER_H__ */
