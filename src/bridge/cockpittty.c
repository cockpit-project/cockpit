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

#include "cockpittty.h"

#include "common/cockpitpipe.h"
#include "common/cockpitjson.h"
#include "common/cockpitunicode.h"
#include "common/cockpitunixsignal.h"

#include <gio/gunixsocketaddress.h>

#include <sys/param.h>
#include <sys/ioctl.h>
#include <errno.h>
#include <pty.h>
#include <string.h>
#include <termios.h>

/**
 * CockpitTtyChannel:
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

#define COCKPIT_TTY_CHANNEL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_TTY_CHANNEL, CockpitTtyChannel))

typedef struct {
  CockpitChannel parent;
} CockpitTtyChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitTtyChannelClass;

typedef struct {
  /* The main TTY for this process */
  int slave;
  int master;

  /* Channels and list of TTYs */
  GHashTable *channels;
  GHashTable *jobs;
  CockpitTtyChannel *claimed;
} CockpitTtyShared;

static CockpitTtyShared *shared = NULL;

G_DEFINE_TYPE (CockpitTtyChannel, cockpit_tty_channel, COCKPIT_TYPE_CHANNEL);

static void
cockpit_tty_channel_init (CockpitTtyChannel *self)
{

}

static void
cockpit_tty_channel_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitTtyChannel *self = COCKPIT_TTY_CHANNEL (channel);
  GHashTableIter iter;
  struct termios ts;
  gpointer pipe;
  gint fd;

  if (shared)
    {
      /* Automatically claim writing if nobody has */
      if (!shared->claimed)
        shared->claimed = self;

      if (shared->claimed == self)
        {
          g_hash_table_iter_init (&iter, shared->jobs);
          while (g_hash_table_iter_next (&iter, &pipe, NULL))
            {
              /* For input we always want no echo */
              g_object_get (pipe, "in-fd", &fd, NULL);
              tcgetattr (fd, &ts);
              ts.c_lflag &= ~(ECHO | ECHOE | ECHOK | ECHONL);
              tcsetattr (fd, TCSANOW, &ts);
              cockpit_pipe_write (pipe, message);
            }
        }
    }
}

static gboolean
cockpit_tty_channel_control (CockpitChannel *channel,
                             const gchar *command,
                             JsonObject *message)
{
  CockpitTtyChannel *self = COCKPIT_TTY_CHANNEL (channel);
  gboolean ret = TRUE;
  gboolean claim = FALSE;

  /* New set of options for channel */
  if (g_str_equal (command, "options"))
    {
      if (!cockpit_json_get_bool (message, "claim", FALSE, &claim))
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"claim\" option for tty channel");
          goto out;
        }

      if (claim && shared)
        shared->claimed = self;
    }

  /* Channel input is done */
  else if (!g_str_equal (command, "done"))
    {
      ret = FALSE;
    }

out:
  return ret;
}

static void
cockpit_tty_channel_prepare (CockpitChannel *channel)
{
  CockpitTtyChannel *self = COCKPIT_TTY_CHANNEL (channel);

  COCKPIT_CHANNEL_CLASS (cockpit_tty_channel_parent_class)->prepare (channel);

  if (!shared)
    {
      cockpit_channel_fail (channel, "internal-error", "pseudo-terminal is not available");
    }
  else
    {
      cockpit_tty_channel_control (channel, "options", cockpit_channel_get_options (channel));
      g_hash_table_add (shared->channels, self);
      cockpit_channel_ready (channel, NULL);
    }
}

static void
cockpit_tty_channel_close (CockpitChannel *channel,
                           const gchar *problem)
{
  CockpitTtyChannel *self = COCKPIT_TTY_CHANNEL (channel);

  if (shared)
    {
      g_hash_table_remove (shared->channels, self);
      if (shared->claimed == self)
        shared->claimed = NULL;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_tty_channel_parent_class)->close (channel, problem);
}

static void
cockpit_tty_channel_finalize (GObject *object)
{
  CockpitTtyChannel *self = COCKPIT_TTY_CHANNEL (object);

  g_assert (!g_hash_table_lookup (shared->channels, self));
  g_assert (shared->claimed != self);

  G_OBJECT_CLASS (cockpit_tty_channel_parent_class)->finalize (object);
}

static void
cockpit_tty_channel_class_init (CockpitTtyChannelClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->finalize = cockpit_tty_channel_finalize;

  channel_class->prepare = cockpit_tty_channel_prepare;
  channel_class->control = cockpit_tty_channel_control;
  channel_class->recv = cockpit_tty_channel_recv;
  channel_class->close = cockpit_tty_channel_close;
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *data,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitTtyShared *shared = user_data;
  GList *channels, *l;
  GBytes *bytes;

  bytes = cockpit_pipe_consume (data, 0, data->len, 0);
  channels = g_hash_table_get_keys (shared->channels);
  for (l = channels; l != NULL; l = g_list_next (l))
    cockpit_channel_send (l->data, bytes, FALSE);
  g_bytes_unref (bytes);
  g_list_free (channels);
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitTtyShared *shared = user_data;
  GList *channels, *l;

  /* This should not normally happen */
  if (!problem)
    problem = "internal-error";
  g_warning ("pseudo-terminal pipe closed: %s", problem);

  channels = g_hash_table_get_keys (shared->channels);
  for (l = channels; l != NULL; l = g_list_next (l))
    cockpit_channel_fail (l->data, problem, "pseudo-terminal unexpectedly closed");
  g_list_free (channels);
}

static void
close_job_master (gpointer user_data)
{
  CockpitPipe *pipe = user_data;

  g_signal_handlers_disconnect_by_func (pipe, on_pipe_read, shared);
  g_signal_handlers_disconnect_by_func (pipe, on_pipe_close, shared);

  cockpit_pipe_close (pipe, "disconnected");
  g_object_unref (pipe);
}

gboolean
cockpit_tty_active (void)
{
  return shared != NULL;
}

void
cockpit_tty_add_job (int master,
                     const gchar *name)
{
  CockpitPipe *pipe;

  g_return_if_fail (shared != NULL);

  pipe = cockpit_pipe_new (name, master, master);

  g_hash_table_add (shared->jobs, pipe);
  g_signal_connect (pipe, "read", G_CALLBACK (on_pipe_read), shared);
  g_signal_connect (pipe, "close", G_CALLBACK (on_pipe_close), shared);
}

void
cockpit_tty_startup (void)
{
  struct winsize winsz = { 24, 80, 0, 0 };
  int master = -1;
  int slave = -1;
  int fd = -1;
  char *fdname;

  g_assert (shared == NULL);

  if (openpty (&master, &slave, NULL, NULL, &winsz) < 0)
    {
      g_warning ("couldn't open pseudo-terminal: %s", g_strerror (errno));
      goto out;
    }

  setsid ();

  if (ioctl (slave, TIOCSCTTY, (char *)NULL) < 0)
    {
      g_warning ("couldn't set pseudo-terminal as terminal for process: %s", g_strerror (errno));
      goto out;
    }

  fd = dup (master);
  if (fd < 0)
    {
      g_warning ("couldn't dup pseudo-terminal file descriptor: %s", g_strerror (errno));
      goto out;
    }

  fdname = ttyname (slave);
  g_debug ("opened pseudo-terminal: %s", fdname);

  shared = g_new0 (CockpitTtyShared, 1);
  shared->channels = g_hash_table_new (g_direct_hash, g_direct_equal);
  shared->jobs = g_hash_table_new_full (g_direct_hash, g_direct_equal, close_job_master, NULL);
  cockpit_tty_add_job (fd, fdname);

  /* Just for book keeping */
  shared->slave = slave;
  shared->master = master;

  master = -1;
  slave = -1;

out:
  if (master != -1)
    close (master);
  if (slave != -1)
    close (slave);
}

void
cockpit_tty_cleanup (void)
{
  if (shared == NULL)
    return;

  g_hash_table_destroy (shared->channels);
  g_hash_table_destroy (shared->jobs);

#if 0
  /* This would send SIGHUP to the current process */
  if (ioctl (shared->slave, TIOCNOTTY, (char *)NULL) < 0)
    g_warning ("couldn't clear pseudo-terminal as terminal for process: %s", g_strerror (errno));
  close (shared->master);
  close (shared->slave);
#endif

  g_free (shared);
  shared = NULL;
}
