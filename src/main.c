#include "manager.h"
#include "util.h"

#include <stdio.h>
#include <systemd/sd-bus.h>

int
main(int argc, char *argv[])
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    _cleanup_(sd_bus_unrefp) sd_bus *bus = NULL;
    int r;

    r = sd_bus_open_user(&bus);
    if (r < 0) {
        fprintf(stderr, "Failed to connect to session bus: %s\n", strerror(-r));
        return EXIT_FAILURE;
    }

    r = sd_bus_request_name(bus, "org.libvirt", 0);
    if (r < 0) {
        fprintf(stderr, "Failed to acquire service name: %s\n", strerror(-r));
        return EXIT_FAILURE;
    }

    r = virt_manager_new(&manager, bus);
    if (r < 0) {
        fprintf(stderr, "Failed to connect to libvirt");
        return EXIT_FAILURE;
    }

    for (;;) {
        r = sd_bus_process(bus, NULL);
        if (r < 0) {
            fprintf(stderr, "Failed to process bus: %s\n", strerror(-r));
            return EXIT_FAILURE;
        }
        if (r > 0)
            continue;

        r = sd_bus_wait(bus, (uint64_t) -1);
        if (r < 0) {
            fprintf(stderr, "Failed to wait on bus: %s\n", strerror(-r));
            return EXIT_FAILURE;
        }
    }
}
