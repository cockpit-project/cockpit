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

static virtDBusGDBusPropertyTable virtDBusNodeDevicePropertyTable[] = {
    { "Name", virtDBusNodeDeviceGetName, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNodeDeviceMethodTable[] = {
    { "Destroy", virtDBusNodeDeviceDestroy },
    { "Detach", virtDBusNodeDeviceDetach },
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
