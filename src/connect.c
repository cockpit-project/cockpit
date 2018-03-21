#include "connect.h"
#include "domain.h"
#include "events.h"
#include "util.h"

#include <glib/gprintf.h>

static gint virtDBusConnectCredType[] = {
    VIR_CRED_AUTHNAME,
    VIR_CRED_ECHOPROMPT,
    VIR_CRED_REALM,
    VIR_CRED_PASSPHRASE,
    VIR_CRED_NOECHOPROMPT,
    VIR_CRED_EXTERNAL,
};

static gint
virtDBusConnectAuthCallback(virConnectCredentialPtr cred G_GNUC_UNUSED,
                            guint ncred G_GNUC_UNUSED,
                            gpointer cbdata)
{
    GError **error = cbdata;
    g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                "Interactive authentication is not supported. "
                "Use client configuration file for libvirt.");
    return -1;
}

static virConnectAuth virtDBusConnectAuth = {
    virtDBusConnectCredType,
    G_N_ELEMENTS(virtDBusConnectCredType),
    virtDBusConnectAuthCallback,
    NULL,
};

static void
virtDBusConnectClose(virtDBusConnect *connect,
                     gboolean deregisterEvents)
{

    for (gint i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1) {
        if (connect->callback_ids[i] >= 0) {
            if (deregisterEvents) {
                virConnectDomainEventDeregisterAny(connect->connection,
                                                   connect->callback_ids[i]);
            }
            connect->callback_ids[i] = -1;
        }
    }

    virConnectClose(connect->connection);
    connect->connection = NULL;
}

gboolean
virtDBusConnectOpen(virtDBusConnect *connect,
                    GError **error)
{
    g_autoptr(GMutexLocker) lock = g_mutex_locker_new(&connect->lock);

    if (connect->connection) {
        if (virConnectIsAlive(connect->connection))
            return TRUE;
        else
            virtDBusConnectClose(connect, FALSE);
    }

    virtDBusConnectAuth.cbdata = error;

    connect->connection = virConnectOpenAuth(connect->uri,
                                             &virtDBusConnectAuth, 0);
    if (!connect->connection) {
        if (error && !*error)
            virtDBusUtilSetLastVirtError(error);
        return FALSE;
    }

    virtDBusEventsRegister(connect);

    return TRUE;
}

static void
virtDBusConnectListDomains(GVariant *inArgs,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath G_GNUC_UNUSED,
                           gpointer userData,
                           GVariant **outArgs,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomainPtr) domains = NULL;
    guint flags;
    GVariantBuilder builder;
    GVariant *gdomains;

    g_variant_get(inArgs, "(u)", &flags);

    if (!virtDBusConnectOpen(connect, error))
        return;

    if (virConnectListAllDomains(connect->connection, &domains, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    if (!*domains)
        return;

    g_variant_builder_init(&builder, G_VARIANT_TYPE("ao"));

    for (gint i = 0; domains[i]; i++) {
        g_autofree gchar *path = NULL;
        path = virtDBusUtilBusPathForVirDomain(domains[i],
                                               connect->domainPath);

        g_variant_builder_add(&builder, "o", path);
    }

    gdomains = g_variant_builder_end(&builder);
    *outArgs = g_variant_new_tuple(&gdomains, 1);
}

static void
virtDBusConnectCreateXML(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath G_GNUC_UNUSED,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *path = NULL;
    gchar *xml;
    guint flags;

    g_variant_get(inArgs, "(&su)", &xml, &flags);

    if (!virtDBusConnectOpen(connect, error))
        return;

    domain = virDomainCreateXML(connect->connection, xml, flags);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    *outArgs = g_variant_new("(o)", path);
}

static void
virtDBusConnectDefineXML(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath G_GNUC_UNUSED,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *path = NULL;
    gchar *xml;

    g_variant_get(inArgs, "(&s)", &xml);

    if (!virtDBusConnectOpen(connect, error))
        return;

    domain = virDomainDefineXML(connect->connection, xml);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    *outArgs = g_variant_new("(o)", path);
}

static virtDBusGDBusMethodTable virtDBusConnectMethodTable[] = {
    { "ListDomains", virtDBusConnectListDomains },
    { "CreateXML", virtDBusConnectCreateXML },
    { "DefineXML", virtDBusConnectDefineXML },
    { NULL, NULL }
};

static GDBusInterfaceInfo *interfaceInfo = NULL;

static void
virtDBusConnectFree(virtDBusConnect *connect)
{
    if (connect->connection)
        virtDBusConnectClose(connect, TRUE);

    g_free(connect->domainPath);
    g_free(connect);
}
G_DEFINE_AUTOPTR_CLEANUP_FUNC(virtDBusConnect, virtDBusConnectFree);

void
virtDBusConnectNew(virtDBusConnect **connectp,
                   GDBusConnection *bus,
                   const gchar *uri,
                   const gchar *connectPath,
                   GError **error)
{
    g_autoptr(virtDBusConnect) connect = NULL;

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_CONNECT_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    connect = g_new0(virtDBusConnect, 1);

    g_mutex_init(&connect->lock);

    for (gint i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1)
        connect->callback_ids[i] = -1;

    connect->bus = bus;
    connect->uri = uri;
    connect->connectPath = connectPath;

    virtDBusGDBusRegisterObject(bus,
                                connect->connectPath,
                                interfaceInfo,
                                virtDBusConnectMethodTable,
                                NULL,
                                connect);

    virtDBusDomainRegister(connect, error);
    if (error && *error)
        return;

    *connectp = connect;
    connect = NULL;
}

void
virtDBusConnectListFree(virtDBusConnect **connectList)
{
    if (!connectList)
        return;

    for (gint i = 0; connectList[i]; i += 1)
        virtDBusConnectFree(connectList[i]);

    g_free(connectList);
}
