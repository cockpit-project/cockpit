#include "manager.h"
#include "util.h"

#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <sys/signalfd.h>
#include <systemd/sd-bus.h>

static int loop_status;

static int
bus_get_libvirt_events(sd_bus *bus)
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
bus_process_events(sd_bus *bus)
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
virEventRemoveHandlep(int *watchp)
{
    if (*watchp >= 0)
        virEventRemoveHandle(*watchp);
}

static void
handle_signal(int watch,
              int fd,
              int events,
              void *opaque)
{
    loop_status = -ECANCELED;
}

static void
handle_bus_event(int watch,
                 int fd,
                 int events,
                 void *opaque)
{
    sd_bus *bus = opaque;

    loop_status = bus_process_events(bus);

    if (loop_status < 0)
        return;

    virEventUpdateHandle(watch, bus_get_libvirt_events(bus));
}

int
main(int argc, char *argv[])
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    _cleanup_(sd_bus_unrefp) sd_bus *bus = NULL;
    _cleanup_(closep) int signal_fd = -1;
    _cleanup_(virEventRemoveHandlep) int bus_watch = -1;
    _cleanup_(virEventRemoveHandlep) int signal_watch = -1;
    sigset_t mask;
    int r;

    sigemptyset(&mask);
    sigaddset(&mask, SIGTERM);
    sigaddset(&mask, SIGINT);
    sigprocmask(SIG_BLOCK, &mask, NULL);

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

    r = bus_process_events(bus);
    if (r < 0)
        return EXIT_FAILURE;

    bus_watch = virEventAddHandle(sd_bus_get_fd(bus),
                                  bus_get_libvirt_events(bus),
                                  handle_bus_event,
                                  bus,
                                  NULL);

    signal_fd = signalfd(-1, &mask, SFD_NONBLOCK | SFD_CLOEXEC);
    signal_watch = virEventAddHandle(signal_fd,
                                     VIR_EVENT_HANDLE_READABLE,
                                     handle_signal,
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
