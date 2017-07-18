#include "domain.h"
#include "events.h"
#include "util.h"

#include <assert.h>
#include <systemd/sd-bus.h>

static int
virtDBusEventsDomainLifecycle(virConnectPtr connection,
                              virDomainPtr domain,
                              int event,
                              int detail,
                              void *opaque)
{
    virtDBusManager *manager = opaque;
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

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  "/org/libvirt/Manager",
                                  "org.libvirt.Manager",
                                  signal);
    if (r < 0)
        return r;

    name = virDomainGetName(domain);
    path = virtDBusUtilBusPathForVirDomain(domain);

    r = sd_bus_message_append(message, "so", name ? : "", path);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
virtDBusEventsDomainDeviceAdded(virConnectPtr connection,
                                virDomainPtr domain,
                                const char *device,
                                void *opaque)
{
    virtDBusManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceAdded");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
virtDBusEventsDomainDeviceRemoved(virConnectPtr connection,
                                  virDomainPtr domain,
                                  const char *device,
                                  void *opaque)
{
    virtDBusManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceRemoved");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
virtDBusEventsDomainDiskChange(virConnectPtr connection,
                               virDomainPtr domain,
                               const char *device,
                               int reason,
                               void *opaque)
{
    virtDBusManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
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

    return sd_bus_send(manager->bus, message, NULL);
}

static int
virtDBusEventsDomainTrayChange(virConnectPtr connection,
                               virDomainPtr domain,
                               const char *old_src_path,
                               const char *new_src_path,
                               const char *device,
                               int reason,
                               void *opaque)
{
    virtDBusManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(virtDBusUtilFreep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = virtDBusUtilBusPathForVirDomain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
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

    return sd_bus_send(manager->bus, message, NULL);
}

static void
virtDBusEventsRegisterEvent(virtDBusManager *manager,
                            int id,
                            virConnectDomainEventGenericCallback callback)
{
    assert(manager->callback_ids[id] == -1);

    manager->callback_ids[id] = virConnectDomainEventRegisterAny(manager->connection,
                                                                 NULL,
                                                                 id,
                                                                 VIR_DOMAIN_EVENT_CALLBACK(callback),
                                                                 manager,
                                                                 NULL);
}

void
virtDBusEventsRegister(virtDBusManager *manager)
{
    virtDBusEventsRegisterEvent(manager,
                                VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainLifecycle));

    virtDBusEventsRegisterEvent(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceAdded));

    virtDBusEventsRegisterEvent(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceRemoved));

    virtDBusEventsRegisterEvent(manager,
                                VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTrayChange));

    virtDBusEventsRegisterEvent(manager,
                                VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDiskChange));

}
