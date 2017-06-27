#pragma once

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

typedef struct VirtManager VirtManager;

int virt_manager_new(VirtManager **managerp, sd_bus *bus);
VirtManager *virt_manager_free(VirtManager *manager);
void virt_manager_freep(VirtManager **managerp);
