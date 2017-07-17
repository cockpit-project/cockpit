#pragma once

#include <libvirt/libvirt.h>
#include <stdlib.h>
#include <systemd/sd-bus.h>
#include <unistd.h>

#define _cleanup_(_x) __attribute__((__cleanup__(_x)))

int bus_message_append_typed_parameters(sd_bus_message *message,
                                        virTypedParameterPtr parameters,
                                        int n_parameters);

int bus_error_set_last_virt_error(sd_bus_error *error);

char *
bus_path_for_domain(virDomainPtr domain);

virDomainPtr
domain_from_bus_path(virConnectPtr connection,
                     const char *path);

static inline void
freep(void *p)
{
        free(*(void **)p);
}

static inline void
closep(int *fdp)
{
    if (*fdp >= 0)
        close(*fdp);
}

static inline void
strv_freep(void *p)
{
    char **strv = *(char ***)p;

    if (strv == NULL)
        return;

    for (unsigned i = 0; strv[i] != NULL; i += 1)
        free(strv[i]);

    free(strv);
}

static inline void
virDomainFreep(virDomainPtr *domainp)
{
    if (*domainp)
        virDomainFree(*domainp);
}
