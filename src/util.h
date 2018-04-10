#pragma once

#include "gdbus.h"

#include <libvirt/libvirt.h>

#define VIRT_DBUS_ERROR virtDBusErrorQuark()

#define virtDBusUtilAutoLock g_autoptr(GMutexLocker) G_GNUC_UNUSED

typedef enum {
    VIRT_DBUS_ERROR_LIBVIRT,
    VIRT_DBUS_N_ERRORS /*< skip >*/
} VirtDBusError;

GQuark
virtDBusErrorQuark(void);

struct _virtDBusUtilTypedParams {
    virTypedParameterPtr params;
    gint nparams;
};
typedef struct _virtDBusUtilTypedParams virtDBusUtilTypedParams;

void
virtDBusUtilTypedParamsClear(virtDBusUtilTypedParams *params);

G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(virtDBusUtilTypedParams, virtDBusUtilTypedParamsClear);

GVariant *
virtDBusUtilTypedParamsToGVariant(virTypedParameterPtr params,
                                  gint nparams);

gboolean
virtDBusUtilGVariantToTypedParams(GVariantIter *iter,
                                  virTypedParameterPtr *params,
                                  gint *nparams,
                                  GError **error);

void
virtDBusUtilSetLastVirtError(GError **error);

gchar *
virtDBusUtilBusPathForVirDomain(virDomainPtr domain,
                                const gchar *domainPath);

virDomainPtr
virtDBusUtilVirDomainFromBusPath(virConnectPtr connection,
                                 const gchar *path,
                                 const gchar *domainPath);

void
virtDBusUtilVirDomainListFree(virDomainPtr *domains);

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virDomain, virDomainFree);
G_DEFINE_AUTOPTR_CLEANUP_FUNC(virDomainPtr, virtDBusUtilVirDomainListFree);

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virDomainStatsRecordPtr, virDomainStatsRecordListFree);

virNetworkPtr
virtDBusUtilVirNetworkFromBusPath(virConnectPtr connection,
                                 const gchar *path,
                                 const gchar *networkPath);

gchar *
virtDBusUtilBusPathForVirNetwork(virNetworkPtr network,
                                 const gchar *networkPath);

void
virtDBusUtilVirNetworkListFree(virNetworkPtr *networks);

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virNetwork, virNetworkFree);
G_DEFINE_AUTOPTR_CLEANUP_FUNC(virNetworkPtr, virtDBusUtilVirNetworkListFree);

typedef gchar *virtDBusCharArray;

void
virtDBusUtilStringListFree(virtDBusCharArray *item);

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virtDBusCharArray, virtDBusUtilStringListFree);

virStoragePoolPtr
virtDBusUtilVirStoragePoolFromBusPath(virConnectPtr connection,
                                      const gchar *path,
                                      const gchar *storagePoolPath);

gchar *
virtDBusUtilBusPathForVirStoragePool(virStoragePoolPtr storagePool,
                                     const gchar *storagePoolPath);

void
virtDBusUtilVirStoragePoolListFree(virStoragePoolPtr *storagePools);

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virStoragePool, virStoragePoolFree);
G_DEFINE_AUTOPTR_CLEANUP_FUNC(virStoragePoolPtr,
                              virtDBusUtilVirStoragePoolListFree);
