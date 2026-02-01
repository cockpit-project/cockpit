/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
