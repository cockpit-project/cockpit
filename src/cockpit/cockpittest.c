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

#include "cockpittest.h"

#include <glib-object.h>

#include <string.h>

/*
 * HACK: We can't yet use g_test_expect_message() and friends.
 * They were pretty broken until GLib 2.40 if you have any debug
 * or info messages ... which we do.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=661926
 */

typedef struct {
  gchar *log_domain;
  GLogLevelFlags log_level;
  gchar *pattern;
  const gchar *file;
  int line;
  const gchar *func;
} ExpectedMessage;

static gboolean cockpit_test_init_was_called = FALSE;
static gint ignore_fatal_count = 0;
static GSList *expected_messages = NULL;
static GLogFunc gtest_default_log_handler = NULL;

static const gchar *
calc_prefix (gint level)
{
  switch (level)
    {
    case G_LOG_LEVEL_ERROR:
      return "ERROR";
    case G_LOG_LEVEL_CRITICAL:
      return "CRITICAL";
    case G_LOG_LEVEL_WARNING:
      return "WARNING";
    case G_LOG_LEVEL_MESSAGE:
      return "Message";
    case G_LOG_LEVEL_INFO:
      return "INFO";
    case G_LOG_LEVEL_DEBUG:
      return "DEBUG";
    default:
      return "Unknown";
    }
}

static gboolean
expected_fatal_handler (const gchar *log_domain,
                        GLogLevelFlags log_level,
                        const gchar *message,
                        gpointer user_data)
{
  if (log_level & G_LOG_FLAG_FATAL)
    {
      if (ignore_fatal_count > 0)
        {
          ignore_fatal_count--;
          return FALSE;
        }
    }

  return TRUE;
}

static void
expected_message_handler (const gchar *log_domain,
                          GLogLevelFlags log_level,
                          const gchar *message,
                          gpointer user_data)
{
  gint level = log_level & G_LOG_LEVEL_MASK;
  ExpectedMessage *expected = NULL;
  gchar *expected_message;

  if (level && expected_messages &&
      (level & G_LOG_LEVEL_DEBUG) == 0)
    {
      expected = expected_messages->data;

      if (log_level & G_LOG_FLAG_FATAL)
        {
          ignore_fatal_count = 1;

          /* This handler is reset for each test, so set it right before we need it */
          g_test_log_set_fatal_handler (expected_fatal_handler, NULL);
        }

      if (g_strcmp0 (expected->log_domain, log_domain) == 0 &&
          ((log_level & expected->log_level) == expected->log_level) &&
          g_pattern_match_simple (expected->pattern, message))
        {
          expected_messages = g_slist_delete_link (expected_messages,
                                                   expected_messages);
          g_free (expected->log_domain);
          g_free (expected->pattern);
          g_free (expected);
          return;
        }
    }

  gtest_default_log_handler (log_domain, log_level, message, NULL);

  if (expected)
    {
      expected_message = g_strdup_printf ("Did not see expected %s-%s: %s",
                                          expected->log_domain,
                                          calc_prefix (expected->log_level),
                                          expected->pattern);
      g_assertion_message (expected->log_domain, expected->file, expected->line,
                           expected->func, expected_message);
      g_free (expected_message);
    }
}

/**
 * cockpit_test_init:
 *
 * Call this instead of g_test_init() to setup a cocpit test.
 * Enables use of cockpit_expect_xxx() functions.
 *
 * Calls g_type_init() if necessary. Sets up cleaner logging
 * during testing.
 *
 * Also calls g_test_init() for you.
 */
void
cockpit_test_init (int *argc,
                   char ***argv)
{
  gchar *basename;

  g_type_init ();

  if (*argc > 0)
    {
      basename = g_path_get_basename ((*argv)[0]);
      g_set_prgname (basename);
      g_free (basename);
    }

  g_test_init (argc, argv, NULL);

  /* Chain to the gtest log handler */
  gtest_default_log_handler = g_log_set_default_handler (expected_message_handler, NULL);
  g_assert (gtest_default_log_handler != NULL);

  cockpit_test_init_was_called = TRUE;
}

void
_cockpit_expect_logged_msg (const char *domain,
                            const gchar *file,
                            int line,
                            const gchar *func,
                            GLogLevelFlags log_level,
                            const gchar *pattern)
{
  ExpectedMessage *expected;

  g_assert (cockpit_test_init_was_called);

  g_return_if_fail (log_level != 0);
  g_return_if_fail (pattern != NULL);
  g_return_if_fail (~log_level & G_LOG_LEVEL_ERROR);
  g_return_if_fail (log_level & G_LOG_LEVEL_MASK);

  expected = g_new (ExpectedMessage, 1);
  expected->log_domain = g_strdup (domain);
  expected->log_level = log_level & G_LOG_LEVEL_MASK;
  expected->pattern = g_strdup (pattern);
  expected->file = file;
  expected->line = line;
  expected->func = func;

  expected_messages = g_slist_append (expected_messages, expected);
}

/**
 * cockpit_assert_expected:
 *
 * Assert that all the things we were expecting in a test
 * happened. This should be called in a teardown() function
 * or after a cockpit_expect_xxx() function.
 */
void
cockpit_assert_expected (void)
{
  ExpectedMessage *expected;
  gchar *message;

  g_assert (cockpit_test_init_was_called);

  if (expected_messages)
    {
      expected = expected_messages->data;

      message = g_strdup_printf ("Did not see expected %s-%s: %s",
                                 expected->log_domain,
                                 calc_prefix (expected->log_level),
                                 expected->pattern);
      g_assertion_message (expected->log_domain, expected->file, expected->line,
                           expected->func, message);
      g_free (message);
    }

  ignore_fatal_count = 0;
}

/**
 * cockpit_assert_strmatch:
 * @str: the string
 * @pattern: to match
 *
 * Checks that @str matches the wildcard style @pattern
 */
void
_cockpit_assert_strmatch_msg (const char *domain,
                              const char *file,
                              int line,
                              const char *func,
                              const gchar *string,
                              const gchar *pattern)
{
  const gchar *suffix;
  gchar *escaped;
  gchar *msg;
  int len;

  if (!string || !g_pattern_match_simple (pattern, string))
    {
      escaped = g_strescape (pattern, "");
      if (!string)
        {
          msg = g_strdup_printf ("'%s' does not match: (null)", escaped);
        }
      else
        {
          suffix = "";
          len = strlen (string);
          if (len > 256)
            {
              len = 256;
              suffix = "\n...\n";
            }
          msg = g_strdup_printf ("'%s' does not match: %.*s%s", escaped, len, string, suffix);
        }
      g_assertion_message (domain, file, line, func, msg);
      g_free (escaped);
      g_free (msg);
    }
}

/**
 * cockpit_test_skip()
 *
 * Can't call g_test_skip(). It's not available in
 * the GLib's we target. Call this instead.
 *
 * Same caveat applies. Must return from test, this
 * doesn't somehow jump out for you.
 */
void
cockpit_test_skip (const gchar *reason)
{
  if (g_test_verbose ())
    g_print ("GTest: skipping: %s\n", reason);
  else
    g_print ("SKIP: %s ", reason);
}

