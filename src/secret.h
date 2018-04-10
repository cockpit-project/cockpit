#pragma once

#include "connect.h"

#define VIRT_DBUS_SECRET_INTERFACE "org.libvirt.Secret"

void
virtDBusSecretRegister(virtDBusConnect *connect,
                       GError **error);
