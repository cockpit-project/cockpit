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
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "DomainEvent",
                                  g_variant_new("(ou)", path, event),
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

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "TrayChange",
                                  g_variant_new("(su)", device, reason),
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

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "DiskChange",
                                  g_variant_new("(sssu)", old_src_path,
                                                new_src_path, device, reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsNetworkLifecycle(virConnectPtr connection G_GNUC_UNUSED,
                               virNetworkPtr network,
                               gint event,
                               gint detail G_GNUC_UNUSED,
                               gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirNetwork(network, connect->networkPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "NetworkEvent",
                                  g_variant_new("(ou)", path, event),
                                  NULL);

    return 0;
}

static void
virtDBusEventsRegisterDomainEvent(virtDBusConnect *connect,
                                  gint id,
                                  virConnectDomainEventGenericCallback callback)
{
    g_assert(connect->domainCallbackIds[id] == -1);

    connect->domainCallbackIds[id] = virConnectDomainEventRegisterAny(connect->connection,
                                                                      NULL,
                                                                      id,
                                                                      VIR_DOMAIN_EVENT_CALLBACK(callback),
                                                                      connect,
                                                                      NULL);
}

static void
virtDBusEventsRegisterNetworkEvent(virtDBusConnect *connect,
                                   gint id,
                                   virConnectNetworkEventGenericCallback callback)
{
    g_assert(connect->networkCallbackIds[id] == -1);

    connect->networkCallbackIds[id] = virConnectNetworkEventRegisterAny(connect->connection,
                                                                        NULL,
                                                                        id,
                                                                        VIR_NETWORK_EVENT_CALLBACK(callback),
                                                                        connect,
                                                                        NULL);
}

void
virtDBusEventsRegister(virtDBusConnect *connect)
{
    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainLifecycle));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceAdded));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceRemoved));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDiskChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTrayChange));

    virtDBusEventsRegisterNetworkEvent(connect,
                                       VIR_NETWORK_EVENT_ID_LIFECYCLE,
                                       VIR_NETWORK_EVENT_CALLBACK(virtDBusEventsNetworkLifecycle));
}
