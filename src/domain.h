#pragma once

#include "manager.h"

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

int domain_register(VirtManager *manager,
                    sd_bus *bus);
