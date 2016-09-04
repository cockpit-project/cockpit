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

#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <execinfo.h>
#include <unistd.h>
#include <sys/types.h>
#include <net/if.h>
#include <netinet/in.h>
#include <netinet/ip6.h>
#include <ifaddrs.h>

#include <sys/select.h>
#include <fcntl.h>
#include <sys/wait.h>

/*
 * HACK: We can't yet use g_test_expect_message() and friends.
 * They were pretty broken until GLib 2.40 if you have any debug
 * or info messages ... which we do.
 *
 * https://bugzilla.gnome.org/show_bug.cgi?id=661926
 */

static gboolean cockpit_test_init_was_called = FALSE;

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
 * Calls g_type_init() if necessary. Sets up cleaner logging
 * during testing.
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

  g_setenv ("GIO_USE_VFS", "local", TRUE);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);

  g_assert (g_snprintf (path, sizeof (path), "%s:%s", BUILDDIR, g_getenv ("PATH")) < sizeof (path));
  g_setenv ("PATH", path, TRUE);

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

/*
 * This gdb code only works if /proc/sys/kernel/yama/ptrace_scope is set to zero
 * See: https://wiki.ubuntu.com/SecurityTeam/Roadmap/KernelHardening#ptrace%20Protection
 */

static gboolean stack_trace_done = FALSE;

static void
stack_trace_sigchld (int signum)
{
  stack_trace_done = TRUE;
}

static void
stack_trace (char **args)
{
  pid_t pid;
  int in_fd[2];
  int out_fd[2];
  fd_set fdset;
  fd_set readset;
  struct timeval tv;
  int sel, idx, state;
  char buffer[256];
  char c;

  stack_trace_done = FALSE;
  signal (SIGCHLD, stack_trace_sigchld);

  if ((pipe (in_fd) == -1) || (pipe (out_fd) == -1))
    {
      perror ("unable to open pipe");
      _exit (0);
    }

  pid = fork ();
  if (pid == 0)
    {
      /* Save stderr for printing failure below */
      int old_err = dup (2);

      int res = fcntl (old_err, F_GETFD);
      if (res == -1)
        {
          perror ("getfd failed");
        }
      else if (fcntl (old_err, F_SETFD,  res | FD_CLOEXEC) == -1)
        {
          perror ("setfd failed");
        }
      else
        {
          if (dup2 (in_fd[0], 0) < 0 || dup2 (out_fd[1], 1) < 0)
            {
              perror ("dup fds failed");
            }
          else
            {
              execvp (args[0], args);
              perror ("exec gdb failed");
            }
        }
      _exit (0);
    }
  else if (pid == (pid_t) -1)
    {
      perror ("unable to fork");
      _exit (0);
    }

  FD_ZERO (&fdset);
  FD_SET (out_fd[0], &fdset);

  if (write (in_fd[1], "backtrace\n", 10) != 10 ||
      write (in_fd[1], "quit\n", 5) != 5)
    {
      perror ("unable to send commands to gdb");
      _exit (0);
    }

  idx = 0;
  state = 0;

  while (1)
    {
      readset = fdset;
      tv.tv_sec = 1;
      tv.tv_usec = 0;

      sel = select (FD_SETSIZE, &readset, NULL, NULL, &tv);
      if (sel == -1)
        break;

      if ((sel > 0) && (FD_ISSET (out_fd[0], &readset)))
        {
          if (read (out_fd[0], &c, 1))
            {
              switch (state)
                {
                case 0:
                  if (c == '#')
                    {
                      state = 1;
                      idx = 0;
                      buffer[idx++] = c;
                    }
                  break;
                case 1:
                  buffer[idx++] = c;
                  if ((c == '\n') || (c == '\r'))
                    {
                      buffer[idx] = 0;
                      fprintf (stderr, "%s", buffer);
                      state = 0;
                      idx = 0;
                    }
                  break;
                default:
                  break;
                }
            }
        }
      else if (stack_trace_done)
        break;
    }

  close (in_fd[0]);
  close (in_fd[1]);
  close (out_fd[0]);
  close (out_fd[1]);
  _exit (0);
}

static void
gdb_stack_trace (void)
{
  pid_t pid;
  gchar buf[16];
  gchar *args[4] = { "gdb", "-p", buf, NULL };
  int status;

  sprintf (buf, "%u", (guint) getpid ());

  pid = fork ();
  if (pid == 0)
    {
      stack_trace (args);
      _exit (0);
    }
  else if (pid == (pid_t) -1)
    {
      perror ("unable to fork gdb");
      return;
    }

  waitpid (pid, &status, 0);
}

void
cockpit_test_signal_backtrace (int sig)
{
  void *array[16];
  size_t size;

  signal (sig, SIG_DFL);

  /* Try to trace with gdb first */
  gdb_stack_trace ();

  /* In case above didn't work, print raw stack trace */
  size = backtrace (array, G_N_ELEMENTS (array));

  /* print out all the frames to stderr */
  fprintf (stderr, "Error: signal %s:\n", strsignal (sig));
  backtrace_symbols_fd (array, size, STDERR_FILENO);

  raise (sig);
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
