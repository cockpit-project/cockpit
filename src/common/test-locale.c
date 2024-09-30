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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitlocale.h"

#include "testlib/cockpittest.h"

#include <libintl.h>
#include <string.h>

typedef struct {
    const gchar *language;
    const gchar *encoding;
    const gchar *locale;
    const gchar *shorter;
} FromFixture;

static FromFixture from_fixtures[] = {
  { "en", NULL, "en", "en" },
  { "en-us", NULL, "en_US", "en" },
  { "en-us", "UTF-8", "en_US.UTF-8", "en" },
  { "zh-cn", NULL, "zh_CN", "zh" },
  { "zh-cn", "UTF-8", "zh_CN.UTF-8", "zh" },
  { NULL, NULL, "C", "C" },
};

static void
test_from_language (gconstpointer data)
{
  const FromFixture *fixture = data;
  gchar *locale;
  gchar *shorter;

  locale = cockpit_locale_from_language (fixture->language, fixture->encoding, &shorter);
  g_assert_cmpstr (locale, ==, fixture->locale);
  if (locale)
    g_assert_cmpstr (shorter, ==, fixture->shorter);
  g_free (locale);
  g_free (shorter);

  locale = cockpit_locale_from_language (fixture->language, fixture->encoding, NULL);
  g_assert_cmpstr (locale, ==, fixture->locale);
  g_free (locale);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i;

  g_unsetenv ("LANGUAGE");
  g_unsetenv ("LANG");
  g_unsetenv ("LC_ALL");
  g_unsetenv ("LC_MESSAGES");

  bindtextdomain ("test", BUILDDIR "/src/common/mock-locale");
  cockpit_test_init (&argc, &argv);

  for (i = 0; i < G_N_ELEMENTS (from_fixtures); i++)
    {
      name = g_strdup_printf ("/locale/from-language/%s", from_fixtures[i].locale);
      g_test_add_data_func (name, from_fixtures + i, test_from_language);
      g_free (name);
    }

  return g_test_run ();
}
