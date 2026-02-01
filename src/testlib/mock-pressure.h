/*
 * Copyright (C) 2017 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef MOCK_PRESSURE_H
#define MOCK_PRESSURE_H

#include <glib-object.h>

#include "ws/cockpitflow.h"

#define MOCK_TYPE_PRESSURE         (mock_pressure_get_type ())

GType                mock_pressure_get_type      (void);

CockpitFlow *        mock_pressure_new           (void);

#endif /* MOCK_PRESSURE_H */
