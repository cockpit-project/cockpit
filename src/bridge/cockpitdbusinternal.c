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

#include "cockpitdbusinternal.h"

#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <errno.h>

typedef struct {
  GIOStream parent;
  gint fd;
  GInputStream *input_stream;
  GOutputStream *output_stream;
} UnixIOStream;

typedef struct _GIOStreamClass UnixIOStreamClass;

GType unix_io_stream_get_type (void);

G_DEFINE_TYPE (UnixIOStream, unix_io_stream, G_TYPE_IO_STREAM)

static void
unix_io_stream_finalize (GObject *object)
{
  UnixIOStream *self = (UnixIOStream *)object;

  /* strictly speaking we should unref these in dispose, but
   * g_io_stream_dispose() wants them to still exist
   */
  g_clear_object (&self->input_stream);
  g_clear_object (&self->output_stream);

  G_OBJECT_CLASS (unix_io_stream_parent_class)->finalize (object);
}

static void
unix_io_stream_init (UnixIOStream *stream)
{
}

static GInputStream *
unix_io_stream_get_input_stream (GIOStream *stream)
{
  UnixIOStream *self = (UnixIOStream *)stream;
  return self->input_stream;
}

static GOutputStream *
unix_io_stream_get_output_stream (GIOStream *stream)
{
  UnixIOStream *self = (UnixIOStream *)stream;
  return self->output_stream;
}

static gboolean
unix_io_stream_close (GIOStream *stream,
                      GCancellable *cancellable,
                      GError **error)
{
  UnixIOStream *self = (UnixIOStream *)stream;
  gboolean ret;

  ret = g_input_stream_close (self->input_stream, cancellable, error);
  if (!g_output_stream_close (self->output_stream, cancellable, ret ? error : NULL))
    ret = FALSE;

  close (self->fd);
  return ret;
}

static void
unix_io_stream_close_async (GIOStream *stream,
                            int io_priority,
                            GCancellable *cancellable,
                            GAsyncReadyCallback callback,
                            gpointer user_data)
{
  GSimpleAsyncResult *res;
  GError *error = NULL;

  res = g_simple_async_result_new (G_OBJECT (stream), callback, user_data,
                                   unix_io_stream_close_async);
  if (!unix_io_stream_close (stream, cancellable, &error))
    g_simple_async_result_take_error (res, error);

  g_simple_async_result_complete_in_idle (res);
  g_object_unref (res);
}

static gboolean
unix_io_stream_close_finish (GIOStream *stream,
                             GAsyncResult *result,
                             GError **error)
{
  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return FALSE;
  return TRUE;
}

static void
unix_io_stream_class_init (UnixIOStreamClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  GIOStreamClass *stream_class = G_IO_STREAM_CLASS (klass);

  gobject_class->finalize = unix_io_stream_finalize;

  stream_class->get_input_stream  = unix_io_stream_get_input_stream;
  stream_class->get_output_stream = unix_io_stream_get_output_stream;
  stream_class->close_fn = unix_io_stream_close;
  stream_class->close_async = unix_io_stream_close_async;
  stream_class->close_finish = unix_io_stream_close_finish;
}

static GIOStream *
unix_io_stream_new (gint fd)
{
  UnixIOStream *self;

  self = g_object_new (unix_io_stream_get_type (), NULL);
  self->input_stream = g_unix_input_stream_new (fd, FALSE);
  self->output_stream = g_unix_output_stream_new (fd, FALSE);
  self->fd = fd;
  return G_IO_STREAM (self);
}

/* ------------------------------------------------------------------------- */

static GDBusConnection *the_server = NULL;
static GDBusConnection *the_client = NULL;
const gchar *the_name = NULL;

GDBusConnection *
cockpit_dbus_internal_client (void)
{
  g_return_val_if_fail (the_client != NULL, NULL);
  return g_object_ref (the_client);
}

const gchar *
cockpit_dbus_internal_name (void)
{
  return the_name;
}

GDBusConnection *
cockpit_dbus_internal_server (void)
{
  g_return_val_if_fail (the_server != NULL, NULL);
  return g_object_ref (the_server);
}

static void
on_complete_get_result (GObject *source,
                        GAsyncResult *result,
                        gpointer user_data)
{
  GAsyncResult **ret = user_data;
  g_assert (*ret == NULL);
  *ret = g_object_ref (result);
}

void
cockpit_dbus_internal_startup (gboolean interact)
{
  GAsyncResult *rclient = NULL;
  GAsyncResult *rserver = NULL;
  GError *error = NULL;
  GIOStream *io;
  gchar *guid;
  int fds[2];

  /*
   * When in interactive mode, we allow poking and prodding our internal
   * DBus interface. Therefore be on the session bus instead of peer-to-peer.
   */
  if (interact)
    {
      the_server = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
      if (the_server)
        {
          the_name = g_dbus_connection_get_unique_name (the_server);
          the_client = g_object_ref (the_server);
          return;
        }
      else
        {
          g_message ("couldn't connect to session bus: %s", error->message);
          g_clear_error (&error);
        }
    }

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, fds) < 0)
    {
      g_warning ("couldn't create loopback socket: %s", g_strerror (errno));
      return;
    }

  io = unix_io_stream_new (fds[0]);
  guid = g_dbus_generate_guid ();
  g_dbus_connection_new (io, guid,
                         G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_SERVER |
                         G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_ALLOW_ANONYMOUS,
                         NULL, NULL, on_complete_get_result, &rserver);
  g_object_unref (io);

  io = unix_io_stream_new (fds[1]);
  g_dbus_connection_new (io, NULL, G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT,
                         NULL, NULL, on_complete_get_result, &rclient);
  g_object_unref (io);

  while (!rserver || !rclient)
    g_main_context_iteration (NULL, TRUE);

  the_server = g_dbus_connection_new_finish (rserver, &error);
  if (the_server == NULL)
    {
      g_warning ("couldn't create internal connection: %s", error->message);
      g_clear_error (&error);
    }

  the_client = g_dbus_connection_new_finish (rclient, &error);
  if (the_client == NULL)
    {
      g_warning ("couldn't create internal connection: %s", error->message);
      g_clear_error (&error);
    }

  g_object_unref (rclient);
  g_object_unref (rserver);
  g_free (guid);
}

void
cockpit_dbus_internal_cleanup (void)
{
  g_clear_object (&the_client);
  g_clear_object (&the_server);
}
