#include "manager.h"
#include "util.h"

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>

struct VirtManager {
    sd_bus *bus;
    virConnectPtr connection;
};

extern const sd_bus_vtable virt_domain_vtable[];

static char *
domain_bus_path(virDomainPtr domain)
{
    char *path = NULL;

    sd_bus_path_encode("/org/libvirt/domain", virDomainGetName(domain), &path);

    return path;
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
        /* TODO error */
        return -EINVAL;

    paths = calloc(n_domains, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = domain_bus_path(domains[i]);

    *nodes = paths;
    paths = NULL;

    return 0;
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

    domain = virDomainLookupByName(manager->connection, name);
    if (!domain)
        return 0;

    *found = domain;

    return 1;
}

int
virt_manager_new(VirtManager **managerp, sd_bus *bus)
{
    static const sd_bus_vtable virt_manager_vtable[] = {
        SD_BUS_VTABLE_START(0),
        SD_BUS_METHOD("ListDomains", "u", "ao", method_list_domains, SD_BUS_VTABLE_UNPRIVILEGED),
        SD_BUS_VTABLE_END
    };

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
