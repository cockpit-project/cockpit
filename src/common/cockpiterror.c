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
 * Error codes.
 */

GQuark
cockpit_error_quark (void)
{
  static GQuark domain = 0;
  static volatile gsize quark_volatile = 0;

  if (g_once_init_enter (&quark_volatile)) {
      domain = g_quark_from_static_string ("cockpit-error");
      g_once_init_leave (&quark_volatile, 1);
  }

  return domain;
}
