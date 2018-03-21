#include "connect.h"
#include "util.h"

#include <glib-unix.h>
#include <libvirt-glib/libvirt-glib.h>

struct _virtDBusDriver {
    const gchar *uri;
    const gchar *object;
};
typedef struct _virtDBusDriver virtDBusDriver;

struct _virtDBusRegisterData {
    virtDBusConnect **connectList;
    const virtDBusDriver *drivers;
    gsize ndrivers;
};
typedef struct _virtDBusRegisterData virtDBusRegisterData;

static const virtDBusDriver sessionDrivers[] = {
    { "qemu:///session",            "/org/libvirt/QEMU" },
    { "test:///default",            "/org/libvirt/Test" },
    { "uml:///session",             "/org/libvirt/UML" },
    { "vbox:///session",            "/org/libvirt/VBox" },
    { "vmwarefusion:///session",    "/org/libvirt/VMwareFusion" },
    { "vmwareplayer:///session",    "/org/libvirt/VMwarePlayer" },
    { "vmwarews:///session",        "/org/libvirt/VMwareWS" },
};

static const virtDBusDriver systemDrivers[] = {
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

static gboolean
virtDBusHandleSignal(gpointer data)
{
    g_main_loop_quit(data);
    return TRUE;
}

static void
virtDBusAcquired(GDBusConnection *connection,
                 const gchar *name G_GNUC_UNUSED,
                 gpointer opaque)
{
    virtDBusRegisterData *data = opaque;
    GError *error = NULL;

    for (gsize i = 0; i < data->ndrivers; i += 1) {
        virtDBusConnectNew(&data->connectList[i], connection,
                           data->drivers[i].uri, data->drivers[i].object,
                           &error);
        if (error) {
            g_printerr("%s\n", error->message);
            exit(EXIT_FAILURE);
        }
    }

}

static void
virtDBusNameAcquired(GDBusConnection *connection G_GNUC_UNUSED,
                     const gchar *name G_GNUC_UNUSED,
                     gpointer data G_GNUC_UNUSED)
{
}

static void
virtDBusNameLost(GDBusConnection *connection G_GNUC_UNUSED,
                 const gchar *name G_GNUC_UNUSED,
                 gpointer data G_GNUC_UNUSED)
{
    g_printerr("Disconnected from D-Bus.\n");
    exit(EXIT_FAILURE);
}

static void
virtDBusRegisterDataFree(virtDBusRegisterData *data)
{
    virtDBusConnectListFree(data->connectList);
}
G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(virtDBusRegisterData, virtDBusRegisterDataFree);

#define VIRT_DBUS_MAX_THREADS 4

int
main(gint argc, gchar *argv[])
{
    static gboolean systemOpt = FALSE;
    static gboolean sessionOpt = FALSE;
    static gint maxThreads = VIRT_DBUS_MAX_THREADS;
    GBusType busType;
    g_auto(virtDBusGDBusSource) sigintSource = 0;
    g_auto(virtDBusGDBusSource) sigtermSource = 0;
    g_auto(virtDBusGDBusOwner) busOwner = 0;
    g_autoptr(GOptionContext) context = NULL;
    g_autoptr(GError) error = NULL;
    g_autoptr(GMainLoop) loop = NULL;
    g_auto(virtDBusRegisterData) data = { 0 };

    static GOptionEntry options[] = {
        { "system", 0, 0, G_OPTION_ARG_NONE, &systemOpt,
            "Connect to the system bus", NULL },
        { "session", 0, 0, G_OPTION_ARG_NONE, &sessionOpt,
            "Connect to the session bus", NULL },
        { "threads", 't', 0, G_OPTION_ARG_INT, &maxThreads,
            "Configure maximal number of worker threads", "N" },
        { NULL }
    };

    context = g_option_context_new("Provide a D-Bus interface to a libvirtd.");
    g_option_context_add_main_entries(context, options, NULL);

    if (!g_option_context_parse(context, &argc, &argv, &error)) {
        g_printerr("%s\n", error->message);
        exit(EXIT_FAILURE);
    }

    if (sessionOpt && systemOpt) {
        g_printerr("Only one of --session or --system can be used.\n");
        exit(EXIT_FAILURE);
    }

    if (sessionOpt) {
        busType = G_BUS_TYPE_SESSION;
    } else if (systemOpt) {
        busType = G_BUS_TYPE_SYSTEM;
    } else {
        if (geteuid() == 0) {
            busType = G_BUS_TYPE_SYSTEM;
        } else {
            busType = G_BUS_TYPE_SESSION;
        }
    }

    if (busType == G_BUS_TYPE_SYSTEM) {
        data.drivers = systemDrivers;
        data.ndrivers = G_N_ELEMENTS(systemDrivers);
    } else {
        data.drivers = sessionDrivers;
        data.ndrivers = G_N_ELEMENTS(sessionDrivers);
    }
    data.connectList = g_new0(virtDBusConnect *, data.ndrivers + 1);

    if (!virtDBusGDBusPrepareThreadPool(maxThreads, &error)) {
        g_printerr("%s\n", error->message);
        exit(EXIT_FAILURE);
    }

    loop = g_main_loop_new(NULL, FALSE);

    sigtermSource = g_unix_signal_add(SIGTERM,
                                      virtDBusHandleSignal,
                                      loop);

    sigintSource = g_unix_signal_add(SIGINT,
                                     virtDBusHandleSignal,
                                     loop);

    gvir_init(0, NULL);
    gvir_event_register();

    busOwner = g_bus_own_name(busType, "org.libvirt",
                              G_BUS_NAME_OWNER_FLAGS_NONE,
                              virtDBusAcquired,
                              virtDBusNameAcquired,
                              virtDBusNameLost,
                              &data, NULL);

    g_main_loop_run(loop);

    return EXIT_SUCCESS;
}
