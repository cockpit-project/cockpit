#include "util.h"

#include <errno.h>
#include <libvirt/libvirt.h>
#include <systemd/sd-bus.h>

static int
domain_get_name(sd_bus *bus,
                const char *path,
                const char *interface,
                const char *property,
                sd_bus_message *reply,
                void *userdata,
                sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    const char *name;

    name = virDomainGetName(domain);
    if (name == NULL)
        name = "";

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
    virDomainPtr domain = userdata;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

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
    virDomainPtr domain = userdata;

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
    virDomainPtr domain = userdata;

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
    virDomainPtr domain = userdata;
    _cleanup_(freep) char *os_type = NULL;

    os_type = virDomainGetOSType(domain);

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
    virDomainPtr domain = userdata;
    int active;

    active = virDomainIsActive(domain);
    if (active < 0)
        active = 0;

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
    virDomainPtr domain = userdata;
    int persistent;

    persistent = virDomainIsPersistent(domain);
    if (persistent < 0)
        persistent = 0;

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
    virDomainPtr domain = userdata;
    int state = 0;
    const char *string;

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
domain_get_xml_desc(sd_bus_message *message,
                    void *userdata,
                    sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    _cleanup_(freep) char *description = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    description = virDomainGetXMLDesc(domain, flags);
    if (!description)
        return bus_error_set_last_virt_error(error);

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
    virDomainPtr domain = userdata;
    virDomainPtr domains[] = { domain, NULL };
    _cleanup_(virDomainStatsRecordListFreep) virDomainStatsRecordPtr *records = NULL;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    uint32_t flags, stats;
    int r;

    r = sd_bus_message_read(message, "uu", &stats, &flags);
    if (r < 0)
        return r;

    if (virDomainListGetStats(domains, stats, &records, flags) != 1)
        return bus_error_set_last_virt_error(error);

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = bus_message_append_typed_parameters(reply, records[0]->params, records[0]->nparams);
    if (r < 0)
        return r;

    return sd_bus_send(NULL, reply, NULL);
}

static int
domain_shutdown(sd_bus_message *message,
                void *userdata,
                sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    int r;

    r = virDomainShutdown(domain);

    return sd_bus_reply_method_return(message, "b", r == 0 ? 1 : 0);
}

static int
domain_destroy(sd_bus_message *message,
               void *userdata,
               sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    int r;

    r = virDomainDestroy(domain);

    return sd_bus_reply_method_return(message, "b", r == 0 ? 1 : 0);
}

static int
domain_reboot(sd_bus_message *message,
               void *userdata,
               sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virDomainReboot(domain, flags);

    return sd_bus_reply_method_return(message, "b", r == 0 ? 1 : 0);
}

static int
domain_reset(sd_bus_message *message,
             void *userdata,
             sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virDomainReset(domain, flags);

    return sd_bus_reply_method_return(message, "b", r == 0 ? 1 : 0);
}

static int
domain_create(sd_bus_message *message,
              void *userdata,
              sd_bus_error *error)
{
    virDomainPtr domain = userdata;
    int r;

    r = virDomainCreate(domain);

    return sd_bus_reply_method_return(message, "b", r == 0 ? 1 : 0);
}

const sd_bus_vtable virt_domain_vtable[] = {
    SD_BUS_VTABLE_START(0),

    SD_BUS_PROPERTY("Name", "s", domain_get_name, 0, 0),
    SD_BUS_PROPERTY("UUID", "s", domain_get_uuid, 0, 0),
    SD_BUS_PROPERTY("Id", "u", domain_get_id, 0, 0),
    SD_BUS_PROPERTY("Vcpus", "u", domain_get_vcpus, 0, 0),
    SD_BUS_PROPERTY("OSType", "s", domain_get_os_type, 0, 0),
    SD_BUS_PROPERTY("Active", "b", domain_get_active, 0, 0),
    SD_BUS_PROPERTY("Persistent", "b", domain_get_persistent, 0, 0),
    SD_BUS_PROPERTY("State", "s", domain_get_state, 0, 0),

    SD_BUS_METHOD("GetXMLDesc", "u", "s", domain_get_xml_desc, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("GetStats", "uu", "a{sv}", domain_get_stats, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Shutdown", "", "b", domain_shutdown, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Destroy", "", "b", domain_destroy, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reboot", "u", "b", domain_reboot, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Reset", "u", "b", domain_reset, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("Create", "", "b", domain_create, SD_BUS_VTABLE_UNPRIVILEGED),

    SD_BUS_VTABLE_END
};
