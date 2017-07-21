#include "domain.h"
#include "manager.h"
#include "util.h"

#include <assert.h>
#include <errno.h>
#include <stdlib.h>

static int
enumerate_domains(sd_bus *bus,
                  const char *path,
                  void *userdata,
                  char ***nodes,
                  sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainListFreep) virDomainPtr *domains = NULL;
    _cleanup_(strv_freep) char **paths = NULL;
    int n_domains;

    n_domains = virConnectListAllDomains(manager->connection, &domains, 0);
    if (n_domains < 0)
        return bus_error_set_last_virt_error(error);

    paths = calloc(n_domains + 1, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = bus_path_for_domain(domains[i]);

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
    _cleanup_(virDomainListFreep) virDomainPtr *domains = NULL;
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

        path = bus_path_for_domain(domains[i]);

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

    path = bus_path_for_domain(domain);

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

    path = bus_path_for_domain(domain);

    return sd_bus_reply_method_return(message, "o", path);
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
    path = bus_path_for_domain(domain);

    r = sd_bus_message_append(message, "so", name ? : "", path);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_device_added_event(virConnectPtr connection,
                                 virDomainPtr domain,
                                 const char *device,
                                 void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceAdded");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_device_removed_event(virConnectPtr connection,
                                   virDomainPtr domain,
                                   const char *device,
                                   void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceRemoved");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_disk_change_event(virConnectPtr connection,
                                virDomainPtr domain,
                                const char *device,
                                int reason,
                                void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "TrayChange");
    if (r < 0)
        return r;

    switch (reason) {
        case VIR_DOMAIN_EVENT_TRAY_CHANGE_OPEN:
            reasonstr = "open";
            break;
        case VIR_DOMAIN_EVENT_TRAY_CHANGE_CLOSE:
            reasonstr = "close";
            break;
        default:
            reasonstr = "";
            break;
    }

    r = sd_bus_message_append(message, "ssss", device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_tray_change_event(virConnectPtr connection,
                                virDomainPtr domain,
                                const char *old_src_path,
                                const char *new_src_path,
                                const char *device,
                                int reason,
                                void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DiskChange");
    if (r < 0)
        return r;

    switch (reason) {
        case VIR_DOMAIN_EVENT_DISK_CHANGE_MISSING_ON_START:
            reasonstr = "missing-on-start";
            break;
        case VIR_DOMAIN_EVENT_DISK_DROP_MISSING_ON_START:
            reasonstr = "missing-on-start";
            break;
        default:
            reasonstr = "";
            break;
    }

    r = sd_bus_message_append(message, "ssss", old_src_path, new_src_path, device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static void
virt_manager_register_event(VirtManager *manager,
                            int id,
                            virConnectDomainEventGenericCallback callback)
{
    assert(manager->callback_ids[id] == -1);

    manager->callback_ids[id] = virConnectDomainEventRegisterAny(manager->connection,
                                                                 NULL,
                                                                 id,
                                                                 VIR_DOMAIN_EVENT_CALLBACK(callback),
                                                                 manager,
                                                                 NULL);
}

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

int
virt_manager_new(VirtManager **managerp,
                 sd_bus *bus,
                 const char *uri)
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    int r;

    manager = calloc(1, sizeof(VirtManager));
    for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1)
        manager->callback_ids[i] = -1;

    manager->bus = sd_bus_ref(bus);

    manager->connection = virConnectOpenAuth(uri, virConnectAuthPtrDefault, 0);
    if (!manager->connection)
        return -EINVAL;

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_lifecycle_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_device_added_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_device_removed_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_tray_change_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_disk_change_event));

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

    if ((r = domain_register(manager, bus) < 0))
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
virt_manager_freep(VirtManager **managerp)
{
    if (*managerp)
        virt_manager_free(*managerp);
}
