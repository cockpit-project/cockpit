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

/* We wrap journal logging, so this is useless */
#define SD_JOURNAL_SUPPRESS_LOCATION 1

#include "config.h"

#include "cockpitlog.h"
#include "cockpitconf.h"

#include <systemd/sd-journal.h>
#include <syslog.h>
#include <string.h>

#include <errno.h>
#include <unistd.h>

static GLogFunc old_handler;
static gboolean have_journal = FALSE;

void
cockpit_null_log_handler (const gchar *log_domain,
                          GLogLevelFlags log_level,
                          const gchar *message,
                          gpointer user_data)
{
  /* who, me? */
}

void
cockpit_journal_log_handler (const gchar *log_domain,
                             GLogLevelFlags log_level,
                             const gchar *message,
                             gpointer user_data)
{
  gboolean to_journal = TRUE;
  int priority;
  const gchar *domains;

  /* In case we have generate our own log lines */
  const gchar *prefix;

  /*
   * Note: we should not call GLib fucntions here.
   *
   * Mapping glib log levels to syslog priorities
   * is not at all obvious.
   */

  switch (log_level & G_LOG_LEVEL_MASK)
    {
    /*
     * In GLib this is always fatal, caller of this
     * function aborts()
     */
    case G_LOG_LEVEL_ERROR:
      priority = LOG_CRIT;
      prefix = "ERROR";
      break;

    /*
     * By convention in GLib applications, critical warnings
     * are usually internal programmer error (ie: precondition
     * failures). This maps well to LOG_CRIT.
     */
    case G_LOG_LEVEL_CRITICAL:
      priority = LOG_CRIT;
      prefix = "CRITICAL";
      break;

    /*
     * By convention in GLib apps, g_warning() is used for
     * non-fatal problems, but ones that should be corrected
     * or not be encountered in normal system behavior.
     */
    case G_LOG_LEVEL_WARNING:
      priority = LOG_ERR;
      prefix = "WARNING";
      break;

    /*
     * These are related to bad input, or other hosts behaving
     * badly. Map well to syslog warnings.
     */
    case G_LOG_LEVEL_MESSAGE:
    default:
      priority = LOG_WARNING;
      prefix = "MESSAGE";
      break;

    /* Informational messages, startup, shutdown etc. */
    case G_LOG_LEVEL_INFO:
      priority = LOG_INFO;
      prefix = "INFO";
      break;

    /* Debug messages. */
    case G_LOG_LEVEL_DEBUG:
      domains = g_getenv ("G_MESSAGES_DEBUG");
      if (domains == NULL ||
          (strcmp (domains, "all") != 0 && (!log_domain || !strstr (domains, log_domain))))
        {
          to_journal = FALSE;
        }

      priority = LOG_INFO;
      prefix = "DEBUG";
      break;
    }

  if (to_journal)
    {
      if (have_journal)
        {
          sd_journal_send ("MESSAGE=%s", message,
                           "PRIORITY=%d", (int)priority,
                           "COCKPIT_DOMAIN=%s", log_domain ? log_domain : "",
                           NULL);
        }
      else if (old_handler == NULL)
        {
            g_printerr ("%s: %s: %s\n",
                        prefix,
                        log_domain ? log_domain : "Unknown",
                        message);
        }
    }

  /* After journal, since this may have side effects */
  if (old_handler)
    old_handler (log_domain, log_level, message, NULL);
}

void
cockpit_set_journal_logging (const gchar *stderr_domain,
                             gboolean only)
{
  GLogLevelFlags fatal;
  const gchar **fatals;
  int fd;

  fatals = cockpit_conf_strv ("Log", "Fatal", ' ');
  if (fatals)
    {
      fatal = G_LOG_LEVEL_ERROR;
      for (; fatals[0] != NULL; fatals++)
        {
          if (g_ascii_strcasecmp ("criticals", fatals[0]) == 0)
            fatal |= G_LOG_LEVEL_CRITICAL;
          else if (g_ascii_strcasecmp ("warnings", fatals[0]) == 0)
            fatal |= G_LOG_LEVEL_WARNING;
        }
      g_log_set_always_fatal (fatal);
    }

  /* Don't log to journal while being tested by test-server */
  if (g_getenv ("COCKPIT_TEST_SERVER_PORT") != NULL)
    only = FALSE;

  old_handler = g_log_set_default_handler (cockpit_journal_log_handler, NULL);

  /* SELinux won't let us always open the sd_journal_stream_fd
   * so just check that the main journal socket exists
   */
  have_journal = g_file_test ("/run/systemd/journal/socket", G_FILE_TEST_EXISTS);
  if (only)
    old_handler = NULL;

  if (only && stderr_domain)
    {
      fd = sd_journal_stream_fd (stderr_domain, LOG_WARNING, 0);
      if (fd < 0)
        {
          if (-fd == ENOENT)
            g_debug ("no journal present to stream stderr");
          else
            g_warning ("couldn't open journal stream for stderr: %s", g_strerror (-fd));
        }
      else
        {
          if (dup2 (fd, 2) < 0)
            {
              g_warning ("couldn't replace journal stream for stderr: %s", g_strerror (errno));
              close (fd);
            }
        }
    }
}
