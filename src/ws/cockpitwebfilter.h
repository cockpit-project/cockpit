/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
