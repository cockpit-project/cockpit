#include "domain.h"
#include "events.h"
#include "util.h"

#include <libvirt/libvirt.h>

VIRT_DBUS_ENUM_DECL(virtDBusEventsDomainEvent)
VIRT_DBUS_ENUM_IMPL(virtDBusEventsDomainEvent,
                    VIR_DOMAIN_EVENT_LAST,
                    "Defined",
                    "Undefined",
                    "Started",
                    "Suspended",
                    "Resumed",
                    "Stopped",
                    "Shutdown",
                    "PMSuspended",
                    "Crashed")

static const gchar *
virtDBusEventsDomainEventToString(gint event)
{
    const gchar *str = virtDBusEventsDomainEventTypeToString(event);
    return str ? str : "unknown";
}

static gint
virtDBusEventsDomainLifecycle(virConnectPtr connection G_GNUC_UNUSED,
                              virDomainPtr domain,
                              gint event,
                              gint detail G_GNUC_UNUSED,
                              gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    const gchar *eventStr = virtDBusEventsDomainEventToString(event);

    if (!eventStr)
        return 0;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "DomainEvent",
                                  g_variant_new("(os)", path, eventStr),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainDeviceAdded(virConnectPtr connection G_GNUC_UNUSED,
                                virDomainPtr domain,
                                const gchar *device,
                                gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DeviceAdded",
                                  g_variant_new("(s)", device),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainDeviceRemoved(virConnectPtr connection G_GNUC_UNUSED,
                                  virDomainPtr domain,
                                  const gchar *device,
                                  gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DeviceRemoved",
                                  g_variant_new("(s)", device),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainTrayChange(virConnectPtr connection G_GNUC_UNUSED,
                               virDomainPtr domain,
                               const gchar *device,
                               gint reason,
                               gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    const gchar *reasonstr;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

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

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "TrayChange",
                                  g_variant_new("(ss)", device, reasonstr),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainDiskChange(virConnectPtr connection G_GNUC_UNUSED,
                               virDomainPtr domain,
                               const gchar *old_src_path,
                               const gchar *new_src_path,
                               const gchar *device,
                               gint reason,
                               gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    const gchar *reasonstr;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

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

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DiskChange",
                                  g_variant_new("(ssss)", old_src_path,
                                                new_src_path, device, reasonstr),
                                  NULL);

    return 0;
}

static void
virtDBusEventsRegisterEvent(virtDBusConnect *connect,
                            gint id,
                            virConnectDomainEventGenericCallback callback)
{
    g_assert(connect->callback_ids[id] == -1);

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
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDiskChange));

    virtDBusEventsRegisterEvent(connect,
                                VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTrayChange));

}
