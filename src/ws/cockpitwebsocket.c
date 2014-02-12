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

#include "config.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>

#include <json-glib/json-glib.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <cockpit/cockpit.h>

#include "cockpitws.h"
#include "libgsystem.h"

#include "websocket/websocket.h"

/* ---------------------------------------------------------------------------------------------------- */

typedef struct
{
  volatile gint             refcount;
  WebSocketConnection      *web_socket;
  GSocketConnection        *connection;
  gboolean                  authenticated;
  gchar                    *target_host;
  gint                      specific_port;
  gchar                    *specific_user;
  gchar                    *specific_password;
  gchar                    *agent_program;
  gchar                    *user;
  gchar                    *password;
  gchar                    *rhost;
  gint                      rport;

  GPid                     session_pid;
  GOutputStream           *to_session;
  GInputStream            *from_session;
  gboolean                 eof_from_session;

  GMainContext            *main_context;

  GCancellable            *sessionio_cancellable;
  GQueue                   session_write_queue;
  gboolean                 active_session_write;
  enum {
    WS_STATE_READING_SIZE_WORD = 0,
    WS_STATE_READING_MESSAGE
  } readstate;
  guint8 size_word_bytes[4];
  guint8 size_word_bytes_read;
  GByteArray *message_buffer;
  guint32 message_bytes_read;
  guint32 message_bytes_remaining;
} WebSocketData;

static void
web_socket_data_unref (WebSocketData   *data)
{
  if (!g_atomic_int_dec_and_test (&data->refcount))
    return;

  g_queue_foreach (&data->session_write_queue, (GFunc)g_bytes_unref, NULL);
  g_queue_clear (&data->session_write_queue);
  g_clear_pointer (&data->message_buffer, g_byte_array_unref);
  g_object_unref (data->web_socket);
  g_free (data->target_host);
  g_free (data->agent_program);
  g_free (data->user);
  g_free (data->rhost);
  g_free (data->specific_user);
  g_free (data->specific_password);
  g_clear_object (&data->sessionio_cancellable);
  g_free (data);
}

static WebSocketData *
web_socket_data_ref (WebSocketData *data)
{
  g_atomic_int_inc (&data->refcount);
  return data;
}

static void
send_error (WebSocketData *data,
            const gchar *command)
{
  gchar *json = g_strdup_printf ("{\"command\": \"error\", \"data\": \"%s\"}", command);
  GBytes *message = g_bytes_new_take (json, strlen (json));
  if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
    web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, message);
  g_bytes_unref (message);
}

static void
warn_if_error_is_not_cancelled (GError *error)
{
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
    return;

  g_warning ("%s", error->message);
}

static void
begin_session_write (WebSocketData *data);

static void
on_session_write_bytes_complete (GObject                   *src,
                                 GAsyncResult              *result,
                                 gpointer                   user_data)
{
  WebSocketData *data = user_data;
  GError *local_error = NULL;
  gs_unref_bytes GBytes *first = NULL;
  gssize bytes_written;
  gsize first_size;

  first = g_queue_pop_head (&data->session_write_queue);
  g_assert (first);
  first_size = g_bytes_get_size (first);

  data->active_session_write = FALSE;

  bytes_written = g_output_stream_write_bytes_finish ((GOutputStream *)src, result, &local_error);
  if (bytes_written < 0)
    {
      g_message ("Caught error writing to session: %s", local_error->message);
      g_clear_error (&local_error);
      web_socket_connection_close (data->web_socket, WEB_SOCKET_CLOSE_SERVER_ERROR, "failed-to-proxy");
      goto out;
    }

  if (bytes_written < first_size)
    {
      gsize remainder_len = first_size - bytes_written;
      GBytes *remainder = g_bytes_new_from_bytes (first, bytes_written, remainder_len);
      g_debug ("Have %" G_GSIZE_FORMAT " bytes leftover from short write", remainder_len);
      g_queue_push_head (&data->session_write_queue, remainder);
    }
  else
    g_debug ("Wrote %" G_GSIZE_FORMAT " bytes to client", bytes_written);

  begin_session_write (data);
 out:
  web_socket_data_unref (data);
}

static void
begin_session_write (WebSocketData       *data)
{
  GBytes *first;

  if (data->active_session_write)
    return;

  first = g_queue_peek_head (&data->session_write_queue);
  if (!first)
    return;

  data->active_session_write = TRUE;

  g_output_stream_write_bytes_async (data->to_session, first, G_PRIORITY_DEFAULT,
                                     data->sessionio_cancellable,
                                     on_session_write_bytes_complete,
                                     web_socket_data_ref (data));
}

static gboolean open_session (WebSocketData *data,
                              GCancellable *cancellable,
                              GError **error);

static void
on_web_socket_message (WebSocketConnection *web_socket,
                       WebSocketDataType type,
                       GBytes *message,
                       WebSocketData *data)
{
  if (data->session_pid == 0)
    {
      GError *error = NULL;
      gsize msg_len;
      gconstpointer msg_data;

      msg_data = g_bytes_get_data (message, &msg_len);

      if (msg_len > 0)
        {
          const gchar *userpass = msg_data;
          gsize len = msg_len;
          const gchar *sep = strchr (userpass, '\n');

          if (sep == NULL)
            data->specific_user = g_strndup (userpass, len);
          else
            {
              data->specific_user = g_strndup (userpass, sep - userpass);
              data->specific_password = g_strndup (sep + 1,
                                                   len - (sep - userpass) - 1);
            }
        }

      if (!open_session (data, NULL, &error))
        {
          g_warning ("Failed to set up session: %s", error->message);
          g_clear_error (&error);

          send_error (data, "internal-error");
          web_socket_connection_close (web_socket,
                                       WEB_SOCKET_CLOSE_SERVER_ERROR,
                                       "transport-failed");
        }
    }
  else
    {
      guint32 len = (guint32) g_bytes_get_size (message);
      /* Canonicalize on network byte order */
      len = GUINT32_TO_BE (len);

      g_queue_push_tail (&data->session_write_queue, g_bytes_new (&len, 4));
      g_queue_push_tail (&data->session_write_queue, g_bytes_ref (message));

      begin_session_write (data);
    }
}

static void
get_remote_address (GSocketConnection *connection,
                    gchar **rhost_out,
                    gint *rport_out)
{
  gs_unref_object GSocketAddress *remote = NULL;
  if (connection)
    remote = g_socket_connection_get_remote_address (connection, NULL);
  if (remote && G_IS_INET_SOCKET_ADDRESS (remote))
    {
      *rhost_out =
        g_inet_address_to_string (g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (remote)));
      *rport_out =
        g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (remote));
    }
  else
    {
      *rhost_out = g_strdup ("<unknown>");
      *rport_out = 0;
    }
}

static void
on_session_read_complete (GObject            *src,
                          GAsyncResult       *result,
                          gpointer            user_data)
{
  WebSocketData *data = user_data;
  gssize bytes_read;
  GError *local_error = NULL;

  bytes_read = g_input_stream_read_finish ((GInputStream *)src, result, &local_error);
  g_debug ("session read %lld bytes", (long long) bytes_read);
  if (bytes_read <= 0)
    {
      data->eof_from_session = TRUE;
      g_main_context_wakeup (data->main_context);
      if (bytes_read < 0)
        {
          warn_if_error_is_not_cancelled (local_error);
          g_clear_error (&local_error);
        }
      goto out;
    }

  /* Stream may have been closed */
  if (!data->from_session)
    goto out;

  switch (data->readstate)
    {
    case WS_STATE_READING_SIZE_WORD:
      {
        data->size_word_bytes_read += bytes_read;
        g_assert_cmpint (data->size_word_bytes_read, <=, 4);
        if (data->size_word_bytes_read == 4)
          {
            data->readstate = WS_STATE_READING_MESSAGE;
            /* Network byte order */
            data->message_bytes_remaining =
              (data->size_word_bytes[0] << 24) |
              (data->size_word_bytes[1] << 16) |
              (data->size_word_bytes[2] << 8)  |
              (data->size_word_bytes[3] << 0)  ;
            data->message_bytes_read = 0;
            g_debug ("session will read %u bytes", data->message_bytes_remaining);
            data->message_buffer = g_byte_array_new ();
            g_byte_array_set_size (data->message_buffer, data->message_bytes_remaining);
          }
        else
          g_debug ("session header size %u bytes remaining", 4 - data->size_word_bytes_read);
      }
      break;
    case WS_STATE_READING_MESSAGE:
      {
        data->message_bytes_remaining -= bytes_read;
        data->message_bytes_read += bytes_read;
        g_assert_cmpint (data->message_bytes_remaining, >=, 0);
        g_assert_cmpint (data->message_bytes_read, <=, data->message_buffer->len);
        if (data->message_bytes_remaining == 0)
          {
            gs_unref_bytes GBytes *message = g_byte_array_free_to_bytes (data->message_buffer);
            data->message_buffer = NULL;
            g_assert_cmpint (data->message_bytes_read, ==, g_bytes_get_size (message));
            g_debug ("session sending message of %u bytes", data->message_bytes_read);
            if (web_socket_connection_get_ready_state (data->web_socket) == WEB_SOCKET_STATE_OPEN)
              web_socket_connection_send (data->web_socket, WEB_SOCKET_DATA_TEXT, message);
            data->readstate = WS_STATE_READING_SIZE_WORD;
            data->size_word_bytes_read = 0;
            memset (data->size_word_bytes, 0, 4);
          }
        else
          g_debug ("session message %u bytes remaining", data->message_bytes_remaining);
      }
      break;
    }

  switch (data->readstate)
    {
    case WS_STATE_READING_SIZE_WORD:
      {
        g_input_stream_read_async (data->from_session,
                                   data->size_word_bytes + data->size_word_bytes_read,
                                   4 - data->size_word_bytes_read,
                                   G_PRIORITY_DEFAULT, data->sessionio_cancellable,
                                   on_session_read_complete,
                                   web_socket_data_ref (data));
      }
      break;
    case WS_STATE_READING_MESSAGE:
      {
        g_input_stream_read_async (data->from_session,
                                   data->message_buffer->data + data->message_bytes_read,
                                   data->message_bytes_remaining,
                                   G_PRIORITY_DEFAULT, data->sessionio_cancellable,
                                   on_session_read_complete,
                                   web_socket_data_ref (data));
      }
      break;
    }
 out:
  web_socket_data_unref (data);
}

static gboolean
open_session (WebSocketData *data,
              GCancellable *cancellable,
              GError **error)
{
  gboolean ret = FALSE;
  int session_stdin = -1;
  int session_stdout = -1;
  gchar pwfd[sizeof(int) * 3];
  gchar port[sizeof(int) * 3];
  gchar login[256];
  int pwpipe[2] = { -1, -1 };

  gchar *argv_remote[] =
    { "/usr/bin/sshpass",
      "-d", pwfd,
      "/usr/bin/ssh",
      "-o", "StrictHostKeyChecking=no",
      "-l", data->specific_user ? data->specific_user : data->user,
      "-p", port,
      data->target_host,
      data->agent_program,
      NULL
    };

  gchar *argv_session[] =
    { PACKAGE_LIBEXEC_DIR "/cockpit-session",
      data->user,
      data->rhost,
      data->agent_program,
      NULL
    };

  gchar *argv_local[] = {
      data->agent_program,
      NULL,
  };

  gchar **argv;

  GSpawnFlags flags = G_SPAWN_DO_NOT_REAP_CHILD;

  if (data->specific_port == 0 &&
      data->specific_user == NULL &&
      data->specific_password == NULL &&
      g_strcmp0 (data->target_host, "localhost") == 0)
    {
      /*
       * If we're already in the right session, then skip cockpit-session.
       * This is used when testing, or running as your own user.
       *
       * This doesn't apply if this code is running as a service, or otherwise
       * unassociated from a terminal, we get a non-zero return value from
       * getlogin_r() in that case.
       */
      if (getlogin_r (login, sizeof (login)) == 0 &&
          g_str_equal (login, data->user))
        {
          argv = argv_local;
        }
      else
        {
          argv = argv_session;
        }
    }
  else
    {
      argv = argv_remote;

      if (g_unix_open_pipe (pwpipe, 0, error) < 0)
        goto out;

      /* Pass the out side (by convention) of the pipe to sshpass */
      g_snprintf (pwfd, sizeof (pwfd), "%d", pwpipe[0]);

      flags |= G_SPAWN_LEAVE_DESCRIPTORS_OPEN;

      g_snprintf (port, sizeof (port), "%d",
                  data->specific_port ? data->specific_port : 22);
    }

  /*
   * We leave file descriptors open for communication with sshpass. ssh
   * itself will close open file descriptors before proceeding further.
   */

  if (!g_spawn_async_with_pipes (NULL,
                                 argv,
                                 NULL,
                                 flags,
                                 NULL,
                                 NULL,
                                 &(data->session_pid),
                                 &session_stdin,
                                 &session_stdout,
                                 NULL,
                                 error))
      goto out;

  if (argv == argv_remote)
    {
      FILE *stream;
      const gchar *password = data->specific_password ? data->specific_password : data->password;
      gboolean failed;

      close (pwpipe[0]);
      pwpipe[0] = -1;

      /*
       * Yes, doing a blocking write like this assumes inside knowledge of the
       * sshpass tool. We have that inside knowledge (sshpass [driven by ssh]
       * will read the password fd before blocking on stdin or stdout, besides
       * there's a kernel buffer as well) ... And this is temporary until
       * we migrate to libssh.
       */
      stream = fdopen (pwpipe[1], "w");
      fwrite (password, 1, strlen (password), stream);
      fputc ('\n', stream);
      fflush (stream);
      failed = ferror (stream);
      fclose (stream);
      pwpipe[1] = -1;

      if (failed)
        {
          g_set_error_literal (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                               "Couldn't give password to sshpass");
          goto out;
        }
    }

  data->to_session = g_unix_output_stream_new (session_stdin, TRUE);
  data->from_session = g_unix_input_stream_new (session_stdout, TRUE);
  session_stdin = session_stdout = -1;

  data->readstate = WS_STATE_READING_SIZE_WORD;
  data->size_word_bytes_read = 0;
  g_input_stream_read_async (data->from_session,
                             data->size_word_bytes, 4,
                             G_PRIORITY_DEFAULT, data->sessionio_cancellable,
                             on_session_read_complete,
                             web_socket_data_ref (data));

  ret = TRUE;

out:
  if (pwpipe[0] >= 0)
    close (pwpipe[0]);
  if (pwpipe[1] >= 0)
    close (pwpipe[1]);
  if (session_stdin >= 0)
    close (session_stdin);
  if (session_stdout >= 0)
    close (session_stdout);

  /*
   * In the case of failure, closing all the inputs
   * will make child go away.
   */

  if (!ret)
    {
      g_spawn_close_pid (data->session_pid);
      data->session_pid = 0;
    }

  return ret;
}

static void
close_session (WebSocketData *data)
{
  if (data->sessionio_cancellable)
    g_cancellable_cancel (data->sessionio_cancellable);

  if (data->session_pid)
    {
      int status;
      GError *error = NULL;

      g_output_stream_close (data->to_session, NULL, NULL);
      TEMP_FAILURE_RETRY (waitpid (data->session_pid, &status, 0));
      g_spawn_close_pid (data->session_pid);
      data->session_pid = 0;

      g_input_stream_close (data->from_session, NULL, NULL);

      if (WIFSIGNALED (status) && WTERMSIG (status) == SIGTERM)
        send_error (data, "terminated");
      else if (WIFEXITED (status) && WEXITSTATUS (status) == 5)
        send_error (data, "not-authorized");  // wrong password
      else if (WIFEXITED (status) && WEXITSTATUS (status) == 6)
        send_error (data, "unknown-hostkey");
      else if (WIFEXITED (status) && WEXITSTATUS (status) == 127)
        send_error (data, "no-agent");        // cockpit-agent not installed
      else if (WIFEXITED (status) && WEXITSTATUS (status) == 255)
        send_error (data, "terminated");      // ssh failed or got a signal, etc.
      else if (!g_spawn_check_exit_status (status, &error))
        {
          send_error (data, "internal-error");
          g_warning ("%s failed: %s", data->agent_program, error->message);
          g_error_free (error);
        }

      g_signal_handlers_disconnect_by_func (data->web_socket, on_web_socket_message, data);
      g_clear_object (&data->from_session);
      g_clear_object (&data->to_session);
    }
}

static void
on_web_socket_open (WebSocketConnection *web_socket,
                    WebSocketData *data)
{
  get_remote_address (data->connection, &(data->rhost), &(data->rport));
  g_info ("New connection from %s:%d for %s%s%s", data->rhost, data->rport,
          data->user ? data->user : "", data->user ? "@" : "", data->target_host);

  /* We send auth errors as regular messages after establishing the
     connection because the WebSocket API doesn't let us see the HTTP
     status code.  We can't just use 'close' control frames to return a
     meaningful status code, but the old protocol doesn't have them.
  */
  if (!data->authenticated)
    {
      send_error (data, "no-session");
      web_socket_connection_close (web_socket,
                                   WEB_SOCKET_CLOSE_GOING_AWAY,
                                   "not-authenticated");
    }
  else
    g_signal_connect (web_socket, "message",
                      G_CALLBACK (on_web_socket_message), data);
}

static void
on_web_socket_error (WebSocketConnection *web_socket,
                     GError *error,
                     WebSocketData *data)
{
  g_warning ("%s", error->message);
}

static gboolean
on_web_socket_closing (WebSocketConnection *web_socket,
                       WebSocketData *data)
{
  g_debug ("web socket closing");
  close_session (data);
  return FALSE;
}

static void
on_web_socket_close (WebSocketConnection *web_socket,
                     WebSocketData *data)
{
  g_info ("Connection from %s:%d for %s@%s closed", data->rhost, data->rport, data->user, data->target_host);
  close_session (data);
}

void
cockpit_web_socket_serve_dbus (CockpitWebServer *server,
                               const gchar *target_host,
                               guint16 specific_port,
                               const gchar *agent_program,
                               GIOStream *io_stream,
                               GHashTable *headers,
                               GByteArray *input_buffer,
                               CockpitAuth *auth)
{
  const gchar *protocols[] = { "cockpit1", NULL };
  WebSocketData *data;
  gchar *url;

  data = g_new0 (WebSocketData, 1);
  data->refcount = 1;
  data->target_host = g_strdup (target_host);
  data->specific_port = specific_port;
  data->agent_program = g_strdup (agent_program);
  if (G_IS_SOCKET_CONNECTION (io_stream))
    data->connection = g_object_ref (io_stream);
  else if (G_IS_TLS_CONNECTION (io_stream))
    {
      GIOStream *base;
      g_object_get (io_stream, "base-io-stream", &base, NULL);
      if (G_IS_SOCKET_CONNECTION (base))
        data->connection = g_object_ref (base);
    }

  data->authenticated = cockpit_auth_check_headers (auth, headers,
                                                 &(data->user), &(data->password));

  /* TODO: We need to validate Host throughout */
  url = g_strdup_printf ("%s://host-not-yet-used/socket/%s",
                         G_IS_TLS_CONNECTION (io_stream) ? "wss" : "ws",
                         target_host);

  data->main_context = g_main_context_new ();
  g_main_context_push_thread_default (data->main_context);

  data->sessionio_cancellable = g_cancellable_new ();
  g_queue_init (&data->session_write_queue);

  data->web_socket = web_socket_server_new_for_stream (url, NULL, protocols,
                                                       io_stream, headers,
                                                       input_buffer);

  g_free (url);

  g_signal_connect (data->web_socket, "open", G_CALLBACK (on_web_socket_open), data);
  g_signal_connect (data->web_socket, "closing", G_CALLBACK (on_web_socket_closing), data);
  g_signal_connect (data->web_socket, "close", G_CALLBACK (on_web_socket_close), data);
  g_signal_connect (data->web_socket, "error", G_CALLBACK (on_web_socket_error), data);

  while (web_socket_connection_get_ready_state (data->web_socket) != WEB_SOCKET_STATE_CLOSED)
    {
      /* The socket was closed by the cockpit-agent going away */
      if (data->eof_from_session)
        {
          if (web_socket_connection_get_ready_state (data->web_socket) < WEB_SOCKET_STATE_CLOSING)
            web_socket_connection_close (data->web_socket, WEB_SOCKET_CLOSE_GOING_AWAY, NULL);
        }

      g_main_context_iteration (data->main_context, TRUE);
    }

  g_cancellable_cancel (data->sessionio_cancellable);

  g_main_context_pop_thread_default (data->main_context);
  g_main_context_unref (data->main_context);

  web_socket_data_unref (data);
}
