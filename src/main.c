#include "manager.h"
#include "util.h"

#include <stdio.h>
#include <systemd/sd-bus.h>

static int loop_status;

static void
handle_bus_event(int watch,
                 int fd,
                 int events,
                 void *opaque)
{
    sd_bus *bus = opaque;

    loop_status = sd_bus_process(bus, NULL);
}

int
main(int argc, char *argv[])
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    _cleanup_(sd_bus_unrefp) sd_bus *bus = NULL;
    int r;

    virEventRegisterDefaultImpl();

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

    virEventAddHandle(sd_bus_get_fd(bus), VIR_EVENT_HANDLE_READABLE, handle_bus_event, bus, NULL);

    while (loop_status >= 0)
        virEventRunDefaultImpl();

    if (loop_status < 0) {
        fprintf(stderr, "Error: %s\n", strerror(-loop_status));
        return EXIT_FAILURE;
    }
}
