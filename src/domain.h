#pragma once

#include "connect.h"

#include <systemd/sd-bus.h>

#define VIRT_DBUS_DOMAIN_INTERFACE "org.libvirt.Domain"

int
virtDBusDomainRegister(virtDBusConnect *connect,
                       sd_bus *bus);
