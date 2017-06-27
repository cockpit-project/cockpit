#pragma once

#include <libvirt/libvirt.h>
#include <stdlib.h>
#include <systemd/sd-bus.h>

#define _cleanup_(_x) __attribute__((__cleanup__(_x)))

int bus_message_append_typed_parameters(sd_bus_message *message,
                                        virTypedParameterPtr parameters,
                                        int n_parameters);

static inline void
freep(void *p)
{
        free(*(void **)p);
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
