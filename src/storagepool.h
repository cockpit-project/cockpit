#pragma once

#include "connect.h"

#define VIRT_DBUS_STORAGEPOOL_INTERFACE "org.libvirt.StoragePool"

void
virtDBusStoragePoolRegister(virtDBusConnect *connect,
                            GError **error);
