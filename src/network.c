#include "network.h"
#include "util.h"

#include <libvirt/libvirt.h>

static void
virtDBusNetworkDHCPLeaseListFree(virNetworkDHCPLeasePtr *leases)
{
    for (gint i = 0; leases[i] != NULL; i++)
        virNetworkDHCPLeaseFree(leases[i]);

    g_free(leases);
}

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virNetworkDHCPLeasePtr, virtDBusNetworkDHCPLeaseListFree);

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
virtDBusNetworkGetActive(const gchar *objectPath,
                         gpointer userData,
                         GVariant **value,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gint active;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    active = virNetworkIsActive(network);
    if (active < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!active);
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

static void
virtDBusNetworkGetPersistent(const gchar *objectPath,
                             gpointer userData,
                             GVariant **value,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gint persistent;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    persistent = virNetworkIsPersistent(network);
    if (persistent < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!persistent);
}

static void
virtDBusNetworkGetUUID(const gchar *objectPath,
                       gpointer userData,
                       GVariant **value,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkGetUUIDString(network, uuid) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", uuid);
}

static void
virtDBusNetworkSetAutostart(GVariant *value,
                            const gchar *objectPath,
                            gpointer userData,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gboolean autostart;

    g_variant_get(value, "b", &autostart);

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkSetAutostart(network, autostart) < 0)
        return virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNetworkCreate(GVariant *inArgs G_GNUC_UNUSED,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkCreate(network) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNetworkDestroy(GVariant *inArgs G_GNUC_UNUSED,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkDestroy(network) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNetworkGetDHCPLeases(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    const gchar *mac;
    guint flags;
    g_autoptr(virNetworkDHCPLeasePtr) leases = NULL;
    gint nleases;
    GVariantBuilder builder;
    GVariant *res;

    g_variant_get(inArgs, "(&su)", &mac, &flags);
    if (g_str_equal(mac, ""))
        mac = NULL;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    nleases = virNetworkGetDHCPLeases(network, mac, &leases, flags);
    if (nleases < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(sxisssuss)"));
    for (gint i = 0; i < nleases; i++) {
        virNetworkDHCPLeasePtr lease = leases[i];

        g_variant_builder_add(&builder, "(sxisssuss)",
                              lease->iface, lease->expirytime,
                              lease->type, lease->mac,
                              lease->iaid ? lease->iaid : "",
                              lease->ipaddr, lease->prefix,
                              lease->hostname ? lease->hostname : "",
                              lease->clientid ? lease->clientid : "");
    }
    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
}

static void
virtDBusNetworkGetXMLDesc(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    g_autofree gchar *xml = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    xml = virNetworkGetXMLDesc(network, flags);
    if (!xml)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", xml);
}

static void
virtDBusNetworkUndefine(GVariant *inArgs G_GNUC_UNUSED,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs G_GNUC_UNUSED,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkUndefine(network) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNetworkUpdate(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNetwork) network = NULL;
    gint command;
    gint section;
    gint parentIndex;
    const gchar *xml;
    guint flags;

    g_variant_get(inArgs, "(uui&su)",
                  &command, &section,
                  &parentIndex, &xml, &flags);

    network = virtDBusNetworkGetVirNetwork(connect, objectPath, error);
    if (!network)
        return;

    if (virNetworkUpdate(network, command, section,
                         parentIndex, xml, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusNetworkPropertyTable[] = {
    { "Active", virtDBusNetworkGetActive, NULL },
    { "Autostart", virtDBusNetworkGetAutostart, virtDBusNetworkSetAutostart },
    { "Name", virtDBusNetworkGetName, NULL },
    { "Persistent", virtDBusNetworkGetPersistent, NULL },
    { "UUID", virtDBusNetworkGetUUID, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNetworkMethodTable[] = {
    { "Create", virtDBusNetworkCreate },
    { "Destroy", virtDBusNetworkDestroy },
    { "GetDHCPLeases", virtDBusNetworkGetDHCPLeases },
    { "GetXMLDesc", virtDBusNetworkGetXMLDesc },
    { "Undefine", virtDBusNetworkUndefine },
    { "Update", virtDBusNetworkUpdate },
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
