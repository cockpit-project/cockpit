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

#include "cockpitfslist.h"
#include "cockpitfswatch.h"

#include "common/cockpitjson.h"

#include <sys/wait.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>

/**
 * CockpitFslist:
 *
 * A #CockpitChannel that lists and optionally watches a directory.
 *
 * The payload type for this channel is 'fslist1'.
 */

#define COCKPIT_FSLIST(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_FSLIST, CockpitFslist))

typedef struct {
  CockpitChannel parent;
  const gchar *path;
  GFileMonitor *monitor;
  guint sig_changed;
  GCancellable *cancellable;
} CockpitFslist;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitFslistClass;

G_DEFINE_TYPE (CockpitFslist, cockpit_fslist, COCKPIT_TYPE_CHANNEL);

static void
cockpit_fslist_recv (CockpitChannel *channel,
                    GBytes *message)
{
  cockpit_channel_fail (channel, "protocol-error", "Received unexpected message in fslist1 channel");
}

static void
cockpit_fslist_init (CockpitFslist *self)
{
}

static const gchar *
error_to_problem (GError *error)
{
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_PERMISSION_DENIED))
    return "access-denied";
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND))
    return "not-found";
  else if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_NOT_DIRECTORY))
    return "not-found";
  else
    return NULL;
}

static void
on_files_listed (GObject *source_object,
                 GAsyncResult *res,
                 gpointer user_data)
{
  GError *error = NULL;
  JsonObject *options;
  GList *files;

  files = g_file_enumerator_next_files_finish (G_FILE_ENUMERATOR (source_object), res, &error);
  if (error)
    {
      if (!g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
        {
          CockpitFslist *self = COCKPIT_FSLIST (user_data);
          g_message ("%s: couldn't process files %s", COCKPIT_FSLIST(user_data)->path, error->message);
          options = cockpit_channel_close_options (COCKPIT_CHANNEL (self));
          json_object_set_string_member (options, "message", error->message);
          cockpit_channel_close (COCKPIT_CHANNEL (self), "internal-error");
        }
      g_clear_error (&error);
      return;
    }

  CockpitFslist *self = COCKPIT_FSLIST (user_data);

  if (files == NULL)
    {
      g_clear_object (&self->cancellable);
      g_object_unref (source_object);

      cockpit_channel_ready (COCKPIT_CHANNEL (self), NULL);

      if (self->monitor == NULL)
        {
          cockpit_channel_control (COCKPIT_CHANNEL (self), "done", NULL);
          cockpit_channel_close (COCKPIT_CHANNEL (self), NULL);
        }
      return;
    }

  for (GList *l = files; l; l = l->next)
    {
      GFileInfo *info = G_FILE_INFO (l->data);
      JsonObject *msg;
      GBytes *msg_bytes;

      msg = json_object_new ();
      json_object_set_string_member (msg, "event", "present");
      json_object_set_string_member
        (msg, "path", g_file_info_get_attribute_byte_string (info, G_FILE_ATTRIBUTE_STANDARD_NAME));
      json_object_set_string_member
        (msg, "type", cockpit_file_type_to_string (g_file_info_get_file_type (info)));
      msg_bytes = cockpit_json_write_bytes (msg);
      json_object_unref (msg);
      cockpit_channel_send (COCKPIT_CHANNEL(self), msg_bytes, FALSE);
      g_bytes_unref (msg_bytes);
    }

  g_list_free_full (files, g_object_unref);

  g_file_enumerator_next_files_async (G_FILE_ENUMERATOR (source_object),
                                      10,
                                      G_PRIORITY_DEFAULT,
                                      self->cancellable,
                                      on_files_listed,
                                      self);
}

static void
on_enumerator_ready (GObject *source_object,
                     GAsyncResult *res,
                     gpointer user_data)
{
  GError *error = NULL;
  GFileEnumerator *enumerator;
  JsonObject *options;
  const gchar *problem;

  enumerator = g_file_enumerate_children_finish (G_FILE (source_object), res, &error);
  if (enumerator == NULL)
    {
      if (!g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
        {
          CockpitFslist *self = COCKPIT_FSLIST (user_data);
          problem = error_to_problem (error);
          if (problem)
            g_debug ("%s: couldn't list directory: %s", self->path, error->message);
          else
            g_warning ("%s: couldn't list directory: %s", self->path, error->message);
          options = cockpit_channel_close_options (COCKPIT_CHANNEL (self));
          json_object_set_string_member (options, "message", error->message);
          cockpit_channel_close (COCKPIT_CHANNEL (self), problem ? problem : "internal-error");
        }
      g_clear_error (&error);
      return;
    }

  CockpitFslist *self = COCKPIT_FSLIST (user_data);

  g_file_enumerator_next_files_async (enumerator,
                                      10,
                                      G_PRIORITY_DEFAULT,
                                      self->cancellable,
                                      on_files_listed,
                                      self);
}

static void
on_changed (GFileMonitor      *monitor,
            GFile             *file,
            GFile             *other_file,
            GFileMonitorEvent  event_type,
            gpointer           user_data)
{
  CockpitFslist *self = COCKPIT_FSLIST(user_data);
  cockpit_fswatch_emit_event (COCKPIT_CHANNEL(self), file, other_file, event_type);
}

static void
cockpit_fslist_prepare (CockpitChannel *channel)
{
  CockpitFslist *self = COCKPIT_FSLIST (channel);
  JsonObject *options;
  GError *error = NULL;
  GFile *file = NULL;
  gboolean watch;

  COCKPIT_CHANNEL_CLASS (cockpit_fslist_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "path", NULL, &self->path))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"path\" option for fslist1 channel");
      goto out;
    }
  if (self->path == NULL || *(self->path) == 0)
    {
      cockpit_channel_fail (channel, "protocol-error", "missing \"path\" option for fslist1 channel");
      goto out;
    }

  if (!cockpit_json_get_bool (options, "watch", TRUE, &watch))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"watch\" option for fslist1 channel");
      goto out;
    }

  self->cancellable = g_cancellable_new ();

  file = g_file_new_for_path (self->path);

  if (watch)
    {
      self->monitor = g_file_monitor_directory (file, 0, NULL, &error);
      if (self->monitor == NULL)
        {
          cockpit_channel_fail (channel, "internal-error",
                                "%s: couldn't monitor directory: %s", self->path, error->message);
          goto out;
        }

      self->sig_changed = g_signal_connect (self->monitor, "changed", G_CALLBACK (on_changed), self);
    }

  g_file_enumerate_children_async (file,
                                   G_FILE_ATTRIBUTE_STANDARD_NAME "," G_FILE_ATTRIBUTE_STANDARD_TYPE,
                                   G_FILE_QUERY_INFO_NONE,
                                   G_PRIORITY_DEFAULT,
                                   self->cancellable,
                                   on_enumerator_ready,
                                   self);
out:
  g_clear_error (&error);
  if (file)
    g_object_unref (file);
}

static void
cockpit_fslist_dispose (GObject *object)
{
  CockpitFslist *self = COCKPIT_FSLIST (object);

  if (self->cancellable)
    g_cancellable_cancel (self->cancellable);

  if (self->monitor)
    {
      if (self->sig_changed)
        g_signal_handler_disconnect (self->monitor, self->sig_changed);
      self->sig_changed = 0;

      // HACK - It is not generally safe to just unref a GFileMonitor.
      // Some events might be on their way to the main loop from its
      // worker thread and if they arrive after the GFileMonitor has
      // been destroyed, bad things will happen.
      //
      // As a workaround, we cancel the monitor and then spin the main
      // loop a bit until nothing is pending anymore.
      //
      // https://bugzilla.gnome.org/show_bug.cgi?id=740491

      g_file_monitor_cancel (self->monitor);
      for (int tries = 0; tries < 10; tries ++)
        {
          if (!g_main_context_iteration (NULL, FALSE))
            break;
        }
    }

  G_OBJECT_CLASS (cockpit_fslist_parent_class)->dispose (object);
}

static void
cockpit_fslist_finalize (GObject *object)
{
  CockpitFslist *self = COCKPIT_FSLIST (object);

  g_clear_object (&self->cancellable);
  g_clear_object (&self->monitor);

  G_OBJECT_CLASS (cockpit_fslist_parent_class)->finalize (object);
}

static void
cockpit_fslist_class_init (CockpitFslistClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_fslist_dispose;
  gobject_class->finalize = cockpit_fslist_finalize;

  channel_class->prepare = cockpit_fslist_prepare;
  channel_class->recv = cockpit_fslist_recv;
}

/**
 * cockpit_fslist_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @path: the path name of the file to read
 * @watch: boolean, watch the directoy as well?
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitFslist is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_fslist_open (CockpitTransport *transport,
                    const gchar *channel_id,
                    const gchar *path,
                    const gboolean watch)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "path", path);
  json_object_set_string_member (options, "payload", "fslist1");
  json_object_set_boolean_member (options, "watch", watch);

  channel = g_object_new (COCKPIT_TYPE_FSLIST,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
