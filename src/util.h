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

GVariant *
virtDBusUtilTypedParamsToGVariant(virTypedParameterPtr params,
                                  gint nparams);

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

gint
virtDBusUtilEnumFromString(const gchar *const *types,
                           guint ntypes,
                           const gchar *type) G_GNUC_PURE;

const gchar *
virtDBusUtilEnumToString(const gchar *const *types,
                         guint ntypes,
                         gint type) G_GNUC_PURE;

#define VIRT_DBUS_ENUM_IMPL(name, lastVal, ...) \
    static const gchar *const name ##TypeList[] = { __VA_ARGS__ }; \
    G_STATIC_ASSERT(G_N_ELEMENTS(name ##TypeList) == lastVal); \
    const gchar *name ##TypeToString(gint type) { \
        return virtDBusUtilEnumToString(name ##TypeList, \
                                        G_N_ELEMENTS(name ##TypeList), \
                                        type); \
    } \
    gint name ##TypeFromString(const gchar *type) { \
        return virtDBusUtilEnumFromString(name ##TypeList, \
                                          G_N_ELEMENTS(name ##TypeList), \
                                          type); \
    }

#define VIRT_DBUS_ENUM_DECL(name) \
    const gchar *name ##TypeToString(gint type) G_GNUC_PURE; \
    gint name ##TypeFromString(const gchar *type) G_GNUC_PURE;

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
