#pragma once

#include "connect.h"

#define VIRT_DBUS_NWFILTER_INTERFACE "org.libvirt.NWFilter"

void
virtDBusNWFilterRegister(virtDBusConnect *connect,
                         GError **error);
