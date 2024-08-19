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

#ifndef COCKPIT_WEB_INJECT_H__
#define COCKPIT_WEB_INJECT_H__

#include "common/cockpitwebfilter.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_WEB_INJECT         (cockpit_web_inject_get_type ())
G_DECLARE_FINAL_TYPE(CockpitWebInject, cockpit_web_inject, COCKPIT, WEB_INJECT, GObject)

CockpitWebFilter *  cockpit_web_inject_new          (const gchar *marker,
                                                     GBytes *inject,
                                                     guint count);

G_END_DECLS

#endif /* COCKPIT_WEB_INJECT_H__ */
