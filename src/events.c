#include "domain.h"
#include "events.h"
#include "util.h"
#include "storagepool.h"

#include <libvirt/libvirt.h>

static gint
virtDBusEventsDomainAgentEvent(virConnectPtr connection G_GNUC_UNUSED,
                               virDomainPtr domain,
                               gint state,
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
                                  "AgentEvent",
                                  g_variant_new("(ii)", state, reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainBalloonChange(virConnectPtr connection G_GNUC_UNUSED,
                                  virDomainPtr domain,
                                  guint64 actual,
                                  gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "BalloonChange",
                                  g_variant_new("(t)", actual),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainBlockJob(virConnectPtr connection G_GNUC_UNUSED,
                             virDomainPtr domain,
                             gchar *disk,
                             gint type,
                             gint status,
                             gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "BlockJob",
                                  g_variant_new("(sii)", disk, type, status),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainControlError(virConnectPtr connection G_GNUC_UNUSED,
                                 virDomainPtr domain,
                                 gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "ControlError",
                                  NULL,
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainEvent(virConnectPtr connection G_GNUC_UNUSED,
                          virDomainPtr domain,
                          gint event,
                          gint detail,
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
                                  g_variant_new("(oii)", path, event, detail),
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
virtDBusEventsDomainDeviceRemovalFailed(virConnectPtr connection G_GNUC_UNUSED,
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
                                  "DeviceRemovalFailed",
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
virtDBusEventsDomainGraphics(virConnectPtr connection G_GNUC_UNUSED,
                             virDomainPtr domain,
                             gint phase,
                             const virDomainEventGraphicsAddress *local,
                             const virDomainEventGraphicsAddress *remote,
                             const gchar *authScheme,
                             const virDomainEventGraphicsSubject *subject,
                             gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    GVariantBuilder builder;
    GVariant *gret;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("(i(iss)(iss)sa(ss))"));

    g_variant_builder_add(&builder, "i", phase);

    g_variant_builder_open(&builder, G_VARIANT_TYPE("(iss)"));
    g_variant_builder_add(&builder, "i", local->family);
    g_variant_builder_add(&builder, "s", VIRT_DBUS_EMPTY_STR(local->node));
    g_variant_builder_add(&builder, "s", VIRT_DBUS_EMPTY_STR(local->service));
    g_variant_builder_close(&builder);

    g_variant_builder_open(&builder, G_VARIANT_TYPE("(iss)"));
    g_variant_builder_add(&builder, "i", remote->family);
    g_variant_builder_add(&builder, "s", VIRT_DBUS_EMPTY_STR(remote->node));
    g_variant_builder_add(&builder, "s", VIRT_DBUS_EMPTY_STR(remote->service));
    g_variant_builder_close(&builder);

    g_variant_builder_add(&builder, "s", authScheme);

    g_variant_builder_open(&builder, G_VARIANT_TYPE("a(ss)"));
    for (gint i = 0; i < subject->nidentity; i++) {
        g_variant_builder_open(&builder, G_VARIANT_TYPE("(ss)"));
        g_variant_builder_add(&builder, "s", subject->identities[i].type);
        g_variant_builder_add(&builder, "s", subject->identities[i].name);
        g_variant_builder_close(&builder);
    }
    g_variant_builder_close(&builder);
    gret = g_variant_builder_end(&builder);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "Graphics",
                                  gret,
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainIOError(virConnectPtr connection G_GNUC_UNUSED,
                            virDomainPtr domain,
                            const gchar *srcPath,
                            const gchar *device,
                            gint action,
                            const gchar *reason,
                            gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "IOError",
                                  g_variant_new("(ssis)", srcPath,
                                                VIRT_DBUS_EMPTY_STR(device),
                                                action, reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainJobCompleted(virConnectPtr connection G_GNUC_UNUSED,
                                 virDomainPtr domain,
                                 virTypedParameterPtr params,
                                 gint nparams,
                                 gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    GVariant *gargs;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    gargs = virtDBusUtilTypedParamsToGVariant(params, nparams);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "JobCompleted",
                                  g_variant_new_tuple(&gargs, 1),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainMetadataChange(virConnectPtr connection G_GNUC_UNUSED,
                                   virDomainPtr domain,
                                   gint type,
                                   const gchar *nsuri,
                                   gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "MetadataChange",
                                  g_variant_new("(is)", type, nsuri),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainMigrationIteration(virConnectPtr connection G_GNUC_UNUSED,
                                       virDomainPtr domain,
                                       gint iteration,
                                       gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "MigrationIteration",
                                  g_variant_new("(i)", iteration),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainPMSuspend(virConnectPtr connection G_GNUC_UNUSED,
                              virDomainPtr domain,
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
                                  "PMSuspend",
                                  g_variant_new("(i)", reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainPMSuspendDisk(virConnectPtr connection G_GNUC_UNUSED,
                                  virDomainPtr domain,
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
                                  "PMSuspendDisk",
                                  g_variant_new("(i)", reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainPMWakeup(virConnectPtr connection G_GNUC_UNUSED,
                             virDomainPtr domain,
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
                                  "PMWakeup",
                                  g_variant_new("(i)", reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainReboot(virConnectPtr connection G_GNUC_UNUSED,
                           virDomainPtr domain,
                           gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "Reboot",
                                  NULL,
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainRTCChange(virConnectPtr connection G_GNUC_UNUSED,
                              virDomainPtr domain,
                              gint64 utcoffset,
                              gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "RTCChange",
                                  g_variant_new("(x)", utcoffset),
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
                                  g_variant_new("(si)", device, reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainTunable(virConnectPtr connection G_GNUC_UNUSED,
                            virDomainPtr domain,
                            virTypedParameterPtr params,
                            gint nparams,
                            gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;
    GVariant *gargs;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    gargs = virtDBusUtilTypedParamsToGVariant(params, nparams);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "Tunable",
                                  g_variant_new_tuple(&gargs, 1),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsDomainWatchdog(virConnectPtr connection G_GNUC_UNUSED,
                             virDomainPtr domain,
                             gint action,
                             gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirDomain(domain, connect->domainPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_DOMAIN_INTERFACE,
                                  "Watchdog",
                                  g_variant_new("(i)", action),
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
                                  g_variant_new("(sssi)", old_src_path,
                                                new_src_path, device, reason),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsNetworkEvent(virConnectPtr connection G_GNUC_UNUSED,
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
                                  g_variant_new("(oi)", path, event),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsNodeDeviceEvent(virConnectPtr connection G_GNUC_UNUSED,
                              virNodeDevicePtr dev,
                              gint event,
                              gint detail,
                              gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirNodeDevice(dev, connect->nodeDevPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "NodeDeviceEvent",
                                  g_variant_new("(oii)", path, event, detail),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsSecretEvent(virConnectPtr connection G_GNUC_UNUSED,
                          virSecretPtr secret,
                          gint event,
                          gint detail,
                          gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirSecret(secret, connect->secretPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "SecretEvent",
                                  g_variant_new("(oii)", path, event, detail),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsStoragePoolEvent(virConnectPtr connection G_GNUC_UNUSED,
                               virStoragePoolPtr storagePool,
                               gint event,
                               gint detail,
                               gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirStoragePool(storagePool,
                                                connect->storagePoolPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  connect->connectPath,
                                  VIRT_DBUS_CONNECT_INTERFACE,
                                  "StoragePoolEvent",
                                  g_variant_new("(oii)", path, event, detail),
                                  NULL);

    return 0;
}

static gint
virtDBusEventsStoragePoolRefresh(virConnectPtr connection G_GNUC_UNUSED,
                                 virStoragePoolPtr storagePool,
                                 gpointer opaque)
{
    virtDBusConnect *connect = opaque;
    g_autofree gchar *path = NULL;

    path = virtDBusUtilBusPathForVirStoragePool(storagePool,
                                                connect->storagePoolPath);

    g_dbus_connection_emit_signal(connect->bus,
                                  NULL,
                                  path,
                                  VIRT_DBUS_STORAGEPOOL_INTERFACE,
                                  "Refresh",
                                  NULL,
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

static void
virtDBusEventsRegisterNodeDeviceEvent(virtDBusConnect *connect,
                                      gint id,
                                      virConnectNodeDeviceEventGenericCallback callback)
{
    g_assert(connect->nodeDevCallbackIds[id] == -1);

    connect->nodeDevCallbackIds[id] = virConnectNodeDeviceEventRegisterAny(connect->connection,
                                                                           NULL,
                                                                           id,
                                                                           VIR_NODE_DEVICE_EVENT_CALLBACK(callback),
                                                                           connect,
                                                                           NULL);
}

static void
virtDBusEventsRegisterSecretEvent(virtDBusConnect *connect,
                                  gint id,
                                  virConnectSecretEventGenericCallback callback)
{
    g_assert(connect->secretCallbackIds[id] == -1);

    connect->secretCallbackIds[id] = virConnectSecretEventRegisterAny(connect->connection,
                                                                      NULL,
                                                                      id,
                                                                      VIR_SECRET_EVENT_CALLBACK(callback),
                                                                      connect,
                                                                      NULL);
}

static void
virtDBusEventsRegisterStoragePoolEvent(virtDBusConnect *connect,
                                       gint id,
                                       virConnectStoragePoolEventGenericCallback callback)
{
    g_assert(connect->storagePoolCallbackIds[id] == -1);

    connect->storagePoolCallbackIds[id] = virConnectStoragePoolEventRegisterAny(connect->connection,
                                                                                NULL,
                                                                                id,
                                                                                VIR_STORAGE_POOL_EVENT_CALLBACK(callback),
                                                                                connect,
                                                                                NULL);
}

void
virtDBusEventsRegister(virtDBusConnect *connect)
{
    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_AGENT_LIFECYCLE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainAgentEvent));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_BALLOON_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainBalloonChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_BLOCK_JOB_2,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainBlockJob));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_CONTROL_ERROR,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainControlError));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainEvent));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceAdded));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DEVICE_REMOVAL_FAILED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceRemovalFailed));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDeviceRemoved));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainDiskChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_GRAPHICS,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainGraphics));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_IO_ERROR_REASON,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainIOError));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_JOB_COMPLETED,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainJobCompleted));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_METADATA_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainMetadataChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_MIGRATION_ITERATION,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainMigrationIteration));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_PMSUSPEND,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainPMSuspend));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_PMSUSPEND_DISK,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainPMSuspendDisk));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_PMWAKEUP,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainPMWakeup));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_REBOOT,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainReboot));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_RTC_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainRTCChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTrayChange));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_TUNABLE,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainTunable));

    virtDBusEventsRegisterDomainEvent(connect,
                                      VIR_DOMAIN_EVENT_ID_WATCHDOG,
                                      VIR_DOMAIN_EVENT_CALLBACK(virtDBusEventsDomainWatchdog));

    virtDBusEventsRegisterNetworkEvent(connect,
                                       VIR_NETWORK_EVENT_ID_LIFECYCLE,
                                       VIR_NETWORK_EVENT_CALLBACK(virtDBusEventsNetworkEvent));

    virtDBusEventsRegisterNodeDeviceEvent(connect,
                                          VIR_NODE_DEVICE_EVENT_ID_LIFECYCLE,
                                          VIR_NODE_DEVICE_EVENT_CALLBACK(virtDBusEventsNodeDeviceEvent));

    virtDBusEventsRegisterSecretEvent(connect,
                                      VIR_SECRET_EVENT_ID_LIFECYCLE,
                                      VIR_SECRET_EVENT_CALLBACK(virtDBusEventsSecretEvent));

    virtDBusEventsRegisterStoragePoolEvent(connect,
                                           VIR_STORAGE_POOL_EVENT_ID_LIFECYCLE,
                                           VIR_STORAGE_POOL_EVENT_CALLBACK(virtDBusEventsStoragePoolEvent));

    virtDBusEventsRegisterStoragePoolEvent(connect,
                                           VIR_STORAGE_POOL_EVENT_ID_REFRESH,
                                           VIR_STORAGE_POOL_EVENT_CALLBACK(virtDBusEventsStoragePoolRefresh));
}
