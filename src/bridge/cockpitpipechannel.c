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

#include "cockpitpipechannel.h"

#include "common/cockpitpipe.h"
#include "common/cockpitjson.h"
#include "common/cockpitunicode.h"
#include "common/cockpitunixsignal.h"

#include <gio/gunixsocketaddress.h>

#include <sys/wait.h>
#include <string.h>

/**
 * CockpitPipeChannel:
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

#define COCKPIT_PIPE_CHANNEL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PIPE_CHANNEL, CockpitPipeChannel))

typedef struct {
  CockpitChannel parent;
  CockpitPipe *pipe;
  GSocket *sock;
  gchar *name;
  gboolean open;
  gboolean closing;
  guint sig_read;
  guint sig_close;
  gint64 batch;
  gint64 latency;
  guint timeout;
} CockpitPipeChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitPipeChannelClass;

G_DEFINE_TYPE (CockpitPipeChannel, cockpit_pipe_channel, COCKPIT_TYPE_CHANNEL);

static void
cockpit_pipe_channel_recv (CockpitChannel *channel,
                           GBytes *message)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (channel);
  if (self->open)
    cockpit_pipe_write (self->pipe, message);
}

static void
process_pipe_buffer (CockpitPipeChannel *self,
                     GByteArray *data)
{
  CockpitChannel *channel = (CockpitChannel *)self;
  GBytes *message;

  if (!data && self->pipe)
    data = cockpit_pipe_get_buffer (self->pipe);

  if (!data)
    return;

  if (self->timeout)
    {
      g_source_remove (self->timeout);
      self->timeout = 0;
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

static gboolean
cockpit_pipe_channel_control (CockpitChannel *channel,
                              const gchar *command,
                              JsonObject *message)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (channel);
  gboolean ret = TRUE;

  /* New set of options for channel */
  if (g_str_equal (command, "options"))
    {
      if (!cockpit_json_get_int (message, "batch", self->batch, &self->batch))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"batch\" option for stream channel");
          goto out;
        }

      if (!cockpit_json_get_int (message, "latency", self->latency, &self->latency) ||
          self->latency < 0 || self->latency >= G_MAXUINT)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"latency\" option for stream channel");
          goto out;
        }

      process_pipe_buffer (self, NULL);
    }

  /* Channel input is done */
  else if (g_str_equal (command, "done"))
    {
      self->closing = TRUE;
      process_pipe_buffer (self, NULL);

      /*
       * If closed, call base class handler directly. Otherwise ask
       * our pipe to close first, which will come back here.
      */
      if (self->open)
        cockpit_pipe_close (self->pipe, NULL);
    }

  else
    {
      ret = FALSE;
    }

out:
  return ret;
}

static void
cockpit_pipe_channel_close (CockpitChannel *channel,
                            const gchar *problem)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (channel);

  self->closing = TRUE;
  process_pipe_buffer (self, NULL);

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, problem);
  else
    COCKPIT_CHANNEL_CLASS (cockpit_pipe_channel_parent_class)->close (channel, problem);
}

static gboolean
on_batch_timeout (gpointer user_data)
{
  CockpitPipeChannel *self = user_data;
  self->timeout = 0;
  process_pipe_buffer (self, NULL);
  return FALSE;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitPipeChannel *self = user_data;

  if (!end_of_data && self->batch > 0 && data->len < self->batch)
    {
      /* Delay the processing of this data */
      if (!self->timeout)
        self->timeout = g_timeout_add (self->latency, on_batch_timeout, self);
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
return_stderr_message (CockpitChannel *channel,
                       CockpitPipe *pipe)
{
  JsonObject *options;
  GByteArray *buffer;
  GBytes *bytes;
  GBytes *clean;
  gchar *data;
  gsize length;

  buffer = cockpit_pipe_get_stderr (pipe);
  if (!buffer)
    return;

  /* A little more complicated to avoid big copies */
  g_byte_array_ref (buffer);
  g_byte_array_append (buffer, (guint8 *)"x", 1); /* place holder for null terminate */
  bytes = g_byte_array_free_to_bytes (buffer);
  clean = cockpit_unicode_force_utf8 (bytes);
  g_bytes_unref (bytes);

  data = g_bytes_unref_to_data (clean, &length);

  /* Fill in null terminate, for x above */
  g_assert (length > 0);
  data[length - 1] = '\0';

  options = cockpit_channel_close_options (channel);
  json_object_set_string_member (options, "message", data);
  g_free (data);
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitPipeChannel *self = user_data;
  CockpitChannel *channel = user_data;
  JsonObject *options;
  gint status;
  gchar *signal;

  process_pipe_buffer (self, NULL);

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

  return_stderr_message (channel, pipe);

  /*
   * In theory we should plumb done handling all the way through to CockpitPipe.
   * But we can do that later in a compatible way.
   */
  if (problem == NULL)
    cockpit_channel_control (channel, "done", NULL);

  cockpit_channel_close (channel, problem);
}

static void
cockpit_pipe_channel_init (CockpitPipeChannel *self)
{
  /* Has no effect until batch is set */
  self->latency = 75;
}

static gint
environ_find (gchar **env,
              const gchar *variable)
{
  gint len, x;
  gchar *pos;

  pos = strchr (variable, '=');
  if (pos == NULL)
    len = strlen (variable);
  else
    len = pos - variable;

  for (x = 0; env && env[x]; x++)
    {
      if (strncmp (env[x], variable, len) == 0 &&
          env[x][len] == '=')
        return x;
    }

  return -1;
}

static gchar **
parse_environ (CockpitChannel *channel,
               JsonObject *options,
               const gchar *directory)
{
  gchar **envset = NULL;
  gboolean had_pwd = FALSE;
  gsize length;
  gchar **env;
  gint i, x;

  if (!cockpit_json_get_strv (options, "environ", NULL, &envset))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"environ\" option for stream channel");
      return NULL;
    }

  env = g_get_environ ();
  length = g_strv_length (env);

  for (i = 0; envset && envset[i] != NULL; i++)
    {
      if (g_str_equal (envset[i], "PWD"))
        had_pwd = TRUE;
      x = environ_find (env, envset[i]);
      if (x != -1)
        {
          g_free (env[x]);
          env[x] = g_strdup (envset[i]);
        }
      else
        {
          env = g_renew (gchar *, env, length + 2);
          env[length] = g_strdup (envset[i]);
          env[length + 1] = NULL;
          length++;
        }
    }

  /*
   * The kernel only knows about the inode of the current directory.
   * So when we spawn a shell, it won't know the directory it's
   * meant to display. Pass it the path we care about in $PWD
   */
  if (!had_pwd && directory)
    env = g_environ_setenv (env, "PWD", directory, TRUE);

  g_free (envset);
  return env;
}

static void
cockpit_pipe_channel_prepare (CockpitChannel *channel)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (channel);
  GSocketAddress *address;
  CockpitPipeFlags flags;
  JsonObject *options;
  gchar **argv = NULL;
  gchar **env = NULL;
  gboolean pty;
  const gchar *dir;
  const gchar *error;

  COCKPIT_CHANNEL_CLASS (cockpit_pipe_channel_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);

  if (!cockpit_json_get_strv (options, "spawn", NULL, &argv))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"spawn\" option for stream channel");
      goto out;
    }

  /* Support our options in the open message too */
  cockpit_pipe_channel_control (channel, "options", options);
  if (self->closing)
    goto out;

  if (argv)
    {
      if (!cockpit_json_get_string (options, "err", NULL, &error))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"err\" options for stream channel");
          goto out;
        }

      flags = COCKPIT_PIPE_FLAGS_NONE;
      if (g_strcmp0 (error, "out") == 0)
        flags = COCKPIT_PIPE_STDERR_TO_STDOUT;
      else if (g_strcmp0 (error, "ignore") == 0)
        flags = COCKPIT_PIPE_STDERR_TO_NULL;
      else if (g_strcmp0 (error, "message") == 0)
        flags = COCKPIT_PIPE_STDERR_TO_MEMORY;

      self->name = g_strdup (argv[0]);
      if (!cockpit_json_get_string (options, "directory", NULL, &dir))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"directory\" option for stream channel");
          goto out;
        }
      if (!cockpit_json_get_bool (options, "pty", FALSE, &pty))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"pty\" option for stream channel");
          goto out;
        }
      env = parse_environ (channel, options, dir);
      if (!env)
        goto out;
      if (pty)
        self->pipe = cockpit_pipe_pty ((const gchar **)argv, (const gchar **)env, dir);
      else
        self->pipe = cockpit_pipe_spawn ((const gchar **)argv, (const gchar **)env, dir, flags);
    }
  else
    {
      address = cockpit_channel_parse_address (channel, &self->name);
      if (!address)
        goto out;
      self->pipe = cockpit_pipe_connect (self->name, address);
      g_object_unref (address);
    }

  self->sig_read = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->sig_close = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);
  self->open = TRUE;
  cockpit_channel_ready (channel, NULL);

out:
  g_free (argv);
  g_strfreev (env);
}

static void
cockpit_pipe_channel_dispose (GObject *object)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (object);

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

  G_OBJECT_CLASS (cockpit_pipe_channel_parent_class)->dispose (object);
}

static void
cockpit_pipe_channel_finalize (GObject *object)
{
  CockpitPipeChannel *self = COCKPIT_PIPE_CHANNEL (object);

  g_clear_object (&self->sock);
  g_clear_object (&self->pipe);
  g_free (self->name);

  G_OBJECT_CLASS (cockpit_pipe_channel_parent_class)->finalize (object);
}

static void
cockpit_pipe_channel_class_init (CockpitPipeChannelClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_pipe_channel_dispose;
  gobject_class->finalize = cockpit_pipe_channel_finalize;

  channel_class->prepare = cockpit_pipe_channel_prepare;
  channel_class->control = cockpit_pipe_channel_control;
  channel_class->recv = cockpit_pipe_channel_recv;
  channel_class->close = cockpit_pipe_channel_close;
}

/**
 * cockpit_pipe_channel_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitPipeChannel is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_pipe_channel_open (CockpitTransport *transport,
                           const gchar *channel_id,
                           const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "stream");

  channel = g_object_new (COCKPIT_TYPE_PIPE_CHANNEL,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
