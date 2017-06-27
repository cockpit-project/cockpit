#include "manager.h"
#include "util.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

struct VirtManager {
    sd_bus *bus;
    virConnectPtr connection;
};

static int method_list_domains(sd_bus_message *message, void *userdata, sd_bus_error *ret_error);

static const sd_bus_vtable virt_manager_vtable[] = {
    SD_BUS_VTABLE_START(0),
    SD_BUS_METHOD("ListDomains", "u", "as", method_list_domains, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_VTABLE_END
};

int
virt_manager_new(VirtManager **managerp, sd_bus *bus)
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    int r;

    manager = calloc(1, sizeof(VirtManager));
    manager->bus = sd_bus_ref(bus);

    manager->connection = virConnectOpenAuth("qemu:///session", virConnectAuthPtrDefault, 0);
    if (!manager->connection)
        /* TODO get libvirt error */
        return -EINVAL;

    r = sd_bus_add_object_vtable(manager->bus,
                                 NULL,
                                 "/org/libvirt/Manager",
                                 "org.libvirt",
                                 virt_manager_vtable,
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

    if (manager->connection)
        virConnectClose(manager->connection);

    free(manager);

    return NULL;
}

void
virt_manager_freep(VirtManager **managerp)
{
    if (*managerp)
        virt_manager_free(*managerp);
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
method_list_domains(sd_bus_message *message,
                    void *userdata,
                    sd_bus_error *ret_error)
{
    VirtManager *manager = userdata;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    _cleanup_(virDomainsFreep) virDomainPtr *domains = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0) {
        sd_bus_error_set_const(ret_error, "org.freedesktop.DBus.Error.InvalidArgs", "Invalid Arguments");
        return -EINVAL;
    }

    r = virConnectListAllDomains(manager->connection, &domains, flags);
    if (r < 0)
        /* TODO error */
        return -EINVAL;

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = sd_bus_message_open_container(reply, 'a', "s");
    if (r < 0)
        return r;

    for (int i = 0; domains[i] != NULL; i += 1) {
        r = sd_bus_message_append(reply, "s", virDomainGetName(domains[i]));
        if (r < 0)
            return r;
    }

    r = sd_bus_message_close_container(reply);
    if (r < 0)
        return r;

    return sd_bus_send(NULL, reply, NULL);
}
