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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitinteracttransport.h"

#include "common/cockpitpipe.h"

#include <string.h>

/**
 * CockpitInteractTransport:
 *
 * A #CockpitTransport implementation that shuttles data over a
 * #CockpitPipe connected to stdio and handles framing in a way
 * that it's more usable for debugging channels.
 */

struct _CockpitInteractTransport {
  CockpitTransport parent_instance;
  gchar *name;
  gchar *delimiter;
  gsize delimiter_len;
  gboolean colored;
  CockpitPipe *pipe;
  gulong read_sig;
  gulong close_sig;
};

typedef struct {
  CockpitTransportClass parent_class;
} CockpitInteractTransportClass;

enum {
    PROP_0,
    PROP_NAME,
    PROP_PIPE,
    PROP_BOUNDARY,
    PROP_COLOR
};

G_DEFINE_TYPE (CockpitInteractTransport, cockpit_interact_transport, COCKPIT_TYPE_TRANSPORT);

static void
cockpit_interact_transport_init (CockpitInteractTransport *self)
{

}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (user_data);

  for (;;)
    {
      guint8 *pos = NULL;

      if (input->len > 0)
        pos = (guint8 *)g_strstr_len ((gchar *)input->data, input->len, self->delimiter);
      if (!pos)
        {
          if (!end_of_data)
            g_debug ("%s: want more data", self->name);
          break;
        }

      guint32 size = pos - input->data;
      g_autoptr(GBytes) message = cockpit_pipe_consume (input, 0, size, self->delimiter_len);

      g_autofree gchar *channel = NULL;
      g_autoptr(GBytes) payload = cockpit_transport_parse_frame (message, &channel);
      if (payload)
        {
          g_debug ("%s: received a %d byte payload", self->name, (int)size);
          cockpit_transport_emit_recv ((CockpitTransport *)self, channel, payload);
        }
    }

  if (end_of_data)
    cockpit_pipe_close (self->pipe, NULL);
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (user_data);

  g_debug ("%s: closed%s%s", self->name,
           problem ? ": " : "", problem ? problem : "");

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), problem);
}

static void
cockpit_interact_transport_constructed (GObject *object)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (object);

  G_OBJECT_CLASS (cockpit_interact_transport_parent_class)->constructed (object);

  g_return_if_fail (self->pipe != NULL);
  g_object_get (self->pipe, "name", &self->name, NULL);
  self->read_sig = g_signal_connect (self->pipe, "read", G_CALLBACK (on_pipe_read), self);
  self->close_sig = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);

  self->delimiter_len = strlen (self->delimiter);
}

static void
cockpit_interact_transport_get_property (GObject *object,
                                         guint prop_id,
                                         GValue *value,
                                         GParamSpec *pspec)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (object);

  switch (prop_id)
    {
    case PROP_NAME:
      g_value_set_string (value, self->name);
      break;
    case PROP_PIPE:
      g_value_set_object (value, self->pipe);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_interact_transport_set_property (GObject *object,
                                         guint prop_id,
                                         const GValue *value,
                                         GParamSpec *pspec)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (object);

  switch (prop_id)
    {
    case PROP_PIPE:
      self->pipe = g_value_dup_object (value);
      break;
    case PROP_BOUNDARY:
      self->delimiter = g_strdup_printf ("\n%s\n", g_value_get_string (value));
      self->delimiter_len = strlen (self->delimiter);
      break;
    case PROP_COLOR:
      self->colored = g_value_get_boolean (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_interact_transport_finalize (GObject *object)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (object);

  g_signal_handler_disconnect (self->pipe, self->read_sig);
  g_signal_handler_disconnect (self->pipe, self->close_sig);

  g_free (self->name);
  g_free (self->delimiter);
  g_clear_object (&self->pipe);

  G_OBJECT_CLASS (cockpit_interact_transport_parent_class)->finalize (object);
}

static void
cockpit_interact_transport_send (CockpitTransport *transport,
                                 const gchar *channel_id,
                                 GBytes *payload)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (transport);
  GBytes *prefix;
  GBytes *suffix;
  GBytes *color;
  gchar *prefix_str;

  if (self->colored)
    {
      color = g_bytes_new_static ("\x1b[1m", 4);
      cockpit_pipe_write (self->pipe, color);
      g_bytes_unref (color);
    }

  prefix_str = g_strdup_printf ("%s\n", channel_id ? channel_id : "");
  prefix = g_bytes_new_take (prefix_str, strlen (prefix_str));
  cockpit_pipe_write (self->pipe, prefix);
  g_bytes_unref (prefix);

  cockpit_pipe_write (self->pipe, payload);

  suffix = g_bytes_new (self->delimiter, self->delimiter_len);
  cockpit_pipe_write (self->pipe, suffix);
  g_bytes_unref (suffix);

  if (self->colored)
    {
      color = g_bytes_new_static ("\x1b[0m", 4);
      cockpit_pipe_write (self->pipe, color);
      g_bytes_unref (color);
    }

  g_debug ("%s: queued %d byte payload", self->name, (int)g_bytes_get_size (payload));
}

static void
cockpit_interact_transport_close (CockpitTransport *transport,
                                  const gchar *problem)
{
  CockpitInteractTransport *self = COCKPIT_INTERACT_TRANSPORT (transport);
  cockpit_pipe_close (self->pipe, problem);
}

static void
cockpit_interact_transport_class_init (CockpitInteractTransportClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);

  transport_class->send = cockpit_interact_transport_send;
  transport_class->close = cockpit_interact_transport_close;

  gobject_class->constructed = cockpit_interact_transport_constructed;
  gobject_class->get_property = cockpit_interact_transport_get_property;
  gobject_class->set_property = cockpit_interact_transport_set_property;
  gobject_class->finalize = cockpit_interact_transport_finalize;

  g_object_class_override_property (gobject_class, PROP_NAME, "name");

  g_object_class_install_property (gobject_class, PROP_PIPE,
              g_param_spec_object ("pipe", NULL, NULL, COCKPIT_TYPE_PIPE,
                                   G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_BOUNDARY,
              g_param_spec_string ("boundary", NULL, NULL, "---",
                                   G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_COLOR,
              g_param_spec_boolean ("color", NULL, NULL, FALSE,
                                    G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

CockpitTransport *
cockpit_interact_transport_new (gint in_fd,
                                gint out_fd,
                                const gchar *boundary)
{
  CockpitTransport *transport;
  CockpitPipe *pipe;

  pipe = cockpit_pipe_new ("interact", in_fd, out_fd);
  transport = g_object_new (COCKPIT_TYPE_INTERACT_TRANSPORT,
                            "pipe", pipe,
                            "boundary", boundary,
                            "color", (gboolean)isatty (out_fd),
                            NULL);
  g_object_unref (pipe);

  return transport;
}

