#pragma once

#define VIR_ENUM_SENTINELS

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

struct virtDBusManager {
    sd_bus *bus;
    virConnectPtr connection;

    int callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};
typedef struct virtDBusManager virtDBusManager;

int virtDBusManagerNew(virtDBusManager **managerp,
                       sd_bus *bus,
                       const char *uri);
virtDBusManager *virtDBusManagerFree(virtDBusManager *manager);
void virtDBusManagerFreep(virtDBusManager **managerp);
