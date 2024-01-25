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

#include "cockpitfsread.h"

#include "common/cockpitflow.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"

#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

#define DEFAULT_MAX_READ_SIZE (16*1024*1024)

/**
 * CockpitFsread:
 *
 * A #CockpitChannel that reads the content of a file.
 *
 * The payload type for this channel is 'fsread1'.
 */

#define COCKPIT_FSREAD(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FSREAD, CockpitFsread))

typedef struct {
  CockpitChannel parent;
  const gchar *path;
  gchar *start_tag;
  int fd;

  CockpitPipe *pipe;
  gboolean open;
  gboolean closing;
  guint sig_read;
  guint sig_close;
} CockpitFsread;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitFsreadClass;

G_DEFINE_TYPE (CockpitFsread, cockpit_fsread, COCKPIT_TYPE_CHANNEL);

static void
cockpit_fsread_recv (CockpitChannel *channel,
                     GBytes *message)
{
  cockpit_channel_fail (channel, "protocol-error", "received unexpected message in fsread channel");
}

static gchar *
file_tag_from_stat (int res,
                    int err,
                    struct stat *buf)
{
  // The transaction tag is the inode and mtime of the file.  Mtime is
  // used to catch in-place modifications, and the inode to catch
  // renames.

  if (res >= 0)
    return g_strdup_printf ("1:%lu-%lld.%ld",
                            (unsigned long)buf->st_ino,
                            (long long int)buf->st_mtim.tv_sec,
                            (long int)buf->st_mtim.tv_nsec);
  else if (err == ENOENT)
    return g_strdup ("-");
  else
    return NULL;
}

gchar *
cockpit_get_file_tag (const gchar *path)
{
  struct stat buf;
  int res = stat (path, &buf);
  return file_tag_from_stat (res, errno, &buf);
}

gchar *
cockpit_get_file_tag_from_fd (int fd)
{
  struct stat buf;
  int res = fstat (fd, &buf);
  return file_tag_from_stat (res, errno, &buf);
}

static void
cockpit_fsread_close (CockpitChannel *channel,
                      const gchar *problem)
{
  CockpitFsread *self = COCKPIT_FSREAD (channel);

  self->closing = TRUE;

  /*
   * If closed, call base class handler directly. Otherwise ask
   * our pipe to close first, which will come back here.
  */
  if (self->open)
    cockpit_pipe_close (self->pipe, problem);
  else
    COCKPIT_CHANNEL_CLASS (cockpit_fsread_parent_class)->close (channel, problem);
}

static void
cockpit_fsread_init (CockpitFsread *self)
{
  self->fd = -1;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitFsread *self = user_data;
  CockpitChannel *channel = user_data;
  const gchar *problem;
  JsonObject *options;
  GBytes *message;
  gchar *tag;

  if (data->len)
    {
      /* When array is reffed, this just clears byte array */
      g_byte_array_ref (data);
      message = g_byte_array_free_to_bytes (data);
      cockpit_channel_send (channel, message, FALSE);
      g_bytes_unref (message);
    }

  if (end_of_data)
    {
      cockpit_channel_control (channel, "done", NULL);

      problem = NULL;
      if (self->fd >= 0 && self->start_tag)
        {
          tag = cockpit_get_file_tag_from_fd (self->fd);
          if (g_strcmp0 (tag, self->start_tag) == 0)
            {
              options = cockpit_channel_close_options (channel);
              json_object_set_string_member (options, "tag", tag);
            }
          else
            {
              problem = "change-conflict";
            }
          g_free (tag);
        }

      cockpit_channel_close (channel, problem);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitFsread *self = COCKPIT_FSREAD (user_data);
  CockpitChannel *channel = COCKPIT_CHANNEL (user_data);

  self->open = FALSE;
  cockpit_channel_close (channel, problem);
}

static void
cockpit_fsread_prepare (CockpitChannel *channel)
{
  CockpitFsread *self = COCKPIT_FSREAD (channel);
  JsonObject *options;
  gint64 max_read_size;
  struct stat statbuf;
  mode_t ifmt;
  int fd;

  COCKPIT_CHANNEL_CLASS (cockpit_fsread_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);

  if (!cockpit_json_get_string (options, "path", NULL, &self->path))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"path\" option for fsread channel");
      return;
    }
  if (self->path == NULL || *(self->path) == 0)
    {
      cockpit_channel_fail (channel, "protocol-error", "missing \"path\" option for fsread channel");
      return;
    }

  if (!cockpit_json_get_int (options, "max_read_size", DEFAULT_MAX_READ_SIZE, &max_read_size))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"max_read_size\" option for fsread channel");
      return;
    }

  if (self->closing)
    return;

  fd = open (self->path, O_RDONLY);
  if (fd < 0)
    {
      int err = errno;
      if (err == ENOENT)
        {
          options = cockpit_channel_close_options (channel);
          json_object_set_string_member (options, "tag", "-");
          cockpit_channel_close (channel, NULL);
        }
      else
        {
          if (err == EPERM || err == EACCES)
            {
              g_debug ("%s: couldn't open: %s", self->path, strerror (err));
              cockpit_channel_close (channel, "access-denied");
            }
          else
            {
              cockpit_channel_fail (channel, "internal-error",
                                    "%s: couldn't open: %s", self->path, strerror (err));
            }
        }
      goto out;
    }

  if (fstat (fd, &statbuf) < 0)
    {
      cockpit_channel_fail (channel, "internal-error", "%s: couldn't stat: %s", self->path, strerror (errno));
      goto out;
    }

  ifmt = (statbuf.st_mode & S_IFMT);
  if (ifmt != S_IFREG && ifmt != S_IFBLK)
    {
      cockpit_channel_fail (channel, "internal-error", "%s: not a readable file", self->path);
      goto out;
    }
  if (ifmt == S_IFREG && statbuf.st_size > max_read_size)
    {
      cockpit_channel_close (channel, "too-large");
      goto out;
    }

  /* This owns the file descriptor */
  self->pipe = cockpit_pipe_new (self->path, fd, -1);
  self->fd = fd;
  fd = -1;

  self->start_tag = cockpit_get_file_tag_from_fd (self->fd);

  /* Let the channel throttle the pipe's input flow*/
  cockpit_flow_throttle (COCKPIT_FLOW (self->pipe), COCKPIT_FLOW (self));

  /* Let the pipe input the channel peer's output flow */
  cockpit_flow_throttle (COCKPIT_FLOW (channel), COCKPIT_FLOW (self->pipe));

  self->sig_read = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->sig_close = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);

  const gchar *binary;
  if (S_ISREG(statbuf.st_mode) && cockpit_json_get_string (options, "binary", "", &binary) && g_str_equal (binary, "raw"))
    {
      g_autoptr(JsonObject) message = json_object_new ();
      json_object_set_int_member (message, "size-hint", statbuf.st_size);
      cockpit_channel_ready (channel, message);
    } else {
      cockpit_channel_ready (channel, NULL);
    }


out:
  if (fd >= 0)
    close (fd);
}

static void
cockpit_fsread_dispose (GObject *object)
{
  CockpitFsread *self = COCKPIT_FSREAD (object);

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

  G_OBJECT_CLASS (cockpit_fsread_parent_class)->dispose (object);
}

static void
cockpit_fsread_finalize (GObject *object)
{
  CockpitFsread *self = COCKPIT_FSREAD (object);

  g_free (self->start_tag);
  g_clear_object (&self->pipe);

  G_OBJECT_CLASS (cockpit_fsread_parent_class)->finalize (object);
}

static void
cockpit_fsread_class_init (CockpitFsreadClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_fsread_dispose;
  gobject_class->finalize = cockpit_fsread_finalize;

  channel_class->prepare = cockpit_fsread_prepare;
  channel_class->recv = cockpit_fsread_recv;
  channel_class->close = cockpit_fsread_close;
}

/**
 * cockpit_fsread_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @path: the path name of the file to read
 * @binary: set binary to "raw"
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitFsread is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_fsread_open (CockpitTransport *transport,
                     const gchar *channel_id,
                     const gchar *path,
                     gboolean binary)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "path", path);
  json_object_set_string_member (options, "payload", "fsread1");
  if (binary)
    json_object_set_string_member (options, "binary", "raw");

  channel = g_object_new (COCKPIT_TYPE_FSREAD,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
