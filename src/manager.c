#include "domain.h"
#include "events.h"
#include "manager.h"
#include "util.h"

#include <errno.h>
#include <stdlib.h>

static int
virtDBusManagerEnumarateDomains(sd_bus *bus,
                                const char *path,
                                void *userdata,
                                char ***nodes,
                                sd_bus_error *error)
{
    virtDBusManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainListFreep) virDomainPtr *domains = NULL;
    _cleanup_(virtDBusUtilStrvFreep) char **paths = NULL;
    int n_domains;

    n_domains = virConnectListAllDomains(manager->connection, &domains, 0);
    if (n_domains < 0)
        return virtDBusUtilSetLastVirtError(error);

    paths = calloc(n_domains + 1, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = virtDBusUtilBusPathForVirDomain(domains[i]);

    *nodes = paths;
    paths = NULL;

    return 0;
}

static int
virtDBusManagerListDomains(sd_bus_message *message,
                           void *userdata,
                           sd_bus_error *error)
{
    virtDBusManager *manager = userdata;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    _cleanup_(virtDBusUtilVirDomainListFreep) virDomainPtr *domains = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virConnectListAllDomains(manager->connection, &domains, flags);
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

        path = virtDBusUtilBusPathForVirDomain(domains[i]);

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
virtDBusManagerCreateXML(sd_bus_message *message,
                         void *userdata,
                         sd_bus_error *error)
{
    virtDBusManager *manager = userdata;
    const char *xml;
    uint32_t flags;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "su", &xml, &flags);
    if (r < 0)
        return r;

    domain = virDomainCreateXML(manager->connection, xml, flags);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
virtDBusManagerDefineXML(sd_bus_message *message,
                         void *userdata,
                         sd_bus_error *error)
{
    virtDBusManager *manager = userdata;
    const char *xml;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "s", &xml);
    if (r < 0)
        return r;

    domain = virDomainDefineXML(manager->connection, xml);
    if (!domain)
        return virtDBusUtilSetLastVirtError(error);

    path = virtDBusUtilBusPathForVirDomain(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static const sd_bus_vtable virt_manager_vtable[] = {
    SD_BUS_VTABLE_START(0),

    SD_BUS_METHOD("ListDomains", "u", "ao", virtDBusManagerListDomains, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("CreateXML", "su", "o", virtDBusManagerCreateXML, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("DefineXML", "s", "o", virtDBusManagerDefineXML, SD_BUS_VTABLE_UNPRIVILEGED),

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
virtDBusManagerNew(virtDBusManager **managerp,
                   sd_bus *bus,
                   const char *uri)
{
    _cleanup_(virtDBusManagerFreep) virtDBusManager *manager = NULL;
    int r;

    manager = calloc(1, sizeof(virtDBusManager));
    for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1)
        manager->callback_ids[i] = -1;

    manager->bus = sd_bus_ref(bus);

    manager->connection = virConnectOpenAuth(uri, virConnectAuthPtrDefault, 0);
    if (!manager->connection)
        return -EINVAL;

    virtDBusEventsRegister(manager);

    r = sd_bus_add_object_vtable(manager->bus,
                                 NULL,
                                 "/org/libvirt/Manager",
                                 "org.libvirt.Manager",
                                 virt_manager_vtable,
                                 manager);
    if (r < 0)
        return r;

    r = sd_bus_add_node_enumerator(bus, NULL, "/org/libvirt/domain", virtDBusManagerEnumarateDomains, manager);
    if (r < 0)
        return r;

    if ((r = virtDBusDomainRegister(manager, bus) < 0))
        return r;

    *managerp = manager;
    manager = NULL;

    return 0;
}

virtDBusManager *
virtDBusManagerFree(virtDBusManager *manager)
{
    if (manager->bus)
        sd_bus_unref(manager->bus);

    if (manager->connection) {
        for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1) {
            if (manager->callback_ids[i] >= 0)
                virConnectDomainEventDeregisterAny(manager->connection, manager->callback_ids[i]);
        }

        virConnectClose(manager->connection);
    }

    free(manager);

    return NULL;
}

void
virtDBusManagerFreep(virtDBusManager **managerp)
{
    if (*managerp)
        virtDBusManagerFree(*managerp);
}
