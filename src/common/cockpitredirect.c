/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

#include "cockpitredirect.h"

#include "cockpitchannel.h"
#include "cockpittransport.h"

/**
 * CockpitRedirect:
 * Interface used to represent a channel redirection.
 */

G_DEFINE_INTERFACE (CockpitRedirect, cockpit_redirect, G_TYPE_OBJECT)

static void
cockpit_redirect_default_init (CockpitRedirectInterface *iface)
{
  /* No default signals or properties */
}

/**
 * cockpit_redirect_send:
 * @self: a channel redirect
 * @payload: data to be sent through
 *
 * Send a message through a channel redirect.
 *
 * Returns: whether data has been sent successfully
 */
gboolean
cockpit_redirect_send (CockpitRedirect *self,
                       GBytes *payload)
{
  CockpitRedirectInterface *iface;

  g_return_val_if_fail (COCKPIT_IS_REDIRECT (self), FALSE);

  iface = COCKPIT_REDIRECT_GET_IFACE (self);
  g_return_val_if_fail (iface->send != NULL, FALSE);
  return iface->send (self, payload);
}

/**
 * CockpitChannelRedirect:
 * Represents redirection to a local channel.
 */

struct _CockpitChannelRedirect {
  GObject parent_instance;

  CockpitChannel *channel;
  gboolean channel_open;

  gulong channel_closed_sig;
};

static void
cockpit_channel_redirect_interface_init (CockpitRedirectInterface *iface)
{
  iface->send = (gboolean (*)(CockpitRedirect *, GBytes *)) cockpit_channel_redirect_send;
}

G_DEFINE_TYPE_WITH_CODE (CockpitChannelRedirect, cockpit_channel_redirect, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_REDIRECT,
                                                cockpit_channel_redirect_interface_init))
enum {
  CHANNEL_PROP_0,
  CHANNEL_PROP_CHANNEL
};

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  CockpitChannelRedirect *self = COCKPIT_CHANNEL_REDIRECT (user_data);
  self->channel_open = FALSE;
}

static void
cockpit_channel_redirect_init (CockpitChannelRedirect *self)
{
  self->channel_open = TRUE;
}

static void
cockpit_channel_redirect_dispose (GObject *gobject)
{
  CockpitChannelRedirect *self = COCKPIT_CHANNEL_REDIRECT (gobject);

  if (self->channel_closed_sig)
    g_signal_handler_disconnect (self->channel, self->channel_closed_sig);
  self->channel_closed_sig = 0;

  g_clear_object (&self->channel);

  G_OBJECT_CLASS (cockpit_channel_redirect_parent_class)->dispose (gobject);
}

static void
cockpit_channel_redirect_set_property (GObject *obj,
                                       guint prop_id,
                                       const GValue *value,
                                       GParamSpec *pspec)
{
  CockpitChannelRedirect *self = COCKPIT_CHANNEL_REDIRECT (obj);

  switch (prop_id)
    {
    case CHANNEL_PROP_CHANNEL:
      self->channel = g_value_dup_object (value);
      self->channel_closed_sig = g_signal_connect (self->channel, "closed", G_CALLBACK (on_channel_closed), self);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_channel_redirect_class_init (CockpitChannelRedirectClass *class)
{
  GObjectClass *object_class = G_OBJECT_CLASS (class);
  object_class->set_property = cockpit_channel_redirect_set_property;
  object_class->dispose = cockpit_channel_redirect_dispose;

  g_object_class_install_property (object_class, CHANNEL_PROP_CHANNEL,
                                   g_param_spec_object ("channel", "channel", "channel",
                                                        COCKPIT_TYPE_CHANNEL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY));
}

gboolean
cockpit_channel_redirect_send (CockpitChannelRedirect *self,
                               GBytes *payload)
{
  if (!self->channel_open)
    return FALSE;

  CockpitTransport *inbound_transport = cockpit_channel_get_transport (self->channel);
  const gchar *channel_id = cockpit_channel_get_id (self->channel);

  cockpit_transport_emit_recv (inbound_transport, channel_id, payload);
  return TRUE;
}

/**
 * CockpitPeerRedirect:
 * Represents redirection to a transport with another bridge at the other end.
 */

struct _CockpitPeerRedirect {
  GObject parent_instance;

  const gchar *channel;
  CockpitTransport *transport;
  gboolean target_open;

  guint transport_closed_sig;
  guint transport_control_sig;
};

static void
cockpit_peer_redirect_interface_init (CockpitRedirectInterface *iface)
{
  iface->send = (gboolean (*)(CockpitRedirect *, GBytes *)) cockpit_peer_redirect_send;
}

G_DEFINE_TYPE_WITH_CODE (CockpitPeerRedirect, cockpit_peer_redirect, G_TYPE_OBJECT,
G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_REDIRECT,
                       cockpit_peer_redirect_interface_init))
enum {
  PEER_PROP_0,
  PEER_PROP_CHANNEL,
  PEER_PROP_TRANSPORT
};

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     gpointer user_data)
{
  /* Target transport closed */
  CockpitPeerRedirect *self = COCKPIT_PEER_REDIRECT (user_data);

  self->target_open = FALSE;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  /* Control message on target transport - check if the target channel is closing */
  CockpitPeerRedirect *self = COCKPIT_PEER_REDIRECT (user_data);

  if (g_strcmp0 (command, "close"))
    return FALSE;

  if (!self->channel || g_strcmp0 (channel_id, self->channel))
    return FALSE;

  self->target_open = FALSE;
  return FALSE;
}

static void
cockpit_peer_redirect_init (CockpitPeerRedirect *self)
{
  self->channel = NULL;
  self->target_open = TRUE;
}

static void
cockpit_peer_redirect_dispose (GObject *gobject)
{
  CockpitPeerRedirect *self = COCKPIT_PEER_REDIRECT (gobject);

  if (self->transport_closed_sig)
    g_signal_handler_disconnect (self->transport, self->transport_closed_sig);
  self->transport_closed_sig = 0;

  if (self->transport_control_sig)
    g_signal_handler_disconnect (self->transport, self->transport_control_sig);
  self->transport_control_sig = 0;

  g_clear_object (&self->transport);

  g_free ((gpointer) self->channel);
  self->channel = NULL;

  G_OBJECT_CLASS (cockpit_peer_redirect_parent_class)->dispose (gobject);
}

static void
cockpit_peer_redirect_set_property (GObject *obj,
                                    guint prop_id,
                                    const GValue *value,
                                    GParamSpec *pspec)
{
  CockpitPeerRedirect *self = COCKPIT_PEER_REDIRECT (obj);

  switch (prop_id)
  {
    case PEER_PROP_CHANNEL:
      self->channel = g_value_dup_string (value);
      break;
    case PEER_PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      self->transport_closed_sig = g_signal_connect (self->transport,
                                                     "closed",
                                                     G_CALLBACK (on_transport_closed),
                                                     self);
      self->transport_control_sig = g_signal_connect (self->transport,
                                                      "control",
                                                      G_CALLBACK (on_transport_control),
                                                      self);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
  }
}

static void
cockpit_peer_redirect_class_init (CockpitPeerRedirectClass *class)
{
  GObjectClass *object_class = G_OBJECT_CLASS (class);
  object_class->set_property = cockpit_peer_redirect_set_property;
  object_class->dispose = cockpit_peer_redirect_dispose;

  g_object_class_install_property (object_class, PEER_PROP_CHANNEL,
                                   g_param_spec_string ("channel", "channel", "channel",
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY));

  g_object_class_install_property (object_class, PEER_PROP_TRANSPORT,
                                   g_param_spec_object ("transport", "transport", "transport",
                                                        COCKPIT_TYPE_TRANSPORT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY));
}

gboolean
cockpit_peer_redirect_send (CockpitPeerRedirect *self,
                            GBytes *payload)
{
  if (!self->target_open)
    return FALSE;

  cockpit_transport_send (self->transport, self->channel, payload);
  return TRUE;
}
