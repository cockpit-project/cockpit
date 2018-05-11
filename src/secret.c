#include "secret.h"
#include "util.h"

#include <libvirt/libvirt.h>

static virSecretPtr
virtDBusSecretGetVirSecret(virtDBusConnect *connect,
                           const gchar *objectPath,
                           GError **error)
{
    virSecretPtr secret;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    secret = virtDBusUtilVirSecretFromBusPath(connect->connection,
                                              objectPath,
                                              connect->secretPath);
    if (!secret) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return secret;
}

static void
virtDBusSecretGetUUID(const gchar *objectPath,
                      gpointer userData,
                      GVariant **value,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    if (virSecretGetUUIDString(secret, uuid) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", uuid);
}

static void
virtDBusSecretGetUsageID(const gchar *objectPath,
                         gpointer userData,
                         GVariant **value,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    const gchar *usageID;

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    usageID = virSecretGetUsageID(secret);
    if (!usageID)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", usageID);
}

static void
virtDBusSecretGetUsageType(const gchar *objectPath,
                           gpointer userData,
                           GVariant **value,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    gint usageType;

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    usageType = virSecretGetUsageType(secret);
    if (usageType < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("i", usageType);
}

static void
virtDBusSecretGetValue(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    g_autofree guchar *value =  NULL;
    gsize size;
    guint flags;
    GVariantBuilder builder;
    GVariant *res;

    g_variant_get(inArgs, "(u)", &flags);

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    value = virSecretGetValue(secret, &size, flags);
    if (!value)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("ay"));
    for (unsigned int i = 0; i < size; i++)
        g_variant_builder_add(&builder, "y", value[i]);

    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
}

static void
virtDBusSecretGetXMLDesc(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    g_autofree gchar *xml = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    xml = virSecretGetXMLDesc(secret, flags);
    if (!xml)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", xml);
}

static void
virtDBusSecretSetValue(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    guint flags;
    g_autofree guchar *value = NULL;
    guchar *tmp;
    gsize size;

    g_variant_get(inArgs, "(ayu)", &iter, &flags);

    size = g_variant_iter_n_children(iter);
    value = g_new0(guchar, size);
    tmp = value;
    while (g_variant_iter_next(iter, "y", tmp))
        tmp++;

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    if (virSecretSetValue(secret, value, size, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusSecretUndefine(GVariant *inArgs G_GNUC_UNUSED,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virSecret) secret = NULL;

    secret = virtDBusSecretGetVirSecret(connect, objectPath, error);
    if (!secret)
        return;

    if (virSecretUndefine(secret) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusSecretPropertyTable[] = {
    { "UUID", virtDBusSecretGetUUID, NULL },
    { "UsageID", virtDBusSecretGetUsageID, NULL },
    { "UsageType", virtDBusSecretGetUsageType, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusSecretMethodTable[] = {
    { "GetXMLDesc", virtDBusSecretGetXMLDesc },
    { "Undefine", virtDBusSecretUndefine },
    { "GetValue", virtDBusSecretGetValue },
    { "SetValue", virtDBusSecretSetValue },
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
