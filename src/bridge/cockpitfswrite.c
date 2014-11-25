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

#include "cockpitfswrite.h"
#include "cockpitfsread.h"

#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>

/**
 * CockpitFswrite:
 *
 * A #CockpitChannel that reads the content of a file.
 *
 * The payload type for this channel is 'fswrite1'.
 */

#define COCKPIT_FSWRITE(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FSWRITE, CockpitFswrite))

typedef struct {
  CockpitChannel parent;
  const gchar *path;
  gchar *tmp_path;
  int fd;
  gboolean got_content;
  const gchar *expected_tag;
  guint sig_close;
} CockpitFswrite;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitFswriteClass;

G_DEFINE_TYPE (CockpitFswrite, cockpit_fswrite, COCKPIT_TYPE_CHANNEL);

static const gchar *
prepare_for_close_with_errno (CockpitFswrite *self,
                              int err)
{
  if (err == EPERM)
    {
      g_debug ("%s: %s", self->path, strerror (err));
      return "not-authorized";
    }
  else
    {
      g_message ("%s: %s", self->path, strerror (err));
      cockpit_channel_close_option (COCKPIT_CHANNEL (self), "message", strerror (err));
      return "internal-error";
    }
}

static void
close_with_errno (CockpitFswrite *self,
                  int err)
{
  cockpit_channel_close (COCKPIT_CHANNEL (self),
                         prepare_for_close_with_errno (self, err));
}

static void
cockpit_fswrite_recv (CockpitChannel *channel,
                      GBytes *message)
{
  CockpitFswrite *self = COCKPIT_FSWRITE (channel);
  gsize size;
  const char *data = g_bytes_get_data (message, &size);

  self->got_content = TRUE;

  while (size > 0)
    {
      ssize_t n = write (self->fd, data, size);
      if (n < 0)
        {
          if (errno == EINTR)
            continue;

          close_with_errno (self, errno);
          return;
        }

      g_return_if_fail (n > 0);
      size -= n;
      data += n;
    }
}

static int
xfsync (int fd)
{
  while (TRUE)
    {
      int res = fsync (fd);
      if (res < 0 && errno == EINTR)
        continue;

      return res;
    }
}

static int
xclose (int fd)
{
  /* http://lkml.indiana.edu/hypermail/linux/kernel/0509.1/0877.html
   */
  int res = close (fd);
  if (res < 0 && errno == EINTR)
    return 0;
  else
    return res;
}

static void
cockpit_fswrite_close (CockpitChannel *channel,
                       const gchar *problem)
{
  CockpitFswrite *self = COCKPIT_FSWRITE (channel);

  /* Commit the changes when there was no problem.
   */
  if (problem == NULL || *problem == 0)
    {
      if (xfsync (self->fd) < 0 || xclose (self->fd) < 0)
        problem = prepare_for_close_with_errno (self, errno);
      else
        {
          gchar *actual_tag = cockpit_get_file_tag (self->path);
          if (self->expected_tag && g_strcmp0 (self->expected_tag, actual_tag))
            {
              problem = "out-of-date";
            }
          else
            {
              if (!self->got_content)
                {
                  cockpit_channel_close_option (channel, "tag", "-");
                  if (unlink (self->path) < 0 && errno != ENOENT)
                    problem = prepare_for_close_with_errno (self, errno);
                  unlink (self->tmp_path);
                }
              else
                {
                  gchar *new_tag = cockpit_get_file_tag (self->tmp_path);
                  cockpit_channel_close_option (channel, "tag", new_tag);
                  if (rename (self->tmp_path, self->path) < 0)
                    problem = prepare_for_close_with_errno (self, errno);
                  g_free (new_tag);
                }
            }
          g_free (actual_tag);
        }
      self->fd = -1;
    }

  /* Cleanup in case of problem
   */
  if (problem && *problem)
    {
      if (self->fd != -1)
        close (self->fd);
      if (self->tmp_path)
        unlink (self->tmp_path);
      self->fd = -1;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_fswrite_parent_class)->close (channel, problem);
}

static void
cockpit_fswrite_init (CockpitFswrite *self)
{
  self->fd = -1;
}

static void
cockpit_fswrite_constructed (GObject *object)
{
  CockpitFswrite *self = COCKPIT_FSWRITE (object);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  gchar *actual_tag;

  G_OBJECT_CLASS (cockpit_fswrite_parent_class)->constructed (object);

  self->path = cockpit_channel_get_option (channel, "path");
  self->expected_tag = cockpit_channel_get_option (channel, "tag");

  if (self->path == NULL || *(self->path) == 0)
    {
      g_warning ("missing 'path' option for fswrite channel");
      cockpit_channel_close (channel, "protocol-error");
      return;
    }

  actual_tag = cockpit_get_file_tag (self->path);
  if (self->expected_tag && g_strcmp0 (self->expected_tag, actual_tag))
    {
      cockpit_channel_close (channel, "change-conflict");
      g_free (actual_tag);
      return;
    }
  g_free (actual_tag);

  // TODO - delay the opening until the first content message.  That
  // way, we don't create a useless temporary file (which might even
  // fail).

  for (int i = 1; i < 10000; i++)
    {
      self->tmp_path = g_strdup_printf ("%s.%d", self->path, i);
      self->fd = open (self->tmp_path, O_WRONLY | O_CREAT | O_EXCL, 0666);
      if (self->fd >= 0 || errno != EEXIST)
        break;
      g_free (self->tmp_path);
      self->tmp_path = NULL;
    }

  if (self->fd < 0)
    {
      close_with_errno (self, errno);
      return;
    }

  cockpit_channel_ready (channel);
}

static void
cockpit_fswrite_finalize (GObject *object)
{
  CockpitFswrite *self = COCKPIT_FSWRITE (object);

  g_free (self->tmp_path);

  G_OBJECT_CLASS (cockpit_fswrite_parent_class)->finalize (object);
}

static void
cockpit_fswrite_class_init (CockpitFswriteClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_fswrite_constructed;
  gobject_class->finalize = cockpit_fswrite_finalize;

  channel_class->recv = cockpit_fswrite_recv;
  channel_class->close = cockpit_fswrite_close;
}

/**
 * cockpit_fswrite_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @path: the path name of the file to write
 * @tag: the expected tag, or NULL
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitFswrite is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_fswrite_open (CockpitTransport *transport,
                      const gchar *channel_id,
                      const gchar *path,
                      const gchar *tag)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "path", path);
  if (tag)
    json_object_set_string_member (options, "tag", tag);
  json_object_set_string_member (options, "payload", "fswrite1");

  channel = g_object_new (COCKPIT_TYPE_FSWRITE,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
