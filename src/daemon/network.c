/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
 *
 * Very heavily based on code from NetworkManager:
 *   src/ip6-manager/nm-ip6-manager.c
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

#include <gio/gunixcredentialsmessage.h>
#include <gudev/gudev.h>
#include <netinet/icmp6.h>
#include <arpa/inet.h>
#include <netinet/ether.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <nm-client.h>
#include <nm-remote-settings.h>
#include <nm-setting-ip4-config.h>
#include <nm-setting-ip6-config.h>
#include <nm-device-ethernet.h>
#include <nm-device-wifi.h>
#include <nm-device-wimax.h>
#include <nm-device-infiniband.h>
#include <nm-utils.h>

#include "libgsystem.h"

#include "daemon.h"
#include "network.h"
#include "netinterface.h"
#include "utils.h"

/**
 * SECTION:network
 * @title: Network
 * @short_description: Implementation of #Network
 *
 * The #Network interface allows inspection and control over
 * system networking.
 */

typedef struct _NetworkClass NetworkClass;

/**
 * <private>
 * Network:
 *
 * Private.
 */
struct _Network
{
  CockpitNetworkSkeleton parent_instance;

  Daemon *daemon;

  NMClient *client;
  NMRemoteSettings *settings;

  GHashTable *ifname_to_netinterface;
};

struct _NetworkClass
{
  CockpitNetworkSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON
};

static void network_iface_init (CockpitNetworkIface *iface);
static gboolean network_initialize (Network *impl, GCancellable *cancellable, GError **error);

G_DEFINE_TYPE_WITH_CODE (Network, network, COCKPIT_TYPE_NETWORK_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_NETWORK, network_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
network_finalize (GObject *object)
{
  Network *self = NETWORK (object);

  g_hash_table_unref (self->ifname_to_netinterface);

  G_OBJECT_CLASS (network_parent_class)->finalize (object);
}

static void
network_get_property (GObject *object,
                      guint prop_id,
                      GValue *value,
                      GParamSpec *pspec)
{
  Network *self = NETWORK (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, network_get_daemon (self));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
network_set_property (GObject *object,
                      guint prop_id,
                      const GValue *value,
                      GParamSpec *pspec)
{
  Network *self = NETWORK (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (self->daemon == NULL);
      /* we don't take a reference to the daemon */
      self->daemon = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
network_init (Network *self)
{
}

static void
network_constructed (GObject *object)
{
  Network *self = NETWORK (object);
  GError *local_error = NULL;
  GError **error = &local_error;

  if (!network_initialize (self, NULL, error))
    goto out;

out:
  if (local_error)
    g_warning ("Failed to initialize network: %s", local_error->message);
  g_clear_error (&local_error);

  if (G_OBJECT_CLASS (network_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (network_parent_class)->constructed (object);
}

static void
network_class_init (NetworkClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = network_finalize;
  gobject_class->constructed  = network_constructed;
  gobject_class->set_property = network_set_property;
  gobject_class->get_property = network_get_property;

  /**
   * Network:daemon:
   *
   * The #Daemon for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_DAEMON,
                                   g_param_spec_object ("daemon",
                                                        NULL,
                                                        NULL,
                                                        TYPE_DAEMON,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * network_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #Network instance.
 *
 * Returns: A new #Network. Free with g_object_unref().
 */
CockpitNetwork *
network_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_NETWORK (g_object_new (TYPE_NETWORK,
                                        "daemon", daemon,
                                        NULL));
}

/**
 * network_get_daemon:
 * @network: A #Network.
 *
 * Gets the daemon used by @network.
 *
 * Returns: A #Daemon. Do not free, the object is owned by @network.
 */
Daemon *
network_get_daemon (Network *self)
{
  g_return_val_if_fail (IS_NETWORK (self), NULL);
  return self->daemon;
}

/* ---------------------------------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------------------------------- */

static void
network_iface_init (CockpitNetworkIface *iface)
{
}

/* ---------------------------------------------------------------------------------------------------- */

static GVariant *
ip6_addr_variant_new (const struct in6_addr *addr,
                      guint32 prefix)
{
  return g_variant_new ("(yyyyyyyyyyyyyyyyu)",
                        addr->__in6_u.__u6_addr8[0],
                        addr->__in6_u.__u6_addr8[1],
                        addr->__in6_u.__u6_addr8[2],
                        addr->__in6_u.__u6_addr8[3],
                        addr->__in6_u.__u6_addr8[4],
                        addr->__in6_u.__u6_addr8[5],
                        addr->__in6_u.__u6_addr8[6],
                        addr->__in6_u.__u6_addr8[7],
                        addr->__in6_u.__u6_addr8[8],
                        addr->__in6_u.__u6_addr8[9],
                        addr->__in6_u.__u6_addr8[10],
                        addr->__in6_u.__u6_addr8[11],
                        addr->__in6_u.__u6_addr8[12],
                        addr->__in6_u.__u6_addr8[13],
                        addr->__in6_u.__u6_addr8[14],
                        addr->__in6_u.__u6_addr8[15],
                        prefix);
}

static GVariant *
ip4_addr_variant_new (guint32 address,
                      guint32 prefix)
{
  return g_variant_new ("(yyyyu)",
                        (address >> 24) & 0xFF,
                        (address >> 16) & 0xFF,
                        (address >> 8)  & 0xFF,
                        (address >> 0)  & 0xFF,
                        prefix);
}

static GSList *
valid_connections_for_device (NMRemoteSettings *remote_settings,
                              NMDevice *device)
{
  GSList *all, *filtered, *iterator, *valid;
  NMConnection *connection;
  NMSettingConnection *s_con;

  all = nm_remote_settings_list_connections (remote_settings);
  filtered = nm_device_filter_connections (device, all);
  g_slist_free (all);

  valid = NULL;
  for (iterator = filtered; iterator; iterator = iterator->next)
    {
      connection = iterator->data;
      s_con = nm_connection_get_setting_connection (connection);
      if (!s_con)
        continue;

      if (nm_setting_connection_get_master (s_con))
        continue;

      valid = g_slist_prepend (valid, connection);
    }
  g_slist_free (filtered);

  return g_slist_reverse (valid);
}

/* return value must be freed by caller with g_free() */
static gchar *
get_mac_address_of_connection (NMConnection *connection)
{
  const GByteArray *mac = NULL;

  if (!connection)
    return NULL;

  /* check the connection type */
  if (nm_connection_is_type (connection,
                             NM_SETTING_WIRELESS_SETTING_NAME))
    {
      /* check wireless settings */
      NMSettingWireless *s_wireless = nm_connection_get_setting_wireless (connection);
      if (!s_wireless)
        return NULL;
      mac = nm_setting_wireless_get_mac_address (s_wireless);
      if (mac)
        return nm_utils_hwaddr_ntoa (mac->data, ARPHRD_ETHER);
    }
  else if (nm_connection_is_type (connection,
                                  NM_SETTING_WIRED_SETTING_NAME))
    {
      /* check wired settings */
      NMSettingWired *s_wired = nm_connection_get_setting_wired (connection);
      if (!s_wired)
        return NULL;
      mac = nm_setting_wired_get_mac_address (s_wired);
      if (mac)
        return nm_utils_hwaddr_ntoa (mac->data, ARPHRD_ETHER);
    }
  else if (nm_connection_is_type (connection,
                                  NM_SETTING_WIMAX_SETTING_NAME))
    {
      /* check wimax settings */
      NMSettingWimax *s_wimax = nm_connection_get_setting_wimax (connection);
      if (!s_wimax)
        return NULL;
      mac = nm_setting_wimax_get_mac_address (s_wimax);
      if (mac)
        return nm_utils_hwaddr_ntoa (mac->data, ARPHRD_ETHER);
    }
  else if (nm_connection_is_type (connection,
                                  NM_SETTING_INFINIBAND_SETTING_NAME))
    {
      /* check infiniband settings */
      NMSettingInfiniband *s_infiniband = \
        nm_connection_get_setting_infiniband (connection);
      if (!s_infiniband)
        return NULL;
      mac = nm_setting_infiniband_get_mac_address (s_infiniband);
      if (mac)
        return nm_utils_hwaddr_ntoa (mac->data,
                                     ARPHRD_INFINIBAND);
    }
  /* no MAC address found */
  return NULL;
}

/* return value must not be freed! */
static const gchar *
get_mac_address_of_device (NMDevice *device)
{
  const gchar *mac = NULL;
  switch (nm_device_get_device_type (device))
    {
    case NM_DEVICE_TYPE_WIFI:
      {
        NMDeviceWifi *device_wifi = NM_DEVICE_WIFI (device);
        mac = nm_device_wifi_get_hw_address (device_wifi);
        break;
      }
    case NM_DEVICE_TYPE_ETHERNET:
      {
        NMDeviceEthernet *device_ethernet = NM_DEVICE_ETHERNET (device);
        mac = nm_device_ethernet_get_hw_address (device_ethernet);
        break;
      }
    case NM_DEVICE_TYPE_WIMAX:
      {
        NMDeviceWimax *device_wimax = NM_DEVICE_WIMAX (device);
        mac = nm_device_wimax_get_hw_address (device_wimax);
        break;
      }
    case NM_DEVICE_TYPE_INFINIBAND:
      {
        NMDeviceInfiniband *device_infiniband = NM_DEVICE_INFINIBAND (device);
        mac = nm_device_infiniband_get_hw_address (device_infiniband);
        break;
      }
    default:
      break;
    }
  /* no MAC address found */
  return mac;
}

/* returns TRUE if both MACs are equal */
static gboolean
compare_mac_device_with_mac_connection (NMDevice *device,
                                        NMConnection *connection)
{
  const gchar *mac_dev = NULL;
  gs_free gchar *mac_conn = NULL;

  mac_dev = get_mac_address_of_device (device);
  if (mac_dev != NULL)
    {
      mac_conn = get_mac_address_of_connection (connection);
      if (mac_conn)
        {
          /* compare both MACs */
          if (g_strcmp0 (mac_dev, mac_conn) == 0)
            return TRUE;

          g_clear_pointer (&mac_conn, g_free);
        }
    }
  return FALSE;
}

static NMConnection *
device_find_connection (NMRemoteSettings *remote_settings,
                        NMDevice *device)
{
  GSList *list, *iterator;
  NMConnection *connection = NULL;
  NMActiveConnection *ac;

  ac = nm_device_get_active_connection (device);
  if (ac)
    {
      return (NMConnection*)nm_remote_settings_get_connection_by_path (remote_settings,
                                                                       nm_active_connection_get_connection (ac));
    }

  /* not found in active connections - check all available connections */
  list = valid_connections_for_device (remote_settings, device);
  if (list != NULL)
    {
      /* if list has only one connection, use this connection */
      if (g_slist_length (list) == 1)
        {
          connection = list->data;
          goto out;
        }

      /* is there connection with the MAC address of the device? */
      for (iterator = list; iterator; iterator = iterator->next)
        {
          connection = iterator->data;
          if (compare_mac_device_with_mac_connection (device, connection))
            goto out;
        }
    }

  /* no connection found for the given device */
  connection = NULL;
out:
  g_slist_free (list);
  return connection;
}

static void
synchronize_device_config (Network *self,
                           Netinterface *iface,
                           NMDevice *device)
{
  NMConnection *connection;
  NMSettingIP4Config *ip4config;
  NMSettingIP6Config *ip6config;
  const char *ip4_method = "";
  const char *ip6_method = "";

  connection = device_find_connection (self->settings, device);

  if (!connection)
    {
      g_message ("No settings connection for device %p", device);
      return;
    }

  ip4config = nm_connection_get_setting_ip4_config (connection);
  if (ip4config)
    ip4_method = nm_setting_ip4_config_get_method (ip4config);
  cockpit_network_netinterface_set_ip4_config_mode (COCKPIT_NETWORK_NETINTERFACE (iface),
                                                    ip4_method);

  ip6config = nm_connection_get_setting_ip6_config (connection);
  if (ip6config)
    ip6_method = nm_setting_ip6_config_get_method (ip6config);
  cockpit_network_netinterface_set_ip6_config_mode (COCKPIT_NETWORK_NETINTERFACE (iface),
                                                    ip6_method);
}

static void
synchronize_device_ethernet (Network *self,
                             Netinterface *iface,
                             NMDeviceEthernet *device)
{
  cockpit_network_netinterface_set_hw_address (COCKPIT_NETWORK_NETINTERFACE (iface),
                                               nm_device_ethernet_get_hw_address (device));
}

static void
synchronize_device_wifi (Network *self,
                         Netinterface *iface,
                         NMDeviceWifi *device)
{
  cockpit_network_netinterface_set_hw_address (COCKPIT_NETWORK_NETINTERFACE (iface),
                                               nm_device_wifi_get_hw_address (device));
}

static void
synchronize_device (Network *self,
                    NMDevice *device)
{
  const char *iface_name = nm_device_get_iface (device);
  Netinterface *iface;
  NMIP4Config *ip4config;
  NMIP6Config *ip6config;

  iface = g_hash_table_lookup (self->ifname_to_netinterface,
                               iface_name);
  g_assert (iface);
  cockpit_network_netinterface_set_name (COCKPIT_NETWORK_NETINTERFACE (iface), iface_name);

  ip4config = nm_device_get_ip4_config (device);
  if (ip4config)
    {
      const GSList *addresses = nm_ip4_config_get_addresses (ip4config);
      const GSList *iter;
      GVariantBuilder builder;

      g_variant_builder_init (&builder, G_VARIANT_TYPE ("a(yyyyu)"));

      for (iter = addresses; iter; iter = iter->next)
        {
          NMIP4Address *ip4addr = iter->data;
          guint32 ipaddr = ntohl (nm_ip4_address_get_address (ip4addr));
          guint32 prefix = nm_ip4_address_get_prefix (ip4addr);

          g_variant_builder_add_value (&builder, ip4_addr_variant_new (ipaddr, prefix));
        }

      cockpit_network_netinterface_set_ip4_addresses (COCKPIT_NETWORK_NETINTERFACE (iface), g_variant_builder_end (&builder));
    }
  ip6config = nm_device_get_ip6_config (device);
  if (ip6config)
    {
      const GSList *addresses = nm_ip6_config_get_addresses (ip6config);
      const GSList *iter;
      GVariantBuilder builder;

      g_variant_builder_init (&builder, G_VARIANT_TYPE ("a(yyyyyyyyyyyyyyyyu)"));

      for (iter = addresses; iter; iter = iter->next)
        {
          NMIP6Address *ip6addr = iter->data;

          g_variant_builder_add_value (&builder, ip6_addr_variant_new (nm_ip6_address_get_address (ip6addr),
                                                                       nm_ip6_address_get_prefix (ip6addr)));
        }

      cockpit_network_netinterface_set_ip6_addresses (COCKPIT_NETWORK_NETINTERFACE (iface), g_variant_builder_end (&builder));
    }

  synchronize_device_config (self, iface, device);

  switch (nm_device_get_device_type (device))
    {
    case NM_DEVICE_TYPE_ETHERNET:
      synchronize_device_ethernet (self, iface, NM_DEVICE_ETHERNET (device));
      break;
    case NM_DEVICE_TYPE_WIFI:
      synchronize_device_wifi (self, iface, NM_DEVICE_WIFI (device));
      break;
    default:
      break;
    }
}

static void
on_nm_device_state_changed (NMDevice *device,
                            guint new_state,
                            guint old_state,
                            guint reason,
                            gpointer user_data)
{
  Network *self = user_data;

  synchronize_device (self, device);
}

static void
on_nm_device_added (NMClient *client,
                    NMDevice *device,
                    gpointer user_data)
{
  Network *self = user_data;
  Netinterface *iface;
  CockpitNetworkNetinterface *cockpit_iface;
  const char *iface_name;
  Daemon *daemon;
  gs_unref_object CockpitObjectSkeleton *object = NULL;
  gs_free char *path = NULL;

  g_assert (client != NULL);
  g_assert (self != NULL);

  iface_name = nm_device_get_iface (device);
  if (!iface_name)
    return;

  iface = g_hash_table_lookup (self->ifname_to_netinterface, iface_name);
  if (iface != NULL)
    return;

  iface = (Netinterface*)netinterface_new (self, iface_name);
  cockpit_iface = COCKPIT_NETWORK_NETINTERFACE (iface);
  g_hash_table_insert (self->ifname_to_netinterface, g_strdup (iface_name), iface);
  path = g_strdup_printf ("/com/redhat/Cockpit/Network/%s", iface_name);
  object = cockpit_object_skeleton_new (path);
  daemon = network_get_daemon (self);
  cockpit_object_skeleton_set_network_netinterface (object, cockpit_iface);
  g_dbus_object_manager_server_export (daemon_get_object_manager (daemon),
                                       G_DBUS_OBJECT_SKELETON (object));

  g_signal_connect (device, "state-changed", G_CALLBACK(on_nm_device_state_changed),
                    self);
  synchronize_device (self, device);
}

static void
on_nm_device_removed (NMClient *client,
                      NMDevice *device,
                      gpointer user_data)
{
  Network *self = user_data;
  const char *iface_name = nm_device_get_iface (device);

  if (!iface_name)
    return;

  g_hash_table_remove (self->ifname_to_netinterface, iface_name);
}

static void
on_nm_settings_read (NMRemoteSettings *settings,
                     Network *self)
{
  const GPtrArray *devices = NULL;
  guint i;

  devices = nm_client_get_devices (self->client);
  if (devices)
    {
      for (i = 0; i < devices->len; i++)
        {
          NMDevice *device = devices->pdata[i];
          on_nm_device_added (self->client, device, self);
        }
    }

  g_signal_connect (self->client, "device-added", G_CALLBACK (on_nm_device_added), self);
  g_signal_connect (self->client, "device-removed", G_CALLBACK (on_nm_device_removed), self);
}

static gboolean
network_initialize (Network *self,
                    GCancellable *cancellable,
                    GError **error)
{
  gboolean ret = FALSE;

  self->ifname_to_netinterface = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                        g_free, (GDestroyNotify) g_object_unref);

  self->client = nm_client_new ();
  self->settings = nm_remote_settings_new (dbus_g_bus_get (DBUS_BUS_SYSTEM, NULL));
  if (!g_initable_init (G_INITABLE (self->settings), cancellable, error))
    goto out;
  g_signal_connect (self->settings, NM_REMOTE_SETTINGS_CONNECTIONS_READ,
                    G_CALLBACK (on_nm_settings_read), self);

  ret = TRUE;
out:
  return ret;
}
