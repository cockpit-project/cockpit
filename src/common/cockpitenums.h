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

#ifndef __COCKPIT_ENUMS_H__
#define __COCKPIT_ENUMS_H__

#include <gio/gio.h>

G_BEGIN_DECLS

/**
 * CockpitError:
 * @COCKPIT_ERROR_FAILED: The operation failed.
 *
 * Error codes for the #COCKPIT_ERROR error domain and the corresponding
 * D-Bus error names.
 */
typedef enum
{
  COCKPIT_ERROR_NO_SUCH_REALM,                /* com.redhat.Cockpit.Error.NoSuchRealm */
  COCKPIT_ERROR_AUTHENTICATION_FAILED,        /* com.redhat.Cockpit.Error.AuthenticationFailed */
  COCKPIT_ERROR_PERMISSION_DENIED,            /* com.redhat.Cockpit.Error.PermissionDenied */
  COCKPIT_ERROR_CANCELLED,                    /* com.redhat.Cockpit.Error.Cancelled */
  COCKPIT_ERROR_FAILED,                       /* com.redhat.Cockpit.Error.Failed */
} CockpitError;

#define COCKPIT_ERROR_NUM_ENTRIES  (COCKPIT_ERROR_FAILED + 1)

#define COCKPIT_RESOURCE_PACKAGE_VALID "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"

G_END_DECLS

#endif /* __COCKPIT_ENUMS_H__ */
