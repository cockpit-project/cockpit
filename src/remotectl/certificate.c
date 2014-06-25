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

#include "config.h"

#include "remotectl.h"

#include <glib.h>

int
cockpit_remotectl_certificate (int argc,
                               char *argv[])
{
  GOptionContext *context;
  GError *error = NULL;
  int ret = 1;

  const GOptionEntry options[] = {
    { G_OPTION_REMAINING, 0, G_OPTION_FLAG_HIDDEN, G_OPTION_ARG_CALLBACK,
      cockpit_remotectl_no_arguments, NULL, NULL },
    { NULL },
  };

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, options, NULL);
  g_option_context_set_help_enabled (context, TRUE);

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_message ("%s", error->message);
      ret = 2;
      goto out;
    }

  g_print ("certificate\n");

out:
  g_option_context_free (context);
  g_clear_error (&error);
  return ret;
}
