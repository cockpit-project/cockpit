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
#include "common/cockpitfdpassing.h"
#include "common/cockpitjsonprint.h"
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
