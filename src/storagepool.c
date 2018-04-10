#include "storagepool.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virtDBusGDBusPropertyTable virtDBusStoragePoolPropertyTable[] = {
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusStoragePoolMethodTable[] = {
    { 0 }
};

static gchar **
virtDBusStoragePoolEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStoragePoolPtr) storagePools = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllStoragePools(connect->connection, &storagePools, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirStoragePool(storagePools[i],
                                                      connect->storagePoolPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo;

void
virtDBusStoragePoolRegister(virtDBusConnect *connect,
                            GError **error)
{
    connect->storagePoolPath = g_strdup_printf("%s/storagepool",
                                               connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_STORAGEPOOL_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->storagePoolPath,
                                 interfaceInfo,
                                 virtDBusStoragePoolEnumerate,
                                 virtDBusStoragePoolMethodTable,
                                 virtDBusStoragePoolPropertyTable,
                                 connect);
}
