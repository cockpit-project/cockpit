#pragma once

#define VIR_ENUM_SENTINELS

#include "util.h"

#include <libvirt/libvirt.h>

#define VIRT_DBUS_CONNECT_INTERFACE "org.libvirt.Connect"

struct virtDBusConnect {
    GDBusConnection *bus;
    const gchar *uri;
    const gchar *connectPath;
    gchar *domainPath;
    virConnectPtr connection;
    GMutex lock;

    gint callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};
typedef struct virtDBusConnect virtDBusConnect;

void
virtDBusConnectNew(virtDBusConnect **connectp,
                   GDBusConnection *bus,
                   const gchar *uri,
                   const gchar *connectPath,
                   GError **error);

gboolean
virtDBusConnectOpen(virtDBusConnect *connect,
                    GError **error);

void
virtDBusConnectListFree(virtDBusConnect **connectList);
