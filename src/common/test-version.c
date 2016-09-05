/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitversion.h"

#include "common/cockpittest.h"

#include <string.h>

typedef struct {
  const gchar *one;
  const gchar *two;
  const gint result;
} Fixture;

static void
test_compare_version (gconstpointer data)
{
  const Fixture *fixture = data;
  gint res;

  g_assert (data != NULL);

  res = cockpit_version_compare (fixture->one, fixture->two);

  /* Normalize */
  if (res < 0)
    res = -1;
  else if (res > 0)
    res = 1;

  g_assert_cmpint (res, ==, fixture->result);
}

static const Fixture fixtures[] = {
  { "", "", 0 },
  { "0", "", 1 },
  { "", "5", -1 },
  { "0", "0", 0 },
  { "0", "0.1", -1 },
  { "0.2", "0", 1 },
  { "0.2.3", "0", 1 },
  { "1.0", "1.0", 0 },
  { "1.0", "1.1", -1 },
  { "1.3", "1.1", 1 },
  { "1.2.3", "1.2.3", 0 },
  { "1.2.3", "1.2.5", -1 },
  { "1.2.8", "1.2.5", 1 },
  { "55", "55", 0 },
  { "5abc", "5abc", 0 },
  { "5abc", "5abcd", -1 },
  { "5xyz", "5abcd", 1 },
  { "abc", "abc", 0 },
  { "xyz", "abc", 1 },
};

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (fixtures); i++)
    {
      g_assert (fixtures[i].one != NULL);
      g_assert (fixtures[i].two != NULL);
      name = g_strdup_printf ("/version/compare/%s_%s", fixtures[i].one, fixtures[i].two);

      g_test_add_data_func (name, fixtures + i, test_compare_version);
      g_free (name);
    }

  return g_test_run ();
}
