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

#ifndef __COCKPIT_H__
#define __COCKPIT_H__

#if !defined(COCKPIT_API_IS_SUBJECT_TO_CHANGE) && !defined(COCKPIT_COMPILATION)
#error  libcockpit is unstable API. You must define COCKPIT_API_IS_SUBJECT_TO_CHANGE before including cockpit/cockpit.h
#endif

#include <gio/gio.h>

#include <stdint.h>
#include <string.h>

#define __COCKPIT_INSIDE_COCKPIT_H__
#include <cockpit/cockpittypes.h>
#include <cockpit/cockpitenums.h>
#include <cockpit/cockpiterror.h>
#include <cockpit/cockpitlog.h>
#include <cockpitenumtypes.h>
#include <cockpit-generated.h>
#undef __COCKPIT_INSIDE_COCKPIT_H__

#endif /* __COCKPIT_H__ */
