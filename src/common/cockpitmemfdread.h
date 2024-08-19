/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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


#pragma once

#include "cockpitcontrolmessages.h"

#include <json-glib/json-glib.h>
#include <glib.h>

gchar *
cockpit_memfd_read (gint fd,
                    GError **error);

gboolean
cockpit_memfd_read_from_envvar (gchar **result,
                                const char *envvar,
                                GError **error);

JsonObject *
cockpit_memfd_read_json (gint fd,
                         GError **error);

JsonObject *
cockpit_memfd_read_json_from_control_messages (CockpitControlMessages *ccm,
                                               GError **error);
