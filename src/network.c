#include "network.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virNetworkPtr
virtDBusNetworkGetVirNetwork(virtDBusConnect *connect,
                             const gchar *objectPath,
                             GError **error)
{
    virNetworkPtr network;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    network = virtDBusUtilVirNetworkFromBusPath(connect->connection,
                                                objectPath,
                                                connect->networkPath);
    if (!network) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return network;
}

static void
virtDBusNetworkGetAutostart(const gchar *objectPath,
                            gpointer userData,
                            GVariant **value,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gint autostart = 0;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkGetAutostart(network, &autostart) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!autostart);
}

static void
virtDBusNetworkGetBridgeName(const gchar *objectPath,
                             gpointer userData,
                             GVariant **value,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    g_autofree gchar *bridge = NULL;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    bridge = virNetworkGetBridgeName(network);

    if (!bridge)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", bridge);
}

static void
virtDBusNetworkGetName(const gchar *objectPath,
                       gpointer userData,
                       GVariant **value,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    const gchar *name;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    name = virNetworkGetName(network);
    if (!name)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", name);
}

static virtDBusGDBusPropertyTable virtDBusNetworkPropertyTable[] = {
    { "Autostart", virtDBusNetworkGetAutostart, NULL },
    { "BridgeName", virtDBusNetworkGetBridgeName, NULL },
    { "Name", virtDBusNetworkGetName, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNetworkMethodTable[] = {
    { 0 }
};

static gchar **
virtDBusNetworkEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetworkPtr) networks = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllNetworks(connect->connection, &networks, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirNetwork(networks[i],
                                                  connect->networkPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo = NULL;

void
virtDBusNetworkRegister(virtDBusConnect *connect,
                        GError **error)
{
    connect->networkPath = g_strdup_printf("%s/network", connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_NETWORK_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->networkPath,
                                 interfaceInfo,
                                 virtDBusNetworkEnumerate,
                                 virtDBusNetworkMethodTable,
                                 virtDBusNetworkPropertyTable,
                                 connect);
}
