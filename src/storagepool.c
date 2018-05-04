#include "storagepool.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virStoragePoolPtr
virtDBusStoragePoolGetVirStoragePool(virtDBusConnect *connect,
                                     const gchar *objectPath,
                                     GError **error)
{
    virStoragePoolPtr storagePool;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    storagePool = virtDBusUtilVirStoragePoolFromBusPath(connect->connection,
                                                        objectPath,
                                                        connect->storagePoolPath);
    if (!storagePool) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return storagePool;
}

static void
virtDBusStoragePoolBuild(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs G_GNUC_UNUSED,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStoragePool) storagePool = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    storagePool = virtDBusStoragePoolGetVirStoragePool(connect, objectPath,
                                                       error);
    if (!storagePool)
        return;

    if (virStoragePoolBuild(storagePool, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusStoragePoolDestroy(GVariant *inArgs G_GNUC_UNUSED,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs G_GNUC_UNUSED,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStoragePool) storagePool = NULL;

    storagePool = virtDBusStoragePoolGetVirStoragePool(connect, objectPath,
                                                       error);
    if (!storagePool)
        return;

    if (virStoragePoolDestroy(storagePool) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusStoragePoolPropertyTable[] = {
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusStoragePoolMethodTable[] = {
    { "Build", virtDBusStoragePoolBuild },
    { "Destroy", virtDBusStoragePoolDestroy },
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
