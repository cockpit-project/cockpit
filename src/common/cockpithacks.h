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

#ifndef HAVE_CLOSEFROM
/* closefrom:
 *
 * We strictly require at least one of:
 *
 *   - closefrom() in the libc
 *   - close_range() in the kernel
 *
 * Our preference is for closefrom(), but we can emulate it with
 * close_range() if we need to.
 */

#include <err.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <unistd.h>

#define closefrom(lowfd) cockpit_closefrom(lowfd)

static inline void
cockpit_closefrom (int lowfd)
{
  int r = syscall (__NR_close_range, lowfd, ~0U, 0);
  if (r != 0)
    {
      warn ("close_range(%d)", lowfd);
      abort ();
    }
}

#endif
