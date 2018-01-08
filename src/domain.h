#pragma once

#include "connect.h"

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

int
virtDBusDomainRegister(virtDBusConnect *connect,
                       sd_bus *bus);
