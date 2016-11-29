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

#ifndef __COCKPIT_DBUS_CACHE_H
#define __COCKPIT_DBUS_CACHE_H

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_DBUS_CACHE    (cockpit_dbus_cache_get_type ())
#define COCKPIT_DBUS_CACHE(o)      (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DBUS_CACHE, CockpitDBusCache))
#define COCKPIT_IS_DBUS_CACHE(k)   (G_TYPE_CHECK_INSTANCE_TYPE ((k), COCKPIT_TYPE_DBUS_CACHE))

typedef struct _CockpitDBusCache CockpitDBusCache;
typedef struct _CockpitDBusCacheClass CockpitDBusCacheClass;

struct _CockpitDBusCacheClass {
  GObjectClass parent;

  void    (* meta)          (CockpitDBusCache *self,
                             GDBusInterfaceInfo *iface);

  void    (* update)        (CockpitDBusCache *self,
                             const gchar *path,
                             GDBusInterfaceInfo *iface);
};

typedef void       (* CockpitDBusIntrospectFunc)           (CockpitDBusCache *cache,
                                                            GDBusInterfaceInfo *iface,
                                                            gpointer user_data);

typedef void       (* CockpitDBusBarrierFunc)              (CockpitDBusCache *cache,
                                                            gpointer user_data);

GType                 cockpit_dbus_cache_get_type          (void) G_GNUC_CONST;

CockpitDBusCache *    cockpit_dbus_cache_new               (GDBusConnection *connection,
                                                            const gchar *name,
                                                            const gchar *logname,
                                                            GHashTable *interface_info);

void                  cockpit_dbus_cache_barrier           (CockpitDBusCache *self,
                                                            CockpitDBusBarrierFunc callback,
                                                            gpointer user_data);

void                  cockpit_dbus_cache_poke              (CockpitDBusCache *self,
                                                            const gchar *path,
                                                            const gchar *iface);

void                  cockpit_dbus_cache_scrape            (CockpitDBusCache *self,
                                                            GVariant *data);

void                  cockpit_dbus_cache_watch             (CockpitDBusCache *self,
                                                            const gchar *path,
                                                            gboolean is_namespace,
                                                            const gchar *interface);

gboolean              cockpit_dbus_cache_unwatch           (CockpitDBusCache *self,
                                                            const gchar *path,
                                                            gboolean is_namespace,
                                                            const gchar *interface);

void                  cockpit_dbus_cache_introspect        (CockpitDBusCache *self,
                                                            const gchar *path,
                                                            const gchar *interface,
                                                            CockpitDBusIntrospectFunc callback,
                                                            gpointer user_data);

GHashTable *          cockpit_dbus_interface_info_new      (void);

GDBusInterfaceInfo *  cockpit_dbus_interface_info_lookup   (GHashTable *interface_info,
                                                            const gchar *interface_name);

void                  cockpit_dbus_interface_info_push     (GHashTable *interface_info,
                                                            GDBusInterfaceInfo *interface);

G_END_DECLS

#endif /* __COCKPIT_DBUS_CACHE_H */
