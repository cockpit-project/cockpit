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

#include "common/cockpitlog.h"

#include <glib-object.h>

#include <unistd.h>

typedef struct {
    const char *name;
    int (* callback) (int, char *[]);
    const gchar *description;
} Command;

static const Command commands[] = {
  { "certificate", cockpit_remotectl_certificate,
    "Manage the certificate that cockpit uses" },
  { NULL },
};

static void
message_handler (const gchar *log_domain,
                 GLogLevelFlags log_level,
                 const gchar *message,
                 gpointer user_data)
{
  g_printerr ("%s: %s\n", g_get_prgname (), message);
}

gboolean
cockpit_remotectl_no_arguments (const gchar *option_value,
                                const gchar *value,
                                gpointer data,
                                GError **error)
{
  g_set_error_literal (error, G_OPTION_ERROR, G_OPTION_ERROR_FAILED,
                       "Too many arguments specified");
  return FALSE;
}

int
main (int argc,
      char **argv)
{
  const Command *command = NULL;
  gboolean verbose = FALSE;
  GError *error = NULL;
  GString *description;
  GOptionContext *context;
  gchar *help;
  int ret = 2;
  gint i;

  const GOptionEntry options[] = {
        { "verbose", 'v', 0, G_OPTION_ARG_NONE, &verbose,
          "Print verbose messages about the task", NULL },
        { NULL },
  };

  signal (SIGPIPE, SIG_IGN);

  /* Send a copy of everything to the journal */
  cockpit_set_journal_logging (G_LOG_DOMAIN, FALSE);

  /* g_message in this domain becomes command output */
  g_log_set_handler (G_LOG_DOMAIN, G_LOG_LEVEL_MESSAGE,
                     message_handler, NULL);

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();
  g_set_prgname ("remotectl");

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, options, NULL);
  g_option_context_set_ignore_unknown_options (context, TRUE);
  g_option_context_set_help_enabled (context, FALSE);

  description = g_string_new ("The most commonly used commands are:\n");
  for (i = 0; commands[i].name != NULL; i++)
    g_string_append_printf (description, "  %-18s%s\n", commands[i].name, commands[i].description);
  g_option_context_set_description (context, description->str);
  g_string_free (description, TRUE);

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_message ("%s", error->message);
      ret = 2;
      goto out;
    }

  /* Skip program name */
  if (argc)
    {
      argc--;
      argv++;
    }

  if (argc > 0)
    {
      for (i = 0; commands[i].name != NULL; i++)
        {
          if (g_str_equal (argv[0], commands[i].name))
            {
              command = commands + i;
              break;
            }
        }
    }

  if (command)
    {
      ret = (command->callback) (argc, argv);
    }
  else
    {
      if (argc == 0 ||
          g_str_equal (argv[0], "-h") ||
          g_str_equal (argv[0], "--help"))
        {
          help = g_option_context_get_help (context, FALSE, NULL);
          g_printerr ("%s", help);
          g_free (help);
          ret = 2;
        }
      else if (argv[0][0] == '-')
        {
          g_message ("Unknown option: %s", argv[0]);
        }
      else
        {
          g_message ("Invalid or unknown command: %s", argv[0]);
        }
    }

out:
  g_clear_error (&error);
  g_option_context_free (context);
  return ret;
}
