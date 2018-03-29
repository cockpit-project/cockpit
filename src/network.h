#pragma once

#include "connect.h"

#define VIRT_DBUS_NETWORK_INTERFACE "org.libvirt.Network"

void
virtDBusNetworkRegister(virtDBusConnect *connect,
                        GError **error);
