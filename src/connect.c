#include "domain.h"
#include "events.h"
#include "connect.h"
#include "util.h"

#include <errno.h>
#include <stdbool.h>
#include <stdlib.h>

static int virtDBusConnectCredType[] = {
    VIR_CRED_AUTHNAME,
    VIR_CRED_ECHOPROMPT,
    VIR_CRED_REALM,
    VIR_CRED_PASSPHRASE,
    VIR_CRED_NOECHOPROMPT,
    VIR_CRED_EXTERNAL,
};

static int
virtDBusConnectAuthCallback(virConnectCredentialPtr cred VIRT_ATTR_UNUSED,
                            unsigned int ncred VIRT_ATTR_UNUSED,
                            void *cbdata)
{
    sd_bus_error *error = cbdata;

    return virtDBusUtilSetError(error,
                                "Interactive authentication is not supported. "
                                "Use client configuration file for libvirt.");
}

static virConnectAuth virtDBusConnectAuth = {
    virtDBusConnectCredType,
    VIRT_N_ELEMENTS(virtDBusConnectCredType),
    virtDBusConnectAuthCallback,
    NULL,
};

static void
virtDBusConnectClose(virtDBusConnect *connect,
                     bool deregisterEvents)
{

    for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1) {
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

static int
virtDBusConnectOpen(virtDBusConnect *connect,
                    sd_bus_error *error)
{
    if (connect->connection) {
        if (virConnectIsAlive(connect->connection))
            return 0;
        else
            virtDBusConnectClose(connect, false);
    }

    virtDBusConnectAuth.cbdata = error;

    connect->connection = virConnectOpenAuth(connect->uri,
                                             &virtDBusConnectAuth, 0);
    if (!connect->connection)
        return virtDBusUtilSetLastVirtError(error);

    virtDBusEventsRegister(connect);

    return 0;
}

static int
virtDBusConnectEnumarateDomains(sd_bus *bus VIRT_ATTR_UNUSED,
                                const char *path VIRT_ATTR_UNUSED,
                                void *userdata,
                                char ***nodes,
                                sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainListFreep) virDomainPtr *domains = NULL;
    _cleanup_(virtDBusUtilStrvFreep) char **paths = NULL;
    int n_domains;
    int r;

    r = virtDBusConnectOpen(connect, error);
    if (r < 0)
        return r;

    n_domains = virConnectListAllDomains(connect->connection, &domains, 0);
    if (n_domains < 0)
        return virtDBusUtilSetLastVirtError(error);

    paths = calloc(n_domains + 1, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = virtDBusUtilBusPathForVirDomain(domains[i],
                                                   connect->domainPath);

    *nodes = paths;
    paths = NULL;

    return 0;
}

static int
virtDBusConnectListDomains(sd_bus_message *message,
                           void *userdata,
                           sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    _cleanup_(virtDBusUtilVirDomainListFreep) virDomainPtr *domains = NULL;
    uint32_t flags;
    int r;

    r = virtDBusConnectOpen(connect, error);
    if (r < 0)
        return r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virConnectListAllDomains(connect->connection, &domains, flags);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = sd_bus_message_open_container(reply, 'a', "o");
    if (r < 0)
        return r;

    for (int i = 0; domains[i] != NULL; i += 1) {
        _cleanup_(virtDBusUtilFreep) char *path = NULL;

        path = virtDBusUtilBusPathForVirDomain(domains[i],
                                               connect->domainPath);

        r = sd_bus_message_append(reply, "o", path);
        if (r < 0)
            return r;
    }

    r = sd_bus_message_close_container(reply);
    if (r < 0)
        return r;

    return sd_bus_send(NULL, reply, NULL);
}

static int
virtDBusConnectCreateXML(sd_bus_message *message,
                         void *userdata,
                         sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    const char *xml;
    uint32_t flags;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    r = virtDBusConnectOpen(connect, error);
    if (r < 0)
        return r;

    r = sd_bus_message_read(message, "su", &xml, &flags);
    if (r < 0)
        return r;

    domain = virDomainCreateXML(connect->connection, xml, flags);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
virtDBusConnectDefineXML(sd_bus_message *message,
                         void *userdata,
                         sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    const char *xml;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    r = virtDBusConnectOpen(connect, error);
    if (r < 0)
        return r;

    r = sd_bus_message_read(message, "s", &xml);
    if (r < 0)
        return r;

    domain = virDomainDefineXML(connect->connection, xml);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    return sd_bus_reply_method_return(message, "o", path);
}

static const sd_bus_vtable virt_connect_vtable[] = {
    SD_BUS_VTABLE_START(0),

    SD_BUS_METHOD("ListDomains", "u", "ao", virtDBusConnectListDomains, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("CreateXML", "su", "o", virtDBusConnectCreateXML, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("DefineXML", "s", "o", virtDBusConnectDefineXML, SD_BUS_VTABLE_UNPRIVILEGED),

    SD_BUS_SIGNAL("DomainDefined", "so", 0),
    SD_BUS_SIGNAL("DomainUndefined", "so", 0),
    SD_BUS_SIGNAL("DomainStarted", "so", 0),
    SD_BUS_SIGNAL("DomainSuspended", "so", 0),
    SD_BUS_SIGNAL("DomainResumed", "so", 0),
    SD_BUS_SIGNAL("DomainStopped", "so", 0),
    SD_BUS_SIGNAL("DomainShutdown", "so", 0),
    SD_BUS_SIGNAL("DomainPMSuspended", "so", 0),
    SD_BUS_SIGNAL("DomainCrashed", "so", 0),

    SD_BUS_VTABLE_END
};

int
virtDBusConnectNew(virtDBusConnect **connectp,
                   sd_bus *bus,
                   const char *uri,
                   const char *connectPath)
{
    _cleanup_(virtDBusConnectFreep) virtDBusConnect *connect = NULL;
    int r;

    connect = calloc(1, sizeof(virtDBusConnect));
    for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1)
        connect->callback_ids[i] = -1;

    connect->bus = sd_bus_ref(bus);
    connect->uri = uri;
    connect->connectPath = connectPath;

    connect->enumerateDomains = virtDBusConnectEnumarateDomains;

    r = sd_bus_add_object_vtable(connect->bus,
                                 NULL,
                                 connect->connectPath,
                                 "org.libvirt.Connect",
                                 virt_connect_vtable,
                                 connect);
    if (r < 0)
        return r;

    if ((r = virtDBusDomainRegister(connect, bus) < 0))
        return r;

    *connectp = connect;
    connect = NULL;

    return 0;
}

virtDBusConnect *
virtDBusConnectFree(virtDBusConnect *connect)
{
    if (connect->bus)
        sd_bus_unref(connect->bus);

    if (connect->connection)
        virtDBusConnectClose(connect, true);

    free(connect->domainPath);

    free(connect);

    return NULL;
}

void
virtDBusConnectFreep(virtDBusConnect **connectp)
{
    if (*connectp)
        virtDBusConnectFree(*connectp);
}

void
virtDBusConnectListFree(virtDBusConnect ***connectList)
{
    if (!*connectList)
        return;

    for (int i = 0; (*connectList)[i]; i += 1)
        virtDBusConnectFree((*connectList)[i]);

    free(*connectList);
}
