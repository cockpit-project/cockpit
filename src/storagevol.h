#pragma once

#include "connect.h"

#define VIRT_DBUS_STORAGEVOL_INTERFACE "org.libvirt.StorageVol"

void
virtDBusStorageVolRegister(virtDBusConnect *connect,
                           GError **error);
