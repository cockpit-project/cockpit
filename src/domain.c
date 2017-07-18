#include "domain.h"
#include "util.h"

static int
domain_get_name(sd_bus *bus,
                const char *path,
                const char *interface,
                const char *property,
                sd_bus_message *reply,
                void *userdata,
                sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    const char *name = "";

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    name = virDomainGetName(domain);
    if (name == NULL)
        return sd_bus_message_append(reply, "s", "");

    return sd_bus_message_append(reply, "s", name);
}

static int
domain_get_uuid(sd_bus *bus,
                const char *path,
                const char *interface,
                const char *property,
                sd_bus_message *reply,
                void *userdata,
                sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    virDomainGetUUIDString(domain, uuid);

    return sd_bus_message_append(reply, "s", uuid);
}

static int
domain_get_id(sd_bus *bus,
              const char *path,
              const char *interface,
              const char *property,
              sd_bus_message *reply,
              void *userdata,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "u", 0);

    return sd_bus_message_append(reply, "u", virDomainGetID(domain));
}

static int
domain_get_vcpus(sd_bus *bus,
                 const char *path,
                 const char *interface,
                 const char *property,
                 sd_bus_message *reply,
                 void *userdata,
                 sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "u", 0);

    return sd_bus_message_append(reply, "u", virDomainGetVcpusFlags(domain, VIR_DOMAIN_VCPU_CURRENT));
}

static int
domain_get_os_type(sd_bus *bus,
                   const char *path,
                   const char *interface,
                   const char *property,
                   sd_bus_message *reply,
                   void *userdata,
                   sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *os_type = NULL;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "s", "");

    os_type = virDomainGetOSType(domain);
    if (os_type == NULL)
        return sd_bus_message_append(reply, "s", "");

    return sd_bus_message_append(reply, "s", os_type);
}

static int
domain_get_active(sd_bus *bus,
                  const char *path,
                  const char *interface,
                  const char *property,
                  sd_bus_message *reply,
                  void *userdata,
                  sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int active;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    active = virDomainIsActive(domain);
    if (active < 0)
        return sd_bus_message_append(reply, "b", 0);

    return sd_bus_message_append(reply, "b", active);
}

static int
domain_get_persistent(sd_bus *bus,
                      const char *path,
                      const char *interface,
                      const char *property,
                      sd_bus_message *reply,
                      void *userdata,
                      sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int persistent;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    persistent = virDomainIsPersistent(domain);
    if (persistent < 0)
        return sd_bus_message_append(reply, "b", 0);

    return sd_bus_message_append(reply, "b", persistent);
}

static int
domain_get_state(sd_bus *bus,
                 const char *path,
                 const char *interface,
                 const char *property,
                 sd_bus_message *reply,
                 void *userdata,
                 sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int state = 0;
    const char *string;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
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
domain_get_autostart(sd_bus *bus,
                     const char *path,
                     const char *interface,
                     const char *property,
                     sd_bus_message *reply,
                     void *userdata,
                     sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int autostart = 0;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection, path);
    if (domain == NULL)
        return sd_bus_message_append(reply, "b", 0);

    virDomainGetAutostart(domain, &autostart);

    return sd_bus_message_append(reply, "b", autostart);
}

static int
domain_get_xml_desc(sd_bus_message *message,
                    void *userdata,
                    sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(virtDBusUtilFreep) char *description = NULL;
    uint32_t flags;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
virDomainStatsRecordListFreep(virDomainStatsRecordPtr **statsp)
{
    if (*statsp)
        virDomainStatsRecordListFree(*statsp);
}

static int
domain_get_stats(sd_bus_message *message,
                 void *userdata,
                 sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    virDomainPtr domains[2];
    _cleanup_(virDomainStatsRecordListFreep) virDomainStatsRecordPtr *records = NULL;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    uint32_t flags, stats;
    int r;

    r = sd_bus_message_read(message, "uu", &stats, &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_shutdown(sd_bus_message *message,
                void *userdata,
                sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_destroy(sd_bus_message *message,
               void *userdata,
               sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_reboot(sd_bus_message *message,
              void *userdata,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_reset(sd_bus_message *message,
             void *userdata,
             sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_create(sd_bus_message *message,
              void *userdata,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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
domain_undefine(sd_bus_message *message,
                void *userdata,
                sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = virtDBusUtilVirDomainFromBusPath(manager->connection,
                                              sd_bus_message_get_path(message));
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

    SD_BUS_PROPERTY("Name", "s", domain_get_name, 0, 0),
    SD_BUS_PROPERTY("UUID", "s", domain_get_uuid, 0, 0),
    SD_BUS_PROPERTY("Id", "u", domain_get_id, 0, 0),
    SD_BUS_PROPERTY("Vcpus", "u", domain_get_vcpus, 0, 0),
    SD_BUS_PROPERTY("OSType", "s", domain_get_os_type, 0, 0),
    SD_BUS_PROPERTY("Active", "b", domain_get_active, 0, 0),
    SD_BUS_PROPERTY("Persistent", "b", domain_get_persistent, 0, 0),
    SD_BUS_PROPERTY("State", "s", domain_get_state, 0, 0),
    SD_BUS_PROPERTY("Autostart", "b", domain_get_autostart, 0, 0),

    SD_BUS_METHOD("GetXMLDesc", "u", "s", domain_get_xml_desc, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("GetStats", "uu", "a{sv}", domain_get_stats, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Shutdown", "", "", domain_shutdown, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Destroy", "", "", domain_destroy, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reboot", "u", "", domain_reboot, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reset", "u", "", domain_reset, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Create", "", "", domain_create, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Undefine", "", "", domain_undefine, SD_BUS_VTABLE_UNPRIVILEGED),

    SD_BUS_SIGNAL("DeviceAdded", "s", 0),
    SD_BUS_SIGNAL("DeviceRemoved", "s", 0),
    SD_BUS_SIGNAL("DiskChange", "ssss", 0),
    SD_BUS_SIGNAL("TrayChange", "ss", 0),

    SD_BUS_VTABLE_END
};

static int
lookup_domain(sd_bus *bus,
              const char *path,
              const char *interface,
              void *userdata,
              void **found,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virtDBusUtilFreep) char *name = NULL;
    _cleanup_(virtDBusUtilVirDomainFreep) virDomainPtr domain = NULL;
    int r;

    r = sd_bus_path_decode(path, "/org/libvirt/domain", &name);
    if (r < 0)
        return r;

    if (*name == '\0')
        return 0;

    domain = virDomainLookupByUUIDString(manager->connection, name);
    if (!domain)
        return 0;

    /*
     * There's no way to unref the pointer we're returning here. So,
     * return the manager object and look up the domain again in the
     * domain_* callbacks.
     */
    *found = manager;

    return 1;
}

int
domain_register(VirtManager *manager,
                sd_bus *bus)
{
    return sd_bus_add_fallback_vtable(bus,
                                      NULL,
                                      "/org/libvirt/domain",
                                      "org.libvirt.Domain",
                                      virt_domain_vtable,
                                      lookup_domain,
                                      manager);
}
