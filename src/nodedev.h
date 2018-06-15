#pragma once

#include "connect.h"

#define VIRT_DBUS_NODEDEV_INTERFACE "org.libvirt.NodeDevice"

void
virtDBusNodeDeviceRegister(virtDBusConnect *connect,
                           GError **error);
