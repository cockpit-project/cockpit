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

#ifndef __COCKPIT_ERROR_H__
#define __COCKPIT_ERROR_H__

#include "common/cockpittypes.h"

G_BEGIN_DECLS

/**
 * COCKPIT_ERROR:
 *
 * Error domain for Cockpit. Errors in this domain will be form the
 * #CockpitError enumeration. See #GError for more information on error
 * domains.
 */
#define COCKPIT_ERROR (cockpit_error_quark ())

GQuark cockpit_error_quark (void);

G_END_DECLS

#endif /* __COCKPIT_ERROR_H__ */
