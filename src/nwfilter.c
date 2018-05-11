#include "nwfilter.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virtDBusGDBusPropertyTable virtDBusNWFilterPropertyTable[] = {
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
