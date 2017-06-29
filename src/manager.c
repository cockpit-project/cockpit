#include "manager.h"
#include "util.h"

#include <errno.h>
#include <stdlib.h>

struct VirtManager {
    sd_bus *bus;
    virConnectPtr connection;

    int lifecycle_event_id;
};

extern const sd_bus_vtable virt_domain_vtable[];

static char *
domain_bus_path(virDomainPtr domain)
{
    char *path = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    virDomainGetUUIDString(domain, uuid);
    sd_bus_path_encode("/org/libvirt/domain", uuid, &path);

    return path;
}

static void
virDomainFreep(virDomainPtr *domainp)
{
    if (*domainp)
        virDomainFree(*domainp);
}

static void
virDomainsFreep(virDomainPtr **domainsp)
{
    virDomainPtr *domains = *domainsp;

    if (!domains)
        return;

    for (int i = 0; domains[i] != NULL; i += 1)
        virDomainFree(domains[i]);

    free(domains);
}

static int
enumerate_domains(sd_bus *bus,
                  const char *path,
                  void *userdata,
                  char ***nodes,
                  sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainsFreep) virDomainPtr *domains = NULL;
    _cleanup_(strv_freep) char **paths = NULL;
    int n_domains;

    n_domains = virConnectListAllDomains(manager->connection, &domains, 0);
    if (n_domains < 0)
        return bus_error_set_last_virt_error(error);

    paths = calloc(n_domains + 1, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = domain_bus_path(domains[i]);

    *nodes = paths;
    paths = NULL;

    return 0;
}

static int
virt_manager_list_domains(sd_bus_message *message,
                          void *userdata,
                          sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    _cleanup_(virDomainsFreep) virDomainPtr *domains = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virConnectListAllDomains(manager->connection, &domains, flags);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = sd_bus_message_open_container(reply, 'a', "o");
    if (r < 0)
        return r;

    for (int i = 0; domains[i] != NULL; i += 1) {
        _cleanup_(freep) char *path = NULL;

        path = domain_bus_path(domains[i]);

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
virt_manager_create_xml(sd_bus_message *message,
                        void *userdata,
                        sd_bus_error *error)
{
    VirtManager *manager = userdata;
    const char *xml;
    uint32_t flags;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "su", &xml, &flags);
    if (r < 0)
        return r;

    domain = virDomainCreateXML(manager->connection, xml, flags);
    if (!domain)
        return bus_error_set_last_virt_error(error);

    path = domain_bus_path(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
virt_manager_define_xml(sd_bus_message *message,
                        void *userdata,
                        sd_bus_error *error)
{
    VirtManager *manager = userdata;
    const char *xml;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "s", &xml);
    if (r < 0)
        return r;

    domain = virDomainDefineXML(manager->connection, xml);
    if (!domain)
        return bus_error_set_last_virt_error(error);

    path = domain_bus_path(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
domain_find(sd_bus *bus,
            const char *path,
            const char *interface,
            void *userdata,
            void **found,
            sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(freep) char *name = NULL;
    virDomainPtr domain;
    int r;

    r = sd_bus_path_decode(path, "/org/libvirt/domain", &name);
    if (r < 0)
        return r;

    if (*name == '\0')
        return 0;

    domain = virDomainLookupByUUIDString(manager->connection, name);
    if (!domain)
        return 0;

    *found = domain;

    return 1;
}

static int
handle_domain_lifecycle_event(virConnectPtr connection,
                              virDomainPtr domain,
                              int event,
                              int detail,
                              void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    const char *signal = NULL;
    const char *name;
    _cleanup_(freep) char *path = NULL;
    int r;

    switch (event) {
        case VIR_DOMAIN_EVENT_DEFINED:
            signal = "DomainDefined";
            break;
        case VIR_DOMAIN_EVENT_UNDEFINED:
            signal = "DomainUndefined";
            break;
        case VIR_DOMAIN_EVENT_STARTED:
            signal = "DomainStarted";
            break;
        case VIR_DOMAIN_EVENT_SUSPENDED:
            signal = "DomainSuspended";
            break;
        case VIR_DOMAIN_EVENT_RESUMED:
            signal = "DomainResumed";
            break;
        case VIR_DOMAIN_EVENT_STOPPED:
            signal = "DomainStopped";
            break;
        case VIR_DOMAIN_EVENT_SHUTDOWN:
            signal = "DomainShutdown";
            break;
        case VIR_DOMAIN_EVENT_PMSUSPENDED:
            signal = "DomainPMSuspended";
            break;
        case VIR_DOMAIN_EVENT_CRASHED:
            signal = "DomainCrashed";
            break;
        default:
            return 0;
    }

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  "/org/libvirt/Manager",
                                  "org.libvirt.Manager",
                                  signal);
    if (r < 0)
        return r;

    name = virDomainGetName(domain);
    path = domain_bus_path(domain);

    r = sd_bus_message_append(message, "so", name ? : "", path);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

int
virt_manager_new(VirtManager **managerp, sd_bus *bus)
{
    static const sd_bus_vtable virt_manager_vtable[] = {
        SD_BUS_VTABLE_START(0),

        SD_BUS_METHOD("ListDomains", "u", "ao", virt_manager_list_domains, SD_BUS_VTABLE_UNPRIVILEGED),
        SD_BUS_METHOD("CreateXML", "su", "o", virt_manager_create_xml, SD_BUS_VTABLE_UNPRIVILEGED),
        SD_BUS_METHOD("DefineXML", "s", "o", virt_manager_define_xml, SD_BUS_VTABLE_UNPRIVILEGED),

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

    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    int r;

    manager = calloc(1, sizeof(VirtManager));
    manager->bus = sd_bus_ref(bus);

    manager->connection = virConnectOpenAuth("qemu:///session", virConnectAuthPtrDefault, 0);
    if (!manager->connection)
        return -EINVAL;

    manager->lifecycle_event_id = virConnectDomainEventRegisterAny(manager->connection,
                                                                   NULL,
                                                                   VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                                                   VIR_DOMAIN_EVENT_CALLBACK(handle_domain_lifecycle_event),
                                                                   manager,
                                                                   NULL);

    r = sd_bus_add_object_vtable(manager->bus,
                                 NULL,
                                 "/org/libvirt/Manager",
                                 "org.libvirt.Manager",
                                 virt_manager_vtable,
                                 manager);
    if (r < 0)
        return r;

    r = sd_bus_add_node_enumerator(bus, NULL, "/org/libvirt/domain", enumerate_domains, manager);
    if (r < 0)
        return r;

    r = sd_bus_add_fallback_vtable(bus,
                                   NULL,
                                   "/org/libvirt/domain",
                                   "org.libvirt.Domain",
                                   virt_domain_vtable,
                                   domain_find,
                                   manager);
    if (r < 0)
        return r;

    *managerp = manager;
    manager = NULL;

    return 0;
}

VirtManager *
virt_manager_free(VirtManager *manager)
{
    if (manager->bus)
        sd_bus_unref(manager->bus);

    if (manager->connection) {
        virConnectDomainEventDeregisterAny(manager->connection, manager->lifecycle_event_id);

        virConnectClose(manager->connection);
    }

    free(manager);

    return NULL;
}

void
virt_manager_freep(VirtManager **managerp)
{
    if (*managerp)
        virt_manager_free(*managerp);
}
