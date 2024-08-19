/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#ifndef MOCK_PRESSURE_H
#define MOCK_PRESSURE_H

#include <glib-object.h>

#include "common/cockpitflow.h"

#define MOCK_TYPE_PRESSURE         (mock_pressure_get_type ())

GType                mock_pressure_get_type      (void);

CockpitFlow *        mock_pressure_new           (void);

#endif /* MOCK_PRESSURE_H */
