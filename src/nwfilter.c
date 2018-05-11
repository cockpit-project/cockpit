#include "nwfilter.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virNWFilterPtr
virtDBusNWFilterGetVirNWFilter(virtDBusConnect *connect,
                               const gchar *objectPath,
                               GError **error)
{
    virNWFilterPtr nwfilter;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    nwfilter = virtDBusUtilVirNWFilterFromBusPath(connect->connection,
                                                  objectPath,
                                                  connect->nwfilterPath);
    if (!nwfilter) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return nwfilter;
}

static void
virtDBusNWFilterGetName(const gchar *objectPath,
                        gpointer userData,
                        GVariant **value,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNWFilter) nwfilter = NULL;
    const gchar *name;

    nwfilter = virtDBusNWFilterGetVirNWFilter(connect, objectPath, error);
    if (!nwfilter)
        return;

    name = virNWFilterGetName(nwfilter);
    if (!name)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", name);
}

static void
virtDBusNWFilterGetUUID(const gchar *objectPath,
                        gpointer userData,
                        GVariant **value,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNWFilter) nwfilter = NULL;
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";

    nwfilter = virtDBusNWFilterGetVirNWFilter(connect, objectPath, error);
    if (!nwfilter)
        return;

    if (virNWFilterGetUUIDString(nwfilter, uuid) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", uuid);
}

static virtDBusGDBusPropertyTable virtDBusNWFilterPropertyTable[] = {
    { "Name", virtDBusNWFilterGetName, NULL },
    { "UUID", virtDBusNWFilterGetUUID, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusNWFilterMethodTable[] = {
    { 0 }
};

static gchar **
virtDBusNWFilterEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virNWFilterPtr) nwfilters = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllNWFilters(connect->connection, &nwfilters, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirNWFilter(nwfilters[i],
                                                   connect->nwfilterPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo;

void
virtDBusNWFilterRegister(virtDBusConnect *connect,
                         GError **error)
{
    connect->nwfilterPath = g_strdup_printf("%s/nwfilter",
                                            connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_NWFILTER_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->nwfilterPath,
                                 interfaceInfo,
                                 virtDBusNWFilterEnumerate,
                                 virtDBusNWFilterMethodTable,
                                 virtDBusNWFilterPropertyTable,
                                 connect);
}
