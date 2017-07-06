#include "manager.h"
#include "util.h"

#include <assert.h>
#include <errno.h>
#include <stdlib.h>

struct VirtManager {
    sd_bus *bus;
    virConnectPtr connection;

    int callback_ids[VIR_DOMAIN_EVENT_ID_LAST];
};

static char *
bus_path_for_domain(virDomainPtr domain)
{
    char *path = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    virDomainGetUUIDString(domain, uuid);
    sd_bus_path_encode("/org/libvirt/domain", uuid, &path);

    return path;
}

static virDomainPtr
domain_from_bus_path(VirtManager *manager,
                     const char *path)
{
    _cleanup_(freep) char *name = NULL;
    int r;

    r = sd_bus_path_decode(path, "/org/libvirt/domain", &name);
    if (r < 0)
        return NULL;

    return virDomainLookupByUUIDString(manager->connection, name);
}

static void
virDomainsFreep(virDomainPtr **domainsp)
{
    virDomainPtr *domains = *domainsp;

    if (!domains)
        return;

    for (int i = 0; domains[i] != NULL; i += 1)
        virDomainFree(domains[i]);

    free(domains);
}

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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    const char *name = "";

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *os_type = NULL;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int active;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int persistent;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int state = 0;
    const char *string;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int autostart = 0;

    domain = domain_from_bus_path(manager, path);
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
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *description = NULL;
    uint32_t flags;
    int r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
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
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    virDomainPtr domains[2];
    _cleanup_(virDomainStatsRecordListFreep) virDomainStatsRecordPtr *records = NULL;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    uint32_t flags, stats;
    int r;

    r = sd_bus_message_read(message, "uu", &stats, &flags);
    if (r < 0)
        return r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    domains[0] = domain;
    domains[1] = NULL;

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
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainShutdown(domain);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
domain_destroy(sd_bus_message *message,
               void *userdata,
               sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainDestroy(domain);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
domain_reboot(sd_bus_message *message,
               void *userdata,
               sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainReboot(domain, flags);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
domain_reset(sd_bus_message *message,
             void *userdata,
             sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainReset(domain, flags);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
domain_create(sd_bus_message *message,
              void *userdata,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainCreate(domain);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
domain_undefine(sd_bus_message *message,
                void *userdata,
                sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    int r;

    domain = domain_from_bus_path(manager, sd_bus_message_get_path(message));
    if (domain == NULL) {
        return sd_bus_reply_method_errorf(message,
                                          SD_BUS_ERROR_UNKNOWN_OBJECT,
                                          "Unknown object '%s'.",
                                          sd_bus_message_get_path(message));
    }

    r = virDomainUndefine(domain);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    return sd_bus_reply_method_return(message, "");
}

static int
enumerate_domains(sd_bus *bus,
                  const char *path,
                  void *userdata,
                  char ***nodes,
                  sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(virDomainsFreep) virDomainPtr *domains = NULL;
    _cleanup_(strv_freep) char **paths = NULL;
    int n_domains;

    n_domains = virConnectListAllDomains(manager->connection, &domains, 0);
    if (n_domains < 0)
        return bus_error_set_last_virt_error(error);

    paths = calloc(n_domains + 1, sizeof(char *));

    for (int i = 0; i < n_domains; i += 1)
        paths[i] = bus_path_for_domain(domains[i]);

    *nodes = paths;
    paths = NULL;

    return 0;
}

static int
virt_manager_list_domains(sd_bus_message *message,
                          void *userdata,
                          sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *reply = NULL;
    _cleanup_(virDomainsFreep) virDomainPtr *domains = NULL;
    uint32_t flags;
    int r;

    r = sd_bus_message_read(message, "u", &flags);
    if (r < 0)
        return r;

    r = virConnectListAllDomains(manager->connection, &domains, flags);
    if (r < 0)
        return bus_error_set_last_virt_error(error);

    r = sd_bus_message_new_method_return(message, &reply);
    if (r < 0)
        return r;

    r = sd_bus_message_open_container(reply, 'a', "o");
    if (r < 0)
        return r;

    for (int i = 0; domains[i] != NULL; i += 1) {
        _cleanup_(freep) char *path = NULL;

        path = bus_path_for_domain(domains[i]);

        r = sd_bus_message_append(reply, "o", path);
        if (r < 0)
            return r;
    }

    r = sd_bus_message_close_container(reply);
    if (r < 0)
        return r;

    return sd_bus_send(NULL, reply, NULL);
}

static int
virt_manager_create_xml(sd_bus_message *message,
                        void *userdata,
                        sd_bus_error *error)
{
    VirtManager *manager = userdata;
    const char *xml;
    uint32_t flags;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "su", &xml, &flags);
    if (r < 0)
        return r;

    domain = virDomainCreateXML(manager->connection, xml, flags);
    if (!domain)
        return bus_error_set_last_virt_error(error);

    path = bus_path_for_domain(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
virt_manager_define_xml(sd_bus_message *message,
                        void *userdata,
                        sd_bus_error *error)
{
    VirtManager *manager = userdata;
    const char *xml;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    r = sd_bus_message_read(message, "s", &xml);
    if (r < 0)
        return r;

    domain = virDomainDefineXML(manager->connection, xml);
    if (!domain)
        return bus_error_set_last_virt_error(error);

    path = bus_path_for_domain(domain);

    return sd_bus_reply_method_return(message, "o", path);
}

static int
handle_domain_lifecycle_event(virConnectPtr connection,
                              virDomainPtr domain,
                              int event,
                              int detail,
                              void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    const char *signal = NULL;
    const char *name;
    _cleanup_(freep) char *path = NULL;
    int r;

    switch (event) {
        case VIR_DOMAIN_EVENT_DEFINED:
            signal = "DomainDefined";
            break;
        case VIR_DOMAIN_EVENT_UNDEFINED:
            signal = "DomainUndefined";
            break;
        case VIR_DOMAIN_EVENT_STARTED:
            signal = "DomainStarted";
            break;
        case VIR_DOMAIN_EVENT_SUSPENDED:
            signal = "DomainSuspended";
            break;
        case VIR_DOMAIN_EVENT_RESUMED:
            signal = "DomainResumed";
            break;
        case VIR_DOMAIN_EVENT_STOPPED:
            signal = "DomainStopped";
            break;
        case VIR_DOMAIN_EVENT_SHUTDOWN:
            signal = "DomainShutdown";
            break;
        case VIR_DOMAIN_EVENT_PMSUSPENDED:
            signal = "DomainPMSuspended";
            break;
        case VIR_DOMAIN_EVENT_CRASHED:
            signal = "DomainCrashed";
            break;
        default:
            return 0;
    }

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  "/org/libvirt/Manager",
                                  "org.libvirt.Manager",
                                  signal);
    if (r < 0)
        return r;

    name = virDomainGetName(domain);
    path = bus_path_for_domain(domain);

    r = sd_bus_message_append(message, "so", name ? : "", path);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_device_added_event(virConnectPtr connection,
                                 virDomainPtr domain,
                                 const char *device,
                                 void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceAdded");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_device_removed_event(virConnectPtr connection,
                                   virDomainPtr domain,
                                   const char *device,
                                   void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DeviceRemoved");
    if (r < 0)
        return r;

    r = sd_bus_message_append(message, "s", device);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_disk_change_event(virConnectPtr connection,
                                virDomainPtr domain,
                                const char *device,
                                int reason,
                                void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "TrayChange");
    if (r < 0)
        return r;

    switch (reason) {
        case VIR_DOMAIN_EVENT_TRAY_CHANGE_OPEN:
            reasonstr = "open";
            break;
        case VIR_DOMAIN_EVENT_TRAY_CHANGE_CLOSE:
            reasonstr = "close";
            break;
        default:
            reasonstr = "";
            break;
    }

    r = sd_bus_message_append(message, "ssss", device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
handle_domain_tray_change_event(virConnectPtr connection,
                                virDomainPtr domain,
                                const char *old_src_path,
                                const char *new_src_path,
                                const char *device,
                                int reason,
                                void *opaque)
{
    VirtManager *manager = opaque;
    _cleanup_(sd_bus_message_unrefp) sd_bus_message *message = NULL;
    _cleanup_(freep) char *path = NULL;
    const char *reasonstr;
    int r;

    path = bus_path_for_domain(domain);

    r = sd_bus_message_new_signal(manager->bus,
                                  &message,
                                  path,
                                  "org.libvirt.Domain",
                                  "DiskChange");
    if (r < 0)
        return r;

    switch (reason) {
        case VIR_DOMAIN_EVENT_DISK_CHANGE_MISSING_ON_START:
            reasonstr = "missing-on-start";
            break;
        case VIR_DOMAIN_EVENT_DISK_DROP_MISSING_ON_START:
            reasonstr = "missing-on-start";
            break;
        default:
            reasonstr = "";
            break;
    }

    r = sd_bus_message_append(message, "ssss", old_src_path, new_src_path, device, reasonstr);
    if (r < 0)
        return r;

    return sd_bus_send(manager->bus, message, NULL);
}

static int
lookup_domain(sd_bus *bus,
              const char *path,
              const char *interface,
              void *userdata,
              void **found,
              sd_bus_error *error)
{
    VirtManager *manager = userdata;
    _cleanup_(freep) char *name = NULL;
    _cleanup_(virDomainFreep) virDomainPtr domain = NULL;
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

static void
virt_manager_register_event(VirtManager *manager,
                            int id,
                            virConnectDomainEventGenericCallback callback)
{
    assert(manager->callback_ids[id] == -1);

    manager->callback_ids[id] = virConnectDomainEventRegisterAny(manager->connection,
                                                                 NULL,
                                                                 id,
                                                                 VIR_DOMAIN_EVENT_CALLBACK(callback),
                                                                 manager,
                                                                 NULL);
}

static const sd_bus_vtable virt_manager_vtable[] = {
    SD_BUS_VTABLE_START(0),

    SD_BUS_METHOD("ListDomains", "u", "ao", virt_manager_list_domains, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("CreateXML", "su", "o", virt_manager_create_xml, SD_BUS_VTABLE_UNPRIVILEGED),
    SD_BUS_METHOD("DefineXML", "s", "o", virt_manager_define_xml, SD_BUS_VTABLE_UNPRIVILEGED),

    SD_BUS_SIGNAL("DomainDefined", "so", 0),
    SD_BUS_SIGNAL("DomainUndefined", "so", 0),
    SD_BUS_SIGNAL("DomainStarted", "so", 0),
    SD_BUS_SIGNAL("DomainSuspended", "so", 0),
    SD_BUS_SIGNAL("DomainResumed", "so", 0),
    SD_BUS_SIGNAL("DomainStopped", "so", 0),
    SD_BUS_SIGNAL("DomainShutdown", "so", 0),
    SD_BUS_SIGNAL("DomainPMSuspended", "so", 0),
    SD_BUS_SIGNAL("DomainCrashed", "so", 0),

    SD_BUS_VTABLE_END
};

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

int
virt_manager_new(VirtManager **managerp,
                 sd_bus *bus,
                 const char *uri)
{
    _cleanup_(virt_manager_freep) VirtManager *manager = NULL;
    int r;

    manager = calloc(1, sizeof(VirtManager));
    for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1)
        manager->callback_ids[i] = -1;

    manager->bus = sd_bus_ref(bus);

    manager->connection = virConnectOpenAuth(uri, virConnectAuthPtrDefault, 0);
    if (!manager->connection)
        return -EINVAL;

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_LIFECYCLE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_lifecycle_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_ADDED,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_device_added_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DEVICE_REMOVED,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_device_removed_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_DISK_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_tray_change_event));

    virt_manager_register_event(manager,
                                VIR_DOMAIN_EVENT_ID_TRAY_CHANGE,
                                VIR_DOMAIN_EVENT_CALLBACK(handle_domain_disk_change_event));

    r = sd_bus_add_object_vtable(manager->bus,
                                 NULL,
                                 "/org/libvirt/Manager",
                                 "org.libvirt.Manager",
                                 virt_manager_vtable,
                                 manager);
    if (r < 0)
        return r;

    r = sd_bus_add_node_enumerator(bus, NULL, "/org/libvirt/domain", enumerate_domains, manager);
    if (r < 0)
        return r;

    r = sd_bus_add_fallback_vtable(bus,
                                   NULL,
                                   "/org/libvirt/domain",
                                   "org.libvirt.Domain",
                                   virt_domain_vtable,
                                   lookup_domain,
                                   manager);
    if (r < 0)
        return r;

    *managerp = manager;
    manager = NULL;

    return 0;
}

VirtManager *
virt_manager_free(VirtManager *manager)
{
    if (manager->bus)
        sd_bus_unref(manager->bus);

    if (manager->connection) {
        for (int i = 0; i < VIR_DOMAIN_EVENT_ID_LAST; i += 1) {
            if (manager->callback_ids[i] >= 0)
                virConnectDomainEventDeregisterAny(manager->connection, manager->callback_ids[i]);
        }

        virConnectClose(manager->connection);
    }

    free(manager);

    return NULL;
}

void
virt_manager_freep(VirtManager **managerp)
{
    if (*managerp)
        virt_manager_free(*managerp);
}
