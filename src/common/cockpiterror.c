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

#include "config.h"

#include "cockpiterror.h"

/**
 * SECTION:cockpiterror
 * @title: CockpitError
 * @short_description: Possible errors that can be returned
 *
 * Error codes and D-Bus errors.
 */

static const GDBusErrorEntry dbus_error_entries[] =
{
  {COCKPIT_ERROR_NO_SUCH_REALM,                "com.redhat.Cockpit.Error.NoSuchRealm"},
  {COCKPIT_ERROR_AUTHENTICATION_FAILED,        "com.redhat.Cockpit.Error.AuthenticationFailed"},
  {COCKPIT_ERROR_PERMISSION_DENIED,            "com.redhat.Cockpit.Error.PermissionDenied"},
  {COCKPIT_ERROR_CANCELLED,                    "com.redhat.Cockpit.Error.Cancelled"},
  {COCKPIT_ERROR_FAILED,                       "com.redhat.Cockpit.Error.Failed"},
};

GQuark
cockpit_error_quark (void)
{
  G_STATIC_ASSERT (G_N_ELEMENTS (dbus_error_entries) == COCKPIT_ERROR_NUM_ENTRIES);
  static volatile gsize quark_volatile = 0;
  g_dbus_error_register_error_domain ("cockpit-error-quark",
                                      &quark_volatile,
                                      dbus_error_entries,
                                      G_N_ELEMENTS (dbus_error_entries));
  return (GQuark) quark_volatile;
}
