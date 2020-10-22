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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#pragma once

/* Here's where we try to implement "temporary" workaround code:
 * anything that might be labelled TODO, FIXME, HACK, XXX, etc.  Having
 * the workarounds in one place gives at least two advantages:
 *
 *   - common workarounds made in several places can be given a single
 *     function/macro/etc. defined in this file, giving a common place
 *     to document the workaround, links to related bug reports, etc.
 *     This also makes removing the workaround easier: remove it from
 *     this file and the compiler will help us find all the places where
 *     we were using it.
 *
 *     For this reason, we even add small functions here for totally
 *     trivial stuff.
 *
 *   - having all of our hacks in a central place gives us one place to
 *     periodically check, allowing us to remove hacks that are not
 *     longer relevant (because the bug got fixed, etc).
 *
 * This file is intended to be included from code which isn't using
 * GLib, and therefore must only contain "pure libc" C.  For code that
 * depends on GLib (and friends), there's cockpithacks-glib.h.
 */

#ifndef PACKAGE_VERSION
#error config.h should be included from the top of every .c file
#endif

#ifdef HAVE_VALGRIND_VALGRIND_H
#include <valgrind/valgrind.h>
#else
#define RUNNING_ON_VALGRIND  (0)
#endif

/* valgrind doesn't currently support fcntl() F_ADD_SEALS and
 * F_GET_SEALS calls, and fails by returning -1/EINVAL.
 *
 * Add a helper here which should return TRUE in case we are on valgrind
 * and this is broken.  We do this so that when the issue is fixed, we
 * can delete this helper from one location and it will be easy to find
 * all the places that used it (instead of trying to grep around
 * randomly).  We may also be able to add a version check at some
 * point...
 *
 * Upstream bug: https://bugs.kde.org/show_bug.cgi?id=361770
 */
#include <stdbool.h>
#include <stdlib.h>

static inline bool
cockpit_hacks_valgrind_memfd_seals_unsupported (void)
{
  return RUNNING_ON_VALGRIND || getenv ("COCKPIT_HACKS_VALGRIND_MEMFD_WORKAROUND");
}

static inline void
cockpit_hacks_valgrind_memfd_workaround_setenv (void)
{
  if (RUNNING_ON_VALGRIND)
    setenv ("COCKPIT_HACKS_VALGRIND_MEMFD_WORKAROUND", "1", true);
}
