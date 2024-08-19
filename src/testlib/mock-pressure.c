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

#include "config.h"

#include "mock-pressure.h"

typedef GObject MockPressure;
typedef GObjectClass MockPressureClass;

static void   mock_pressure_flow_iface_init   (CockpitFlowInterface *iface);

G_DEFINE_TYPE_WITH_CODE (MockPressure, mock_pressure, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, mock_pressure_flow_iface_init));

static void
mock_pressure_init (MockPressure *self)
{

}

static void
mock_pressure_class_init (MockPressureClass *klass)
{

}

static void
mock_pressure_flow_iface_init (CockpitFlowInterface *iface)
{
  /* No implementation */
}

CockpitFlow *
mock_pressure_new (void)
{
  return g_object_new (MOCK_TYPE_PRESSURE, NULL);
}
