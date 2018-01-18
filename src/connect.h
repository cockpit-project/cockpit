#pragma once

#define VIR_ENUM_SENTINELS

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

struct virtDBusConnect {
    sd_bus *bus;
    const char *uri;
    virConnectPtr connection;

    sd_bus_node_enumerator_t enumerateDomains;

    int callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};
typedef struct virtDBusConnect virtDBusConnect;

int virtDBusConnectNew(virtDBusConnect **connectp,
                       sd_bus *bus,
                       const char *uri);
virtDBusConnect *virtDBusConnectFree(virtDBusConnect *connect);
void virtDBusConnectFreep(virtDBusConnect **connectp);
