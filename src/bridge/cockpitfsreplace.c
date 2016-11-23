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

#include "cockpitfsreplace.h"
#include "cockpitfsread.h"

#include "common/cockpitjson.h"

#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <stdio.h>

/**
 * CockpitFsreplace:
 *
 * A #CockpitChannel that writes/replaces the content of a file.
 *
 * The payload type for this channel is 'fsreplace1'.
 */

#define COCKPIT_FSREPLACE(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FSREPLACE, CockpitFsreplace))

typedef struct {
  CockpitChannel parent;
  const gchar *path;
  gchar *tmp_path;
  int fd;
  gboolean got_content;
  const gchar *expected_tag;
  guint sig_close;
} CockpitFsreplace;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitFsreplaceClass;

G_DEFINE_TYPE (CockpitFsreplace, cockpit_fsreplace, COCKPIT_TYPE_CHANNEL);

static void
close_with_errno (CockpitFsreplace *self,
                  const gchar *diagnostic,
                  int err)
{
  CockpitChannel *channel = COCKPIT_CHANNEL (self);

  if (err == EPERM || err == EACCES)
    {
      g_debug ("%s: %s: %s", self->path, diagnostic, strerror (err));
      cockpit_channel_close (channel, "access-denied");
    }
  else
    {
      cockpit_channel_fail (channel, "internal-error",
                            "%s: %s: %s", self->path, diagnostic, strerror (err));
    }
}

static void
cockpit_fsreplace_recv (CockpitChannel *channel,
                      GBytes *message)
{
  CockpitFsreplace *self = COCKPIT_FSREPLACE (channel);
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

          close_with_errno (self, "couldn't write", errno);
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

static gboolean
cockpit_fsreplace_control (CockpitChannel *channel,
                           const gchar *command,
                           JsonObject *unused)
{
  CockpitFsreplace *self = COCKPIT_FSREPLACE (channel);
  gchar *actual_tag = NULL;
  gchar *new_tag = NULL;
  JsonObject *options;

  if (!g_str_equal (command, "done"))
    return FALSE;

  g_object_ref (self);

  /* Commit the changes when there was no problem  */
  if (xfsync (self->fd) < 0 || xclose (self->fd) < 0)
    {
      close_with_errno (self, "couldn't sync", errno);
      goto out;
    }
  else
    {
      actual_tag = cockpit_get_file_tag (self->path);
      if (self->expected_tag && g_strcmp0 (self->expected_tag, actual_tag))
        {
          cockpit_channel_close (channel, "out-of-date");
          goto out;
        }
      else
        {
          options = cockpit_channel_close_options (channel);
          if (!self->got_content)
            {
              json_object_set_string_member (options, "tag", "-");
              if (unlink (self->tmp_path) < 0)
                g_message ("%s: couldn't remove temp file: %s", self->tmp_path, g_strerror (errno));
              if (unlink (self->path) < 0 && errno != ENOENT)
                {
                  close_with_errno (self, "couldn't unlink", errno);
                  goto out;
                }
            }
          else
            {
              new_tag = cockpit_get_file_tag (self->tmp_path);
              json_object_set_string_member (options, "tag", new_tag);
              if (rename (self->tmp_path, self->path) < 0)
                {
                  close_with_errno (self, "couldn't rename", errno);
                  goto out;
                }
            }
        }
    }

  cockpit_channel_close (channel, NULL);

out:
  g_free (new_tag);
  g_free (actual_tag);
  self->fd = -1;
  g_object_unref (self);
  return TRUE;
}

static void
cockpit_fsreplace_close (CockpitChannel *channel,
                       const gchar *problem)
{
  CockpitFsreplace *self = COCKPIT_FSREPLACE (channel);

  if (self->fd != -1)
    close (self->fd);
  self->fd = -1;

  /* Cleanup in case of problem */
  if (problem)
    {
      if (self->tmp_path)
        if (unlink (self->tmp_path) < 0 && errno != ENOENT)
          g_message ("%s: couldn't remove temp file: %s", self->tmp_path, g_strerror (errno));
    }

  COCKPIT_CHANNEL_CLASS (cockpit_fsreplace_parent_class)->close (channel, problem);
}

static void
cockpit_fsreplace_init (CockpitFsreplace *self)
{
  self->fd = -1;
}

static void
cockpit_fsreplace_prepare (CockpitChannel *channel)
{
  CockpitFsreplace *self = COCKPIT_FSREPLACE (channel);
  JsonObject *options;
  gchar *actual_tag = NULL;

  COCKPIT_CHANNEL_CLASS (cockpit_fsreplace_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "path", NULL, &self->path))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "invalid \"path\" option for fsreplace1 channel");
      goto out;
    }
  else if (self->path == NULL || g_str_equal (self->path, ""))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "missing \"path\" option for fsreplace1 channel");
      goto out;
    }

  if (!cockpit_json_get_string (options, "tag", NULL, &self->expected_tag))
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "%s: invalid \"tag\" option for fsreplace1 channel", self->path);
      goto out;
    }

  actual_tag = cockpit_get_file_tag (self->path);
  if (self->expected_tag && g_strcmp0 (self->expected_tag, actual_tag))
    {
      cockpit_channel_close (channel, "change-conflict");
      goto out;
    }

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
    close_with_errno (self, "couldn't open unique file", errno);
  else
    cockpit_channel_ready (channel, NULL);

out:
  g_free (actual_tag);
}

static void
cockpit_fsreplace_finalize (GObject *object)
{
  CockpitFsreplace *self = COCKPIT_FSREPLACE (object);

  g_free (self->tmp_path);

  G_OBJECT_CLASS (cockpit_fsreplace_parent_class)->finalize (object);
}

static void
cockpit_fsreplace_class_init (CockpitFsreplaceClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->finalize = cockpit_fsreplace_finalize;

  channel_class->prepare = cockpit_fsreplace_prepare;
  channel_class->control = cockpit_fsreplace_control;
  channel_class->recv = cockpit_fsreplace_recv;
  channel_class->close = cockpit_fsreplace_close;
}

/**
 * cockpit_fsreplace_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @path: the path name of the file to write
 * @tag: the expected tag, or NULL
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitFsreplace is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_fsreplace_open (CockpitTransport *transport,
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
  json_object_set_string_member (options, "payload", "fsreplace1");

  channel = g_object_new (COCKPIT_TYPE_FSREPLACE,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
