/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitsshagent.h"

#include "common/cockpittransport.h"
#include "common/cockpitpipe.h"
#include "common/cockpitjson.h"

#include <sys/socket.h>
#include <stdlib.h>
#include <errno.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Proxy a ssh agent
 */

#define COCKPIT_SSH_AGENT(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SSH_AGENT, CockpitSshAgent))

struct  _CockpitSshAgent {
  GObject parent_instance;
  CockpitTransport *transport;

  gchar *channel_id;
  gchar *logname;

  CockpitPipe *pipe;

  int ssh_fd;

  int sig_closed;
  int sig_recv;
  int sig_control;
  int sig_pipe_close;
  int sig_pipe_read;

  int status;

  gboolean open;
  gboolean transport_closed;
  gboolean pipe_closed;
  gboolean channel_closed;
  gboolean fd_claimed;
};


struct _CockpitSshAgentClass {
  GObjectClass parent_class;
};

G_DEFINE_TYPE (CockpitSshAgent, cockpit_ssh_agent, G_TYPE_OBJECT);

enum
{
  PROP_0,
  PROP_TRANSPORT,
  PROP_LOGNAME,
  PROP_CHANNEL,
};

static void
cockpit_ssh_agent_finalize (GObject *object)
{
  CockpitSshAgent *self = COCKPIT_SSH_AGENT (object);
  if (self->open)
    cockpit_ssh_agent_close (self);

  if (self->transport)
    g_object_unref (self->transport);

  if (self->ssh_fd && !self->fd_claimed)
    close (self->ssh_fd);

  g_free (self->logname);
  G_OBJECT_CLASS (cockpit_ssh_agent_parent_class)->finalize (object);
}

static void
on_agent_transport_closed (CockpitTransport *transport,
                           const gchar *problem,
                           gpointer user_data)
{
  CockpitSshAgent *agent = user_data;
  g_debug ("%s: agent transport closed", agent->logname);
  agent->transport_closed = TRUE;
  cockpit_ssh_agent_close (agent);
}

static gboolean
on_agent_transport_control (CockpitTransport *transport,
                            const gchar *command,
                            const gchar *channel,
                            JsonObject *options,
                            GBytes *payload,
                            gpointer user_data)
{
  CockpitSshAgent *agent = user_data;
  if (g_strcmp0 (channel, agent->channel_id) == 0 &&
      g_strcmp0 (command, "close") == 0)
    {
      g_debug ("%s: agent channel closed", agent->logname);
      agent->channel_closed = TRUE;
      cockpit_ssh_agent_close (agent);
      return TRUE;
    }
  return FALSE;
}

static gboolean
on_agent_transport_recv (CockpitTransport *transport,
                         const gchar *channel,
                         GBytes *payload,
                         gpointer user_data)
{
  CockpitSshAgent *agent = user_data;
  if (g_strcmp0 (channel, agent->channel_id) == 0)
    {
      if (!agent->pipe_closed)
        cockpit_pipe_write (agent->pipe, payload);
      return TRUE;
    }
  return FALSE;
}

static void
on_agent_pipe_read (CockpitPipe *pipe,
                    GByteArray *data,
                    gboolean end_of_data,
                    gpointer user_data)
{
  CockpitSshAgent *agent = user_data;
  if (!agent->transport_closed)
    {
      GBytes *message = NULL;
      message = cockpit_pipe_consume (data, 0, data->len, 0);
      cockpit_transport_send (agent->transport,
                              agent->channel_id,
                              message);
      g_bytes_unref (message);
    }
}

static void
on_agent_pipe_close (CockpitPipe *pipe,
                     const gchar *problem,
                     gpointer user_data)
{
  CockpitSshAgent *agent = user_data;
  agent->pipe_closed = TRUE;
  g_debug ("%s: agent pipe closed", agent->logname);
  cockpit_ssh_agent_close (agent);
}

static void
cockpit_ssh_agent_init (CockpitSshAgent *self)
{
  self->transport = NULL;
  self->logname = NULL;
  self->channel_id = NULL;
  self->pipe = NULL;
}

static void
cockpit_ssh_agent_constructed (GObject *object)
{
  int pair[2];

  CockpitSshAgent *self = COCKPIT_SSH_AGENT (object);

  G_OBJECT_CLASS (cockpit_ssh_agent_parent_class)->constructed (object);

  JsonObject *options = NULL;
  GBytes *message = NULL;

  if (socketpair (AF_UNIX, SOCK_STREAM, 0, pair) < 0)
    {
      g_error ("Couldn't create socket pair: %s",
               g_strerror (errno));
      goto out;
    }

  g_debug ("%s: setting up agent pipe %d %d", self->logname, pair[0], pair[1]);

  self->ssh_fd = pair[0];
  self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                             "in-fd", pair[1],
                             "out-fd", pair[1],
                             "name", "agent-proxy",
                             NULL);
  self->open = TRUE;

  self->sig_recv = g_signal_connect (self->transport,
                                     "recv",
                                     G_CALLBACK (on_agent_transport_recv),
                                      self);
  self->sig_closed = g_signal_connect (self->transport,
                                       "closed",
                                       G_CALLBACK (on_agent_transport_closed),
                                        self);
  self->sig_control = g_signal_connect (self->transport,
                                        "control",
                                        G_CALLBACK (on_agent_transport_control),
                                        self);

  options = json_object_new ();
  json_object_set_string_member (options, "channel", self->channel_id);
  json_object_set_string_member (options, "command", "open");
  json_object_set_string_member (options, "binary", "raw");
  json_object_set_string_member (options, "payload", "stream");
  json_object_set_string_member (options, "internal", "ssh-agent");
  message = cockpit_json_write_bytes (options);
  cockpit_transport_send (self->transport,
                          NULL,
                          message);

  self->sig_pipe_read = g_signal_connect (self->pipe,
                                           "read",
                                           G_CALLBACK (on_agent_pipe_read),
                                           self);
  self->sig_pipe_close = g_signal_connect (self->pipe,
                                            "close",
                                            G_CALLBACK (on_agent_pipe_close),
                                            self);

out:
  if (options)
    json_object_unref (options);
  if (message)
    g_bytes_unref (message);
}


static void
cockpit_ssh_agent_set_property (GObject *object,
                                guint prop_id,
                                const GValue *value,
                                GParamSpec *pspec)
{
  CockpitSshAgent *self = COCKPIT_SSH_AGENT (object);
  switch (prop_id)
  {
  case PROP_TRANSPORT:
    g_assert (self->transport == NULL);
    self->transport = g_value_dup_object (value);
    break;
  case PROP_LOGNAME:
    g_assert (self->logname == NULL);
    self->logname = g_value_dup_string (value);
    break;
  case PROP_CHANNEL:
    g_assert (self->channel_id == NULL);
    self->channel_id = g_value_dup_string (value);
    break;
  default:
    G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
    break;
  }
}

static void
cockpit_ssh_agent_class_init (CockpitSshAgentClass *klass)
{
  GObjectClass *gobject_class;
  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = cockpit_ssh_agent_finalize;
  gobject_class->constructed = cockpit_ssh_agent_constructed;
  gobject_class->set_property = cockpit_ssh_agent_set_property;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
                                   g_param_spec_object ("transport",
                                                        NULL,
                                                        NULL,
                                                        COCKPIT_TYPE_TRANSPORT,
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

  g_object_class_install_property (gobject_class, PROP_CHANNEL,
                                   g_param_spec_string ("channel",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

CockpitSshAgent *
cockpit_ssh_agent_new (CockpitTransport *transport,
                       const gchar *logname,
                       const gchar *channel_id)
{
  g_return_val_if_fail (logname != NULL, NULL);
  g_return_val_if_fail (transport != NULL, NULL);
  g_return_val_if_fail (channel_id != NULL, NULL);

  return g_object_new (COCKPIT_TYPE_SSH_AGENT,
                       "transport", transport,
                       "logname", logname,
                       "channel", channel_id,
                       NULL);
}

void
cockpit_ssh_agent_close (CockpitSshAgent *agent)
{
  /* is agent open? */
  if (!agent->open)
    return;

  g_debug ("%s: close agent", agent->logname);
  agent->open = FALSE;

  if (agent->sig_pipe_close > 0)
    g_signal_handler_disconnect (agent->pipe, agent->sig_pipe_close);
  agent->sig_pipe_close = 0;

  if (agent->sig_pipe_read > 0)
    g_signal_handler_disconnect (agent->pipe, agent->sig_pipe_read);
  agent->sig_pipe_read = 0;

  if (!agent->pipe_closed)
    {
      agent->pipe_closed = TRUE;
      cockpit_pipe_close (agent->pipe, NULL);
    }
  if (agent->sig_closed > 0)
    g_signal_handler_disconnect (agent->transport, agent->sig_closed);
  agent->sig_closed = 0;

  if (agent->sig_recv > 0)
    g_signal_handler_disconnect (agent->transport, agent->sig_recv);
  agent->sig_recv = 0;

  if (agent->sig_control > 0)
    g_signal_handler_disconnect (agent->transport, agent->sig_control);
  agent->sig_control = 0;

  if (!agent->transport_closed && !agent->channel_closed)
    {
      JsonObject *options = NULL;
      GBytes *message = NULL;

      agent->transport_closed = TRUE;
      agent->channel_closed = TRUE;
      options = json_object_new ();
      json_object_set_string_member (options, "channel", agent->channel_id);
      json_object_set_string_member (options, "command", "close");
      message = cockpit_json_write_bytes (options);
      cockpit_transport_send (agent->transport,
                              NULL,
                              message);
      json_object_unref (options);
      g_bytes_unref (message);
    }

  g_object_unref (agent->pipe);
  agent->pipe = NULL;

  g_free (agent->channel_id);
  agent->channel_id = NULL;
}

int
cockpit_ssh_agent_claim_fd (CockpitSshAgent *self)
{
  int fd;

  g_return_val_if_fail (self->fd_claimed == FALSE, -1);
  self->fd_claimed = TRUE;
  fd = self->ssh_fd;
  self->ssh_fd = -1;
  return fd;
}
