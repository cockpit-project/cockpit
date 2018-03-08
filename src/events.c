#include "domain.h"
#include "events.h"
#include "util.h"

#include <assert.h>
#include <systemd/sd-bus.h>

static int
virtDBusEventsDomainLifecycle(virConnectPtr connection VIRT_ATTR_UNUSED,
                              virDomainPtr domain,
                              int event,
                              int detail VIRT_ATTR_UNUSED,
                              void *opaque)
{
    virtDBusConnect *connect = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    const char *signal = NULL;
    const char *name;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    switch (event) {
    case VIR_DOMAIN_EVENT_DEFINED:
        signal = "DomainDefined";
        break;
    case VIR_DOMAIN_EVENT_UNDEFINED:
        signal = "DomainUndefined";
        break;
    case VIR_DOMAIN_EVENT_STARTED:
        signal = "DomainStarted";
        break;
    case VIR_DOMAIN_EVENT_SUSPENDED:
        signal = "DomainSuspended";
        break;
    case VIR_DOMAIN_EVENT_RESUMED:
        signal = "DomainResumed";
        break;
    case VIR_DOMAIN_EVENT_STOPPED:
        signal = "DomainStopped";
        break;
    case VIR_DOMAIN_EVENT_SHUTDOWN:
        signal = "DomainShutdown";
        break;
    case VIR_DOMAIN_EVENT_PMSUSPENDED:
        signal = "DomainPMSuspended";
        break;
    case VIR_DOMAIN_EVENT_CRASHED:
        signal = "DomainCrashed";
        break;
    default:
        return 0;
    }

    r = sd_bus_message_new_signal(connect->bus,
                                  &message,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  signal);
    if (r < 0)
        return r;

    name = virDomainGetName(domain);
    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    r = sd_bus_message_append(message, "so", name ? : "", path);
    if (r < 0)
        return r;

    return sd_bus_send(connect->bus, message, NULL);
}

static int
virtDBusEventsDomainDeviceAdded(virConnectPtr connection VIRT_ATTR_UNUSED,
                                virDomainPtr domain,
                                const char *device,
                                void *opaque)
{
    virtDBusConnect *connect = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    r = sd_bus_message_new_signal(connect->bus,
                                  &message,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DeviceAdded");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(connect->bus, message, NULL);
}

static int
virtDBusEventsDomainDeviceRemoved(virConnectPtr connection VIRT_ATTR_UNUSED,
                                  virDomainPtr domain,
                                  const char *device,
                                  void *opaque)
{
    virtDBusConnect *connect = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    r = sd_bus_message_new_signal(connect->bus,
                                  &message,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DeviceRemoved");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(connect->bus, message, NULL);
}

static int
virtDBusEventsDomainDiskChange(virConnectPtr connection VIRT_ATTR_UNUSED,
                               virDomainPtr domain,
                               const char *device,
                               int reason,
                               void *opaque)
{
    virtDBusConnect *connect = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    r = sd_bus_message_new_signal(connect->bus,
                                  &message,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "TrayChange");
    if (r < 0)
        return r;

    switch (reason) {
    case VIR_DOMAIN_EVENT_TRAY_CHANGE_OPEN:
        reasonstr = "open";
        break;
    case VIR_DOMAIN_EVENT_TRAY_CHANGE_CLOSE:
        reasonstr = "close";
        break;
    default:
        reasonstr = "";
        break;
    }

    r = sd_bus_message_append(message, "ssss", device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(connect->bus, message, NULL);
}

static int
virtDBusEventsDomainTrayChange(virConnectPtr connection VIRT_ATTR_UNUSED,
                               virDomainPtr domain,
                               const char *old_src_path,
                               const char *new_src_path,
                               const char *device,
                               int reason,
                               void *opaque)
{
    virtDBusConnect *connect = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    r = sd_bus_message_new_signal(connect->bus,
                                  &message,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DiskChange");
    if (r < 0)
        return r;

    switch (reason) {
    case VIR_DOMAIN_EVENT_DISK_CHANGE_MISSING_ON_START:
        reasonstr = "missing-on-start";
        break;
    case VIR_DOMAIN_EVENT_DISK_DROP_MISSING_ON_START:
        reasonstr = "missing-on-start";
        break;
    default:
        reasonstr = "";
        break;
    }

    r = sd_bus_message_append(message, "ssss", old_src_path, new_src_path, device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(connect->bus, message, NULL);
}

static void
virtDBusEventsRegisterEvent(virtDBusConnect *connect,
                            int id,
                            virConnectDomainEventGenericCallback callback)
{
    assert(connect->callback_ids[id] == -1);

    connect->callback_ids[id] = virConnectDomainEventRegisterAny(connect->connection,
                                                                 NULL,
                                                                 id,
                                                                 VIR_DOMAIN_EVENT_CALLBACK(callback),
                                                                 connect,
                                                                 NULL);
}

void
virtDBusEventsRegister(virtDBusConnect *connect)
{
    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainLifecycle));

    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceAdded));

    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceRemoved));

    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTrayChange));

    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDiskChange));

}
