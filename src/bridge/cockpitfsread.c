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

#include "common/cockpitjson.h"

#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

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
  int fd;
  gchar *start_tag;
  GQueue *queue;
  guint idler;
} CockpitFsread;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitFsreadClass;

G_DEFINE_TYPE (CockpitFsread, cockpit_fsread, COCKPIT_TYPE_CHANNEL);

static gboolean
on_idle_send_block (gpointer data)
{
  CockpitChannel *channel = data;
  CockpitFsread *self = data;
  const gchar *problem;
  JsonObject *options;
  GBytes *payload;
  gchar *tag;

  payload = g_queue_pop_head (self->queue);
  if (payload == NULL)
    {
      self->idler = 0;
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
      return FALSE;
    }
  else
    {
      cockpit_channel_send (channel, payload, FALSE);
      g_bytes_unref (payload);
      return TRUE;
    }
}

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
    return g_strdup_printf ("1:%lu-%ld.%ld",
                            (unsigned long)buf->st_ino,
                            buf->st_mtim.tv_sec,
                            buf->st_mtim.tv_nsec);
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

  if (self->idler)
    {
      g_source_remove (self->idler);
      self->idler = 0;
    }

  if (self->fd >= 0)
    close (self->fd);

  COCKPIT_CHANNEL_CLASS (cockpit_fsread_parent_class)->close (channel, problem);
}

static void
cockpit_fsread_init (CockpitFsread *self)
{
  self->fd = -1;
}

static void
push_bytes (GQueue *queue,
            GBytes *bytes)
{
  gsize size;
  gsize length;
  gsize offset;

  size = g_bytes_get_size (bytes);
  if (size < 8192)
    {
      g_queue_push_tail (queue, bytes);
    }
  else
    {
      for (offset = 0; offset < size; offset += 4096)
        {
          length = MIN (4096, size - offset);
          g_queue_push_tail (queue, g_bytes_new_from_bytes (bytes, offset, length));
        }
      g_bytes_unref (bytes);
    }
}

static void
cockpit_fsread_prepare (CockpitChannel *channel)
{
  CockpitFsread *self = COCKPIT_FSREAD (channel);
  JsonObject *options;
  GMappedFile *mapped;
  GError *error = NULL;

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

  self->fd = open (self->path, O_RDONLY);
  if (self->fd < 0)
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
      return;
    }

  mapped = g_mapped_file_new_from_fd (self->fd, FALSE, &error);
  if (error)
    {
      cockpit_channel_fail (channel, "internal-error", "couldn't map: %s", error->message);
      g_error_free (error);
      return;
    }

  self->start_tag = cockpit_get_file_tag_from_fd (self->fd);
  self->queue = g_queue_new ();
  push_bytes (self->queue, g_mapped_file_get_bytes (mapped));
  self->idler = g_idle_add (on_idle_send_block, self);
  cockpit_channel_ready (channel, NULL);
  g_mapped_file_unref (mapped);
}

static void
cockpit_fsread_finalize (GObject *object)
{
  CockpitFsread *self = COCKPIT_FSREAD (object);

  g_free (self->start_tag);
  if (self->queue)
    {
      while (!g_queue_is_empty (self->queue))
        g_bytes_unref (g_queue_pop_head (self->queue));
      g_queue_free (self->queue);
    }
  g_assert (self->idler == 0);

  G_OBJECT_CLASS (cockpit_fsread_parent_class)->finalize (object);
}

static void
cockpit_fsread_class_init (CockpitFsreadClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

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
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitFsread is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_fsread_open (CockpitTransport *transport,
                     const gchar *channel_id,
                     const gchar *path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "path", path);
  json_object_set_string_member (options, "payload", "fsread1");

  channel = g_object_new (COCKPIT_TYPE_FSREAD,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
