#pragma once

#define VIR_ENUM_SENTINELS

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

struct VirtManager {
    sd_bus *bus;
    virConnectPtr connection;

    int callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};
typedef struct VirtManager VirtManager;

int virt_manager_new(VirtManager **managerp,
                     sd_bus *bus,
                     const char *uri);
VirtManager *virt_manager_free(VirtManager *manager);
void virt_manager_freep(VirtManager **managerp);
