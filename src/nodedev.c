#include "nodedev.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virtDBusGDBusPropertyTable virtDBusNodeDevicePropertyTable[] = {
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNodeDeviceMethodTable[] = {
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
