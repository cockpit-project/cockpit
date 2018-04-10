#include "secret.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virtDBusGDBusPropertyTable virtDBusSecretPropertyTable[] = {
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusSecretMethodTable[] = {
    { 0 }
};

static gchar **
virtDBusSecretEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecretPtr) secrets = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllSecrets(connect->connection, &secrets, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirSecret(secrets[i],
                                                 connect->secretPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo;

void
virtDBusSecretRegister(virtDBusConnect *connect,
                       GError **error)
{
    connect->secretPath = g_strdup_printf("%s/secret", connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_SECRET_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->secretPath,
                                 interfaceInfo,
                                 virtDBusSecretEnumerate,
                                 virtDBusSecretMethodTable,
                                 virtDBusSecretPropertyTable,
                                 connect);
}
