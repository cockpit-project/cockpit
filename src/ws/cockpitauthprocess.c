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

/**
 * CockpitAuthProcess:
 *
 * Spawns a command a communicates with it over a specific
 * socket pair until authentication fails or is successful.
 * If successful, the process can then be claimed as a
 * #CockpitPipe and used in a #CockpitTransport
 */

#include "config.h"

#include "cockpitauthprocess.h"
#include "cockpitsshagent.h"

#include "common/cockpiterror.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"
#include "common/cockpitunixfd.h"

#include <stdlib.h>
#include <errno.h>
#include <string.h>
#include <sys/socket.h>

/* The amount of time auth pipe will stay open */
guint default_timeout = 60;

typedef struct {
  guint wanted_fd_number;
  gint auth_fd;
  gint agent_fd;
} ChildFds;

struct  _CockpitAuthProcess {
  GObject parent_instance;

  gboolean pipe_claimed;

  guint max_idle;
  guint max_wait_pipe;

  guint response_timeout;

  CockpitPipe *pipe;

  guint sig_pipe_read;
  guint sig_pipe_close;

  gboolean closed;
  gboolean pipe_closed;

  gchar *conversation;
  gchar *logname;
  gchar *name;

  ChildFds child_data;

  gboolean send_signal;

  gint process_in;
  gint process_out;
  GPid process_pid;
};


struct _CockpitAuthProcessClass {
  GObjectClass parent_class;
};

G_DEFINE_TYPE (CockpitAuthProcess, cockpit_auth_process, G_TYPE_OBJECT);

enum
{
  PROP_0,
  PROP_IDLE_TIMEOUT,
  PROP_PIPE_TIMEOUT,
  PROP_PROCESS_AUTH_FD,
  PROP_CONVERSATION,
  PROP_LOGNAME,
  PROP_NAME,
};

enum
{
  MESSAGE,
  CLOSED,
  NUM_SIGNALS,
};

static guint signals[NUM_SIGNALS];

static void
close_auth_pipe (CockpitAuthProcess *self,
                 const gchar *problem)
{
  if (self->closed)
    return;

  self->closed = TRUE;

  if (self->response_timeout)
    g_source_remove (self->response_timeout);
  self->response_timeout = 0;

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

static void
cockpit_auth_process_dispose (GObject *object)
{
  CockpitAuthProcess *self = COCKPIT_AUTH_PROCESS (object);

  if (!self->closed)
    close_auth_pipe (self, NULL);

  g_clear_object (&self->pipe);

  if (self->process_in != -1)
    close (self->process_in);
  if (self->process_out != -1)
    close (self->process_out);

  if (self->process_pid != 0)
    cockpit_auth_process_terminate (self);

  G_OBJECT_CLASS (cockpit_auth_process_parent_class)->dispose (object);
}

static void
cockpit_auth_process_finalize (GObject *object)
{
  CockpitAuthProcess *self = COCKPIT_AUTH_PROCESS (object);

  if (self->child_data.auth_fd > -1)
    close (self->child_data.auth_fd);
  self->child_data.auth_fd = -1;

  g_free (self->conversation);
  g_free (self->logname);
  g_free (self->name);
  G_OBJECT_CLASS (cockpit_auth_process_parent_class)->finalize (object);
}

static void
spawn_child_setup (gpointer data)
{
  ChildFds *child_fds = data;
  gint wanted;
  gint large;
  gint small;

  if (child_fds->agent_fd > 0)
    {
      /* Two fds to keep open, close everything bigger than the larger
       * of the two and then everything except smaller upto the larger fd
       */

      large = child_fds->auth_fd > child_fds->agent_fd ? child_fds->auth_fd : child_fds->agent_fd;
      small = child_fds->auth_fd < child_fds->agent_fd ? child_fds->auth_fd : child_fds->agent_fd;

      if (cockpit_unix_fd_close_all (large, large) < 0)
        {
          g_printerr ("couldn't close larger file descriptors: %m");
          _exit (127);
        }

      if (cockpit_unix_fd_close_until (3, small, large) < 0)
        {
          g_printerr ("couldn't close smaller file descriptors: %m");
          _exit (127);
        }
    }
  else
    {
      if (cockpit_unix_fd_close_all (3, child_fds->auth_fd) < 0)
        {
          g_printerr ("couldn't close file descriptors: %m");
          _exit (127);
        }
    }

  /* Dup to the configured fd */
  if (child_fds->auth_fd != child_fds->wanted_fd_number &&
      dup2 (child_fds->auth_fd, child_fds->wanted_fd_number) < 0)
    {
      g_printerr ("couldn't dup file descriptor: %m");
      _exit (127);
    }

  if (child_fds->auth_fd != child_fds->wanted_fd_number)
    close (child_fds->auth_fd);

  if (child_fds->agent_fd > 0)
    {
      /* Dup to the wanted fd + 1 */
      wanted = child_fds->wanted_fd_number + 1;
      if (dup2 (child_fds->agent_fd, wanted) < 0)
        {
          g_printerr ("couldn't dup agent file descriptor: %m");
          _exit (127);
        }

      if (child_fds->agent_fd != wanted)
        close (child_fds->agent_fd);
    }
}

static gboolean
on_timeout (gpointer user_data)
{
  CockpitAuthProcess *self = user_data;
  if (!self->pipe_closed)
      cockpit_pipe_close (self->pipe, "timeout");

  return FALSE;
}

static void
expect_response (CockpitAuthProcess *self)
{
  if (self->response_timeout)
    g_source_remove (self->response_timeout);

  self->response_timeout = g_timeout_add_seconds (self->max_wait_pipe,
                                                  on_timeout, self);
  self->send_signal = TRUE;
}

static void
report_message (CockpitAuthProcess *self,
                GBytes *data)
{
  if (!self->send_signal)
    {
      g_debug ("%s: Dropping auth message, not expecting response", self->logname);
      return;
    }

  g_object_ref (self);
  g_debug ("%s: reporting message", self->logname);
  self->send_signal = FALSE;

  g_signal_emit (self, signals[MESSAGE], 0, data);

  if (self->response_timeout)
    g_source_remove (self->response_timeout);
  self->response_timeout = 0;

  if (!self->pipe_closed && !self->closed)
    {
      self->response_timeout = g_timeout_add_seconds (self->max_idle,
                                                      on_timeout, self);
    }
  g_object_unref (self);
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitAuthProcess *self = user_data;
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
  CockpitAuthProcess *self = user_data;
  GByteArray *buf = NULL;
  GBytes *message = NULL;
  GError *error = NULL;

  if (self->pipe_closed)
    return;

  g_object_ref (pipe);
  g_object_ref (self);

  self->pipe_closed = TRUE;

  if (self->response_timeout)
    g_source_remove (self->response_timeout);
  self->response_timeout = 0;

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
  else if (self->send_signal && !buf->len)
    {
      g_set_error (&error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", "Authentication failed: no results");
    }

  if (buf->len > 0)
    {
      message = cockpit_pipe_consume (buf, 0, buf->len, 0);
      report_message (self, message);
      g_bytes_unref (message);
    }

  g_signal_emit (self, signals[CLOSED], 0, error, problem);

  if (error)
    g_error_free (error);

  close_auth_pipe (self, NULL);

  g_object_unref (pipe);
  g_object_unref (self);
}

static void
cockpit_auth_process_init (CockpitAuthProcess *self)
{
  self->max_idle = default_timeout;
  self->max_wait_pipe = default_timeout;
  self->send_signal = FALSE;
  self->conversation = NULL;
}

static void
cockpit_auth_process_constructed (GObject *object)
{
  int pair[2];

  CockpitAuthProcess *self = COCKPIT_AUTH_PROCESS (object);

  G_OBJECT_CLASS (cockpit_auth_process_parent_class)->constructed (object);

  if (socketpair (AF_UNIX, SOCK_SEQPACKET, 0, pair) < 0)
    {
      if (errno != EMFILE && errno != ENFILE)
        {
          g_critical ("%s: Couldn't create socket pair: %s",
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

  self->child_data.auth_fd = pair[0];
  self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                             "in-fd", pair[1],
                             "out-fd", pair[1],
                             "name", self->logname,
                             "seq-packet", TRUE,
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
cockpit_auth_process_set_property (GObject *object,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  CockpitAuthProcess *self = COCKPIT_AUTH_PROCESS (object);
  switch (prop_id)
  {
  case PROP_IDLE_TIMEOUT:
    self->max_idle = g_value_get_uint (value);
    break;
  case PROP_PIPE_TIMEOUT:
    self->max_wait_pipe = g_value_get_uint (value);
    break;
  case PROP_PROCESS_AUTH_FD:
    self->child_data.wanted_fd_number = g_value_get_uint (value);
    break;
  case PROP_CONVERSATION:
    self->conversation = g_value_dup_string (value);
    break;
  case PROP_LOGNAME:
    self->logname = g_value_dup_string (value);
    break;
  case PROP_NAME:
    self->name = g_value_dup_string (value);
    break;
  default:
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
    break;
  }
}

static void
cockpit_auth_process_class_init (CockpitAuthProcessClass *klass)
{
  GObjectClass *gobject_class;
  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = cockpit_auth_process_finalize;
  gobject_class->dispose = cockpit_auth_process_dispose;
  gobject_class->constructed = cockpit_auth_process_constructed;
  gobject_class->set_property = cockpit_auth_process_set_property;

  g_object_class_install_property (gobject_class, PROP_PROCESS_AUTH_FD,
                                   g_param_spec_uint ("wanted-auth-fd",
                                                      NULL,
                                                      NULL,
                                                      0,
                                                      900,
                                                      3,
                                                      G_PARAM_WRITABLE |
                                                      G_PARAM_CONSTRUCT_ONLY |
                                                      G_PARAM_STATIC_STRINGS));

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

  g_object_class_install_property (gobject_class, PROP_CONVERSATION,
                                   g_param_spec_string ("conversation",
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

  g_object_class_install_property (gobject_class, PROP_NAME,
                                   g_param_spec_string ("name",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));


  signals[CLOSED] = g_signal_new ("close", COCKPIT_TYPE_AUTH_PROCESS, G_SIGNAL_RUN_FIRST,
                                  0, NULL, NULL, g_cclosure_marshal_generic,
                                  G_TYPE_NONE, 2, G_TYPE_ERROR, G_TYPE_STRING);

  signals[MESSAGE] = g_signal_new ("message", COCKPIT_TYPE_AUTH_PROCESS, G_SIGNAL_RUN_FIRST,
                                   0, NULL, NULL, g_cclosure_marshal_generic,
                                   G_TYPE_NONE, 1, G_TYPE_BYTES);

}

void
cockpit_auth_process_terminate (CockpitAuthProcess *self)
{
  if (self->process_pid != 0)
    {
      g_child_watch_add (self->process_pid, (GChildWatchFunc)g_spawn_close_pid, NULL);
      kill (self->process_pid, SIGTERM);
    }
  self->process_pid = 0;
}

CockpitPipe *
cockpit_auth_process_claim_as_pipe (CockpitAuthProcess *self)
{
  CockpitPipe *pipe = NULL;

  g_return_val_if_fail (self->pipe_claimed == FALSE, NULL);
  self->pipe_claimed = TRUE;
  pipe = g_object_new (COCKPIT_TYPE_PIPE,
                       "name", self->name,
                       "pid", self->process_pid,
                       "in-fd", self->process_out,
                       "out-fd", self->process_in,
                       NULL);
  self->process_pid = 0;
  self->process_out = -1;
  self->process_in = -1;

  return pipe;
}

JsonObject *
cockpit_auth_process_parse_result (CockpitAuthProcess *self,
                                   gchar *response_data,
                                   GError **error)
{
  JsonObject *results = NULL;
  GError *json_error = NULL;

  g_debug ("%s says: %s", self->logname, response_data);

  if (response_data)
    {
      results = cockpit_json_parse_object (response_data,
                                           strlen (response_data),
                                           &json_error);
    }

  if (g_error_matches (json_error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_DATA))
    {
      g_message ("%s: got non-utf8 user name", self->logname);
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Login user name is not UTF8 encoded");
      g_error_free (json_error);
    }
  else if (!results)
    {
      g_warning ("%s: couldn't parse auth output: %s",
                 self->logname,
                 json_error ? json_error->message : NULL);
      g_error_free (json_error);
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Authentication failed: no results");
    }

  return results;
}

const gchar *
cockpit_auth_process_get_authenticated_user (CockpitAuthProcess *self,
                                             JsonObject *results,
                                             JsonObject **prompt_data,
                                             GError **error)
{
  const gchar *user;
  const gchar *error_str;
  const gchar *prompt;
  const gchar *message;

  if (!results ||
      !cockpit_json_get_string (results, "error", NULL, &error_str) ||
      !cockpit_json_get_string (results, "message", NULL, &message) ||
      !cockpit_json_get_string (results, "prompt", NULL, &prompt))
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Authentication failed: invalid results");
    }
  else
    {
      if (prompt && prompt_data)
        {
          *prompt_data = json_object_ref (results);
          g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                       "X-Conversation needed");
        }
      else if (!error_str)
        {
          if (!cockpit_json_get_string (results, "user", NULL, &user) || !user)
            {
              g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                           "Authentication failed: missing user");
            }
          else
            {
              return user;
            }
        }
      else
        {
          if (g_strcmp0 (error_str, "authentication-failed") == 0 ||
                   g_strcmp0 (error_str, "authentication-unavailable") == 0)
            {
              g_debug ("%s: %s %s", self->logname, error_str, message);
              g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                           "Authentication failed");
            }
          else if (g_strcmp0 (error_str, "no-host") == 0 ||
                   g_strcmp0 (error_str, "invalid-hostkey") == 0 ||
                   g_strcmp0 (error_str, "unknown-hostkey") == 0 ||
                   g_strcmp0 (error_str, "unknown-host") == 0)
            {
              g_debug ("%s: %s", self->logname, error_str);
              g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                           "Authentication failed: %s", error_str);
            }
          else if (g_strcmp0 (error_str, "permission-denied") == 0)
            {
              g_debug ("permission denied %s", message);
              g_set_error_literal (error, COCKPIT_ERROR, COCKPIT_ERROR_PERMISSION_DENIED,
                                   message ? message : "Permission denied");
            }
          else
            {
              g_debug ("%s: errored %s: %s", self->logname,
                       error_str, message);
              if (message)
                {
                  g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                               "Authentication failed: %s: %s",
                               error_str,
                               message);
                }
              else
                {
                  g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                               "Authentication failed: %s",
                               error_str);
                }

            }
        }
    }

  return NULL;
}

const gchar *
cockpit_auth_process_get_conversation (CockpitAuthProcess *self)
{
  g_return_val_if_fail (self != NULL, NULL);
  return self->conversation;
}

/* ----------------------------------------------------------------------------
 * Sends any bytes given and expects a response to be written back on the pipe
 * Can not be called again when already waiting for a response.
 */
void
cockpit_auth_process_write_auth_bytes (CockpitAuthProcess *self,
                                       GBytes *auth_bytes)
{
  g_return_if_fail (self->send_signal == FALSE);

  if (self->pipe_closed)
    {
      g_debug ("%s: dropping auth message. Pipe is closed", self->logname);
      return;
    }

  expect_response (self);
  cockpit_pipe_write (self->pipe, auth_bytes);
}

gboolean
cockpit_auth_process_start (CockpitAuthProcess *self,
                            const gchar** command_args,
                            const gchar** env,
                            gint agent_fd,
                            gboolean should_respond,
                            GError **error)
{
  gboolean ret;

  g_debug ("spawning %s", command_args[0]);

  self->child_data.agent_fd = agent_fd;
  ret = g_spawn_async_with_pipes (NULL, (gchar **) command_args, (gchar **) env,
                                  G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                  spawn_child_setup, &self->child_data,
                                  &self->process_pid, &self->process_in,
                                  &self->process_out, NULL, error);

  /* Child process end of pipe */
  close (self->child_data.auth_fd);
  self->child_data.auth_fd = -1;
  self->child_data.agent_fd = -1;
  if (agent_fd > 0)
    close (agent_fd);

  if (ret && should_respond)
    expect_response (self);
  return ret;
}
