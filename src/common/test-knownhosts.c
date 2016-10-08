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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitknownhosts.h"

#include "cockpittest.h"

#include <glib.h>

const static gchar *known_hosts_file = SRCDIR "/src/common/mock_known_hosts";

static void
test_knownhosts (void)
{
  g_assert_false (cockpit_is_host_known ("/bad-file", "single-alone", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "single", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-alone", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "single-port", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-port", 1111));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-wild", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-wild1", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-wild-extra", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-portwild", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-portwild", 2222));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "single-portwild1", 2222));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "single-1", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-1.test", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "single-2.test", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "single-2a.test", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "multiple", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple1", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "multiple2", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple2", 1111));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple-1.test", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple-2.test", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "multiple-2a.test", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple-wild", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple-wild1", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "multiple-wild-extra", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "hashedmachine", 22));
  g_assert_false (cockpit_is_host_known (known_hosts_file, "hashedmachine2", 22));
  g_assert_true (cockpit_is_host_known (known_hosts_file, "hashedmachine2", 2020));
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/knownhosts/test-matches", test_knownhosts);
  return g_test_run ();
}
