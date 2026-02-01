/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef COCKPIT_WEB_INJECT_H__
#define COCKPIT_WEB_INJECT_H__

#include "cockpitwebfilter.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_INJECT         (cockpit_web_inject_get_type ())
G_DECLARE_FINAL_TYPE(CockpitWebInject, cockpit_web_inject, COCKPIT, WEB_INJECT, GObject)

CockpitWebFilter *  cockpit_web_inject_new          (const gchar *marker,
                                                     GBytes *inject,
                                                     guint count);

G_END_DECLS

#endif /* COCKPIT_WEB_INJECT_H__ */
