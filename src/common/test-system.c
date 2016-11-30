/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "cockpitsystem.h"

#include "common/cockpittest.h"

#include <glib/gstdio.h>

#include <string.h>

/* Defined in cockpit-system.c */
extern const gchar *cockpit_system_proc_base;

typedef struct {
  const gchar *name;
  guint64 result;
  const gchar *warning;
  const gchar *contents;
} StartFixture;

static const StartFixture start_fixtures[] = {
  {
    "real-world",
    1286773,
    NULL,
    "25429 (bash) S 25423 25429 25429 34816 28241 4210688 15410 80646 0 0 18 5 51 35 20 0 1 0 1286773 126083072 1827 18446744073709551615 93932014997504 93932016010716 140725640184064 140725640182696 140221933127530 0 65536 3670020 1266777851 1 0 0 17 0 0 0 0 0 0 93932018110120 93932018156904 93932029841408 140725640190162 140725640190167 140725640190167 140725640191982 0"
  },
  {
    "spaces-in-command",
    1286773,
    NULL,
    "25429 (bash command spaces) S 25423 25429 25429 34816 28241 4210688 15410 80646 0 0 18 5 51 35 20 0 1 0 1286773 126083072 1827 18446744073709551615 93932014997504 93932016010716 140725640184064 140725640182696 140221933127530 0 65536 3670020 1266777851 1 0 0 17 0 0 0 0 0 0 93932018110120 93932018156904 93932029841408 140725640190162 140725640190167 140725640190167 140725640191982 0"
  },
  {
    "missing-file",
    0,
    "couldn't read start time*",
    NULL,
  },
  {
    "missing-command",
    0,
    "error parsing stat command*",
    "25429 xxxx S 25423 25429 25429 34816 28241 4210688 15410 80646 0 0 18 5 51 35 20 0 1 0 1286773 126083072 1827 18446744073709551615 93932014997504 93932016010716 140725640184064 140725640182696 140221933127530 0 65536 3670020 1266777851 1 0 0 17 0 0 0 0 0 0 93932018110120 93932018156904 93932029841408 140725640190162 140725640190167 140725640190167 140725640191982 0",
  },
  {
    "truncate-command",
    0,
    "error parsing stat command*",
    "25429 (bash)",
  },
  {
    "not-enough-tokens",
    0,
    "error parsing stat tokens*",
    "25429 (bash) S 25423 25429 25429 34816 28241 4210688 15410 80646"
  },
  {
    "invalid-time-value",
    0,
    "error parsing start time*",
    "25429 (bash) S 25423 25429 25429 34816 28241 4210688 15410 80646 0 0 18 5 51 35 20 0 1 0 1286773x 126083072 1827 18446744073709551615 93932014997504 93932016010716 140725640184064 140725640182696 140221933127530 0 65536 3670020 1266777851 1 0 0 17 0 0 0 0 0 0 93932018110120 93932018156904 93932029841408 140725640190162 140725640190167 140725640190167 140725640191982 0"
  },
};

static void
test_start_time (gconstpointer data)
{
  const StartFixture *fixture = data;
  GError *error = NULL;
  gchar *filename = NULL;
  gchar *directory;
  gchar *base;
  guint64 result;

  base = g_strdup ("/tmp/test-cockpit-system.XXXXXX");
  base = g_mkdtemp (base);
  g_assert (base != NULL);
  cockpit_system_proc_base = base;

  directory = g_strdup_printf ("%s/%d", base, getpid ());
  g_assert_cmpint (g_mkdir (directory, 0700), ==, 0);

  if (fixture->contents)
    {
      filename = g_strdup_printf ("%s/stat", directory);
      g_file_set_contents (filename, fixture->contents, -1, &error);
      g_assert_no_error (error);
    }
  if (fixture->warning)
    cockpit_expect_warning (fixture->warning);

  result = cockpit_system_process_start_time ();

  /* g_printerr ("%lu\n", result); */
  g_assert (result == fixture->result);

  if (fixture->warning)
    cockpit_assert_expected ();

  if (filename)
    g_assert_cmpint (g_unlink (filename), ==, 0);
  g_assert_cmpint (g_rmdir (directory), ==, 0);
  g_assert_cmpint (g_rmdir (base), ==, 0);

  cockpit_system_proc_base = "/proc";
  g_free (directory);
  g_free (filename);
  g_free (base);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  int i;

  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (start_fixtures); i++)
    {
      name = g_strdup_printf ("/system/start-time/%s", start_fixtures[i].name);
      g_test_add_data_func (name, start_fixtures + i, test_start_time);
      g_free (name);
    }

  return g_test_run ();
}
