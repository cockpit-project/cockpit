#pragma once

#define VIR_ENUM_SENTINELS

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

#define VIRT_DBUS_CONNECT_INTERFACE "org.libvirt.Connect"

struct virtDBusConnect {
    sd_bus *bus;
    const char *uri;
    const char *connectPath;
    char *domainPath;
    virConnectPtr connection;

    sd_bus_node_enumerator_t enumerateDomains;

    int callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};
typedef struct virtDBusConnect virtDBusConnect;

int
virtDBusConnectNew(virtDBusConnect **connectp,
                   sd_bus *bus,
                   const char *uri,
                   const char *connectPath);

int
virtDBusConnectOpen(virtDBusConnect *connect,
                    sd_bus_error *error);

virtDBusConnect *
virtDBusConnectFree(virtDBusConnect *connect);

void
virtDBusConnectFreep(virtDBusConnect **connectp);

void
virtDBusConnectListFree(virtDBusConnect ***connectList);
