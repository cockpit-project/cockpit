/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_ERROR_H__
#define __COCKPIT_ERROR_H__

#include <glib.h>

G_BEGIN_DECLS

/**
 * COCKPIT_ERROR:
 *
 * Error domain for Cockpit. Errors in this domain will be form the
 * #CockpitError enumeration. See #GError for more information on error
 * domains.
 */
#define COCKPIT_ERROR (cockpit_error_quark ())

/**
 * CockpitError:
 * @COCKPIT_ERROR_FAILED: The operation failed.
 *
 * Error codes for the #COCKPIT_ERROR error domain and the corresponding
 * D-Bus error names.
 */
typedef enum {
  COCKPIT_ERROR_AUTHENTICATION_FAILED,
  COCKPIT_ERROR_PERMISSION_DENIED,
  COCKPIT_ERROR_FAILED,
} CockpitError;

GQuark cockpit_error_quark (void);

G_END_DECLS

#endif /* __COCKPIT_ERROR_H__ */
