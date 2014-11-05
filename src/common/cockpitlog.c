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

#include <systemd/sd-journal.h>
#include <syslog.h>
#include <string.h>

#include <errno.h>
#include <unistd.h>

static GPrintFunc old_printerr;
static GLogFunc old_handler;

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
      break;

    /*
     * By convention in GLib applications, critical warnings
     * are usually internal programmer error (ie: precondition
     * failures). This maps well to LOG_CRIT.
     */
    case G_LOG_LEVEL_CRITICAL:
      priority = LOG_CRIT;
      break;

    /*
     * By convention in GLib apps, g_warning() is used for
     * non-fatal problems, but ones that should be corrected
     * or not be encountered in normal system behavior.
     */
    case G_LOG_LEVEL_WARNING:
      priority = LOG_ERR;
      break;

    /*
     * These are related to bad input, or other hosts behaving
     * badly. Map well to syslog warnings.
     */
    case G_LOG_LEVEL_MESSAGE:
    default:
      priority = LOG_WARNING;
      break;

    /* Informational messages, startup, shutdown etc. */
    case G_LOG_LEVEL_INFO:
      priority = LOG_INFO;
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
      break;
    }

  if (to_journal)
    {
      sd_journal_send ("MESSAGE=%s", message,
                       "PRIORITY=%d", (int)priority,
                       "COCKPIT_DOMAIN=%s", log_domain ? log_domain : "",
                       NULL);
    }

  /* After journal, since this may have side effects */
  if (old_handler)
    old_handler (log_domain, log_level, message, NULL);
}

static void
printerr_handler (const gchar *string)
{
  /* We sanitize the strings produced by g_assert and friends a bit.
   */

  if (old_printerr)
    old_printerr (string);

  if (g_str_has_prefix (string, "**\n"))
    string += strlen("**\n");
  int len = strlen (string);
  if (len > 0 && string[len-1] == '\n')
    len -= 1;

  sd_journal_print (LOG_ERR, "%.*s", len, string);
}

static void
printerr_stderr (const gchar *string)
{
  gssize len;
  gssize res;

  len = strlen (string);
  while (len > 0)
    {
      res = write (2, string, len);
      if (res < 0)
        {
          if (errno != EAGAIN || errno != EINTR)
            break;
        }
      else
        {
          g_assert (res <= len);
          string += res;
          len -= res;
        }
    }
}

void
cockpit_set_journal_logging (gboolean only)
{
  old_handler = g_log_set_default_handler (cockpit_journal_log_handler, NULL);

  old_printerr = g_set_printerr_handler (printerr_handler);

  /* HACK: GLib doesn't currently return its original handler */
  if (!old_printerr)
    old_printerr = printerr_stderr;

  if (only)
    {
      old_printerr = NULL;
      old_handler = NULL;
    }
}
