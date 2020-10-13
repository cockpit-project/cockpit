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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitjsonprint.h"
#include "cockpitmemfdread.h"
#include "cockpittest.h"
#include "cockpithacks.h"

#include <gio/gunixfdmessage.h>
#include <gio/gunixcredentialsmessage.h>

#include <errno.h>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/mman.h>
#include <stdio.h>
#include <unistd.h>

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

  if (!cockpit_hacks_valgrind_memfd_seals_unsupported ())
    {
      /* not a memfd */
      fd = open ("/dev/null", O_RDONLY);

      content = cockpit_memfd_read (fd, &error);
      cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*not memfd?*");
      g_clear_error (&error);
      close (fd);


      /* memfd is not properly sealed */
      fd = memfd_create ("xyz", MFD_CLOEXEC);

      content = cockpit_memfd_read (fd, &error);
      cockpit_assert_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL, "*incorrect seals set*");
      g_assert (content == NULL);
      g_clear_error (&error);
      close (fd);
    }


  /* memfd is empty */
  fd = memfd_create ("xyz", MFD_ALLOW_SEALING | MFD_CLOEXEC);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0 || (errno == EINVAL && cockpit_hacks_valgrind_memfd_seals_unsupported ()));

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
  fd = memfd_create ("xyz", MFD_CLOEXEC | MFD_ALLOW_SEALING);
  g_assert_cmpint (write (fd, "beh", 3), ==, 3);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0 || (errno == EINVAL && cockpit_hacks_valgrind_memfd_seals_unsupported ()));
  object = cockpit_memfd_read_json (fd, &error);
  cockpit_assert_error_matches (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_BAREWORD, "*unexpected identifier*");
  g_clear_error (&error);
  close (fd);

  /* valid json, but not an object */
  fd = memfd_create ("xyz", MFD_CLOEXEC | MFD_ALLOW_SEALING);
  g_assert_cmpint (write (fd, "[]", 2), ==, 2);
  r = fcntl (fd, F_ADD_SEALS, F_SEAL_SHRINK | F_SEAL_GROW | F_SEAL_WRITE);
  g_assert (r == 0 || (errno == EINVAL && cockpit_hacks_valgrind_memfd_seals_unsupported ()));
  object = cockpit_memfd_read_json (fd, &error);
  cockpit_assert_error_matches (error, JSON_PARSER_ERROR, -1, "*Not a JSON object*");
  close (fd);

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

  return g_test_run ();
}
