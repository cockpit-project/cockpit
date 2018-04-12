#include "domain.h"
#include "util.h"

#include <libvirt/libvirt.h>

VIRT_DBUS_ENUM_DECL(virtDBusDomainJob)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainJob,
                    VIR_DOMAIN_JOB_LAST,
                    "none",
                    "bounded",
                    "unbounded",
                    "completed",
                    "failed",
                    "canceled")

VIRT_DBUS_ENUM_DECL(virtDBusDomainMemoryStat)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainMemoryStat,
                    VIR_DOMAIN_MEMORY_STAT_LAST,
                    "swap_in",
                    "swap_out",
                    "major_fault",
                    "minor_fault",
                    "unused",
                    "available",
                    "actual_baloon",
                    "rss",
                    "usable",
                    "last_update")

static GVariant *
virtDBusDomainMemoryStatsToGVariant(virDomainMemoryStatPtr stats,
                                    gint nr_stats)
{
    GVariantBuilder builder;

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a{st}"));

    for (gint i = 0; i < nr_stats; i++) {
        const gchar *memoryStat = virtDBusDomainMemoryStatTypeToString(stats[i].tag);
        if (!memoryStat)
            continue;
        g_variant_builder_add(&builder, "{st}", memoryStat, stats[i].val);
    }

    return g_variant_builder_end(&builder);
}

static virDomainPtr
virtDBusDomainGetVirDomain(virtDBusConnect *connect,
                           const gchar *objectPath,
                           GError **error)
{
    virDomainPtr domain;

    if (virtDBusConnectOpen(connect, error) < 0)
        return NULL;

    domain = virtDBusUtilVirDomainFromBusPath(connect->connection,
                                              objectPath,
                                              connect->domainPath);
    if (!domain) {
        virtDBusUtilSetLastVirtError(error);
        return NULL;
    }

    return domain;
}

static void
virtDBusDomainGetActive(const gchar *objectPath,
                        gpointer userData,
                        GVariant **value,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint active;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    active = virDomainIsActive(domain);
    if (active < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!active);
}

static void
virtDBusDomainGetId(const gchar *objectPath,
                    gpointer userData,
                    GVariant **value,
                    GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint id;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    id = virDomainGetID(domain);
    if (id == (guint)-1)
        id = 0;

    *value = g_variant_new("u", id);
}

static void
virtDBusDomainGetAutostart(const gchar *objectPath,
                           gpointer userData,
                           GVariant **value,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint autostart = 0;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetAutostart(domain, &autostart) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!autostart);
}

static void
virtDBusDomainGetName(const gchar *objectPath,
                      gpointer userData,
                      GVariant **value,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *name;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    name = virDomainGetName(domain);
    if (!name)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", name);
}

static void
virtDBusDomainGetOsType(const gchar *objectPath,
                        gpointer userData,
                        GVariant **value,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *osType = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    osType = virDomainGetOSType(domain);
    if (!osType)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", osType);
}

static void
virtDBusDomainGetPersistent(const gchar *objectPath,
                            gpointer userData,
                            GVariant **value,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint persistent;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    persistent = virDomainIsPersistent(domain);
    if (persistent < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!persistent);
}

static void
virtDBusDomainGetSchedulerType(const gchar *objectPath,
                               gpointer userData,
                               GVariant **value,
                               GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *schedtype = NULL;
    gint nparams;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    schedtype = virDomainGetSchedulerType(domain, &nparams);
    if (!schedtype)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("(si)", schedtype, nparams);
}

static void
virtDBusDomainGetState(const gchar *objectPath,
                       gpointer userData,
                       GVariant **value,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint state = 0;
    const gchar *string;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetState(domain, &state, NULL, 0) < 0)
        return virtDBusUtilSetLastVirtError(error);

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

    *value = g_variant_new("s", string);
}

static void
virtDBusDomainGetUUID(const gchar *objectPath,
                      gpointer userData,
                      GVariant **value,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetUUIDString(domain, uuid) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("s", uuid);
}

static void
virtDBusDomainSetAutostart(GVariant *value,
                           const gchar *objectPath,
                           gpointer userData,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gboolean autostart;

    g_variant_get(value, "b", &autostart);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetAutostart(domain, autostart) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainAbortJob(GVariant *inArgs G_GNUC_UNUSED,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainAbortJob(domain) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainAttachDevice(GVariant *inArgs,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs G_GNUC_UNUSED,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *xml;
    guint flags;

    g_variant_get(inArgs, "(&su)", &xml, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainAttachDeviceFlags(domain, xml, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainCreate(GVariant *inArgs,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs G_GNUC_UNUSED,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainCreateWithFlags(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainDestroy(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainDestroyFlags(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainDetachDevice(GVariant *inArgs,
                           GUnixFDList *inFDs G_GNUC_UNUSED,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs G_GNUC_UNUSED,
                           GUnixFDList **outFDs G_GNUC_UNUSED,
                           GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *xml;
    guint flags;

    g_variant_get(inArgs, "(&su)", &xml, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainDetachDeviceFlags(domain, xml, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainGetJobInfo(GVariant *inArgs G_GNUC_UNUSED,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree virDomainJobInfoPtr jobInfo = NULL;
    const gchar *jobTypeStr;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    jobInfo = g_new0(virDomainJobInfo, 1);
    if (virDomainGetJobInfo(domain, jobInfo) < 0)
        return virtDBusUtilSetLastVirtError(error);

    jobTypeStr = virtDBusDomainJobTypeToString(jobInfo->type);
    if (!jobTypeStr) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't format virDomainJobType '%d' to string.", jobInfo->type);
        return;
    }
    *outArgs = g_variant_new("((sttttttttttt))", jobTypeStr,
                             jobInfo->timeElapsed, jobInfo->timeRemaining,
                             jobInfo->dataTotal, jobInfo->dataProcessed,
                             jobInfo->dataRemaining, jobInfo->memTotal,
                             jobInfo->memProcessed, jobInfo->memRemaining,
                             jobInfo->fileTotal, jobInfo->fileProcessed,
                             jobInfo->fileRemaining);
}

static void
virtDBusDomainGetMemoryParameters(GVariant *inArgs,
                                  GUnixFDList *inFDs G_GNUC_UNUSED,
                                  const gchar *objectPath,
                                  gpointer userData,
                                  GVariant **outArgs,
                                  GUnixFDList **outFDs G_GNUC_UNUSED,
                                  GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree virTypedParameterPtr params = NULL;
    gint nparams = 0;
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetMemoryParameters(domain, NULL, &nparams, flags);
    if (ret == 0 && nparams != 0) {
        params = g_new0(virTypedParameter, nparams);
        if (virDomainGetMemoryParameters(domain, params, &nparams, flags) < 0)
            return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params, nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

G_DEFINE_AUTOPTR_CLEANUP_FUNC(virDomainStatsRecordPtr, virDomainStatsRecordListFree);

static void
virtDBusDomainGetStats(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    virDomainPtr domains[2];
    g_autoptr(virDomainStatsRecordPtr) records = NULL;
    guint stats;
    guint flags;
    GVariant *grecords;

    g_variant_get(inArgs, "(uu)", &stats, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    domains[0] = domain;
    domains[1] = NULL;

    if (virDomainListGetStats(domains, stats, &records, flags) != 1)
        return virtDBusUtilSetLastVirtError(error);

    grecords = virtDBusUtilTypedParamsToGVariant(records[0]->params,
                                                 records[0]->nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetVcpus(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint vcpus;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    vcpus = virDomainGetVcpusFlags(domain, flags);
    if (vcpus < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(u)", vcpus);
}

static void
virtDBusDomainGetXMLDesc(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *xml = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    xml = virDomainGetXMLDesc(domain, flags);
    if (!xml)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", xml);
}

static void
virtDBusDomainHasManagedSaveImage(GVariant *inArgs,
                                  GUnixFDList *inFDs G_GNUC_UNUSED,
                                  const gchar *objectPath,
                                  gpointer userData,
                                  GVariant **outArgs,
                                  GUnixFDList **outFDs G_GNUC_UNUSED,
                                  GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint managedSaveImage;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    managedSaveImage = virDomainHasManagedSaveImage(domain, flags);
    if (managedSaveImage < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(b)", managedSaveImage);
}

static void
virtDBusDomainManagedSave(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainManagedSave(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainManagedSaveRemove(GVariant *inArgs,
                                GUnixFDList *inFDs G_GNUC_UNUSED,
                                const gchar *objectPath,
                                gpointer userData,
                                GVariant **outArgs G_GNUC_UNUSED,
                                GUnixFDList **outFDs G_GNUC_UNUSED,
                                GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainManagedSaveRemove(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainMemoryStats(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    virDomainMemoryStatStruct stats[VIR_DOMAIN_MEMORY_STAT_NR];
    gint nr_stats;
    guint flags;
    GVariant *gstats;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    nr_stats = virDomainMemoryStats(domain, stats, VIR_DOMAIN_MEMORY_STAT_NR, flags);
    if (nr_stats < 0)
        return virtDBusUtilSetLastVirtError(error);

    gstats = virtDBusDomainMemoryStatsToGVariant(stats, nr_stats);

    *outArgs = g_variant_new_tuple(&gstats, 1);
}

static void
virtDBusDomainMigrateGetMaxDowntime(GVariant *inArgs,
                                    GUnixFDList *inFDs G_GNUC_UNUSED,
                                    const gchar *objectPath,
                                    gpointer userData,
                                    GVariant **outArgs,
                                    GUnixFDList **outFDs G_GNUC_UNUSED,
                                    GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong downtime;
    guint flags;
    gint ret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainMigrateGetMaxDowntime(domain,
                                         (unsigned long long *)&downtime,
                                         flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(t)", downtime);
}

static void
virtDBusDomainMigrateSetMaxDowntime(GVariant *inArgs,
                                    GUnixFDList *inFDs G_GNUC_UNUSED,
                                    const gchar *objectPath,
                                    gpointer userData,
                                    GVariant **outArgs G_GNUC_UNUSED,
                                    GUnixFDList **outFDs G_GNUC_UNUSED,
                                    GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong downtime;
    guint flags;

    g_variant_get(inArgs, "(tu)", &downtime, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateSetMaxDowntime(domain, downtime, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainReboot(GVariant *inArgs,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs G_GNUC_UNUSED,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainReboot(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainReset(GVariant *inArgs,
                    GUnixFDList *inFDs G_GNUC_UNUSED,
                    const gchar *objectPath,
                    gpointer userData,
                    GVariant **outArgs G_GNUC_UNUSED,
                    GUnixFDList **outFDs G_GNUC_UNUSED,
                    GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainReset(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainResume(GVariant *inArgs G_GNUC_UNUSED,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs G_GNUC_UNUSED,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainResume(domain) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetVcpus(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint vcpus;
    guint flags;

    g_variant_get(inArgs, "(uu)", &vcpus, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetVcpusFlags(domain, vcpus, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainShutdown(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainShutdownFlags(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSuspend(GVariant *inArgs G_GNUC_UNUSED,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSuspend(domain) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainUndefine(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs G_GNUC_UNUSED,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainUndefineFlags(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static virtDBusGDBusPropertyTable virtDBusDomainPropertyTable[] = {
    { "Active", virtDBusDomainGetActive, NULL },
    { "Autostart", virtDBusDomainGetAutostart, virtDBusDomainSetAutostart },
    { "Id", virtDBusDomainGetId, NULL },
    { "Name", virtDBusDomainGetName, NULL },
    { "OSType", virtDBusDomainGetOsType, NULL },
    { "Persistent", virtDBusDomainGetPersistent, NULL },
    { "SchedulerType", virtDBusDomainGetSchedulerType, NULL},
    { "State", virtDBusDomainGetState, NULL },
    { "UUID", virtDBusDomainGetUUID, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusDomainMethodTable[] = {
    { "AbortJob", virtDBusDomainAbortJob },
    { "AttachDevice", virtDBusDomainAttachDevice },
    { "Create", virtDBusDomainCreate },
    { "Destroy", virtDBusDomainDestroy },
    { "DetachDevice", virtDBusDomainDetachDevice },
    { "GetJobInfo", virtDBusDomainGetJobInfo },
    { "GetMemoryParameters", virtDBusDomainGetMemoryParameters },
    { "GetStats", virtDBusDomainGetStats },
    { "GetVcpus", virtDBusDomainGetVcpus },
    { "GetXMLDesc", virtDBusDomainGetXMLDesc },
    { "HasManagedSaveImage", virtDBusDomainHasManagedSaveImage },
    { "ManagedSave", virtDBusDomainManagedSave },
    { "ManagedSaveRemove", virtDBusDomainManagedSaveRemove },
    { "MemoryStats", virtDBusDomainMemoryStats },
    { "MigrateGetMaxDowntime", virtDBusDomainMigrateGetMaxDowntime },
    { "MigrateSetMaxDowntime", virtDBusDomainMigrateSetMaxDowntime },
    { "Reboot", virtDBusDomainReboot },
    { "Reset", virtDBusDomainReset },
    { "Resume", virtDBusDomainResume },
    { "SetVcpus", virtDBusDomainSetVcpus },
    { "Shutdown", virtDBusDomainShutdown },
    { "Suspend", virtDBusDomainSuspend },
    { "Undefine", virtDBusDomainUndefine },
    { 0 }
};

static gchar **
virtDBusDomainEnumerate(gpointer userData)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomainPtr) domains = NULL;
    gint num = 0;
    gchar **ret = NULL;

    if (!virtDBusConnectOpen(connect, NULL))
        return NULL;

    num = virConnectListAllDomains(connect->connection, &domains, 0);
    if (num < 0)
        return NULL;

    if (num == 0)
        return NULL;

    ret = g_new0(gchar *, num + 1);

    for (gint i = 0; i < num; i++) {
        ret[i] = virtDBusUtilBusPathForVirDomain(domains[i],
                                                 connect->domainPath);
    }

    return ret;
}

static GDBusInterfaceInfo *interfaceInfo = NULL;

void
virtDBusDomainRegister(virtDBusConnect *connect,
                       GError **error)
{
    connect->domainPath = g_strdup_printf("%s/domain", connect->connectPath);

    if (!interfaceInfo) {
        interfaceInfo = virtDBusGDBusLoadIntrospectData(VIRT_DBUS_DOMAIN_INTERFACE,
                                                        error);
        if (!interfaceInfo)
            return;
    }

    virtDBusGDBusRegisterSubtree(connect->bus,
                                 connect->domainPath,
                                 interfaceInfo,
                                 virtDBusDomainEnumerate,
                                 virtDBusDomainMethodTable,
                                 virtDBusDomainPropertyTable,
                                 connect);
}
