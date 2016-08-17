/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "cockpitauthpipe.h"

#include "common/cockpitpipe.h"
#include "common/cockpiterror.h"

#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <sys/socket.h>

/* The amount of time a auth pipe will stay open */
guint cockpit_ws_auth_pipe_timeout = 60;

/* ----------------------------------------------------------------------------
 * A Pipe for passing auth messages.
 * Sends any bytes given and expects a
 * response to be written back on the pipe
 */

struct  _CockpitAuthPipe {
  GObject parent_instance;
  int fd;
  gboolean fd_claimed;

  guint max_idle;
  guint max_wait_pipe;

  guint timeout;

  CockpitPipe *pipe;

  guint sig_pipe_read;
  guint sig_pipe_close;

  gboolean closed;
  gboolean pipe_closed;

  gchar *id;
  gchar *logname;
  gboolean send_signal;
};


struct _CockpitAuthPipeClass {
  GObjectClass parent_class;
};

G_DEFINE_TYPE (CockpitAuthPipe, cockpit_auth_pipe, G_TYPE_OBJECT);

enum
{
  PROP_0,
  PROP_IDLE_TIMEOUT,
  PROP_PIPE_TIMEOUT,
  PROP_ID,
  PROP_LOGNAME,
};

enum
{
  MESSAGE,
  CLOSED,
  NUM_SIGNALS,
};

static guint signals[NUM_SIGNALS];

static void
cockpit_auth_pipe_dispose (GObject *object)
{
  CockpitAuthPipe *self = COCKPIT_AUTH_PIPE (object);

  if (!self->closed)
    cockpit_auth_pipe_close (self, NULL);

  g_clear_object (&self->pipe);

  G_OBJECT_CLASS (cockpit_auth_pipe_parent_class)->dispose (object);

}

static void
cockpit_auth_pipe_finalize (GObject *object)
{
  CockpitAuthPipe *self = COCKPIT_AUTH_PIPE (object);

  if (self->fd > 0 && !self->fd_claimed)
    close (self->fd);
  self->fd = 0;

  g_free (self->id);
  g_free (self->logname);
  G_OBJECT_CLASS (cockpit_auth_pipe_parent_class)->finalize (object);
}

static gboolean
on_timeout (gpointer user_data)
{
  CockpitAuthPipe *self = user_data;
  if (!self->pipe_closed)
      cockpit_pipe_close (self->pipe, "timeout");

  return FALSE;
}

static void
expect_response (CockpitAuthPipe *self)
{
  if (self->timeout)
    g_source_remove (self->timeout);

  self->timeout = g_timeout_add_seconds (self->max_wait_pipe,
                                         on_timeout, self);
  self->send_signal = TRUE;
}

static void
report_message (CockpitAuthPipe *self,
                GBytes *data)
{
  if (!self->send_signal)
    {
      g_debug ("%s: Dropping auth message, not expecting response", self->logname);
      return;
    }

  g_debug ("%s: reporting message", self->logname);
  self->send_signal = FALSE;

  g_signal_emit (self, signals[MESSAGE], 0, data);

  if (self->timeout)
    g_source_remove (self->timeout);
  self->timeout = 0;

  if (!self->pipe_closed)
    {
      self->timeout = g_timeout_add_seconds (self->max_idle,
                                             on_timeout, self);
    }
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitAuthPipe *self = user_data;
  GBytes *message = NULL;

  /* Let close report the result */
  if (end_of_data)
    return;

  /* We expect every read to be a complete message */
  if (input->len > 0)
    {
      message = cockpit_pipe_consume (input, 0, input->len, 0);
      report_message (self, message);
      g_bytes_unref (message);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitAuthPipe *self = user_data;
  GByteArray *buf = NULL;
  GBytes *message = NULL;
  GError *error = NULL;

  if (self->pipe_closed)
    return;

  g_object_ref (pipe);
  g_object_ref (self);

  self->pipe_closed = TRUE;

  if (self->timeout)
    g_source_remove (self->timeout);
  self->timeout = 0;

  buf = cockpit_pipe_get_buffer (pipe);

  if (problem)
      g_warning ("%s: Auth pipe closed: %s", self->logname, problem);
  else
      g_debug ("%s: Auth pipe closed", self->logname);

  if (problem && g_strcmp0 (problem, "timeout") == 0)
    {
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", "Authentication failed: Timeout");
    }
  else if (problem)
    {
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", "Internal error in login process");
    }
  else if (self->send_signal && !message)
    {
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", "Authentication failed: no results");
    }

  if (buf->len)
    {
      message = cockpit_pipe_consume (buf, 0, buf->len, 0);
      report_message (self, message);
      g_bytes_unref (message);
    }

  g_signal_emit (self, signals[CLOSED], 0, error);

  if (error)
    g_error_free (error);

  cockpit_auth_pipe_close (self, NULL);

  g_object_unref (pipe);
  g_object_unref (self);
}

static void
cockpit_auth_pipe_init (CockpitAuthPipe *self)
{
  self->max_idle = cockpit_ws_auth_pipe_timeout;
  self->max_wait_pipe = cockpit_ws_auth_pipe_timeout;
  self->send_signal = FALSE;
  self->id = NULL;
}

static void
cockpit_auth_pipe_constructed (GObject *object)
{
  int pair[2];

  CockpitAuthPipe *self = COCKPIT_AUTH_PIPE (object);

  G_OBJECT_CLASS (cockpit_auth_pipe_parent_class)->constructed (object);

  if (socketpair (AF_UNIX, SOCK_SEQPACKET, 0, pair) < 0)
    {
      if (errno != EMFILE && errno != ENFILE)
        {
          g_error ("%s: Couldn't create socket pair: %s",
                   self->logname, g_strerror (errno));
        }
      else
        {
          g_warning ("%s: Couldn't create socket pair: %s",
                     self->logname, g_strerror (errno));
        }

      return;
    }

  g_debug ("%s: setting up auth pipe %d %d", self->logname, pair[0], pair[1]);

  self->fd = pair[0];
  self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                             "in-fd", pair[1],
                             "out-fd", pair[1],
                             "name", self->logname,
                             "read-size", MAX_AUTH_BUFFER,
                             NULL);

  self->sig_pipe_read = g_signal_connect (self->pipe,
                                           "read",
                                           G_CALLBACK (on_pipe_read),
                                           self);
  self->sig_pipe_close = g_signal_connect (self->pipe,
                                            "close",
                                            G_CALLBACK (on_pipe_close),
                                            self);
  self->closed = FALSE;
  self->pipe_closed = FALSE;
}

static void
cockpit_auth_pipe_set_property (GObject *object,
                                guint prop_id,
                                const GValue *value,
                                GParamSpec *pspec)
{
  CockpitAuthPipe *self = COCKPIT_AUTH_PIPE (object);
  switch (prop_id)
  {
  case PROP_IDLE_TIMEOUT:
    self->max_idle = g_value_get_uint (value);
    break;
  case PROP_PIPE_TIMEOUT:
    self->max_wait_pipe = g_value_get_uint (value);
    break;
  case PROP_ID:
    self->id = g_value_dup_string (value);
    break;
  case PROP_LOGNAME:
    self->logname = g_strdup_printf ("%s auth pipe", g_value_get_string (value));
    break;
  default:
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
    break;
  }
}

static void
cockpit_auth_pipe_class_init (CockpitAuthPipeClass *klass)
{
  GObjectClass *gobject_class;
  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = cockpit_auth_pipe_finalize;
  gobject_class->dispose = cockpit_auth_pipe_dispose;
  gobject_class->constructed = cockpit_auth_pipe_constructed;
  gobject_class->set_property = cockpit_auth_pipe_set_property;

  g_object_class_install_property (gobject_class, PROP_IDLE_TIMEOUT,
                                   g_param_spec_uint ("idle-timeout",
                                                        NULL,
                                                        NULL,
                                                        0,
                                                        900,
                                                        30,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
  g_object_class_install_property (gobject_class, PROP_PIPE_TIMEOUT,
                                   g_param_spec_uint ("pipe-timeout",
                                                        NULL,
                                                        NULL,
                                                        0,
                                                        900,
                                                        30,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_ID,
                                   g_param_spec_string ("id",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_LOGNAME,
                                   g_param_spec_string ("logname",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  signals[CLOSED] = g_signal_new ("close", COCKPIT_TYPE_AUTH_PIPE, G_SIGNAL_RUN_FIRST,
                                  0, NULL, NULL, g_cclosure_marshal_generic,
                                  G_TYPE_NONE, 1, G_TYPE_ERROR);

  signals[MESSAGE] = g_signal_new ("message", COCKPIT_TYPE_AUTH_PIPE, G_SIGNAL_RUN_FIRST,
                                   0, NULL, NULL, g_cclosure_marshal_generic,
                                   G_TYPE_NONE, 1, G_TYPE_BYTES);

}

void
cockpit_auth_pipe_close (CockpitAuthPipe *self,
                         const gchar *problem)
{
  if (self->closed)
    return;

  self->closed = TRUE;

  if (self->timeout)
    g_source_remove (self->timeout);
  self->timeout = 0;

  if (self->sig_pipe_read > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_pipe_read);
  self->sig_pipe_read = 0;

  if (!self->pipe_closed)
    cockpit_pipe_close (self->pipe, problem);

  if (self->sig_pipe_close > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_pipe_close);
  self->sig_pipe_close = 0;

  g_clear_object (&self->pipe);
}

int
cockpit_auth_pipe_claim_fd (CockpitAuthPipe *self)
{
  int fd;

  g_return_val_if_fail (self->fd_claimed == FALSE, -1);
  self->fd_claimed = TRUE;
  fd = self->fd;
  self->fd = -1;
  return fd;
}

const gchar *
cockpit_auth_pipe_get_id (CockpitAuthPipe *self)
{
  g_return_val_if_fail (self != NULL, NULL);
  return self->id;
}

/* ----------------------------------------------------------------------------
 * Sends any bytes given and expects a
 * response to be written back on the pipe
 *
 * Can not be called again when already waiting
 * for a response.
 */
void
cockpit_auth_pipe_answer (CockpitAuthPipe *auth_pipe,
                          GBytes *auth_data)
{
  unsigned char nb = '\0';
  GBytes *blank = g_bytes_new_static (&nb, 1);

  g_return_if_fail (auth_pipe->send_signal == FALSE);

  if (auth_pipe->pipe_closed)
    {
      g_debug ("%s: dropping auth message. Pipe is closed", auth_pipe->logname);
      return;
    }

  expect_response (auth_pipe);
  if (g_bytes_get_size (auth_data) > 0)
    cockpit_pipe_write (auth_pipe->pipe, auth_data);
  else
    cockpit_pipe_write (auth_pipe->pipe, blank);
  g_bytes_unref (blank);
}

/* ----------------------------------------------------------------------------
 * Tells the pipe to expect a response
 */
void
cockpit_auth_pipe_expect_answer (CockpitAuthPipe *auth_pipe)
{
  if (auth_pipe->send_signal)
      g_critical ("Already waiting for a response. This is a programmer error.");

  expect_response (auth_pipe);
}
