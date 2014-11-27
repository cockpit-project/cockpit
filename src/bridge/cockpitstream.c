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

#include "cockpitstream.h"

#include "common/cockpitpipe.h"
#include "common/cockpitjson.h"

#include "common/cockpitunixsignal.h"

#include <gio/gunixsocketaddress.h>

#include <sys/wait.h>

/**
 * CockpitStream:
 *
 * A #CockpitChannel that sends messages from a regular socket
 * or file descriptor. Any data is read in whatever chunks it
 * shows up in read().
 *
 * Only UTF8 text data is transmitted. Anything else is
 * forced into UTF8 by replacing invalid characters.
 *
 * The payload type for this channel is 'stream'.
 */

#define COCKPIT_STREAM(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_STREAM, CockpitStream))

typedef struct {
  CockpitChannel parent;
  CockpitPipe *pipe;
  GSocket *sock;
  gchar *name;
  gboolean open;
  gboolean closing;
  guint sig_read;
  guint sig_close;
  gint64 batch_size;
  guint batch_timeout;
} CockpitStream;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitStreamClass;

G_DEFINE_TYPE (CockpitStream, cockpit_stream, COCKPIT_TYPE_CHANNEL);

static void
cockpit_stream_recv (CockpitChannel *channel,
                     GBytes *message)
{
  CockpitStream *self = COCKPIT_STREAM (channel);
  cockpit_pipe_write (self->pipe, message);
}

static void
process_pipe_buffer (CockpitStream *self,
                     GByteArray *data)
{
  CockpitChannel *channel = (CockpitChannel *)self;
  GBytes *message;

  if (self->batch_timeout)
    {
      g_source_remove (self->batch_timeout);
      self->batch_timeout = 0;
    }

  if (data->len)
    {
      /* When array is reffed, this just clears byte array */
      g_byte_array_ref (data);
      message = g_byte_array_free_to_bytes (data);
      cockpit_channel_send (channel, message, FALSE);
      g_bytes_unref (message);
    }
}

static void
cockpit_stream_eof (CockpitChannel *channel)
{
  CockpitStream *self = COCKPIT_STREAM (channel);

  self->closing = TRUE;
  if (self->pipe)
    process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, NULL);
}

static void
cockpit_stream_close (CockpitChannel *channel,
                      const gchar *problem)
{
  CockpitStream *self = COCKPIT_STREAM (channel);

  self->closing = TRUE;
  if (self->pipe)
    process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, problem);
  else
    COCKPIT_CHANNEL_CLASS (cockpit_stream_parent_class)->close (channel, problem);
}

static gboolean
on_batch_timeout (gpointer user_data)
{
  CockpitStream *self = user_data;
  self->batch_timeout = 0;
  process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));
  return FALSE;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitStream *self = user_data;

  if (!end_of_data &&
      self->batch_size > 0 &&
      data->len < self->batch_size)
    {
      /* Delay the processing of this data */
      if (!self->batch_timeout)
        self->batch_timeout = g_timeout_add (75, on_batch_timeout, self);
    }
  else
    {
      process_pipe_buffer (self, data);
    }

  /* Close the pipe when writing is done */
  if (end_of_data && self->open)
    {
      g_debug ("%s: end of data, closing pipe", self->name);
      cockpit_pipe_close (pipe, NULL);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitStream *self = user_data;
  CockpitChannel *channel = user_data;
  JsonObject *options;
  gint status;
  gchar *signal;

  process_pipe_buffer (self, cockpit_pipe_get_buffer (self->pipe));

  self->open = FALSE;

  if (cockpit_pipe_get_pid (pipe, NULL))
    {
      options = cockpit_channel_close_options (channel);
      status = cockpit_pipe_exit_status (pipe);
      if (WIFEXITED (status))
        {
          json_object_set_int_member (options, "exit-status", WEXITSTATUS (status));
        }
      else if (WIFSIGNALED (status))
        {
          signal = cockpit_strsignal (WTERMSIG (status));
          json_object_set_string_member (options, "exit-signal", signal);
          g_free (signal);
        }
      else if (status)
        {
          json_object_set_int_member (options, "exit-status", -1);
        }
    }

  /*
   * In theory we should plumb eof handling all the way through to CockpitPipe.
   * But we can do that later in a compatible way.
   */
  if (problem == NULL)
    cockpit_channel_eof (channel);

  cockpit_channel_close (channel, problem);
}

static void
cockpit_stream_init (CockpitStream *self)
{

}

static void
cockpit_stream_prepare (CockpitChannel *channel)
{
  CockpitStream *self = COCKPIT_STREAM (channel);
  const gchar *problem = "protocol-error";
  GSocketAddress *address;
  CockpitPipeFlags flags;
  JsonObject *options;
  const gchar *unix_path;
  gchar **argv = NULL;
  gchar **env = NULL;
  gboolean pty;
  const gchar *dir;
  const gchar *error;

  COCKPIT_CHANNEL_CLASS (cockpit_stream_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "unix", NULL, &unix_path))
    {
      g_warning ("invalid \"unix\" option for stream channel");
      goto out;
    }
  if (!cockpit_json_get_strv (options, "spawn", NULL, &argv))
    {
      g_warning ("invalid \"spawn\" option for stream channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "error", NULL, &error))
    {
      g_warning ("invalid \"error\" options for stream channel");
      goto out;
    }
  if (!cockpit_json_get_int (options, "batch", G_MAXINT64, &self->batch_size))
    {
      g_warning ("invalid \"batch\" option for stream channel");
      goto out;
    }

  if (argv == NULL && unix_path == NULL)
    {
      g_warning ("did not receive a \"unix\" or \"spawn\" option");
      goto out;
    }
  else if (argv != NULL && unix_path != NULL)
    {
      g_warning ("received both a \"unix\" and \"spawn\" option");
      goto out;
    }
  else if (unix_path)
    {
      self->name = g_strdup (unix_path);
      address = g_unix_socket_address_new (unix_path);
      self->pipe = cockpit_pipe_connect (self->name, address);
      g_object_unref (address);
    }
  else if (argv)
    {
      flags = COCKPIT_PIPE_STDERR_TO_LOG;
      if (error && g_str_equal (error, "output"))
        flags = COCKPIT_PIPE_STDERR_TO_STDOUT;

      self->name = g_strdup (argv[0]);
      if (!cockpit_json_get_strv (options, "environ", NULL, &env))
        {
          g_warning ("invalid \"environ\" option for stream channel");
          goto out;
        }
      if (!cockpit_json_get_string (options, "directory", NULL, &dir))
        {
          g_warning ("invalid \"directory\" option for stream channel");
          goto out;
        }
      if (!cockpit_json_get_bool (options, "pty", FALSE, &pty))
        {
          g_warning ("invalid \"pty\" option for stream channel");
          goto out;
        }
      if (pty)
        self->pipe = cockpit_pipe_pty ((const gchar **)argv, (const gchar **)env, dir);
      else
        self->pipe = cockpit_pipe_spawn ((const gchar **)argv, (const gchar **)env, dir, flags);
    }

  self->sig_read = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->sig_close = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);
  self->open = TRUE;
  cockpit_channel_ready (channel);
  problem = NULL;

out:
  g_free (argv);
  g_free (env);
  if (problem)
    cockpit_channel_close (channel, problem);
}

static void
cockpit_stream_dispose (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  if (self->pipe)
    {
      if (self->open)
        cockpit_pipe_close (self->pipe, "terminated");
      if (self->sig_read)
        g_signal_handler_disconnect (self->pipe, self->sig_read);
      if (self->sig_close)
        g_signal_handler_disconnect (self->pipe, self->sig_close);
      self->sig_read = self->sig_close = 0;
    }

  G_OBJECT_CLASS (cockpit_stream_parent_class)->dispose (object);
}

static void
cockpit_stream_finalize (GObject *object)
{
  CockpitStream *self = COCKPIT_STREAM (object);

  g_clear_object (&self->sock);
  g_clear_object (&self->pipe);
  g_free (self->name);

  G_OBJECT_CLASS (cockpit_stream_parent_class)->finalize (object);
}

static void
cockpit_stream_class_init (CockpitStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_stream_dispose;
  gobject_class->finalize = cockpit_stream_finalize;

  channel_class->prepare = cockpit_stream_prepare;
  channel_class->eof = cockpit_stream_eof;
  channel_class->recv = cockpit_stream_recv;
  channel_class->close = cockpit_stream_close;
}

/**
 * cockpit_stream_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitStream is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_stream_open (CockpitTransport *transport,
                     const gchar *channel_id,
                     const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "stream");

  channel = g_object_new (COCKPIT_TYPE_STREAM,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
