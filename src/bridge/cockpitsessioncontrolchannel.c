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

#include "cockpitsessioncontrolchannel.h"
#include "sessioncontroller.h"

#include <stdio.h>

/**
 * CockpitSessionControlChannel:
 *
 * A #CockpitChannel that never sends messages and ignores
 * all messages it receives.
 *
 * The payload type for this channel is 'session-control'.
 */

#define COCKPIT_SESSION_CONTROL_CHANNEL(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SESSION_CONTROL_CHANNEL, CockpitSessionControlChannel))

typedef struct {
  CockpitChannel parent;
} CockpitSessionControlChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitSessionControlChannelClass;

G_DEFINE_TYPE (CockpitSessionControlChannel, cockpit_session_control_channel, COCKPIT_TYPE_CHANNEL);

static void
cockpit_session_control_channel_recv (CockpitChannel *channel,
                                      GBytes *message)
{
}

static gboolean
cockpit_session_control_channel_control (CockpitChannel *channel,
                              const gchar *command,
                              JsonObject *options)
{
  SessionController *session_controller;

  g_debug ("RECEIVED SESSION-CONTROL %s", command);

  if (g_str_equal (command, "done"))
    {
      g_debug ("received session-control channel done");
      cockpit_channel_control (channel, command, options);
      return TRUE;
    }
  else if (g_str_equal (command, "active"))
    {
      g_debug ("received session-control channel active - resetting timeout");

      /* Reset the session timeout when activity is detected */
      session_controller = session_controller_get_instance ();
      if (session_controller)
        {
          session_controller_reset_timeout (session_controller);
        }

      return TRUE;
    }

  return FALSE;
}

static void
cockpit_session_control_channel_init (CockpitSessionControlChannel *self)
{

}

static void
cockpit_session_control_channel_prepare (CockpitChannel *channel)
{
  SessionController *session_controller;
  const gchar *channel_id;
  gint timeout;

  COCKPIT_CHANNEL_CLASS (cockpit_session_control_channel_parent_class)->prepare (channel);

  /* Register this channel with the session controller */
  session_controller = session_controller_get_instance ();
  if (session_controller)
    {
      channel_id = cockpit_channel_get_id (channel);
      session_controller_register_channel (session_controller, channel_id);

      /* Send ready control message with timeout value */
      timeout = session_controller_get_timeout (session_controller);

      JsonObject *ready_options = json_object_new ();
      json_object_set_int_member (ready_options, "timeout", timeout);
      cockpit_channel_ready (channel, ready_options);
      json_object_unref (ready_options);

      g_debug ("Sent ready control message with timeout: %d seconds", timeout);
    }
  else
    {
      cockpit_channel_ready (channel, NULL);
    }
}

static void
cockpit_session_control_channel_closed (CockpitChannel *channel,
                                         const gchar *problem)
{
  SessionController *session_controller;
  const gchar *channel_id;

  /* Unregister this channel from the session controller */
  session_controller = session_controller_get_instance ();
  if (session_controller)
    {
      channel_id = cockpit_channel_get_id (channel);
      session_controller_unregister_channel (session_controller, channel_id);
    }
}

static void
cockpit_session_control_channel_class_init (CockpitSessionControlChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  channel_class->prepare = cockpit_session_control_channel_prepare;
  channel_class->control = cockpit_session_control_channel_control;
  channel_class->recv = cockpit_session_control_channel_recv;
  channel_class->closed = cockpit_session_control_channel_closed;
}
