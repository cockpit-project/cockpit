#include "nodedev.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virNodeDevicePtr
virtDBusNodeDeviceGetVirNodeDevice(virtDBusConnect *connect,
                                   const gchar *objectPath,
                                   GError **error)
{
    virNodeDevicePtr dev;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    dev = virtDBusUtilVirNodeDeviceFromBusPath(connect->connection,
                                               objectPath,
                                               connect->nodeDevPath);
    if (!dev) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return dev;
}

static void
virtDBusNodeDeviceGetName(const gchar *objectPath,
                          gpointer userData,
                          GVariant **value,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;
    const gchar *name;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    name = virNodeDeviceGetName(dev);
    if (!name)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", name);
}

static void
virtDBusNodeDeviceGetParent(const gchar *objectPath,
                            gpointer userData,
                            GVariant **value,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;
    const gchar *parent;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    parent = virNodeDeviceGetParent(dev);
    if (!parent)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", parent);
}

static void
virtDBusNodeDeviceDestroy(GVariant *inArgs G_GNUC_UNUSED,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    if (virNodeDeviceDestroy(dev) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNodeDeviceDetach(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs G_GNUC_UNUSED,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;
    const gchar *driverName;
    guint flags;

    g_variant_get(inArgs, "(&su)", &driverName, &flags);

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    if (virNodeDeviceDetachFlags(dev, driverName, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNodeDeviceGetXMLDesc(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;
    g_autofree gchar *xml = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    xml = virNodeDeviceGetXMLDesc(dev, flags);
    if (!xml)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", xml);
}

static void
virtDBusNodeDeviceListCaps(GVariant *inArgs G_GNUC_UNUSED,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;
    g_autoptr(virtDBusCharArray) caps = NULL;
    gint ncaps;
    GVariant *gret;
    GVariantBuilder builder;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    if ((ncaps = virNodeDeviceNumOfCaps(dev)) < 0)
        return virtDBusUtilSetLastVirtError(error);

    caps = g_new0(char *, ncaps + 1);

    if ((ncaps = virNodeDeviceListCaps(dev, caps, ncaps)) < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("as"));
    for (gint i = 0; i < ncaps; i++)
        g_variant_builder_add(&builder, "s", caps[i]);
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
}

static void
virtDBusNodeDeviceReAttach(GVariant *inArgs G_GNUC_UNUSED,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs G_GNUC_UNUSED,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    if (virNodeDeviceReAttach(dev) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusNodeDeviceReset(GVariant *inArgs G_GNUC_UNUSED,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs G_GNUC_UNUSED,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevice) dev = NULL;

    dev = virtDBusNodeDeviceGetVirNodeDevice(connect, objectPath, error);
    if (!dev)
        return;

    if (virNodeDeviceReset(dev) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusNodeDevicePropertyTable[] = {
    { "Name", virtDBusNodeDeviceGetName, NULL },
    { "Parent", virtDBusNodeDeviceGetParent, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNodeDeviceMethodTable[] = {
    { "Destroy", virtDBusNodeDeviceDestroy },
    { "Detach", virtDBusNodeDeviceDetach },
    { "GetXMLDesc", virtDBusNodeDeviceGetXMLDesc },
    { "ListCaps", virtDBusNodeDeviceListCaps },
    { "ReAttach", virtDBusNodeDeviceReAttach },
    { "Reset", virtDBusNodeDeviceReset },
    { 0 }
};

static gchar **
virtDBusNodeDeviceEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNodeDevicePtr) devs = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllNodeDevices(connect->connection, &devs, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirNodeDevice(devs[i],
                                                     connect->nodeDevPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo;

void
virtDBusNodeDeviceRegister(virtDBusConnect *connect,
                           GError **error)
{
    connect->nodeDevPath = g_strdup_printf("%s/nodedev",
                                           connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_NODEDEV_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->nodeDevPath,
                                 interfaceInfo,
                                 virtDBusNodeDeviceEnumerate,
                                 virtDBusNodeDeviceMethodTable,
                                 virtDBusNodeDevicePropertyTable,
                                 connect);
}
