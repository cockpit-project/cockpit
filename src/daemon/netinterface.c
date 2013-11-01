/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include <string.h>

#include "daemon.h"
#include "network.h"
#include "netinterface.h"
#include "utils.h"

/**
 * SECTION:netinterface
 * @title: Network Interface
 * @short_description: Implementation of #Netinterface
 *
 * The #Netinterface represents a single network interface.
 */

typedef struct _NetinterfaceClass NetinterfaceClass;

/**
 * <private>
 * Netinterface:
 *
 * Private.
 */
struct _Netinterface
{
  CockpitNetworkNetinterfaceSkeleton parent_instance;

  Network *network;

  gchar *name;
};

struct _NetinterfaceClass
{
  CockpitNetworkNetinterfaceSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_NETWORK
};

static void network_netinterface_iface_init (CockpitNetworkNetinterfaceIface *iface);
static gboolean netinterface_ensure_initialized (Netinterface *impl, GCancellable *cancellable, GError **error);

G_DEFINE_TYPE_WITH_CODE (Netinterface, netinterface, COCKPIT_TYPE_NETWORK_NETINTERFACE_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_NETWORK_NETINTERFACE, network_netinterface_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
netinterface_finalize (GObject *object)
{
  Netinterface *self = NETINTERFACE (object);

  (void)self;

  G_OBJECT_CLASS (netinterface_parent_class)->finalize (object);
}

static void
netinterface_get_property (GObject *object,
                           guint prop_id,
                           GValue *value,
                           GParamSpec *pspec)
{
  Netinterface *self = NETINTERFACE (object);

  switch (prop_id)
    {
    case PROP_NETWORK:
      g_value_set_object (value, netinterface_get_network (self));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
netinterface_set_property (GObject *object,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  Netinterface *self = NETINTERFACE (object);

  switch (prop_id)
    {
    case PROP_NETWORK:
      g_assert (self->network == NULL);
      self->network = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
netinterface_init (Netinterface *self)
{
  GError *local_error = NULL;
  GError **error = &local_error;

  if (!netinterface_ensure_initialized (self, NULL, error))
    goto out;

out:
  if (local_error)
    g_warning ("Failed to initialize interface: %s", local_error->message);
  g_clear_error (&local_error);
}

static void
netinterface_constructed (GObject *object)
{
  Netinterface *self = NETINTERFACE (object);

  (void)self;

  if (G_OBJECT_CLASS (netinterface_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (netinterface_parent_class)->constructed (object);
}

static void
netinterface_class_init (NetinterfaceClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = netinterface_finalize;
  gobject_class->constructed  = netinterface_constructed;
  gobject_class->set_property = netinterface_set_property;
  gobject_class->get_property = netinterface_get_property;

  /**
   * Netinterface:network:
   *
   * The #Network for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_NETWORK,
                                   g_param_spec_object ("network",
                                                        NULL,
                                                        NULL,
                                                        TYPE_NETWORK,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * netinterface_new:
 * @network: A #Network
 *
 * Creates a new #Netinterface instance.
 *
 * Returns: A new #Netinterface. Free with g_object_unref().
 */
CockpitNetworkNetinterface *
netinterface_new (Network *network,
                  const gchar *name)
{
  g_return_val_if_fail (IS_NETWORK (network), NULL);
  return COCKPIT_NETWORK_NETINTERFACE (g_object_new (TYPE_NETINTERFACE,
                                                     "network", network,
                                                     "name", name,
                                                     NULL));
}

/**
 * netinterface_get_network:
 * @self: A #Netinterface.
 *
 * Gets the network used by @self.
 *
 * Returns: A #Network. Do not free, the object is owned by @self.
 */
Network *
netinterface_get_network (Netinterface *self)
{
  g_return_val_if_fail (IS_NETINTERFACE (self), NULL);
  return self->network;
}

/* ---------------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------------- */

static void
network_netinterface_iface_init (CockpitNetworkNetinterfaceIface *iface)
{
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
netinterface_ensure_initialized (Netinterface *self,
                                 GCancellable *cancellable,
                                 GError **error)
{
  return TRUE;
}
