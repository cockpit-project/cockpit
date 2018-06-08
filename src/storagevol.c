#include "storagevol.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virStorageVolPtr
virtDBusStorageVolGetVirStorageVol(virtDBusConnect *connect,
                                   const gchar *objectPath,
                                   GError **error)
{
    virStorageVolPtr storageVol;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    storageVol = virtDBusUtilVirStorageVolFromBusPath(connect->connection,
                                                      objectPath,
                                                      connect->storageVolPath);
    if (!storageVol) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return storageVol;
}

static void
virtDBusStorageVolGetName(const gchar *objectPath,
                          gpointer userData,
                          GVariant **value,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    const gchar *name;

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    name = virStorageVolGetName(storageVol);
    if (!name)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", name);
}

static void
virtDBusStorageVolGetKey(const gchar *objectPath,
                         gpointer userData,
                         GVariant **value,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    const gchar *key;

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    key = virStorageVolGetKey(storageVol);
    if (!key)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", key);
}

static void
virtDBusStorageVolGetPath(const gchar *objectPath,
                          gpointer userData,
                          GVariant **value,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    g_autofree gchar *path = NULL;

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    path = virStorageVolGetPath(storageVol);
    if (!path)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", path);
}

static void
virtDBusStorageVolDelete(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs G_GNUC_UNUSED,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    if (virStorageVolDelete(storageVol, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusStorageVolGetInfo(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    virStorageVolInfo info;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    if (virStorageVolGetInfoFlags(storageVol, &info, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((itt))", info.type, info.capacity,
                             info.allocation);
}

static void
virtDBusStorageVolGetXMLDesc(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    g_autofree gchar *xml = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    xml = virStorageVolGetXMLDesc(storageVol, flags);
    if (!xml)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", xml);
}

static void
virtDBusStorageVolResize(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs G_GNUC_UNUSED,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    guint64 capacity;
    guint flags;

    g_variant_get(inArgs, "(tu)", &capacity, &flags);

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    if (virStorageVolResize(storageVol, capacity, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusStorageVolWipe(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStorageVol) storageVol = NULL;
    guint pattern;
    guint flags;

    g_variant_get(inArgs, "(uu)", &pattern, &flags);

    storageVol = virtDBusStorageVolGetVirStorageVol(connect, objectPath,
                                                    error);
    if (!storageVol)
        return;

    if (virStorageVolWipePattern(storageVol, pattern, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusStorageVolPropertyTable[] = {
    { "Name", virtDBusStorageVolGetName, NULL },
    { "Key", virtDBusStorageVolGetKey, NULL },
    { "Path", virtDBusStorageVolGetPath, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusStorageVolMethodTable[] = {
    { "Delete", virtDBusStorageVolDelete },
    { "GetInfo", virtDBusStorageVolGetInfo },
    { "GetXMLDesc", virtDBusStorageVolGetXMLDesc },
    { "Resize", virtDBusStorageVolResize },
    { "Wipe", virtDBusStorageVolWipe },
    { 0 }
};

static gchar **
virtDBusStorageVolEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virStoragePoolPtr) storagePools = NULL;
    gint numPools = 0;
    GPtrArray *list = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    numPools = virConnectListAllStoragePools(connect->connection,
                                             &storagePools, 0);
    if (numPools <= 0)
        return NULL;

    list = g_ptr_array_new();

    for (gint i = 0; i < numPools; i++) {
        g_autoptr(virStorageVolPtr) storageVols = NULL;
        gint numVols;

        numVols = virStoragePoolListAllVolumes(storagePools[i],
                                               &storageVols, 0);
        if (numVols <= 0)
            continue;

        for (gint j = 0; j < numVols; j++) {
            gchar *volPath = virtDBusUtilBusPathForVirStorageVol(storageVols[j],
                                                                 connect->storageVolPath);
            g_ptr_array_add(list, volPath);
        }
    }

    if (list->len > 0)
        g_ptr_array_add(list, NULL);

    return (gchar **)g_ptr_array_free(list, FALSE);
}

static GDBusInterfaceInfo *interfaceInfo;

void
virtDBusStorageVolRegister(virtDBusConnect *connect,
                           GError **error)
{
    connect->storageVolPath = g_strdup_printf("%s/storagevol",
                                              connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_STORAGEVOL_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->storageVolPath,
                                 interfaceInfo,
                                 virtDBusStorageVolEnumerate,
                                 virtDBusStorageVolMethodTable,
                                 virtDBusStorageVolPropertyTable,
                                 connect);
}
