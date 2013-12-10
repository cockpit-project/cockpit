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

struct {
  int bind_fd;
  int session_fd;
  ssh_session session;
  ssh_event event;
  ssh_channel channel;
  int childpid;
  const gchar *user;
  const gchar *password;
} state;

static gboolean
auth_password (const gchar *user,
               const gchar *password)
{
  return g_str_equal (user, state.user) &&
         g_str_equal (password, state.password);
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
  static pid_t p = 0;

  if (p != 0)
    return -1;
  if (revents & POLLIN)
    {
      int ws;
      do
        {
          ws = ssh_channel_window_size (chan);
          ws = ws < BUFSIZE ? ws : BUFSIZE;
          if (ws && (bytes = read (fd, buf, ws)) > 0)
            {
              sz += bytes;
              ssh_channel_write (chan, buf, bytes);
            }
        }
      while (ws > 0 && bytes == BUFSIZE);
    }
  if (revents & (POLLHUP | POLLERR | POLLNVAL))
    {
      if ((p = waitpid (state.childpid, &status, WNOHANG)) > 0)
        ssh_channel_request_send_exit_status (chan, WEXITSTATUS(status));
      ssh_channel_send_eof (chan);
      ssh_channel_close (chan);
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
  int fd = GPOINTER_TO_INT (user_data);
  if (!len)
    return 0;
  return write (fd, data, len);
}

static void
chan_eof (ssh_session session,
          ssh_channel channel,
          gpointer user_data)
{
  int fd = GPOINTER_TO_INT (user_data);
  shutdown (fd, SHUT_WR);
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

  events = POLLIN | POLLPRI | POLLERR | POLLHUP | POLLNVAL;
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
      close (2);
      close (spair[1]);
      dup2 (spair[0], 0);
      dup2 (spair[0], 1);
      dup2 (spair[0], 2);
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

  events = POLLIN | POLLPRI | POLLERR | POLLHUP | POLLNVAL;
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
  switch (ssh_message_type (message))
    {
    case SSH_REQUEST_AUTH:
      switch (ssh_message_subtype (message))
        {
        case SSH_AUTH_METHOD_PASSWORD:
          if (auth_password (ssh_message_auth_user (message),
                             ssh_message_auth_password (message)))
            goto accept;
          ssh_message_auth_set_methods (message, SSH_AUTH_METHOD_PASSWORD);
          goto deny;

        case SSH_AUTH_METHOD_NONE:
        default:
          ssh_message_auth_set_methods (message, SSH_AUTH_METHOD_PASSWORD);
          goto deny;
        }

    default:
      ssh_message_auth_set_methods (message, SSH_AUTH_METHOD_PASSWORD);
      goto deny;
    }

deny:
  return 1;
accept:
  ssh_set_message_callback (state.session, channel_open_callback, &state.channel);
  ssh_message_auth_reply_success (message, 0);
  return 0;
}

static gint
mock_ssh_server (const gchar *server_addr,
                 gint server_port,
                 const gchar *user,
                 const gchar *password)
{
  char portname[16];
  char addrname[16];
  struct sockaddr_storage addr;
  socklen_t addrlen;
  ssh_bind sshbind;
  int r;

  state.event = ssh_event_new ();
  if (state.event == NULL)
    g_return_val_if_reached (-1);

  sshbind = ssh_bind_new ();
  state.session = ssh_new ();

  if (server_addr == NULL)
    server_addr = "127.0.0.1";

  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_BINDADDR, server_addr);
  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_BINDPORT, &server_port);
  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_RSAKEY, SRCDIR "/src/ws/mock_rsa_key");
  ssh_bind_options_set (sshbind, SSH_BIND_OPTIONS_DSAKEY, SRCDIR "/src/ws/mock_dsa_key");

  if (ssh_bind_listen (sshbind) < 0)
    {
      g_critical ("couldn't listen on socket: %s", ssh_get_error (sshbind));
      return 1;
    }

  state.bind_fd = ssh_bind_get_fd (sshbind);
  state.user = user;
  state.password = password;

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

  ssh_set_message_callback (state.session, authenticate_callback, NULL);

  r = ssh_bind_accept (sshbind, state.session);
  if (r == SSH_ERROR)
    {
      g_critical ("accepting connection failed: %s", ssh_get_error (sshbind));
      return 1;
    }

  state.session_fd = ssh_get_fd (state.session);

  if (ssh_handle_key_exchange (state.session))
    {
      g_critical ("key exchange failed: %s", ssh_get_error (state.session));
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
  ssh_disconnect (state.session);
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
  gint port = 0;
  int ret;

  GOptionEntry entries[] = {
    { "user", 0, 0, G_OPTION_ARG_STRING, &user, "User name to expect", "name" },
    { "password", 0, 0, G_OPTION_ARG_STRING, &password, "Password to expect", "xxx" },
    { "bind", 0, 0, G_OPTION_ARG_STRING, &bind, "Address to bind to", "addr" },
    { "port", 'p', 0, G_OPTION_ARG_INT, &port, "Port to bind to", "NN" },
    { "verbose", 'v', 0, G_OPTION_ARG_NONE, &verbose, "Verbose info", NULL },
    { NULL }
  };

#ifdef __linux
#include <sys/prctl.h>
  prctl (PR_SET_PDEATHSIG, 15);
#endif

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
      if (verbose)
        ssh_set_log_level (SSH_LOG_PROTOCOL);
      ret = mock_ssh_server (bind, port, user, password);
    }

  g_option_context_free (context);
  g_free (password);
  g_free (user);
  g_free (bind);

  ssh_finalize ();
  return ret;
}
