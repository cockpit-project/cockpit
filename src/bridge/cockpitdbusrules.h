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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_DBUS_RULES_H_
#define COCKPIT_DBUS_RULES_H_

#include <glib.h>

typedef struct _CockpitDBusRules CockpitDBusRules;

CockpitDBusRules *  cockpit_dbus_rules_new         (void);

gboolean            cockpit_dbus_rules_match       (CockpitDBusRules *rules,
                                                    const gchar *path,
                                                    const gchar *interface,
                                                    const gchar *member,
                                                    const gchar *arg0);

gboolean            cockpit_dbus_rules_add         (CockpitDBusRules *rules,
                                                    const gchar *path,
                                                    gboolean is_namespace,
                                                    const gchar *interface,
                                                    const gchar *member,
                                                    const gchar *arg0);

gboolean            cockpit_dbus_rules_remove      (CockpitDBusRules *rules,
                                                    const gchar *path,
                                                    gboolean is_namespace,
                                                    const gchar *interface,
                                                    const gchar *member,
                                                    const gchar *arg0);

gchar *             cockpit_dbus_rules_to_string   (CockpitDBusRules *rules);

void                cockpit_dbus_rules_free        (CockpitDBusRules *rules);

#endif /* COCKPIT_DBUS_RULES_H_ */
