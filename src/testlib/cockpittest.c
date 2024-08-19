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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpittest.h"

#include "common/cockpitconf.h"
#include "common/cockpitjson.h"
#include "common/cockpitsystem.h"

#include <glib-object.h>

#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip6.h>
#include <ifaddrs.h>

/*
 * HACK: We can't yet use g_test_expect_message() and friends.
 * They were pretty broken until GLib 2.40 if you have any debug
 * or info messages ... which we do.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=661926
 */

static gboolean cockpit_test_init_was_called = FALSE;
static const gchar *orig_g_debug;

/* In cockpitconf.c */
extern const gchar *cockpit_config_file;

G_LOCK_DEFINE (expected);

typedef struct {
  gchar *log_domain;
  GLogLevelFlags log_level;
  gchar *pattern;
  const gchar *file;
  int line;
  const gchar *func;
  gboolean skipable;
  gboolean optional;
} ExpectedMessage;

static void
expected_message_free (gpointer data)
{
  ExpectedMessage *expected = data;
  g_free (expected->log_domain);
  g_free (expected->pattern);
  g_free (expected);
}

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
  GSList *l = NULL;
  gchar *expected_message;
  gboolean skip = FALSE;

  G_LOCK (expected);

  if (level && expected_messages &&
      (level & G_LOG_LEVEL_DEBUG) == 0)
    {
      if (log_level & G_LOG_FLAG_FATAL)
        {
          ignore_fatal_count = 1;

          /* This handler is reset for each test, so set it right before we need it */
          g_test_log_set_fatal_handler (expected_fatal_handler, NULL);
        }

      /* Loop until we find a non-skipable message or have a match */
      for (l = expected_messages; l != NULL; l = l->next)
        {
          expected = l->data;
          if (g_strcmp0 (expected->log_domain, log_domain) == 0 &&
              ((log_level & expected->log_level) == expected->log_level) &&
              g_pattern_match_simple (expected->pattern, message))
            {
              expected_messages = g_slist_delete_link (expected_messages, l);
              expected_message_free (expected);
              skip = TRUE;
              break;
            }
          else if (!expected->skipable)
            {
              break;
            }
        }
    }

  G_UNLOCK (expected);

  if (skip)
    return;

  gtest_default_log_handler (log_domain, log_level, message, NULL);

  if (expected)
    {
      expected_message = g_strdup_printf ("Got unexpected message: %s instead of %s-%s: %s",
                                          message,
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
 * Sets up cleaner logging during testing.
 *
 * Also calls g_test_init() for you.
 */
void
cockpit_test_init (int *argc,
                   char ***argv)
{
  static gchar path[4096];
  gchar *basename;

  signal (SIGPIPE, SIG_IGN);

  cockpit_setenv_check ("GIO_USE_VFS", "local", TRUE);
  cockpit_setenv_check ("GSETTINGS_BACKEND", "memory", TRUE);
  cockpit_setenv_check ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);

  g_assert (g_snprintf (path, sizeof (path), "%s:%s", BUILDDIR, g_getenv ("PATH")) < sizeof (path));
  cockpit_setenv_check ("PATH", path, TRUE);

  /* For our process (children are handled through $G_DEBUG) */
  g_log_set_always_fatal (G_LOG_LEVEL_ERROR | G_LOG_LEVEL_CRITICAL | G_LOG_LEVEL_WARNING);

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
                            const gchar *pattern,
                            gboolean skipable,
                            gboolean optional)
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
  expected->skipable = optional ? TRUE : skipable;
  expected->optional = optional;

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
  GSList *l = NULL;
  g_assert (cockpit_test_init_was_called);

  G_LOCK (expected);

  if (expected_messages)
    {
      for (l = expected_messages; l != NULL; l = l->next)
        {
          expected = l->data;
          if (!expected->optional)
            {
              message = g_strdup_printf ("Did not see expected %s-%s: %s",
                                         expected->log_domain,
                                         calc_prefix (expected->log_level),
                                         expected->pattern);
              break;
            }
        }
    }

  G_UNLOCK (expected);

  if (message)
    {
      g_assertion_message (expected->log_domain, expected->file, expected->line,
                           expected->func, message);
      g_free (message);
    }

  g_slist_free_full (expected_messages, expected_message_free);
  expected_messages = NULL;
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

void
_cockpit_assert_gvariant_eq_msg (const char *domain,
                                 const char *file,
                                 int line,
                                 const char *func,
                                 GVariant *actual,
                                 const gchar *expected)
{
  GVariant *expected_variant = g_variant_parse (NULL, expected, NULL, NULL, NULL);
  if (!g_variant_equal (actual, expected_variant))
    {
      gchar *actual_string = g_variant_print (actual, TRUE);
      gchar *msg = g_strdup_printf ("%s != %s", actual_string, expected);
      g_assertion_message (domain, file, line, func, msg);
      g_free (msg);
      g_free (actual_string);
    }
  g_variant_unref (expected_variant);
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
    len = strlen (data ?: "");
  if (exp_len < 0)
    exp_len = strlen (expect ?: "");

  if (len == exp_len)
    {
      if (len == 0)
        return;
      else if (data && expect && memcmp (data, expect, len) == 0)
        return;
    }

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

GInetAddress *
cockpit_test_find_non_loopback_address (void)
{
  GInetAddress *inet = NULL;
  struct ifaddrs *ifas, *ifa;
  gpointer bytes;

  g_assert_cmpint (getifaddrs (&ifas), ==, 0);
  for (ifa = ifas; ifa != NULL; ifa = ifa->ifa_next)
    {
      if (!(ifa->ifa_flags & IFF_UP))
        continue;
      if (ifa->ifa_addr == NULL)
        continue;
      if (ifa->ifa_addr->sa_family == AF_INET)
        {
          bytes = &(((struct sockaddr_in *)ifa->ifa_addr)->sin_addr);
          inet = g_inet_address_new_from_bytes (bytes, G_SOCKET_FAMILY_IPV4);
        }
      else if (ifa->ifa_addr->sa_family == AF_INET6)
        {
          bytes = &(((struct sockaddr_in6 *)ifa->ifa_addr)->sin6_addr);
          inet = g_inet_address_new_from_bytes (bytes, G_SOCKET_FAMILY_IPV6);
        }
      if (inet)
        {
          if (!g_inet_address_get_is_loopback (inet))
            break;
          g_object_unref (inet);
          inet = NULL;
        }
    }

  freeifaddrs (ifas);
  return inet;
}

void
cockpit_test_allow_warnings (void)
{
  /* make some noise if this gets called twice */
  g_return_if_fail (orig_g_debug == NULL);
  orig_g_debug = g_getenv ("G_DEBUG");
  cockpit_setenv_check ("G_DEBUG", "fatal-criticals", TRUE);
}

void
cockpit_test_reset_warnings (void)
{
  if (orig_g_debug != NULL)
    {
      cockpit_setenv_check ("G_DEBUG", orig_g_debug, TRUE);
      orig_g_debug = NULL;
    }
}

gboolean
cockpit_test_skip_slow (void)
{
  if (g_getenv ("COCKPIT_SKIP_SLOW_TESTS"))
    {
      g_test_skip ("Skipping slow tests");
      return TRUE;
    }

  return FALSE;
}

void
cockpit_assertion_message_error_matches (const char     *domain,
                                         const char     *file,
                                         int             line,
                                         const char     *func,
                                         const char     *expr,
                                         const GError   *error,
                                         GQuark          error_domain,
                                         int             error_code,
                                         const char     *message_pattern)
{
  /* loosely based on g_assertion_message_error() */
  g_autoptr(GString) gstring = g_string_new ("assertion failed ");

  g_string_append_printf (gstring, "%s =~ GError(", expr);

  if (error_domain)
    g_string_append_printf (gstring, "domain=%s", g_quark_to_string (error_domain));
  else
    g_string_append (gstring, "domain=any");

  g_string_append (gstring, ", ");

  if (error_code != -1)
    g_string_append_printf (gstring, "code=%d", error_code);
  else
    g_string_append (gstring, "code=any");

  g_string_append (gstring, ", ");

  if (message_pattern)
    g_string_append_printf (gstring, "message=~'%s'", message_pattern);
  else
    g_string_append (gstring, "message=any");

  g_string_append (gstring, ")): ");

  if (error)
      g_string_append_printf (gstring, "%s (%s, %d)", error->message,
                              g_quark_to_string (error->domain), error->code);
  else
    g_string_append_printf (gstring, "%s is NULL", expr);

  g_assertion_message (domain, file, line, func, gstring->str);
}
