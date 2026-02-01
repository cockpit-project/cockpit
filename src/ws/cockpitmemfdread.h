/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */


#pragma once

#include "cockpitcontrolmessages.h"

#include <json-glib/json-glib.h>
#include <glib.h>

gchar *
cockpit_memfd_read (gint fd,
                    GError **error);

JsonObject *
cockpit_memfd_read_json (gint fd,
                         GError **error);

JsonObject *
cockpit_memfd_read_json_from_control_messages (CockpitControlMessages *ccm,
                                               GError **error);
