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

#include "cockpitjson.h"

#include "cockpitconf.h"

#include <glib-object.h>

#include <string.h>

/*
 * HACK: We can't yet use g_test_expect_message() and friends.
 * They were pretty broken until GLib 2.40 if you have any debug
 * or info messages ... which we do.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=661926
 */

static gboolean cockpit_test_init_was_called = FALSE;

G_LOCK_DEFINE (expected);

typedef struct {
  gchar *log_domain;
  GLogLevelFlags log_level;
  gchar *pattern;
  const gchar *file;
  int line;
  const gchar *func;
} ExpectedMessage;

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
  gboolean ret = TRUE;

  if (log_level & G_LOG_FLAG_FATAL)
    {
      G_LOCK (expected);

      if (ignore_fatal_count > 0)
        {
          ignore_fatal_count--;
          ret = FALSE;
        }

      G_UNLOCK (expected);
    }

  return ret;
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
  gboolean skip = FALSE;

  G_LOCK (expected);

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
          skip = TRUE;
        }
    }

  G_UNLOCK (expected);

  if (skip)
    return;

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

  signal (SIGPIPE, SIG_IGN);

  g_setenv ("GIO_USE_VFS", "local", TRUE);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);

  g_type_init ();

  // System cockpit configuration file should not be loaded
  cockpit_config_file = NULL;

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

  G_LOCK (expected);
  expected_messages = g_slist_append (expected_messages, expected);
  G_UNLOCK (expected);
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
  ExpectedMessage *expected = NULL;
  gchar *message = NULL;

  g_assert (cockpit_test_init_was_called);

  G_LOCK (expected);

  if (expected_messages)
    {
      expected = expected_messages->data;

      message = g_strdup_printf ("Did not see expected %s-%s: %s",
                                 expected->log_domain,
                                 calc_prefix (expected->log_level),
                                 expected->pattern);
    }

  G_UNLOCK (expected);

  if (expected)
    {
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

          /* To avoid insane output */
          if (len > 8192)
            {
              len = 8192;
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

void
_cockpit_assert_json_eq_msg (const char *domain,
                             const char *file,
                             int line,
                             const char *func,
                             gpointer object_or_array,
                             const gchar *expect)
{
  GError *error = NULL;
  JsonNode *node;
  JsonNode *exnode;
  gchar *escaped;
  gchar *msg;

  if (expect[0] == '[')
    {
      node = json_node_new (JSON_NODE_ARRAY);
      json_node_set_array (node, object_or_array);
    }
  else
    {
      node = json_node_new (JSON_NODE_OBJECT);
      json_node_set_object (node, object_or_array);
    }

  exnode = cockpit_json_parse (expect, -1, &error);
  if (error)
    g_assertion_message_error (domain, file, line, func, "error", error, 0, 0);
  g_assert (exnode);

  if (!cockpit_json_equal (exnode, node))
    {
      escaped = cockpit_json_write (node, NULL);

      msg = g_strdup_printf ("%s != %s", escaped, expect);
      g_assertion_message (domain, file, line, func, msg);
      g_free (escaped);
      g_free (msg);
    }
  json_node_free (node);
  json_node_free (exnode);
}

static gchar *
test_escape_data (const guchar *data,
                  gssize n_data)
{
  static const char HEXC[] = "0123456789ABCDEF";
  GString *result;
  gchar c;
  gsize i;
  guchar j;

  if (!data)
    return g_strdup ("NULL");

  result = g_string_sized_new (n_data * 2 + 1);
  for (i = 0; i < n_data; ++i)
    {
      c = data[i];
      if (g_ascii_isprint (c) && !strchr ("\n\r\v", c))
        {
          g_string_append_c (result, c);
        }
      else
        {
          g_string_append (result, "\\x");
          j = c >> 4 & 0xf;
          g_string_append_c (result, HEXC[j]);
          j = c & 0xf;
          g_string_append_c (result, HEXC[j]);
        }
    }

  return g_string_free (result, FALSE);
}

void
_cockpit_assert_data_eq_msg (const char *domain,
                             const char *file,
                             int line,
                             const char *func,
                             gconstpointer data,
                             gssize len,
                             gconstpointer expect,
                             gssize exp_len)
{
  char *a1, *a2, *s;
  if (!data && !expect)
    return;
  if (len < 0)
    len = strlen (data);
  if (exp_len < 0)
    exp_len = strlen (expect);
  if (len == exp_len && memcmp (data, expect, len) == 0)
    return;
  a1 = test_escape_data (data, len);
  a2 = test_escape_data (expect, exp_len);
  s = g_strdup_printf ("data is not the same (%s != %s)", a1, a2);
  g_free (a1);
  g_free (a2);
  g_assertion_message (domain, file, line, func, s);
  g_free (s);
}

void
_cockpit_assert_bytes_eq_msg (const char *domain,
                              const char *file,
                              int line,
                              const char *func,
                              GBytes *data,
                              gconstpointer expect,
                              gssize exp_len)
{
  _cockpit_assert_data_eq_msg (domain, file, line, func,
                               g_bytes_get_data (data, NULL),
                               g_bytes_get_size (data),
                               expect, exp_len);
}
