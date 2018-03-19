#pragma once

#include "gdbus.h"

#include <libvirt/libvirt.h>

#define VIRT_DBUS_ERROR virtDBusErrorQuark()

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
