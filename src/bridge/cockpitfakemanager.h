/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#ifndef __COCKPIT_FAKE_MANAGER_H__
#define __COCKPIT_FAKE_MANAGER_H__

/*
 * This is a fake GDBusObjectManager implementation which does not depend
 * on a server side implementation of org.freedesktop.DBus.ObjectManager.
 *
 * It's not perfect.
 *
 * Use cockpit_fake_manager_poke() to make it look up an object. It'll
 * automatically follow trees of properties and things that it understands.
 *
 * Use cockpit_fake_manager_scrape() to pass it a GVariant that possibly has
 * one or more object paths (nested anywhere) which it should look up and
 * be aware of.
 */

#include <gio/gio.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_FAKE_MANAGER         (cockpit_fake_manager_get_type ())
#define COCKPIT_FAKE_MANAGER(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FAKE_MANAGER, CockpitFakeManager))
#define COCKPIT_IS_FAKE_MANAGER(k)        (G_TYPE_CHECK_INSTANCE_TYPE ((k), COCKPIT_TYPE_FAKE_MANAGER))

typedef struct _CockpitFakeManager        CockpitFakeManager;

GType                cockpit_fake_manager_get_type          (void) G_GNUC_CONST;

void                 cockpit_fake_manager_new_for_bus       (GBusType bus_type,
                                                             GDBusObjectManagerClientFlags flags,
                                                             const gchar *service_name,
                                                             const gchar **object_paths,
                                                             GCancellable *cancellable,
                                                             GAsyncReadyCallback callback,
                                                             gpointer user_data);

GDBusObjectManager * cockpit_fake_manager_new_finish        (GAsyncResult *result,
                                                             GError **error);

void                 cockpit_fake_manager_poke              (CockpitFakeManager *self,
                                                             const gchar *object_path);

void                 cockpit_fake_manager_scrape            (CockpitFakeManager *self,
                                                             GVariant *variant);

GDBusConnection *    cockpit_fake_manager_get_connection    (CockpitFakeManager *self);

G_END_DECLS

#endif /* __COCKPIT_FAKE_MANAGER_H__ */
