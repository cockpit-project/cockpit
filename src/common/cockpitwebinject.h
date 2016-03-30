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

#ifndef COCKPIT_WEB_INJECT_H__
#define COCKPIT_WEB_INJECT_H__

#include "common/cockpitwebfilter.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_INJECT         (cockpit_web_inject_get_type ())
#define COCKPIT_WEB_INJECT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_WEB_INJECT, CockpitWebInject))
#define COCKPIT_IS_WEB_INJECT(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_WEB_INJECT))

typedef struct _CockpitWebInject CockpitWebInject;

GType               cockpit_web_inject_get_type     (void) G_GNUC_CONST;

CockpitWebFilter *  cockpit_web_inject_new          (const gchar *marker,
                                                     GBytes *inject,
                                                     guint count);

G_END_DECLS

#endif /* COCKPIT_WEB_INJECT_H__ */
