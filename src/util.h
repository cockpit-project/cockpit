#pragma once

#include <libvirt/libvirt.h>
#include <stdlib.h>
#include <systemd/sd-bus.h>

#define _cleanup_(_x) __attribute__((__cleanup__(_x)))

static inline
void freep(void *p)
{
        free(*(void **)p);
}
