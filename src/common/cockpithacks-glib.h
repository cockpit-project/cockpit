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

/* See the comment in cockpithacks.h for an explanation of why this file
 * exists.
 *
 * This file is intended to be included from code which is built against
 * GLib.  For the "pure C" parts of cockpit, include cockpithacks.h
 * directly.
 */

#include "cockpithacks.h"
#include <glib.h>

/* g_debug() defaults to writing its output to stdout, which doesn't
 * really work for us.  GLib 2.67.0 introduced an API to change this
 * behaviour, and we want to use this API if it's available.
 *
 * Otherwise, we know that earlier versions of GLib use the `stdout`
 * `FILE *` to do its write, while we write directly to fd 1, so we can
 * replace the value of `stdout` to cause GLib to write elsewhere.  This
 * is specifically not allowed by POSIX, but works on Linux.
 */
#include <stdio.h>

static inline void
cockpit_hacks_redirect_gdebug_to_stderr (void)
{
#if GLIB_CHECK_VERSION(2,67,0)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
  g_log_writer_default_set_use_stderr (TRUE);
#pragma GCC diagnostic pop
#else
  stdout = stderr;
#endif
}

/* g_assert_no_errno: Remove this after we depend on GLib 2.66
 *
 * Even if GLib does define this, we want to undefine it and define our
 * own copy so that we can remove the version warning.
 */
#ifdef g_assert_no_errno
#undef g_assert_no_errno
#endif

#include <errno.h>
/* Direct copy, minus 'GLIB_AVAILABLE_MACRO_IN_2_66' */
#define g_assert_no_errno(expr)         G_STMT_START { \
                                             int __ret, __errsv; \
                                             errno = 0; \
                                             __ret = expr; \
                                             __errsv = errno; \
                                             if (__ret < 0) \
                                               { \
                                                 gchar *__msg; \
                                                 __msg = g_strdup_printf ("assertion failed (" #expr " >= 0): errno %i: %s", __errsv, g_strerror (__errsv)); \
                                                 g_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, __msg); \
                                                 g_free (__msg); \
                                               } \
                                        } G_STMT_END
