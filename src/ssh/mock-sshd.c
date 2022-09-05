/*
 * Based on SSH example code found here:
 *
 * http://git.libssh.org/users/milo/libssh.git/plain/examples/samplesshd-full.c?h=sshd
 *
 * Copyright 2003-2011 Aris Adamantiadis
 *
 * This file is part of the SSH Library
 *
 * You are free to copy this file, modify it in any way, consider it being public
 * domain. This does not apply to the rest of the library though, but it is
 * allowed to cut-and-paste working code from this file to any license of
 * program.
 *
 * The goal is to show the API in action. It's not a reference on how terminal
 * clients must be made or how a client should react.
 */

#include "config.h"

#include <libssh/libssh.h>
#include <libssh/server.h>
#include <libssh/callbacks.h>

#include <glib.h>

#include <sys/socket.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <poll.h>
#include <pty.h>
#include <sys/wait.h>
#include <unistd.h>
#include <fcntl.h>

#define BUFSIZE          (8 * 1024)

static gint auth_methods = SSH_AUTH_METHOD_PASSWORD | SSH_AUTH_METHOD_PUBLICKEY | SSH_AUTH_METHOD_INTERACTIVE;
struct {
  int bind_fd;
  int session_fd;
  ssh_session session;
  ssh_event event;
  ssh_channel channel;
  int childpid;
  const gchar *user;
  const gchar *password;
  ssh_key pkey;
  GByteArray *buffer;
  gboolean buffer_eof;
  gboolean multi_step;
} state;

enum
{
  SUCCESS,
  MORE,
  FAILED,
};

static int
auth_interactive (ssh_session session,
                  ssh_message message,
                  gint *round)
{
  static const char *prompts[2] = { "Password", "Token" };
  static char echo[] = { 0, 1 };
  static const char *again[1] = { "So Close" };
  static char again_echo[] = { 0 };
  const char *token;
  int ret = FAILED;
  gint count = 0;
  gint spot = *round;

  /* wait for a shell */
  switch (spot)
    {
    case 0:
      if (g_str_equal (ssh_message_auth_user (message), state.user))
        {
          ssh_message_auth_interactive_request (message, "Test Interactive",
                                                state.multi_step ? "Password and Token" : "Password",
                                                state.multi_step ? 2 : 1,
                                                prompts, echo);
          ret = MORE;
        }
      break;
    case 1:
      count = ssh_userauth_kbdint_getnanswers(session);
      if (state.multi_step && count != 2)
        goto out;
      else if (!state.multi_step && count != 1)
        goto out;

      if (!g_str_equal (ssh_userauth_kbdint_getanswer(session, 0), state.password))
        goto out;

      if (state.multi_step)
        {
          token = ssh_userauth_kbdint_getanswer(session, 1);
          if (g_str_equal (token,  "5"))
            {
              ret = SUCCESS;
            }
          else if (g_str_equal (token,  "6"))
            {
              ssh_message_auth_interactive_request (message, "Test Interactive",
                                                    "Again", 1, again, again_echo);
              ret = MORE;
            }
        }
      else
        {
          ret = SUCCESS;
        }
      break;
    case 2:
      count = ssh_userauth_kbdint_getnanswers(session);
      if (count != 1)
        goto out;

      if (g_str_equal (ssh_userauth_kbdint_getanswer(session, 0), "5"))
        ret = SUCCESS;
    }
out:
  if (ret == MORE)
    *round = spot + 1;
  return ret;
}

static gboolean
auth_password (const gchar *user,
               const gchar *password)
{
  return g_str_equal (user, state.user) &&
         g_str_equal (password, state.password);
}

static int
auth_publickey (ssh_message message)
{
  int ret = -1;
  int auth_state = ssh_message_auth_publickey_state (message);
  gboolean have = ssh_key_cmp (state.pkey,
                               ssh_message_auth_pubkey (message),
                               SSH_KEY_CMP_PUBLIC) == 0;
  if (have && auth_state == SSH_PUBLICKEY_STATE_VALID)
    ret = 1;
  else if (have && auth_state == SSH_PUBLICKEY_STATE_NONE)
    ret = 0;

  return ret;
}

static int
fd_data (socket_t fd,
         int revents,
         gpointer user_data)
{
  ssh_channel chan = (ssh_channel)user_data;
  guint8 buf[BUFSIZE];
  gint sz = 0;
  gint bytes = 0;
  gint status;
  gint written;
  pid_t pid = 0;
  gboolean end = FALSE;
  gint ret;

  if (revents & POLLIN)
    {
      int ws;
      do
        {
          ws = ssh_channel_window_size (chan);
          ws = ws < BUFSIZE ? ws : BUFSIZE;
          if (ws == 0)
            break;
          bytes = read (fd, buf, ws);
          if (bytes < 0)
            {
              if (errno == EAGAIN)
                break;
              if (errno != ECONNRESET && errno != EBADF)
                g_critical ("couldn't read from process: %m");
              end = TRUE;
              break;
            }
          else if (bytes == 0)
            {
              end = TRUE;
            }
          else
            {
              sz += bytes;
              written = ssh_channel_write (chan, buf, bytes);
              if (written != bytes)
                g_assert_not_reached ();
            }
        }
      while (bytes == ws);
    }
  if ((revents & POLLOUT))
    {
      if (state.buffer->len > 0)
        {
          written = write (fd, state.buffer->data, state.buffer->len);
          if (written < 0 && errno != EAGAIN)
            g_critical ("couldn't write: %s", g_strerror (errno));
          if (written > 0)
            g_byte_array_remove_range (state.buffer, 0, written);
        }
      if (state.buffer_eof && state.buffer->len == 0)
        {
          if (shutdown (fd, SHUT_WR) < 0)
            {
              if (errno != EAGAIN && errno != EBADF)
                g_critical ("couldn't shutdown: %s", g_strerror (errno));
            }
          else
            {
              state.buffer_eof = FALSE;
            }
        }
    }
  if (end || (revents & (POLLHUP | POLLERR | POLLNVAL)))
    {
      ssh_channel_send_eof (chan);
      pid = waitpid (state.childpid, &status, 0);
      if (pid < 0)
        {
          g_critical ("couldn't wait on child process: %m");
        }
      else
        {
          if (WIFSIGNALED (status))
            ssh_channel_request_send_exit_signal (chan, strsignal (WTERMSIG (status)), 0, "", "");
          else
            ssh_channel_request_send_exit_status (chan, WEXITSTATUS (status));
        }
      ret = ssh_blocking_flush (state.session, -1);
      if (ret != SSH_OK && ret != SSH_CLOSED)
        g_message ("ssh_blocking_flush() failed: %d", ret);
      ssh_channel_close (chan);
      ssh_channel_free (chan);
      ret = ssh_blocking_flush (state.session, -1);
      if (ret != SSH_OK && ret != SSH_CLOSED)
        g_message ("ssh_blocking_flush() failed: %d", ret);
      state.channel = NULL;
      ssh_event_remove_fd (state.event, fd);
      sz = -1;
    }

  return sz;
}

static int
chan_data (ssh_session session,
           ssh_channel channel,
           gpointer data,
           guint32 len,
           int is_stderr,
           gpointer user_data)
{
  g_byte_array_append (state.buffer, data, len);
  return len;
}

static void
chan_eof (ssh_session session,
          ssh_channel channel,
          gpointer user_data)
{
  state.buffer_eof = TRUE;
}

static void
chan_close (ssh_session session,
            ssh_channel channel,
            gpointer user_data)
{
  int fd = GPOINTER_TO_INT (user_data);
  close (fd);
}

struct ssh_channel_callbacks_struct cb = {
    .channel_data_function = chan_data,
    .channel_eof_function = chan_eof,
    .channel_close_function = chan_close,
    .userdata = NULL
};

static int
do_shell (ssh_event event,
          ssh_channel chan)
{
  socket_t fd;
  struct termios *term = NULL;
  struct winsize *win = NULL;
  short events;
  int fd_status;

  state.childpid = forkpty (&fd, NULL, term, win);
  if (state.childpid == 0)
    {
      close (state.bind_fd);
      close (state.session_fd);
      execl ("/bin/bash", "/bin/bash", NULL);
      _exit (127);
    }
  else if (state.childpid < 0)
    {
      g_critical ("forkpty failed: %s", g_strerror (errno));
      return -1;
    }

  fd_status = fcntl (fd, F_GETFL, 0);
  if (fcntl (fd, F_SETFL, fd_status | O_NONBLOCK) < 0)
    {
      g_critical ("couldn't set non-blocking mode");
      return -1;
    }

  cb.userdata = (gpointer)(long)fd;
  ssh_callbacks_init(&cb);
  ssh_set_channel_callbacks (chan, &cb);

  events = POLLIN | POLLOUT | POLLPRI | POLLERR | POLLHUP | POLLNVAL;
  if (ssh_event_add_fd (event, fd, events, fd_data, chan) != SSH_OK)
    g_return_val_if_reached(-1);

  return 0;
}

static int
fork_exec (const gchar *cmd)
{
  int spair[2];
  int fd_status;

  if (socketpair (AF_UNIX, SOCK_STREAM, 0, spair) < 0)
    {
      g_critical ("socketpair failed: %s", g_strerror (errno));
      return -1;
    }

  state.childpid = fork ();
  if (state.childpid == 0)
    {
      close (state.bind_fd);
      close (state.session_fd);

      close (0);
      close (1);
      close (spair[1]);
      dup2 (spair[0], 0);
      dup2 (spair[0], 1);
      close (spair[0]);
      execl ("/bin/sh", "/bin/sh", "-c", cmd, NULL);
      _exit (127);
    }
  else if (state.childpid < 0)
    {
      g_critical ("fork failed: %s", g_strerror (errno));
      return -1;
    }

  close (spair[0]);

  fd_status = fcntl (spair[1], F_GETFL, 0);
  if (fcntl (spair[1], F_SETFL, fd_status | O_NONBLOCK) < 0)
    {
      g_critical ("couldn't set non-blocking mode: %s", g_strerror (errno));
      return -1;
    }
  return spair[1];
}

static int
do_exec (ssh_event event,
         ssh_channel chan,
         const gchar *cmd)
{
  socket_t fd;
  short events;

  fd = fork_exec (cmd);
  if (fd < 0)
    return -1;

  cb.userdata = GINT_TO_POINTER (fd);
  ssh_callbacks_init(&cb);
  ssh_set_channel_callbacks (chan, &cb);

  events = POLLIN | POLLOUT | POLLPRI | POLLERR | POLLHUP | POLLNVAL;
  if (ssh_event_add_fd (event, fd, events, fd_data, chan) != SSH_OK)
    g_return_val_if_reached(-1);

  return 0;
}

static int
channel_request_callback (ssh_session session,
                          ssh_message message,
                          gpointer user_data)
{
  const gchar *cmd;

  /* wait for a shell */
  switch (ssh_message_type (message))
    {
    case SSH_REQUEST_CHANNEL:
      switch (ssh_message_subtype (message))
        {
        case SSH_CHANNEL_REQUEST_SHELL:
          if (do_shell (state.event, state.channel) < 0)
            goto deny;
          goto accept_end;
        case SSH_CHANNEL_REQUEST_EXEC:
          cmd = ssh_message_channel_request_command (message);
          if (do_exec (state.event, state.channel, cmd) < 0)
            goto deny;
          goto accept_end;
        case SSH_CHANNEL_REQUEST_PTY:
        case SSH_CHANNEL_REQUEST_ENV:
          goto accept;
        default:
          g_message ("message subtype unknown: %d", ssh_message_subtype (message));
          goto deny;
        }
    default:
      g_message ("message type unknown: %d", ssh_message_type (message));
      goto deny;
    }

deny:
  return 1;

accept_end:
accept:
  ssh_message_channel_request_reply_success (message);
  return 0;
}

static int
channel_open_callback (ssh_session session,
                       ssh_message message,
                       gpointer user_data)
{
  ssh_channel *channel = user_data;

  /* wait for a channel session */
  switch (ssh_message_type (message))
    {
    case SSH_REQUEST_CHANNEL_OPEN:
      switch (ssh_message_subtype (message))
        {
        case SSH_CHANNEL_SESSION:
          goto accept;
        default:
          goto deny;
        }
    default:
      goto deny;
    }

deny:
  return 1;
accept:
  ssh_set_message_callback (state.session, channel_request_callback, NULL);
  *channel = ssh_message_channel_request_open_reply_accept (message);
  return 0;
}

static int
authenticate_callback (ssh_session session,
                       ssh_message message,
                       gpointer user_data)
{
  int rc;
  int *round = user_data;
  switch (ssh_message_type (message))
    {
    case SSH_REQUEST_AUTH:
      switch (ssh_message_subtype (message))
        {
        case SSH_AUTH_METHOD_INTERACTIVE:
          if (auth_methods & SSH_AUTH_METHOD_INTERACTIVE)
            {
              rc = auth_interactive (session, message, round);
              if (rc == SUCCESS)
                goto accept;
              else if (rc == MORE)
                goto more;
            }
            ssh_message_auth_set_methods (message, auth_methods);
            goto deny;
        case SSH_AUTH_METHOD_PASSWORD:
          if ((auth_methods & SSH_AUTH_METHOD_PASSWORD) &&
              auth_password (ssh_message_auth_user (message),
                             ssh_message_auth_password (message)))
            goto accept;
          ssh_message_auth_set_methods (message, auth_methods);
          goto deny;

        case SSH_AUTH_METHOD_PUBLICKEY:
          if (auth_methods & SSH_AUTH_METHOD_PUBLICKEY)
            {
              int result = auth_publickey (message);
              if (result == 1)
                {
                  goto accept;
                }
              else if (result == 0)
                {
                  ssh_message_auth_reply_pk_ok_simple (message);
                  return 0;
                }
            }
          ssh_message_auth_set_methods (message, auth_methods);
          goto deny;

        case SSH_AUTH_METHOD_NONE:
        default:
          ssh_message_auth_set_methods (message, auth_methods);
          goto deny;
        }

    default:
      ssh_message_auth_set_methods (message, auth_methods);
      goto deny;
    }

deny:
  return 1;
more:
  return 0;
accept:
  ssh_set_message_callback (state.session, channel_open_callback, &state.channel);
  ssh_message_auth_reply_success (message, 0);
  return 0;
}

static gint
mock_ssh_server (const gchar *server_addr,
                 gint server_port,
                 const gchar *user,
                 const gchar *password,
                 gboolean multi_step,
                 const gchar *pkey_file)
{
  char portname[16];
  char addrname[16];
  struct sockaddr_storage addr;
  socklen_t addrlen;
  ssh_bind sshbind;
  const char *msg;
  int r;
  gint rounds = 0;

  state.event = ssh_event_new ();
  if (state.event == NULL)
    g_return_val_if_reached (-1);

  sshbind = ssh_bind_new ();
  state.session = ssh_new ();

  if (server_addr == NULL)
    server_addr = "127.0.0.1";

  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_BINDADDR, server_addr);
  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_BINDPORT, &server_port);
  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_RSAKEY, SRCDIR "/src/ssh/mock_rsa_key");

  /* Known issue with recent libssh versions on 32bits: avoid using
   * curve25519-sha256.  See https://bugs.libssh.org/T151
   */
  if (sizeof (void *) == 4)
    ssh_options_set (state.session, SSH_OPTIONS_KEY_EXCHANGE, "ecdh-sha2-nistp256, diffie-hellman-group18-sha512, diffie-hellman-group16-sha512, diffie-hellman-group-exchange-sha256, diffie-hellman-group14-sha1, diffie-hellman-group1-sha1, diffie-hellman-group-exchange-sha1");

  if (ssh_bind_listen (sshbind) < 0)
    {
      g_critical ("couldn't listen on socket: %s", ssh_get_error (sshbind));
      return 1;
    }

  state.bind_fd = ssh_bind_get_fd (sshbind);
  state.user = user;
  state.password = password;
  state.multi_step = multi_step;
  ssh_pki_import_pubkey_file (pkey_file ? pkey_file : SRCDIR "/src/ssh/test_rsa.pub",
                              &state.pkey);
  state.buffer = g_byte_array_new ();

  /* Print out the port */
  if (server_port == 0)
    {
      addrlen = sizeof (addr);
      if (getsockname (state.bind_fd, (struct sockaddr *)&addr, &addrlen) < 0)
        {
          g_critical ("couldn't get local address: %s", g_strerror (errno));
          return 1;
        }
      r = getnameinfo ((struct sockaddr *)&addr, addrlen, addrname, sizeof (addrname),
                       portname, sizeof (portname), NI_NUMERICHOST | NI_NUMERICSERV);
      if (r != 0)
        {
          g_critical ("couldn't get local port: %s", gai_strerror (r));
          return 1;
        }

      /* Caller wants to know the port */
      g_print ("%s\n", portname);
    }

  /* Close stdout (once above info is printed) */
  close (1);

  ssh_set_message_callback (state.session, authenticate_callback, &rounds);

  r = ssh_bind_accept (sshbind, state.session);
  if (r == SSH_ERROR)
    {
      g_critical ("accepting connection failed: %s", ssh_get_error (sshbind));
      return 1;
    }

  state.session_fd = ssh_get_fd (state.session);

  if (ssh_handle_key_exchange (state.session))
    {
      msg = ssh_get_error (state.session);
      if (!strstr (msg, "_DISCONNECT"))
        g_critical ("key exchange failed: %s", msg);
      return 1;
    }

  if (ssh_event_add_session (state.event, state.session) != SSH_OK)
    g_return_val_if_reached (-1);

  do
    {
      ssh_event_dopoll (state.event, 10000);
    }
  while (ssh_is_connected (state.session));

  ssh_event_remove_session (state.event, state.session);
  ssh_event_free (state.event);
  ssh_free (state.session);
  ssh_key_free (state.pkey);
  g_byte_array_free (state.buffer, TRUE);
  ssh_bind_free (sshbind);

  return 0;
}

int
main (int argc,
      char *argv[])
{
  GOptionContext *context;
  gchar *user = NULL;
  gchar *password = NULL;
  gchar *bind = NULL;
  GError *error = NULL;
  gboolean verbose = FALSE;
  gboolean broken_auth = FALSE;
  gboolean multi_step = FALSE;
  gint port = 0;
  int ret;
  g_autofree gchar *pkey_file = NULL;

  GOptionEntry entries[] = {
    { "user", 0, 0, G_OPTION_ARG_STRING, &user, "User name to expect", "name" },
    { "password", 0, 0, G_OPTION_ARG_STRING, &password, "Password to expect", "xxx" },
    { "bind", 0, 0, G_OPTION_ARG_STRING, &bind, "Address to bind to", "addr" },
    { "port", 'p', 0, G_OPTION_ARG_INT, &port, "Port to bind to", "NN" },
    { "verbose", 'v', 0, G_OPTION_ARG_NONE, &verbose, "Verbose info", NULL },
    { "multi-step", 'm', 0, G_OPTION_ARG_NONE, &multi_step, "Multi Step Auth", NULL },
    { "broken-auth", 0, 0, G_OPTION_ARG_NONE, &broken_auth, "Break authentication", NULL },
    { "import-pubkey", 0, 0, G_OPTION_ARG_STRING, &pkey_file, "Public keyfile to import", NULL },
    { NULL }
  };

#ifdef __linux
#include <sys/prctl.h>
  prctl (PR_SET_PDEATHSIG, 15);
#endif

  if (signal (SIGPIPE, SIG_IGN) == SIG_ERR)
    g_assert_not_reached ();

  ssh_init ();

  context = g_option_context_new ("- mock ssh server");
  g_option_context_add_main_entries (context, entries, "");
  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      g_printerr ("mock-sshd: %s\n", error->message);
      g_error_free (error);
      ret = 2;
    }
  else if (argc != 1)
    {
      g_printerr ("mock-sshd: extra arguments on command line\n");
      ret = 2;
    }
  else
    {
      if (broken_auth)
        auth_methods = SSH_AUTH_METHOD_HOSTBASED;
      if (verbose)
        ssh_set_log_level (SSH_LOG_PROTOCOL);
      ret = mock_ssh_server (bind, port, user, password, multi_step, pkey_file);
    }

  g_option_context_free (context);
  g_free (password);
  g_free (user);
  g_free (bind);

  ssh_finalize ();
  return ret;
}
