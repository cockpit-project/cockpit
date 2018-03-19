#include "domain.h"
#include "events.h"
#include "util.h"

#include <libvirt/libvirt.h>

static gint
virtDBusEventsDomainLifecycle(virConnectPtr connection G_GNUC_UNUSED,
                              virDomainPtr domain,
                              gint event,
                              gint detail G_GNUC_UNUSED,
                              gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    const gchar *signal = NULL;
    const gchar *name;
    g_autofree gchar *path = NULL;

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

    name = virDomainGetName(domain);
    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  signal,
                                  g_variant_new("(so)", name, path),
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
