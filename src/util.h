#pragma once

#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

#define VIRT_DBUS_ERROR_INTERFACE "org.libvirt.Error"

#define _cleanup_(_x) __attribute__((__cleanup__(_x)))

#define VIRT_ATTR_UNUSED __attribute__((__unused__))

#define VIRT_N_ELEMENTS(array) (sizeof(array) / sizeof(*(array)))


int
virtDBusUtilMessageAppendTypedParameters(sd_bus_message *message,
                                         virTypedParameterPtr parameters,
                                         int n_parameters);

int
virtDBusUtilSetLastVirtError(sd_bus_error *error);

int
virtDBusUtilSetError(sd_bus_error *error,
                     const char *message);

char *
virtDBusUtilBusPathForVirDomain(virDomainPtr domain,
                                const char *domainPath);

virDomainPtr
virtDBusUtilVirDomainFromBusPath(virConnectPtr connection,
                                 const char *path,
                                 const char *domainPath);

void
virtDBusUtilFreep(void *p);

void
virtDBusUtilClosep(int *fdp);

void
virtDBusUtilStrvFreep(void *p);

void
virtDBusUtilVirDomainFreep(virDomainPtr *domainp);

void
virtDBusUtilVirDomainListFreep(virDomainPtr **domainsp);
