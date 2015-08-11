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

#include "cockpitunicode.h"

#include "common/cockpittest.h"

#include <string.h>

typedef struct {
  const gchar *input;
  const gchar *output;
} Fixture;

static void
test_force_utf8 (gconstpointer data)
{
  const Fixture *fixture = data;
  const gchar *expect;
  GBytes *input;
  GBytes *output;

  g_assert (data != NULL);

  input = g_bytes_new_static (fixture->input, strlen (fixture->input));
  output = cockpit_unicode_force_utf8 (input);

  expect = fixture->output ? fixture->output : fixture->input;
  cockpit_assert_bytes_eq (output, expect, -1);

  if (!fixture->output)
    g_assert (input == output);
  else
    g_assert (input != output);

  g_bytes_unref (input);
  g_bytes_unref (output);
}

static const Fixture fixtures[] = {
  { "this is a ascii", NULL },
  { "this is \303\244 utf8", NULL },
  { "this is \303 invalid", "this is \357\277\275 invalid" },
  { "this is invalid \303", "this is invalid \357\277\275" },
  { "\303 this is \303 invalid \303", "\357\277\275 this is \357\277\275 invalid \357\277\275" },
};

int
main (int argc,
      char *argv[])
{
  gchar *escaped;
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (fixtures); i++)
    {
      g_assert (fixtures[i].input != NULL);
      escaped = g_strcanon (g_strdup (fixtures[i].input), COCKPIT_TEST_CHARS, '_');
      name = g_strdup_printf ("/unicode/force-utf8/%s", escaped);
      g_free (escaped);

      g_test_add_data_func (name, fixtures + i, test_force_utf8);
      g_free (name);
    }

  return g_test_run ();
}
