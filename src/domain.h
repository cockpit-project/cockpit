#pragma once

#include "connect.h"

#define VIRT_DBUS_DOMAIN_INTERFACE "org.libvirt.Domain"

void
virtDBusDomainRegister(virtDBusConnect *connect,
                       GError **error);
