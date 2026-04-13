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

#include <glib.h>
#include <stdio.h>

#include "sessioncontroller.h"

/**
 * SessionController:
 *
 * A GObject class for managing session timeouts.
 * This class follows the singleton pattern.
 */

static SessionController *session_controller_instance = NULL;

typedef enum {
  SESSION_STATE_IDLE,        /* No channels, no timeouts */
  SESSION_STATE_ACTIVE,      /* Channels active, timeout running */
  SESSION_STATE_COUNTDOWN,   /* Sending countdown messages */
  SESSION_STATE_LOGOUT,      /* Logout message sent, waiting for transport close */
  SESSION_STATE_CLOSED       /* Transport closed */
} SessionState;

enum {
  PROP_0,
  PROP_TIMEOUT,
  PROP_TRANSPORT,
  N_PROPS
};

static GParamSpec *properties [N_PROPS];

struct _SessionController
{
  GObject parent_instance;
  gint timeout;
  CockpitTransport *transport;
  GHashTable *channels;

  /* State machine fields */
  SessionState state;
  guint main_timeout_id;     /* Main timeout before countdown */
  guint countdown_timeout_id; /* Countdown timer */
  guint close_timeout_id;    /* Final close timer */
  gint countdown_remaining;  /* Seconds remaining in countdown */
};

G_DEFINE_TYPE (SessionController, session_controller, G_TYPE_OBJECT)

/* Forward declarations */
static void session_controller_dispose (GObject *object);
static void session_controller_start_countdown (SessionController *self);
static void session_controller_send_logout (SessionController *self);
static void session_controller_close_transport (SessionController *self);

static gboolean
session_controller_main_timeout_cb (gpointer user_data)
{
  SessionController *self = SESSION_CONTROLLER (user_data);

  g_debug ("Main session timeout reached, starting countdown");
  self->main_timeout_id = 0;
  session_controller_start_countdown (self);

  return G_SOURCE_REMOVE;
}

static gboolean
session_controller_countdown_timeout_cb (gpointer user_data)
{
  SessionController *self = SESSION_CONTROLLER (user_data);
  gchar countdown_str[16];

  if (self->countdown_remaining > 0)
    {
      /* Send countdown message */
      g_snprintf (countdown_str, sizeof (countdown_str), "%d", self->countdown_remaining);
      session_controller_send_control_to_all (self, "countdown", "remaining", countdown_str, NULL);

      g_debug ("Countdown: %d seconds remaining", self->countdown_remaining);
      self->countdown_remaining--;

      return G_SOURCE_CONTINUE;
    }
  else
    {
      /* Countdown finished, send logout */
      g_debug ("Countdown finished, sending logout");
      self->countdown_timeout_id = 0;
      session_controller_send_logout (self);

      return G_SOURCE_REMOVE;
    }
}

static gboolean
session_controller_close_timeout_cb (gpointer user_data)
{
  SessionController *self = SESSION_CONTROLLER (user_data);

  g_debug ("Close timeout reached, closing transport");
  self->close_timeout_id = 0;
  session_controller_close_transport (self);

  return G_SOURCE_REMOVE;
}

static void
session_controller_get_property (GObject    *object,
                                  guint       prop_id,
                                  GValue     *value,
                                  GParamSpec *pspec)
{
  SessionController *self = SESSION_CONTROLLER (object);

  switch (prop_id)
    {
    case PROP_TIMEOUT:
      g_value_set_int (value, self->timeout);
      break;
    case PROP_TRANSPORT:
      g_value_set_object (value, self->transport);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
    }
}

static void
session_controller_set_property (GObject      *object,
                                  guint         prop_id,
                                  const GValue *value,
                                  GParamSpec   *pspec)
{
  SessionController *self = SESSION_CONTROLLER (object);

  switch (prop_id)
    {
    case PROP_TIMEOUT:
      self->timeout = g_value_get_int (value);
      break;
    case PROP_TRANSPORT:
      g_clear_object (&self->transport);
      self->transport = g_value_dup_object (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
    }
}

static void
session_controller_class_init (SessionControllerClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->get_property = session_controller_get_property;
  object_class->set_property = session_controller_set_property;
  object_class->dispose = session_controller_dispose;

  properties [PROP_TIMEOUT] =
    g_param_spec_int ("timeout",
                      "Timeout",
                      "Session timeout in seconds",
                      0,
                      G_MAXINT,
                      0,
                      G_PARAM_READWRITE |
                      G_PARAM_CONSTRUCT_ONLY |
                      G_PARAM_STATIC_STRINGS);

  properties [PROP_TRANSPORT] =
    g_param_spec_object ("transport",
                         "Transport",
                         "Cockpit transport instance",
                         COCKPIT_TYPE_TRANSPORT,
                         G_PARAM_READWRITE |
                         G_PARAM_CONSTRUCT_ONLY |
                         G_PARAM_STATIC_STRINGS);

  g_object_class_install_properties (object_class, N_PROPS, properties);
}

static void
session_controller_init (SessionController *self)
{
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  self->state = SESSION_STATE_IDLE;
  self->main_timeout_id = 0;
  self->countdown_timeout_id = 0;
  self->close_timeout_id = 0;
  self->countdown_remaining = 0;
}

static void
session_controller_dispose (GObject *object)
{
  SessionController *self = SESSION_CONTROLLER (object);

  /* Clean up any active timers */
  if (self->main_timeout_id > 0)
    {
      g_source_remove (self->main_timeout_id);
      self->main_timeout_id = 0;
    }
  if (self->countdown_timeout_id > 0)
    {
      g_source_remove (self->countdown_timeout_id);
      self->countdown_timeout_id = 0;
    }
  if (self->close_timeout_id > 0)
    {
      g_source_remove (self->close_timeout_id);
      self->close_timeout_id = 0;
    }

  g_clear_object (&self->transport);
  g_clear_pointer (&self->channels, g_hash_table_destroy);

  /* Clear singleton instance if this is it */
  if (session_controller_instance == self)
    session_controller_instance = NULL;

  G_OBJECT_CLASS (session_controller_parent_class)->dispose (object);
}

SessionController *
session_controller_new (gint timeout,
                        CockpitTransport *transport)
{
  if (session_controller_instance != NULL)
    {
      g_warning ("SessionController instance already exists. Returning existing instance.");
      return g_object_ref (session_controller_instance);
    }

  session_controller_instance = g_object_new (SESSION_TYPE_CONTROLLER,
                                              "timeout", timeout,
                                              "transport", transport,
                                              NULL);
  return session_controller_instance;
}

SessionController *
session_controller_get_instance (void)
{
  return session_controller_instance;
}

void
session_controller_set_instance (SessionController *instance)
{
  if (session_controller_instance != NULL && session_controller_instance != instance)
    g_object_unref (session_controller_instance);

  session_controller_instance = instance;
}

void
session_controller_register_channel (SessionController *self,
                                      const gchar *channel_name)
{
  gboolean was_empty;

  g_return_if_fail (SESSION_IS_CONTROLLER (self));
  g_return_if_fail (channel_name != NULL);

  was_empty = (g_hash_table_size (self->channels) == 0);
  g_hash_table_add (self->channels, g_strdup (channel_name));
  g_debug ("Registered session-control channel: %s", channel_name);

  /* Start timeout when first channel is registered */
  if (was_empty && self->timeout > 30 && self->state == SESSION_STATE_IDLE)
    {
      guint timeout_seconds = self->timeout - 30; /* Start countdown 30s before timeout */

      self->state = SESSION_STATE_ACTIVE;
      self->main_timeout_id = g_timeout_add_seconds (timeout_seconds,
                                                    session_controller_main_timeout_cb,
                                                    self);

      g_debug ("Started main session timeout (%u seconds until countdown)", timeout_seconds);
    }
}

void
session_controller_unregister_channel (SessionController *self,
                                        const gchar *channel_name)
{
  gboolean removed;

  g_return_if_fail (SESSION_IS_CONTROLLER (self));
  g_return_if_fail (channel_name != NULL);

  removed = g_hash_table_remove (self->channels, channel_name);
  if (removed)
    {
      g_debug ("Unregistered session-control channel: %s", channel_name);

      /* If all channels are gone and we're still in active state, cancel timeout */
      if (g_hash_table_size (self->channels) == 0 && self->state == SESSION_STATE_ACTIVE)
        {
          if (self->main_timeout_id > 0)
            {
              g_source_remove (self->main_timeout_id);
              self->main_timeout_id = 0;
            }

          self->state = SESSION_STATE_IDLE;
          g_debug ("All channels unregistered, cancelled session timeout");
        }
    }
}

gboolean
session_controller_has_channel (SessionController *self,
                                 const gchar *channel_name)
{
  g_return_val_if_fail (SESSION_IS_CONTROLLER (self), FALSE);
  g_return_val_if_fail (channel_name != NULL, FALSE);

  return g_hash_table_contains (self->channels, channel_name);
}

guint
session_controller_get_channel_count (SessionController *self)
{
  g_return_val_if_fail (SESSION_IS_CONTROLLER (self), 0);

  return g_hash_table_size (self->channels);
}

void
session_controller_send_control_to_all (SessionController *self,
                                         const gchar *command,
                                         ...)
{
  GHashTableIter iter;
  gpointer channel_name;
  va_list args;

  g_return_if_fail (SESSION_IS_CONTROLLER (self));
  g_return_if_fail (command != NULL);
  g_return_if_fail (self->transport != NULL);

  /* Send control message to each registered channel */
  g_hash_table_iter_init (&iter, self->channels);
  while (g_hash_table_iter_next (&iter, &channel_name, NULL))
    {
      const gchar *channel_id = (const gchar *) channel_name;
      GBytes *control_message;

      /* For now, support simple commands. Can be extended to handle additional parameters */
      va_start (args, command);
      const gchar *first_key = va_arg (args, const gchar *);

      if (first_key != NULL)
        {
          const gchar *first_value = va_arg (args, const gchar *);
          const gchar *second_key = va_arg (args, const gchar *);

          if (second_key != NULL)
            {
              const gchar *second_value = va_arg (args, const gchar *);
              control_message = cockpit_transport_build_control ("command", command,
                                                                "channel", channel_id,
                                                                first_key, first_value,
                                                                second_key, second_value,
                                                                NULL);
            }
          else
            {
              control_message = cockpit_transport_build_control ("command", command,
                                                                "channel", channel_id,
                                                                first_key, first_value,
                                                                NULL);
            }
        }
      else
        {
          /* Simple command with just channel */
          control_message = cockpit_transport_build_control ("command", command,
                                                            "channel", channel_id,
                                                            NULL);
        }
      va_end (args);

      cockpit_transport_send (self->transport, NULL, control_message);
      g_bytes_unref (control_message);

      g_debug ("Sent control message '%s' to channel: %s", command, channel_id);
    }
}

void
session_controller_close_all_channels (SessionController *self,
                                        const gchar *problem)
{
  g_return_if_fail (SESSION_IS_CONTROLLER (self));

  if (problem != NULL)
    {
      session_controller_send_control_to_all (self, "close", "problem", problem, NULL);
    }
  else
    {
      session_controller_send_control_to_all (self, "close", NULL);
    }

  g_debug ("Sent close control message to all %u registered channels",
           session_controller_get_channel_count (self));
}

static void
session_controller_start_countdown (SessionController *self)
{
  g_return_if_fail (SESSION_IS_CONTROLLER (self));

  if (self->state != SESSION_STATE_ACTIVE)
    return;

  self->state = SESSION_STATE_COUNTDOWN;
  self->countdown_remaining = 30; /* 30 seconds countdown */

  /* Start countdown timer (1 second intervals) */
  self->countdown_timeout_id = g_timeout_add_seconds (1,
                                                      session_controller_countdown_timeout_cb,
                                                      self);

  g_debug ("Started 30-second countdown");
}

static void
session_controller_send_logout (SessionController *self)
{
  g_return_if_fail (SESSION_IS_CONTROLLER (self));

  if (self->state != SESSION_STATE_COUNTDOWN)
    return;

  self->state = SESSION_STATE_LOGOUT;

  /* Send logout control message to all channels */
  session_controller_send_control_to_all (self, "logout", NULL);

  /* Start 10-second timer before closing transport */
  self->close_timeout_id = g_timeout_add_seconds (10,
                                                 session_controller_close_timeout_cb,
                                                 self);

  g_debug ("Sent logout message, will close transport in 10 seconds");
}

static void
session_controller_close_transport (SessionController *self)
{
  g_return_if_fail (SESSION_IS_CONTROLLER (self));

  if (self->state != SESSION_STATE_LOGOUT)
    return;

  self->state = SESSION_STATE_CLOSED;

  if (self->transport)
    {
      cockpit_transport_close (self->transport, "session-timeout");
      g_debug ("Transport closed due to session timeout");
    }
}

const gchar *
session_controller_get_state_name (SessionController *self)
{
  g_return_val_if_fail (SESSION_IS_CONTROLLER (self), "unknown");

  switch (self->state)
    {
    case SESSION_STATE_IDLE:
      return "idle";
    case SESSION_STATE_ACTIVE:
      return "active";
    case SESSION_STATE_COUNTDOWN:
      return "countdown";
    case SESSION_STATE_LOGOUT:
      return "logout";
    case SESSION_STATE_CLOSED:
      return "closed";
    default:
      return "unknown";
    }
}

void
session_controller_reset_timeout (SessionController *self)
{
  g_return_if_fail (SESSION_IS_CONTROLLER (self));

  /* Only reset if we have channels and timeout is configured */
  if (g_hash_table_size (self->channels) == 0 || self->timeout <= 30)
    return;

  /* Don't reset if already closed */
  if (self->state == SESSION_STATE_CLOSED)
    return;

  /* Clear any existing timers */
  if (self->main_timeout_id > 0)
    {
      g_source_remove (self->main_timeout_id);
      self->main_timeout_id = 0;
    }
  if (self->countdown_timeout_id > 0)
    {
      g_source_remove (self->countdown_timeout_id);
      self->countdown_timeout_id = 0;
    }
  if (self->close_timeout_id > 0)
    {
      g_source_remove (self->close_timeout_id);
      self->close_timeout_id = 0;
    }

  /* Reset to active state and restart the main timeout */
  if (self->state != SESSION_STATE_ACTIVE)
    {
      g_debug ("Resetting session state from '%s' to 'active'",
               session_controller_get_state_name (self));
    }

  self->state = SESSION_STATE_ACTIVE;
  self->countdown_remaining = 0;

  /* Start new main timeout */
  guint timeout_seconds = self->timeout - 30;
  self->main_timeout_id = g_timeout_add_seconds (timeout_seconds,
                                                session_controller_main_timeout_cb,
                                                self);

  g_debug ("Session activity detected, reset timeout (%u seconds until countdown)",
           timeout_seconds);
}

void
session_controller_notify_activity (void)
{
  SessionController *instance = session_controller_get_instance ();

  if (instance)
    {
      session_controller_reset_timeout (instance);
    }
  else
    {
      g_debug ("Session activity notification ignored - no SessionController instance");
    }
}

gint
session_controller_get_timeout (SessionController *self)
{
  g_return_val_if_fail (SESSION_IS_CONTROLLER (self), 0);

  return self->timeout;
}
