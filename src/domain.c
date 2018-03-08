#define _GNU_SOURCE

#include "domain.h"
#include "util.h"

#include <libvirt/libvirt.h>
#include <stdio.h>

static int
virtDBusDomainGetName(sd_bus *bus VIRT_ATTR_UNUSED,
                      const char *path,
                      const char *interface VIRT_ATTR_UNUSED,
                      const char *property VIRT_ATTR_UNUSED,
                      sd_bus_message *reply,
                      void *userdata,
                      sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    const char *name = "";

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    name = virDomainGetName(domain);
    if (name == NULL)
        return sd_bus_message_append(reply, "s", "");

    return sd_bus_message_append(reply, "s", name);
}

static int
virtDBusDomainGetUUID(sd_bus *bus VIRT_ATTR_UNUSED,
                      const char *path,
                      const char *interface VIRT_ATTR_UNUSED,
                      const char *property VIRT_ATTR_UNUSED,
                      sd_bus_message *reply,
                      void *userdata,
                      sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    virDomainGetUUIDString(domain, uuid);

    return sd_bus_message_append(reply, "s", uuid);
}

static int
virtDBusDomainGetId(sd_bus *bus VIRT_ATTR_UNUSED,
                    const char *path,
                    const char *interface VIRT_ATTR_UNUSED,
                    const char *property VIRT_ATTR_UNUSED,
                    sd_bus_message *reply,
                    void *userdata,
                    sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "u", 0);

    return sd_bus_message_append(reply, "u", virDomainGetID(domain));
}

static int
virtDBusDomainGetVcpus(sd_bus *bus VIRT_ATTR_UNUSED,
                       const char *path,
                       const char *interface VIRT_ATTR_UNUSED,
                       const char *property VIRT_ATTR_UNUSED,
                       sd_bus_message *reply,
                       void *userdata,
                       sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "u", 0);

    return sd_bus_message_append(reply, "u", virDomainGetVcpusFlags(domain, VIR_DOMAIN_VCPU_CURRENT));
}

static int
virtDBusDomainGetOsType(sd_bus *bus VIRT_ATTR_UNUSED,
                        const char *path,
                        const char *interface VIRT_ATTR_UNUSED,
                        const char *property VIRT_ATTR_UNUSED,
                        sd_bus_message *reply,
                        void *userdata,
                        sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *os_type = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    os_type = virDomainGetOSType(domain);
    if (os_type == NULL)
        return sd_bus_message_append(reply, "s", "");

    return sd_bus_message_append(reply, "s", os_type);
}

static int
virtDBusDomainGetActive(sd_bus *bus VIRT_ATTR_UNUSED,
                        const char *path,
                        const char *interface VIRT_ATTR_UNUSED,
                        const char *property VIRT_ATTR_UNUSED,
                        sd_bus_message *reply,
                        void *userdata,
                        sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int active;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    active = virDomainIsActive(domain);
    if (active < 0)
        return sd_bus_message_append(reply, "b", 0);

    return sd_bus_message_append(reply, "b", active);
}

static int
virtDBusDomainGetPersistent(sd_bus *bus VIRT_ATTR_UNUSED,
                            const char *path,
                            const char *interface VIRT_ATTR_UNUSED,
                            const char *property VIRT_ATTR_UNUSED,
                            sd_bus_message *reply,
                            void *userdata,
                            sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int persistent;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    persistent = virDomainIsPersistent(domain);
    if (persistent < 0)
        return sd_bus_message_append(reply, "b", 0);

    return sd_bus_message_append(reply, "b", persistent);
}

static int
virtDBusDomainGetState(sd_bus *bus VIRT_ATTR_UNUSED,
                       const char *path,
                       const char *interface VIRT_ATTR_UNUSED,
                       const char *property VIRT_ATTR_UNUSED,
                       sd_bus_message *reply,
                       void *userdata,
                       sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int state = 0;
    const char *string;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    virDomainGetState(domain, &state, NULL, 0);

    switch (state) {
    case VIR_DOMAIN_NOSTATE:
    default:
        string = "nostate";
        break;
    case VIR_DOMAIN_RUNNING:
        string = "running";
        break;
    case VIR_DOMAIN_BLOCKED:
        string = "blocked";
        break;
    case VIR_DOMAIN_PAUSED:
        string = "paused";
        break;
    case VIR_DOMAIN_SHUTDOWN:
        string = "shutdown";
        break;
    case VIR_DOMAIN_SHUTOFF:
        string = "shutoff";
        break;
    case VIR_DOMAIN_CRASHED:
        string = "crashed";
        break;
    case VIR_DOMAIN_PMSUSPENDED:
        string = "pmsuspended";
        break;
    }

    return sd_bus_message_append(reply, "s", string);
}

static int
virtDBusDomainGetAutostart(sd_bus *bus VIRT_ATTR_UNUSED,
                           const char *path,
                           const char *interface VIRT_ATTR_UNUSED,
                           const char *property VIRT_ATTR_UNUSED,
                           sd_bus_message *reply,
                           void *userdata,
                           sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int autostart = 0;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection, path,
                                              connect->domainPath);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    virDomainGetAutostart(domain, &autostart);

    return sd_bus_message_append(reply, "b", autostart);
}

static int
virtDBusDomainGetXMLDesc(sd_bus_message *message,
                         void *userdata,
                         sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *description = NULL;
    uint32_t flags;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    description = virDomainGetXMLDesc(domain, flags);
    if (!description)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "s", description);
}

static void
virtDBusDomainStatsRecordListFreep(virDomainStatsRecordPtr **statsp)
{
    if (*statsp)
        virDomainStatsRecordListFree(*statsp);
}

static int
virtDBusDomainGetStats(sd_bus_message *message,
                       void *userdata,
                       sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    virDomainPtr domains[2];
    _cleanup_(virtDBusDomainStatsRecordListFreep) virDomainStatsRecordPtr *records = NULL;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    uint32_t flags, stats;
    int r;

    r = sd_bus_message_read(message, "uu", &stats, &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    domains[0] = domain;
    domains[1] = NULL;

    if (virDomainListGetStats(domains, stats, &records, flags) != 1)
        return virtDBusUtilSetLastVirtError(error);

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = virtDBusUtilMessageAppendTypedParameters(reply, records[0]->params, records[0]->nparams);
    if (r < 0)
        return r;

    return sd_bus_send(NULL, reply, NULL);
}

static int
virtDBusDomainShutdown(sd_bus_message *message,
                       void *userdata,
                       sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainShutdown(domain);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static int
virtDBusDomainDestroy(sd_bus_message *message,
                      void *userdata,
                      sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainDestroy(domain);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static int
virtDBusDomainReboot(sd_bus_message *message,
                     void *userdata,
                     sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainReboot(domain, flags);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static int
virtDBusDomainReset(sd_bus_message *message,
                    void *userdata,
                    sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainReset(domain, flags);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static int
virtDBusDomainCreate(sd_bus_message *message,
                     void *userdata,
                     sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainCreate(domain);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static int
virtDBusDomainUndefine(sd_bus_message *message,
                       void *userdata,
                       sd_bus_error *error)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              sd_bus_message_get_path(message),
                                              connect->domainPath);
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainUndefine(domain);
    if (r < 0)
        return virtDBusUtilSetLastVirtError(error);

    return sd_bus_reply_method_return(message, "");
}

static const sd_bus_vtable virt_domain_vtable[] = {
    SD_BUS_VTABLE_START(0),

    SD_BUS_PROPERTY("Name", "s", virtDBusDomainGetName, 0, 0),
    SD_BUS_PROPERTY("UUID", "s", virtDBusDomainGetUUID, 0, 0),
    SD_BUS_PROPERTY("Id", "u", virtDBusDomainGetId, 0, 0),
    SD_BUS_PROPERTY("Vcpus", "u", virtDBusDomainGetVcpus, 0, 0),
    SD_BUS_PROPERTY("OSType", "s", virtDBusDomainGetOsType, 0, 0),
    SD_BUS_PROPERTY("Active", "b", virtDBusDomainGetActive, 0, 0),
    SD_BUS_PROPERTY("Persistent", "b", virtDBusDomainGetPersistent, 0, 0),
    SD_BUS_PROPERTY("State", "s", virtDBusDomainGetState, 0, 0),
    SD_BUS_PROPERTY("Autostart", "b", virtDBusDomainGetAutostart, 0, 0),

    SD_BUS_METHOD("GetXMLDesc", "u", "s", virtDBusDomainGetXMLDesc, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("GetStats", "uu", "a{sv}", virtDBusDomainGetStats, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Shutdown", "", "", virtDBusDomainShutdown, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Destroy", "", "", virtDBusDomainDestroy, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reboot", "u", "", virtDBusDomainReboot, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reset", "u", "", virtDBusDomainReset, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Create", "", "", virtDBusDomainCreate, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Undefine", "", "", virtDBusDomainUndefine, SD_BUS_VTABLE_UNPRIVILEGED),

    SD_BUS_SIGNAL("DeviceAdded", "s", 0),
    SD_BUS_SIGNAL("DeviceRemoved", "s", 0),
    SD_BUS_SIGNAL("DiskChange", "ssss", 0),
    SD_BUS_SIGNAL("TrayChange", "ss", 0),

    SD_BUS_VTABLE_END
};

static int
virtDBusDomainLookup(sd_bus *bus VIRT_ATTR_UNUSED,
                     const char *path,
                     const char *interface VIRT_ATTR_UNUSED,
                     void *userdata,
                     void **found,
                     sd_bus_error *error VIRT_ATTR_UNUSED)
{
    virtDBusConnect *connect = userdata;
    _cleanup_(virtDBusUtilFreep) char *name = NULL;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    r = sd_bus_path_decode(path, connect->domainPath, &name);
    if (r < 0)
        return r;

    if (*name == '\0')
        return 0;

    domain = virDomainLookupByUUIDString(connect->connection, name);
    if (!domain)
        return 0;

    /*
     * There's no way to unref the pointer we're returning here. So,
     * return the connect object and look up the domain again in the
     * domain_* callbacks.
     */
    *found = connect;

    return 1;
}

int
virtDBusDomainRegister(virtDBusConnect *connect,
                       sd_bus *bus)
{
    int r;

    r = asprintf(&connect->domainPath, "%s/domain", connect->connectPath);
    if (r < 0)
        return r;

    r = sd_bus_add_node_enumerator(bus, NULL, connect->domainPath,
                                   connect->enumerateDomains, connect);
    if (r < 0)
        return r;

    return sd_bus_add_fallback_vtable(bus,
                                      NULL,
                                      connect->domainPath,
                                      VIRT_DBUS_DOMAIN_INTERFACE,
                                      virt_domain_vtable,
                                      virtDBusDomainLookup,
                                      connect);
}
