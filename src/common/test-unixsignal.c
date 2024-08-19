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

#include "cockpitunixsignal.h"

#include "testlib/cockpittest.h"

#include <glib.h>

static void
test_posix_signal (void)
{
  gchar *signal;

  signal = cockpit_strsignal (SIGVTALRM);
  g_assert_cmpstr (signal, ==, "VTALRM");
  g_free (signal);
}

static void
test_rt_signal (void)
{
  gchar *signal;

  signal = cockpit_strsignal (SIGRTMIN);
  g_assert_cmpstr (signal, ==, "RT0");
  g_free (signal);
}

static void
test_other_signal (void)
{
  gchar *signal;

  signal = cockpit_strsignal (0xffffffff);
  g_assert_cmpstr (signal, ==, "UNKNOWN");
  g_free (signal);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/unixsignal/posix-signal", test_posix_signal);
  g_test_add_func ("/unixsignal/realtime-signal", test_rt_signal);
  g_test_add_func ("/unixsignal/other-signal", test_other_signal);

  return g_test_run ();
}
