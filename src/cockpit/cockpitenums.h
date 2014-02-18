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

#if !defined(COCKPIT_INSIDE_COCKPIT_H_) && !defined(COCKPIT_COMPILATION)
#error "Only <cockpit/cockpit.h> can be included directly."
#endif

#ifndef COCKPIT_ENUMS_H_F68E5F504F2143BFA218EEFBE066BE6A
#define COCKPIT_ENUMS_H_F68E5F504F2143BFA218EEFBE066BE6A

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
  COCKPIT_ERROR_CANCELLED,                    /* com.redhat.Cockpit.Error.Cancelled */
  COCKPIT_ERROR_FAILED,                       /* com.redhat.Cockpit.Error.Failed */
} CockpitError;

#define COCKPIT_ERROR_NUM_ENTRIES  (COCKPIT_ERROR_FAILED + 1)

/**
 * CockpitLogLevel:
 * @COCKPIT_LOG_LEVEL_DEBUG: Debug messages.
 * @COCKPIT_LOG_LEVEL_INFO: Informational messages.
 * @COCKPIT_LOG_LEVEL_NOTICE: Messages that the administrator should take notice of.
 * @COCKPIT_LOG_LEVEL_WARNING: Warning messages.
 * @COCKPIT_LOG_LEVEL_ERROR: Error messages.
 *
 * Logging levels. The level @COCKPIT_LOG_LEVEL_NOTICE and above goes to syslog.
 *
 * Unlike g_warning() and g_error(), none of these logging levels causes the program to ever terminate.
 */
typedef enum
{
  COCKPIT_LOG_LEVEL_DEBUG,
  COCKPIT_LOG_LEVEL_INFO,
  COCKPIT_LOG_LEVEL_NOTICE,
  COCKPIT_LOG_LEVEL_WARNING,
  COCKPIT_LOG_LEVEL_ERROR
} CockpitLogLevel;

G_END_DECLS

#endif /* __COCKPIT_ENUMS_H__ */
