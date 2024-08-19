/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

#include "cockpitcontrolmessages.h"
#include "cockpitfdpassing.h"
#include "cockpitjsonprint.h"
#include "cockpitmemfdread.h"
#include "cockpitsocket.h"

#include "testlib/cockpittest.h"

#include <gio/gunixfdmessage.h>
#include <gio/gunixcredentialsmessage.h>
#include <glib-unix.h>

#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <stdio.h>

/* --- testing of printing --- */

typedef struct
{
  char buffer[1024];
  FILE *stream;

  char expected_buffer[1024];
  gchar *expected_end;

  size_t pagesize;
  char *accessible;
  char *inaccessible;
} TestFixture;

static int
memfd_create_noexec (const char *name,
                     unsigned int flags)
{
  /* current kernels moan about not specifying exec mode */
#ifdef MFD_NOEXEC_SEAL
  int fd = memfd_create (name, flags | MFD_NOEXEC_SEAL);
  /* fallback for older kernels */
  if (fd != -1 || errno != EINVAL)
    return fd;
#endif
  return memfd_create (name, flags);
}

static void
test_fixture_setup (TestFixture   *fixture,
                    gconstpointer  user_data)
{
  /* set up the stream */
  fixture->stream = fmemopen (fixture->buffer, sizeof fixture->buffer, "w");
  setbuf (fixture->stream, NULL);
  rewind (fixture->stream);

  /* create a range of accessible bytes surrounded by memory that will
   * cause a crash if accessed.
   */
  fixture->pagesize = sysconf(_SC_PAGE_SIZE);

  /* allocate 3 pages of memory that will crash when accessed (PROT_NONE) */
  char *region = mmap (NULL, 3 * fixture->pagesize, PROT_NONE,
                       MAP_ANONYMOUS | MAP_PRIVATE, -1, 0);
  g_assert (region != MAP_FAILED);

  /* punch a read/writable hole in the middle of the 3 pages */
  int r = mprotect (region + fixture->pagesize, fixture->pagesize, PROT_READ | PROT_WRITE);
  g_assert (r == 0);

  /* record the first and last(+1) accessible bytes.  accessing the
   * bytes immediately outside of this range is guaranteed to crash.
   * this allows us to ensure proper memory behaviour of the code we're
   * testing.
   */
  fixture->accessible = region + fixture->pagesize;
  fixture->inaccessible = fixture->accessible + fixture->pagesize;

  /* setup the expected buffer, empty to start */
  fixture->expected_end = fixture->expected_buffer;
}

static void
test_fixture_teardown (TestFixture   *fixture,
                       gconstpointer  user_data)
{
  char *region = fixture->accessible - fixture->pagesize;
  munmap (region, 3 * fixture->pagesize);
  fixture->accessible = NULL;
  fixture->inaccessible = NULL;

  fixture->expected_end = NULL;

  fclose (fixture->stream);
  fixture->stream = NULL;
}

static void
test_fixture_expect (TestFixture *fixture,
                     const gchar *expected)
{
  fixture->expected_end = stpcpy (fixture->expected_end, expected);
}

static void
test_fixture_compare_expected (TestFixture *fixture)
{
  /* Ensure that both strings are nul terminated */
  fixture->buffer[ftell (fixture->stream)] = '\0';
  *fixture->expected_end = '\0';

  /* Ensure that neither string has embedded nuls */
  g_assert_cmpint (strlen (fixture->buffer), ==, ftell (fixture->stream));
  g_assert (strchr (fixture->expected_buffer, '\0') == fixture->expected_end);

  /* Compare! */
  g_assert_cmpstr (fixture->buffer, ==, fixture->expected_buffer);
}

static void
test_print_string (TestFixture   *fixture,
                   gconstpointer  user_data)
{
  /* create a string with every possible byte in it and check that
   * everything is correctly escaped
   */
  char buffer[256];
  int offset = 0;
  char tmp[10];

  test_fixture_expect (fixture, ", \"key\": \"");

  for (int c = 1; c < 32; c++) /* control characters (before space) */
    {
      /* ascii control characters printed as unicode escapes */
      snprintf (tmp, sizeof tmp, "\\u%04x", c);
      test_fixture_expect (fixture, tmp);

      buffer[offset++] = c;
    }

  test_fixture_expect (fixture, " !");
  buffer[offset++] = 32; /* space */
  buffer[offset++] = 33; /* ! */

  test_fixture_expect (fixture, "\\\"");
  buffer[offset++] = 34; /* " */

  for (int c = 35; c < 92; c++) /* # through [ */
    {
      snprintf (tmp, sizeof tmp, "%c", c);
      test_fixture_expect (fixture, tmp);
      buffer[offset++] = c;
    }

  test_fixture_expect (fixture, "\\\\");
  buffer[offset++] = 92; /* \ */

  for (int c = 93; c < 127; c++) /* ] through ~ */
    {
      snprintf (tmp, sizeof tmp, "%c", c);
      test_fixture_expect (fixture, tmp);
      buffer[offset++] = c;
    }

  test_fixture_expect (fixture, "\\u007f");
  buffer[offset++] = 127; /* DEL */

  for (int c = 128; c < 256; c++) /* non-ascii */
    {
      test_fixture_expect (fixture, "?");
      buffer[offset++] = c;
    }

  buffer[offset++] = '\0';
  g_assert_cmpint (offset, ==, sizeof buffer);
  test_fixture_expect (fixture, "\"");

  /* print it with -1, correct length, and "too big" length */
  cockpit_json_print_string_property (fixture->stream, "key", buffer, -1);
  test_fixture_compare_expected (fixture);
  rewind (fixture->stream);

  cockpit_json_print_string_property (fixture->stream, "key", buffer, 255);
  test_fixture_compare_expected (fixture);
  rewind (fixture->stream);

  cockpit_json_print_string_property (fixture->stream, "key", buffer, 256);
  test_fixture_compare_expected (fixture);
  rewind (fixture->stream);
}

/* The following test tries to catch bad behaviour from the scanner that
 * finds the groups of unescaped characters for fast printing.  It
 * ensures that:
 *
 *   1) the groups are always scanned correctly and correct escaped
 *      output is produced
 *
 *   2) a nul is always honoured, regardless of a larger given
 *      max_length parameter
 *
 *   3) max_length is always honoured, regardless of if a nul is present
 *      or not.
 *
 * In particular, we use our fixture to ensure that we never touch
 * memory past either the final nul character, or past the specified
 * max_length.
 *
 * We test strings composed of a given number 'groups'.  Each group
 * consists of a certain number of repetitions ('reps') of a given
 * character.
 *
 * We use a sequence counter to determine the character and the number
 * of reps for each group.  At each step we take the modulus of a
 * division to make a decision about the given variable, using the whole
 * result as a residual for future decisions.  This effectively
 * implements a counter with an arbitrary radix at each position.  Once
 * we see a non-zero resitual, we know that we've surely exhausted all
 * possible combinations.
 *
 * These constants could easily be a bit higher, but the running time
 * explodes pretty quickly, and this test benefits from being run under
 * valgrind.
 */
#define MIN_GROUPS  1
#define MAX_GROUPS  3
#define MAX_REPS    5

static guint
divmod (guint *residual,
        guint  divisor)
{
  guint result = *residual % divisor;

  *residual /= divisor;

  return result;
}

static void
test_print_string_memory_safety (TestFixture   *fixture,
                                 gconstpointer  user_data)
{
  gchar characters[] = { '\n', ' ', 'a', '\\', '\"', 0xcc };
  const gchar *escaped[] = { "\\u000a", " ", "a", "\\\\", "\\\"", "?" };
  gchar buffer[MAX_GROUPS * MAX_REPS];

  for (gint n_groups = MIN_GROUPS; n_groups <= MAX_GROUPS; n_groups++)
    {
      for (guint seq = 0;; seq++)
        {
          guint residual = seq;
          gint length = 0;
          int reps;

          fixture->expected_end = stpcpy (fixture->expected_buffer, ", \"key\": \"");

          for (gint group = 0; group < n_groups; group++)
            {
              gint c = divmod (&residual, sizeof characters);
              reps = divmod (&residual, MAX_REPS) + 1;

              memset (buffer + length, characters[c], reps);
              length += reps;

              for (gint i = 0; i < reps; i++)
                test_fixture_expect (fixture, escaped[c]);
            }

          g_assert_cmpint (length, <=, sizeof buffer);

          if (residual)
            /* non-zero residual → we've already tried all cases */
            break;

          test_fixture_expect (fixture, "\"");

          /* Test various cases of the string not being nul terminated.
           * We avoid starting from 0 each time in order to avoid
           * effectively testing fewer groups.  `reps` is leftover from
           * the last iteration of the loop above.  Starting at:
           *
           *    length - reps + 1
           *
           * makes sure that we see at least one character from this
           * final group.
           *
           * We position the subset of the string at `region` (at a
           * negative offset to the inaccessible area in the fixture) to
           * ensure that we don't read more than the requested `i`
           * characters.
           *
           * This test doesn't ensure that the correct output is
           * produced.  It's difficult to cut the expected string to the
           * correct length, given the different lengths of escaped
           * characters.
           */
          for (gint i = length - reps + 1; i <= length; i++)
            {
              gchar *region = fixture->inaccessible - i;

              memcpy (region, buffer, i);
              cockpit_json_print_string_property (fixture->stream, "key", region, i);
              rewind (fixture->stream);
            }

          /* These ones test a complete nul-terminated string.  As such,
           * we configure the region to be exactly large enough to hold
           * the nul-terminated string.  Then we try giving different
           * lengths.
           */
          gchar *region = fixture->inaccessible - (length + 1);
          memcpy (region, buffer, length);
          region[length] = '\0';

          /* First with -1 */
          cockpit_json_print_string_property (fixture->stream, "key", region, -1);
          test_fixture_compare_expected (fixture);
          rewind (fixture->stream);

          /* Then the exact length */
          cockpit_json_print_string_property (fixture->stream, "key", region, length);
          test_fixture_compare_expected (fixture);
          rewind (fixture->stream);

          /* Then lengths bigger than the string (keeping in mind that
           * this is a *max* length parameter).
           */
          for (gint i = length + 1; i <= length + 3; i++)
            {
              cockpit_json_print_string_property (fixture->stream, "key", region, i);
              test_fixture_compare_expected (fixture);
              rewind (fixture->stream);
            }
        }
    }
}

static void
test_print_numeric (TestFixture   *fixture,
                    gconstpointer  user_data)
{
  cockpit_json_print_integer_property (fixture->stream, "zero", 0);
  test_fixture_expect (fixture, ", \"zero\": 0");

  cockpit_json_print_integer_property (fixture->stream, "one", 1);
  test_fixture_expect (fixture, ", \"one\": 1");

  cockpit_json_print_integer_property (fixture->stream, "million", 1000000);
  test_fixture_expect (fixture, ", \"million\": 1000000");

  /* check that numbers that can't be encoded in double still work */
  guint64 extra_big = 9007199254740993ull; /* 2^53 + 1 */
  g_assert_cmpint (extra_big, !=, (guint64) (double) extra_big);
  cockpit_json_print_integer_property (fixture->stream, "extrabig", extra_big);
  test_fixture_expect (fixture, ", \"extrabig\": 9007199254740993");

  /* check these special values to make sure they're being handled as uint64 */
  cockpit_json_print_integer_property (fixture->stream, "intmax", INT64_MAX);
  test_fixture_expect (fixture, ", \"intmax\": 9223372036854775807");
  cockpit_json_print_integer_property (fixture->stream, "intmaxplusone", INT64_MAX + 1ull);
  test_fixture_expect (fixture, ", \"intmaxplusone\": 9223372036854775808");
  cockpit_json_print_integer_property (fixture->stream, "uintmax", UINT64_MAX);
  test_fixture_expect (fixture, ", \"uintmax\": 18446744073709551615");
  cockpit_json_print_integer_property (fixture->stream, "minus1", -1);
  test_fixture_expect (fixture, ", \"minus1\": 18446744073709551615");

  /* make sure it all worked out */
  test_fixture_compare_expected (fixture);
}

static void
test_print_boolean (TestFixture   *fixture,
                    gconstpointer  user_data)
{
  test_fixture_expect (fixture, ", \"true\": true, \"false\": false, \"alsotrue\": true");

  cockpit_json_print_bool_property (fixture->stream, "true", true);
  cockpit_json_print_bool_property (fixture->stream, "false", false);
  cockpit_json_print_bool_property (fixture->stream, "alsotrue", 123456);

  test_fixture_compare_expected (fixture);
}

/* --- testing of reading --- */

static void
test_memfd_simple (void)
{
  FILE *stream;

  stream = cockpit_json_print_open_memfd ("test", 1);
  gint fd = cockpit_json_print_finish_memfd (&stream);

  g_autoptr(GError) error = NULL;
  g_autofree gchar *content = cockpit_memfd_read (fd, &error);
  g_assert_no_error (error);
  close (fd);

  g_assert_cmpstr (content, ==, "{\"version\": 1}");
}

static void
test_memfd_error_cases (void)
{
  g_autoptr(GError) error = NULL;
  g_autofree gchar *content = NULL;
  FILE *stream;
  gint fd;
  gint r;

  /* not a memfd */
  fd = open ("/dev/null", O_RDONLY);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*not memfd?*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);


  /* memfd is not properly sealed */
  fd = memfd_create_noexec ("xyz", MFD_CLOEXEC);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*incorrect seals set*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);

  /* memfd is empty */
  fd = memfd_create_noexec ("xyz", MFD_ALLOW_SEALING | MFD_CLOEXEC);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*empty*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);


  /* memfd is too big */
  stream = cockpit_json_print_open_memfd ("xyz", 1);
  fprintf (stream, "%20000s", "");
  fd = cockpit_json_print_finish_memfd (&stream);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*unreasonably large*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);


  /* memfd can't be read */
  stream = cockpit_json_print_open_memfd ("xyz", 1);
  int tmpfd = cockpit_json_print_finish_memfd (&stream);
  gchar procfile[80];
  snprintf (procfile, sizeof procfile, "/proc/self/fd/%d", tmpfd);
  fd = open (procfile, O_WRONLY);
  g_assert_cmpint (fd, !=, -1);
  r = close (tmpfd);
  g_assert_cmpint (r, ==, 0);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_BADF, "*failed to read*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);


  /* memfd contains a nul */
  stream = cockpit_json_print_open_memfd ("xyz", 1);
  fputc (0, stream);
  fd = cockpit_json_print_finish_memfd (&stream);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*contains nul*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);

  /* memfd contains non-ascii */
  stream = cockpit_json_print_open_memfd ("xyz", 1);
  fputc (0xcc, stream);
  fd = cockpit_json_print_finish_memfd (&stream);

  content = cockpit_memfd_read (fd, &error);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*contains non-ASCII*");
  g_assert (content == NULL);
  g_clear_error (&error);
  close (fd);
}

static void
test_memfd_json (void)
{
  FILE *stream;

  stream = cockpit_json_print_open_memfd ("test", 1);
  cockpit_json_print_string_property (stream, "hello", "world", -1);
  cockpit_json_print_integer_property (stream, "size", 200);
  cockpit_json_print_bool_property (stream, "truth", true);
  cockpit_json_print_bool_property (stream, "falsth", false);
  gint fd = cockpit_json_print_finish_memfd (&stream);

  g_autoptr(GError) error = NULL;
  g_autoptr(JsonObject) object = cockpit_memfd_read_json (fd, &error);
  g_assert_no_error (error);
  close (fd);

  g_assert_cmpint (json_object_get_int_member (object, "version"), ==, 1);
  g_assert_cmpstr (json_object_get_string_member (object, "hello"), ==, "world");
  g_assert_cmpint (json_object_get_int_member (object, "size"), ==, 200);
  g_assert_cmpint (json_object_get_boolean_member (object, "truth"), ==, TRUE);
  g_assert_cmpint (json_object_get_boolean_member (object, "falsth"), ==, FALSE);
}

static void
test_memfd_json_error_cases (void)
{
  g_autoptr(GError) error = NULL;
  g_autoptr(JsonObject) object = NULL;
  gint fd;
  gint r;

  /* invalid json */
  fd = memfd_create_noexec ("xyz", MFD_CLOEXEC | MFD_ALLOW_SEALING);
  g_assert_cmpint (write (fd, "beh", 3), ==, 3);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0);
  object = cockpit_memfd_read_json (fd, &error);
  g_assert (object == NULL);
  cockpit_assert_error_matches (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_BAREWORD, "*unexpected identifier*");
  g_clear_error (&error);
  close (fd);

  /* valid json, but not an object */
  fd = memfd_create_noexec ("xyz", MFD_CLOEXEC | MFD_ALLOW_SEALING);
  g_assert_cmpint (write (fd, "[]", 2), ==, 2);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0);
  object = cockpit_memfd_read_json (fd, &error);
  g_assert (object == NULL);
  cockpit_assert_error_matches (error, JSON_PARSER_ERROR, -1, "*Not a JSON object*");
  close (fd);

}

/* --- unix socket testing --- */

static GSList *live_control_messages;

static void
assert_live_control_messages (gint expected)
{
  g_assert_cmpint (g_slist_length (live_control_messages), ==, expected);
}

static void
remove_message_from_list (gpointer data,
                          GObject *where_the_object_was)
{
  for (GSList **n = &live_control_messages; *n; n = &(*n)->next)
    if ((*n)->data == where_the_object_was)
      {
        *n = g_slist_delete_link (*n, *n);
        return;
      }

  g_error ("Couldn't find control message %p in list", where_the_object_was);

}

static void
receive_cmsgs (GSocket                 *socket,
               CockpitControlMessages  *ccm)
{
  gchar buffer[1];
  GInputVector vector = { buffer, sizeof buffer };
  GError *error = NULL;
  g_socket_receive_message (socket,
                            NULL, /* address */
                            &vector, 1,
                            &ccm->messages, &ccm->n_messages,
                            NULL, NULL,
                            &error);

  /* Use this to make sure all messages are getting properly freed */
  for (gint i = 0; i < ccm->n_messages; i++)
    {
      live_control_messages = g_slist_prepend (live_control_messages, ccm->messages[i]);
      g_object_weak_ref (G_OBJECT (ccm->messages[i]), remove_message_from_list, NULL);
    }

  g_assert_no_error (error);
}

static void
receive_nothing (GSocket *socket)
{
  g_auto(CockpitControlMessages) ccm = COCKPIT_CONTROL_MESSAGES_INIT;

  receive_cmsgs (socket, &ccm);

  g_assert (cockpit_control_messages_empty (&ccm));
}

static gint *
receive_fds (GSocket  *socket,
             gint     *out_nfds,
             GError  **error)
{
  g_auto(CockpitControlMessages) ccm = COCKPIT_CONTROL_MESSAGES_INIT;

  receive_cmsgs (socket, &ccm);

  int n_fds;
  const gint *fds = cockpit_control_messages_peek_fd_list (&ccm, &n_fds, error);

  if (fds == NULL)
    return NULL;

  gint *result = g_new (int, n_fds + 1);
  for (gint i = 0; i < n_fds; i++)
    result[i] = dup (fds[i]);
  result[n_fds] = -1;
  *out_nfds = n_fds;
  return result;
}

static void
free_fds (gint **inout_fds,
          gint  *inout_nfds)
{
  gint *fds = *inout_fds;
  gint nfds = *inout_nfds;

  for (gint i = 0; i < nfds; i++)
    {
      g_assert (fds[i] != -1);
      int r = close (fds[i]);
      g_assert (r == 0);
    }
  g_assert (fds[nfds] == -1);

  g_free (fds);

  *inout_fds = NULL;
  *inout_nfds = 0;
}

static gint
receive_fd (GSocket  *socket,
            GError  **error)
{
  g_auto(CockpitControlMessages) ccm = COCKPIT_CONTROL_MESSAGES_INIT;

  receive_cmsgs (socket, &ccm);

  int fd = cockpit_control_messages_peek_single_fd (&ccm, error);

  if (fd == -1)
    return -1;

  return dup (fd);
}

static void
send_cmsgs (GSocket                *socket,
            GSocketControlMessage **messages,
            gint                   n_messages,
            gint                   n_bytes)
{
  const gchar buffer[100] = "";
  g_assert_cmpint(n_bytes, <=, sizeof buffer);
  GOutputVector vector = { buffer, n_bytes };
  GError *error = NULL;
  g_socket_send_message (socket,
                         NULL, /* address */
                         &vector, 1,
                         messages, n_messages,
                         0, NULL, &error);
  g_assert_no_error (error);
}

static void
send_nothing (GSocket *socket,
              gint n_bytes)
{
  send_cmsgs (socket, NULL, 0, n_bytes);
}

static GSocketControlMessage *
make_fd_message (const gint *fds,
                 gint        n_fds)
{
  g_autoptr(GUnixFDList) fdl = g_unix_fd_list_new ();

  for (gint i = 0; i < n_fds; i++)
    {
      GError *error = NULL;
      g_unix_fd_list_append (fdl, fds[i], &error);
      g_assert_no_error (error);
    }

  return g_unix_fd_message_new_with_fd_list (fdl);
}

static void
send_fds (GSocket    *socket,
          const gint *fds,
          gint        n_fds)
{
  g_autoptr(GSocketControlMessage) fdm = make_fd_message (fds, n_fds);
  send_cmsgs (socket, &fdm, 1, 1);
}

static void
send_fd (GSocket *socket,
         gint     fd)
{
  send_fds (socket, &fd, 1);
}

static void
assert_base_state (GSocket *one,
                   GSocket *two)
{
  assert_live_control_messages (0);
  g_assert (g_socket_condition_check (one, G_IO_IN | G_IO_OUT) == G_IO_OUT);
  g_assert (g_socket_condition_check (two, G_IO_IN | G_IO_OUT) == G_IO_OUT);
}

static void
test_unix_socket_simple (void)
{
  g_autoptr(GSocket) one, two;

  cockpit_socket_socketpair (&one, &two);
  assert_base_state (one, two);

  /* boring */
  send_nothing (one, 1);
  receive_nothing (two);
  assert_base_state (one, two);

  send_nothing (two, 1);
  receive_nothing (one);
  assert_base_state (one, two);

  /* try a single fd */
  send_fd (one, 1);
  GError *error = NULL;
  gint fd = receive_fd (two, &error);
  g_assert_no_error (error);
  g_assert (fd != -1);
  close (fd);
  assert_base_state (one, two);

  /* try multiple fds */
  send_fds (one, (gint []){ 0, 1, 2}, 3);
  gint n_fds = 0; /* gcc is unhappy without this... */
  gint *fds = receive_fds (two, &n_fds, &error);
  g_assert_no_error (error);
  g_assert (fds != NULL);
  g_assert_cmpint (n_fds, ==, 3);
  free_fds (&fds, &n_fds);
  assert_base_state (one, two);

  /* mix-and-match with cockpitfdpassing */
  int two_fd = g_socket_get_fd (two);
  g_unix_set_fd_nonblocking (two_fd, FALSE, &error);
  g_assert_no_error (error);

  /* one -> two */
  send_fd (one, 1);
  int r = cockpit_socket_receive_fd (two_fd, &fd);
  g_assert_cmpint (r, ==, 1);
  g_assert (fd != -1);
  close (fd);

  /* two -> one */
  cockpit_socket_send_fd (two_fd, 1);
  fd = receive_fd (one, &error);
  g_assert_no_error (error);
  g_assert (fd != -1);
  close (fd);
  assert_base_state (one, two);
}

static void
test_unix_socket_partial_read (void)
{
  g_autoptr(GSocket) one, two;

  cockpit_socket_socketpair (&one, &two);
  assert_base_state (one, two);

  /* test unspecified behaviour, which we rely on: the cmsg should be
   * read with the first byte of the message with which it was sent.
   *
   * we depend on this because we start on the cockpit-ws side by
   * reading a single byte, but we will send the json blob as part of
   * the first full packet from cockpit-tls.
   */
  send_nothing (one, 10);
  int fd1 = 1;
  g_autoptr(GSocketControlMessage) fdm = make_fd_message (&fd1, 1);
  send_cmsgs (one, &fdm, 1, 10);

  for (gint i = 0; i < 20; i++)
    {
      g_autoptr(GError) error = NULL;
      gint fd = receive_fd (two, &error);

      if (fd != -1)
        {
          /* we expect to get this at the 11th try */
          g_assert_cmpint (i, ==, 10);
          close (fd);
        }
      else
        {
          cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*0 control message*");
        }
    }
}

static void
test_unix_socket_error_cases (void)
{
  g_autoptr(GSocket) one, two;

  cockpit_socket_socketpair (&one, &two);
  assert_base_state (one, two);

  /* try receiving an fd when nothing was sent */
  send_nothing (one, 1);
  GError *error = NULL;
  int fd = receive_fd (two, &error);
  g_assert (fd == -1);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*0 control message*");
  g_clear_error (&error);
  assert_base_state (one, two);

  /* see what happens if we send more fds than expected */
  send_fds (one, (const gint []){ 0, 1, 2}, 3);
  fd = receive_fd (two, &error);
  g_assert (fd == -1);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*received 3*1 expected*");
  g_clear_error (&error);
  assert_base_state (one, two);

  /* The remaining tests rely on receiving SCM_CREDENTIALS.  We need to
   * enable SO_PASSCRED for that.
   */
  int truth = 1;
  int r = setsockopt (g_socket_get_fd (two), SOL_SOCKET, SO_PASSCRED, &truth, sizeof truth);
  g_assert (r == 0);

  /* see what happens if we send the wrong message type */
  g_autoptr(GSocketControlMessage) creds = g_unix_credentials_message_new ();
  send_cmsgs (one, &creds, 1, 1);
  fd = receive_fd (two, &error);
  g_assert (fd == -1);
  cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL,
                                "*GUnixCredentialsMessage*GUnixFDMessage expected*");
  g_clear_error (&error);
  assert_base_state (one, two);

  /* see what happens if we send too many messages */
  g_autoptr(GUnixFDList) fdl = g_unix_fd_list_new ();
  g_unix_fd_list_append (fdl, 1, &error);
  g_assert_no_error (error);
  g_autoptr(GSocketControlMessage) fdm = g_unix_fd_message_new_with_fd_list (fdl);
  GSocketControlMessage *messages[] = { creds, fdm };
  send_cmsgs (one, messages, G_N_ELEMENTS (messages), 1);
  fd = receive_fd (two, &error);
  g_assert (fd == -1);
  g_assert_error (error, G_FILE_ERROR, G_FILE_ERROR_INVAL);
  g_assert (strstr (error->message, "2 control messages (one message"));
  g_clear_error (&error);
  assert_base_state (one, two);
}

/* --- putting it all together (unix sockets) --- */

static void
test_unix_socket_combined (void)
{
  g_autoptr(GSocket) one, two;

  cockpit_socket_socketpair (&one, &two);
  assert_base_state (one, two);

  FILE *stream = cockpit_json_print_open_memfd ("xyz", 1);
  cockpit_json_print_string_property (stream, "test", "it worked!", -1);
  gint fd = cockpit_json_print_finish_memfd (&stream);

  send_fd (one, fd);
  close (fd);

  g_auto(CockpitControlMessages) ccm = COCKPIT_CONTROL_MESSAGES_INIT;
  receive_cmsgs (two, &ccm);

  g_autoptr(GError) error = NULL;
  g_autoptr(JsonObject) json = cockpit_memfd_read_json_from_control_messages (&ccm, &error);
  g_assert_no_error (error);

  g_assert_cmpint (json_object_get_int_member (json, "version"), ==, 1);
  g_assert_cmpstr (json_object_get_string_member (json, "test"), ==, "it worked!");
}

int
main (int    argc,
      char **argv)
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/json/fd/print/string", TestFixture, NULL,
              test_fixture_setup, test_print_string, test_fixture_teardown);
  g_test_add ("/json/fd/print/string/memory-safety", TestFixture, NULL,
              test_fixture_setup,  test_print_string_memory_safety, test_fixture_teardown);
  g_test_add ("/json/fd/print/numeric", TestFixture, NULL,
              test_fixture_setup, test_print_numeric, test_fixture_teardown);
  g_test_add ("/json/fd/print/boolean", TestFixture, NULL,
              test_fixture_setup, test_print_boolean, test_fixture_teardown);

  g_test_add_func ("/json/fd/memfd/simple", test_memfd_simple);
  g_test_add_func ("/json/fd/memfd/error-cases", test_memfd_error_cases);
  g_test_add_func ("/json/fd/memfd/json", test_memfd_json);
  g_test_add_func ("/json/fd/memfd/json/error-cases", test_memfd_json_error_cases);
  g_test_add_func ("/json/fd/unix-socket/simple", test_unix_socket_simple);
  g_test_add_func ("/json/fd/unix-socket/partial-read", test_unix_socket_partial_read);
  g_test_add_func ("/json/fd/unix-socket/error-cases", test_unix_socket_error_cases);
  g_test_add_func ("/json/fd/unix-socket/combined", test_unix_socket_combined);

  return g_test_run ();
}
