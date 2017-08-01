#pragma once

#include "manager.h"

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

int
virtDBusDomainRegister(virtDBusManager *manager,
                       sd_bus *bus);
