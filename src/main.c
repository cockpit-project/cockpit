#include "config.h"

#include "connect.h"
#include "util.h"

#include <errno.h>
#include <getopt.h>
#include <poll.h>
#include <stdbool.h>
#include <stdio.h>
#include <sys/signalfd.h>
#include <systemd/sd-bus.h>

static int loop_status;

static int
virtDBusGetLibvirtEvents(sd_bus *bus)
{
    int events;
    int virt_events = 0;

    events = sd_bus_get_events(bus);

    if (events & POLLIN)
        virt_events |= VIR_EVENT_HANDLE_READABLE;

    if (events & POLLOUT)
        virt_events |= VIR_EVENT_HANDLE_WRITABLE;

    return virt_events;
}

static int
virtDBusProcessEvents(sd_bus *bus)
{
    for (;;) {
            int r;

            r = sd_bus_process(bus, NULL);
            if (r < 0)
                    return r;

            if (r == 0)
                    break;
    }

    return 0;
}

static void
virtDBusVirEventRemoveHandlep(int *watchp)
{
    if (*watchp >= 0)
        virEventRemoveHandle(*watchp);
}

static void
virtDBusHandleSignal(int watch VIRT_ATTR_UNUSED,
                     int fd VIRT_ATTR_UNUSED,
                     int events VIRT_ATTR_UNUSED,
                     void *opaque VIRT_ATTR_UNUSED)
{
    loop_status = -ECANCELED;
}

static void
virtDBusHandleBusEvent(int watch,
                       int fd VIRT_ATTR_UNUSED,
                       int events VIRT_ATTR_UNUSED,
                       void *opaque)
{
    sd_bus *bus = opaque;

    loop_status = virtDBusProcessEvents(bus);

    if (loop_status < 0)
        return;

    virEventUpdateHandle(watch, virtDBusGetLibvirtEvents(bus));
}

struct virtDBusDriver {
    const char *uri;
    const char *object;
};

static const struct virtDBusDriver sessionDrivers[] = {
    { "qemu:///session",            "/org/libvirt/QEMU" },
    { "test:///default",            "/org/libvirt/Test" },
    { "uml:///session",             "/org/libvirt/UML" },
    { "vbox:///session",            "/org/libvirt/VBox" },
    { "vmwarefusion:///session",    "/org/libvirt/VMwareFusion" },
    { "vmwareplayer:///session",    "/org/libvirt/VMwarePlayer" },
    { "vmwarews:///session",        "/org/libvirt/VMwareWS" },
};

static const struct virtDBusDriver systemDrivers[] = {
    { "bhyve:///system",        "/org/libvirt/BHyve" },
    { "lxc:///",                "/org/libvirt/LXC" },
    { "openvz:///system",       "/org/libvirt/OpenVZ" },
    { "qemu:///system",         "/org/libvirt/QEMU" },
    { "test:///default",        "/org/libvirt/Test" },
    { "uml:///system",          "/org/libvirt/UML" },
    { "vbox:///system",         "/org/libvirt/VBox" },
    { "vz:///system",           "/org/libvirt/VZ" },
    { "xen:///",                "/org/libvirt/Xen" },
};

int
main(int argc, char *argv[])
{
    enum {
        ARG_SYSTEM = 255,
        ARG_SESSION
    };

    static const struct option options[] = {
        { "help",    no_argument,       NULL, 'h' },
        { "system",  no_argument,       NULL, ARG_SYSTEM },
        { "session", no_argument,       NULL, ARG_SESSION },
        {}
    };

    bool system_bus;
    const struct virtDBusDriver *drivers = NULL;
    int ndrivers = 0;

    _cleanup_(virtDBusConnectListFree) virtDBusConnect **connect = NULL;
    _cleanup_(sd_bus_unrefp) sd_bus *bus = NULL;
    _cleanup_(virtDBusUtilClosep) int signal_fd = -1;
    _cleanup_(virtDBusVirEventRemoveHandlep) int bus_watch = -1;
    _cleanup_(virtDBusVirEventRemoveHandlep) int signal_watch = -1;
    sigset_t mask;
    int c;
    int r;

    if (geteuid() == 0) {
        system_bus = true;
    } else {
        system_bus = false;
    }

    while ((c = getopt_long(argc, argv, "hc:", options, NULL)) >= 0) {
        switch (c) {
            case 'h':
                printf("Usage: %s [OPTIONS]\n", program_invocation_short_name);
                printf("\n");
                printf("Provide a D-Bus interface to a libvirtd.\n");
                printf("\n");
                printf("  -h, --help        Display this help text and exit\n");
                printf("  --session         Connect to the session bus\n");
                printf("  --system          Connect to the system bus\n");
                return 0;

            case ARG_SYSTEM:
                system_bus = true;
                break;

            case ARG_SESSION:
                system_bus = false;
                break;

            default:
                return EXIT_FAILURE;
        }
    }

    sigemptyset(&mask);
    sigaddset(&mask, SIGTERM);
    sigaddset(&mask, SIGINT);
    sigprocmask(SIG_BLOCK, &mask, NULL);

    virEventRegisterDefaultImpl();

    r = system_bus ? sd_bus_open_system(&bus) : sd_bus_open_user(&bus);
    if (r < 0) {
        fprintf(stderr, "Failed to connect to session bus: %s\n", strerror(-r));
        return EXIT_FAILURE;
    }

    r = sd_bus_request_name(bus, "org.libvirt", 0);
    if (r < 0) {
        fprintf(stderr, "Failed to acquire service name: %s\n", strerror(-r));
        return EXIT_FAILURE;
    }

    if (system_bus) {
        drivers = systemDrivers;
        ndrivers = VIRT_N_ELEMENTS(systemDrivers);
    } else {
        drivers = sessionDrivers;
        ndrivers = VIRT_N_ELEMENTS(sessionDrivers);
    }

    connect = calloc(ndrivers + 1, sizeof(virtDBusConnect *));

    for (int i = 0; i < ndrivers; i += 1) {
        r = virtDBusConnectNew(&connect[i], bus,
                               drivers[i].uri, drivers[i].object);
        if (r < 0) {
            fprintf(stderr, "Failed to register libvirt connection.");
            return EXIT_FAILURE;
        }
    }

    r = virtDBusProcessEvents(bus);
    if (r < 0)
        return EXIT_FAILURE;

    bus_watch = virEventAddHandle(sd_bus_get_fd(bus),
                                  virtDBusGetLibvirtEvents(bus),
                                  virtDBusHandleBusEvent,
                                  bus,
                                  NULL);

    signal_fd = signalfd(-1, &mask, SFD_NONBLOCK | SFD_CLOEXEC);
    signal_watch = virEventAddHandle(signal_fd,
                                     VIR_EVENT_HANDLE_READABLE,
                                     virtDBusHandleSignal,
                                     NULL,
                                     NULL);

    while (loop_status >= 0)
        virEventRunDefaultImpl();

    if (loop_status < 0 && loop_status != -ECANCELED) {
        fprintf(stderr, "Error: %s\n", strerror(-loop_status));
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
