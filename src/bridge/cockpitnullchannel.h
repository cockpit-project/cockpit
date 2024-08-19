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

#ifndef COCKPIT_NULL_CHANNEL_H__
#define COCKPIT_NULL_CHANNEL_H__

#include "common/cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_NULL_CHANNEL         (cockpit_null_channel_get_type ())

GType              cockpit_null_channel_get_type     (void) G_GNUC_CONST;

#endif /* COCKPIT_NULL_CHANEL_H__ */
