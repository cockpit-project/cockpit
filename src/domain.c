#include "domain.h"
#include "util.h"

#include <libvirt/libvirt.h>

VIRT_DBUS_ENUM_DECL(virtDBusDomainBlockJob)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainBlockJob,
                    VIR_DOMAIN_BLOCK_JOB_TYPE_LAST,
                    "unknown",
                    "pull",
                    "copy",
                    "commit",
                    "active-commit")

VIRT_DBUS_ENUM_DECL(virtDBusDomainControlErrorReason)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainControlErrorReason,
                    VIR_DOMAIN_CONTROL_ERROR_REASON_LAST,
                    "none",
                    "unknown",
                    "monitor",
                    "internal")

VIRT_DBUS_ENUM_DECL(virtDBusDomainControlState)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainControlState,
                    VIR_DOMAIN_CONTROL_LAST,
                    "ok",
                    "job",
                    "occupied",
                    "error")

VIRT_DBUS_ENUM_DECL(virtDBusDomainDiskError)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainDiskError,
                    VIR_DOMAIN_DISK_ERROR_LAST,
                    "none",
                    "unspec",
                    "no-space")

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

VIRT_DBUS_ENUM_DECL(virtDBusDomainMetadata)
VIRT_DBUS_ENUM_IMPL(virtDBusDomainMetadata,
                    VIR_DOMAIN_METADATA_LAST,
                    "description",
                    "title",
                    "element")

struct _virtDBusDomainFSInfoList {
    virDomainFSInfoPtr *info;
    gint count;
};

typedef struct _virtDBusDomainFSInfoList virtDBusDomainFSInfoList;

static void
virtDBusDomainFSInfoListClear(virtDBusDomainFSInfoList *info)
{
    for (gint i = 0; i < info->count; i++)
        virDomainFSInfoFree(info->info[i]);

    g_free(info->info);
}

G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(virtDBusDomainFSInfoList,
                                 virtDBusDomainFSInfoListClear);

struct _virtDBusDomainIOThreadInfoList {
    virDomainIOThreadInfoPtr *info;
    gint count;
};

typedef struct _virtDBusDomainIOThreadInfoList virtDBusDomainIOThreadInfoList;

static void
virtDBusDomainIOThreadInfoListClear(virtDBusDomainIOThreadInfoList *info)
{
    for (gint i = 0; i < info->count; i++)
        virDomainIOThreadInfoFree(info->info[i]);

    g_free(info->info);
}

G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(virtDBusDomainIOThreadInfoList,
                                 virtDBusDomainIOThreadInfoListClear);

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
virtDBusDomainGetUpdated(const gchar *objectPath,
                         gpointer userData,
                         GVariant **value,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint updated;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    updated = virDomainIsUpdated(domain);
    if (updated < 0)
        return virtDBusUtilSetLastVirtError(error);

    *value = g_variant_new("b", !!updated);
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
virtDBusDomainAddIOThread(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint iothreadId;
    guint flags;

    g_variant_get(inArgs, "(uu)", &iothreadId, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainAddIOThread(domain, iothreadId, flags) < 0)
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
virtDBusDomainBlockCommit(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    const gchar *base;
    const gchar *top;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(&s&s&stu)", &disk, &base, &top, &bandwidth, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockCommit(domain, disk, base, top, bandwidth, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainBlockJobAbort(GVariant *inArgs,
                            GUnixFDList *inFDs G_GNUC_UNUSED,
                            const gchar *objectPath,
                            gpointer userData,
                            GVariant **outArgs G_GNUC_UNUSED,
                            GUnixFDList **outFDs G_GNUC_UNUSED,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    guint flags;

    g_variant_get(inArgs, "(&su)", &disk, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockJobAbort(domain, disk, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainBlockJobSetSpeed(GVariant *inArgs,
                               GUnixFDList *inFDs G_GNUC_UNUSED,
                               const gchar *objectPath,
                               gpointer userData,
                               GVariant **outArgs G_GNUC_UNUSED,
                               GUnixFDList **outFDs G_GNUC_UNUSED,
                               GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(&stu)", &disk, &bandwidth, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockJobSetSpeed(domain, disk, bandwidth, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainBlockPeek(GVariant *inArgs,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    gulong offset;
    gsize size;
    guint flags;
    g_autofree guchar *buffer = NULL;
    GVariantBuilder builder;
    GVariant *res;

    g_variant_get(inArgs, "(&sttu)", &disk, &offset, &size, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    buffer = g_new0(guchar, size);
    if (virDomainBlockPeek(domain, disk, offset, size, buffer, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("ay"));
    for (unsigned int i = 0; i < size; i++)
        g_variant_builder_add(&builder, "y", buffer[i]);

    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
}

static void
virtDBusDomainBlockPull(GVariant *inArgs,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs G_GNUC_UNUSED,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(&stu)", &disk, &bandwidth, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockPull(domain, disk, bandwidth, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainBlockRebase(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    const gchar *base;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(&s&stu)", &disk, &base, &bandwidth, &flags);
    if (g_str_equal(base, ""))
        base = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockRebase(domain, disk, base, bandwidth, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainBlockResize(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *disk;
    gulong size;
    guint flags;

    g_variant_get(inArgs, "(&stu)", &disk, &size, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockResize(domain, disk, size, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainCoreDumpWithFormat(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs G_GNUC_UNUSED,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *to;
    guint dumpformat;
    guint flags;

    g_variant_get(inArgs, "(&suu)", &to, &dumpformat, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainCoreDumpWithFormat(domain, to, dumpformat, flags) < 0)
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
virtDBusDomainDelIOThread(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint iothreadId;
    guint flags;

    g_variant_get(inArgs, "(uu)", &iothreadId, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainDelIOThread(domain, iothreadId, flags) < 0)
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
virtDBusDomainFSFreeze(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree const gchar **mountpoints = NULL;
    const gchar **tmp;
    g_autoptr(GVariantIter) iter;
    gsize nmountpoints = 0;
    guint flags;
    gint ret;

    g_variant_get(inArgs, "(asu)", &iter, &flags);

    nmountpoints = g_variant_iter_n_children(iter);
    if (nmountpoints > 0) {
        mountpoints = g_new0(const gchar*, nmountpoints);
        tmp = mountpoints;
        while (g_variant_iter_next(iter, "&s", tmp))
            tmp++;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainFSFreeze(domain, mountpoints, nmountpoints, flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(u)", ret);
}

static void
virtDBusDomainFSThaw(GVariant *inArgs,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree const gchar **mountpoints = NULL;
    const gchar **tmp;
    g_autoptr(GVariantIter) iter;
    guint nmountpoints;
    guint flags;
    gint ret;

    g_variant_get(inArgs, "(asu)", &iter, &flags);

    nmountpoints = g_variant_iter_n_children(iter);
    if (nmountpoints > 0) {
        mountpoints = g_new0(const gchar*, nmountpoints);
        tmp = mountpoints;
        while (g_variant_iter_next(iter, "&s", tmp))
            tmp++;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainFSThaw(domain, mountpoints, nmountpoints, flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(u)", ret);
}

static void
virtDBusDomainFSTrim(GVariant *inArgs,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs G_GNUC_UNUSED,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *mountpoint;
    gulong minimum;
    guint flags;

    g_variant_get(inArgs, "(stu)", &mountpoint, &minimum, &flags);
    if (g_str_equal(mountpoint, ""))
        mountpoint = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainFSTrim(domain, mountpoint, minimum, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainGetBlkioParameters(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetBlkioParameters(domain, NULL, &params.nparams, flags);
    if (ret == 0 && params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetBlkioParameters(domain, params.params,
                                        &params.nparams, flags) < 0) {
            return virtDBusUtilSetLastVirtError(error);
        }
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetBlockIOTune(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    const gchar *disk;
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(&su)", &disk, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetBlockIoTune(domain, disk, NULL, &params.nparams, flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);
    if (ret == 0 && params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetBlockIoTune(domain, disk, params.params,
                                    &params.nparams, flags) < 0) {
            return virtDBusUtilSetLastVirtError(error);
        }
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetBlockJobInfo(GVariant *inArgs,
                              GUnixFDList *inFDs G_GNUC_UNUSED,
                              const gchar *objectPath,
                              gpointer userData,
                              GVariant **outArgs,
                              GUnixFDList **outFDs G_GNUC_UNUSED,
                              GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    virDomainBlockJobInfo info;
    const gchar *disk;
    guint flags;
    const gchar *blockJobTypeStr;

    g_variant_get(inArgs, "(&su)", &disk, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetBlockJobInfo(domain, disk, &info, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    blockJobTypeStr = virtDBusDomainBlockJobTypeToString(info.type);
    if (!blockJobTypeStr) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't format virDomainBlockJobType '%d' to string.",
                    info.type);
        return;
    }

    *outArgs = g_variant_new("((sttt))", blockJobTypeStr, info.bandwidth,
                             info.cur, info.end);
}

static void
virtDBusDomainGetControlInfo(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree virDomainControlInfoPtr controlInfo = NULL;
    const gchar *stateStr;
    const gchar *errorReasonStr;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    controlInfo = g_new0(virDomainControlInfo, 1);
    if (virDomainGetControlInfo(domain, controlInfo, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    stateStr = virtDBusDomainControlStateTypeToString(controlInfo->state);
    if (!stateStr) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't format virDomainControlState '%d' to string.",
                    controlInfo->state);
        return;
    }
    errorReasonStr = virtDBusDomainControlErrorReasonTypeToString(controlInfo->details);
    if (!errorReasonStr) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't format virDomainControlErrorReason '%d' to string.",
                    controlInfo->details);
        return;
    }

    *outArgs = g_variant_new("((sst))", stateStr,
                             errorReasonStr, controlInfo->stateTime);
}

static void
virtDBusDomainGetDiskErrors(GVariant *inArgs,
                            GUnixFDList *inFDs G_GNUC_UNUSED,
                            const gchar *objectPath,
                            gpointer userData,
                            GVariant **outArgs,
                            GUnixFDList **outFDs G_GNUC_UNUSED,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree virDomainDiskErrorPtr disks = NULL;
    guint ndisks;
    gint count;
    guint flags;
    GVariant *res;
    GVariantBuilder builder;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    count = virDomainGetDiskErrors(domain, NULL, 0, 0);
    if (count < 0)
        return virtDBusUtilSetLastVirtError(error);
    ndisks = count;

    if (ndisks) {
        disks = g_new0(virDomainDiskError, ndisks);

        count = virDomainGetDiskErrors(domain, disks, ndisks, 0);
        if (count < 0)
            return virtDBusUtilSetLastVirtError(error);
    }

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(ss)"));
    for (gint i = 0; i < count; i++) {
        const gchar *err = virtDBusDomainDiskErrorTypeToString(disks[i].error);

        if (!err)
            continue;
        g_variant_builder_open(&builder, G_VARIANT_TYPE("(ss)"));
        g_variant_builder_add(&builder, "s", disks[i].disk);
        g_variant_builder_add(&builder, "s", err);
        g_variant_builder_close(&builder);
    }
    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
}

static void
virtDBusDomainGetFSInfo(GVariant *inArgs,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusDomainFSInfoList) info = { 0 };
    GVariantBuilder builder;
    guint flags;
    GVariant *gret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    info.count = virDomainGetFSInfo(domain, &info.info, flags);
    if (info.count < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(sssas)"));

    for (gint i = 0; i < info.count; i++) {
        g_variant_builder_open(&builder, G_VARIANT_TYPE("(sssas)"));
        g_variant_builder_add(&builder, "s", info.info[i]->mountpoint);
        g_variant_builder_add(&builder, "s", info.info[i]->name);
        g_variant_builder_add(&builder, "s", info.info[i]->fstype);

        g_variant_builder_open(&builder, G_VARIANT_TYPE("as"));
        for (guint j = 0; j < info.info[i]->ndevAlias; j++)
            g_variant_builder_add(&builder, "s", info.info[i]->devAlias[j]);
        g_variant_builder_close(&builder);
        g_variant_builder_close(&builder);
    }
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
}

static void
virtDBusDomainGetGuestVcpus(GVariant *inArgs,
                            GUnixFDList *inFDs G_GNUC_UNUSED,
                            const gchar *objectPath,
                            gpointer userData,
                            GVariant **outArgs,
                            GUnixFDList **outFDs G_GNUC_UNUSED,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetGuestVcpus(domain, &params.params,
                               (guint *)&params.nparams, flags) < 0) {
        return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetHostname(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree gchar *hostname = NULL;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    hostname = virDomainGetHostname(domain, flags);
    if (!hostname)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", hostname);
}

static void
virtDBusDomainGetInterfaceParameters(GVariant *inArgs,
                                     GUnixFDList *inFDs G_GNUC_UNUSED,
                                     const gchar *objectPath,
                                     gpointer userData,
                                     GVariant **outArgs,
                                     GUnixFDList **outFDs G_GNUC_UNUSED,
                                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    const gchar *device;
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(&su)", &device, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetInterfaceParameters(domain, device, NULL,
                                          &params.nparams, flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);
    if (params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetInterfaceParameters(domain, device, params.params,
                                            &params.nparams, flags) < 0) {
            return virtDBusUtilSetLastVirtError(error);
        }
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetIOThreadInfo(GVariant *inArgs,
                              GUnixFDList *inFDs G_GNUC_UNUSED,
                              const gchar *objectPath,
                              gpointer userData,
                              GVariant **outArgs,
                              GUnixFDList **outFDs G_GNUC_UNUSED,
                              GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusDomainIOThreadInfoList) info = { 0 };
    GVariantBuilder builder;
    guint flags;
    gint cpuCount;
    GVariant *gret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    info.count = virDomainGetIOThreadInfo(domain, &info.info, flags);
    if (info.count < 0)
        return virtDBusUtilSetLastVirtError(error);

    cpuCount = virNodeGetCPUMap(connect->connection, NULL, NULL, 0);
    if (cpuCount < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(uab)"));

    for (gint i = 0; i < info.count; i++) {
        g_variant_builder_open(&builder, G_VARIANT_TYPE("(uab)"));
        g_variant_builder_add(&builder, "u", info.info[i]->iothread_id);
        g_variant_builder_open(&builder, G_VARIANT_TYPE("ab"));
        for (gint j = 0; j < cpuCount; j++)
            g_variant_builder_add(&builder, "b", VIR_CPU_USED(info.info[i]->cpumap, j));
        g_variant_builder_close(&builder);
        g_variant_builder_close(&builder);
    }
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
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
virtDBusDomainGetJobStats(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    const gchar *typeStr;
    gint type;
    GVariant *grecords;
    GVariantBuilder builder;
    GVariant *gret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetJobStats(domain, &type, &params.params,
                             &params.nparams, flags) < 0) {
        return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    typeStr = virtDBusDomainJobTypeToString(type);
    if (!typeStr) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't format virDomainJobType '%d' to string.", type);
        return;
    }

    g_variant_builder_init(&builder, G_VARIANT_TYPE("(sa{sv})"));
    g_variant_builder_add(&builder, "s", typeStr);
    g_variant_builder_add_value(&builder, grecords);
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
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
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetMemoryParameters(domain, NULL, &params.nparams, flags);
    if (ret == 0 && params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetMemoryParameters(domain, params.params,
                                         &params.nparams, flags) < 0) {
            return virtDBusUtilSetLastVirtError(error);
        }
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetMetadata(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *typeStr;
    gint type;
    const gchar *uri;
    guint flags;
    g_autofree gchar *ret = NULL;

    g_variant_get(inArgs, "(&s&su)", &typeStr, &uri, &flags);
    if (g_str_equal(uri, ""))
        uri = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    type = virtDBusDomainMetadataTypeFromString(typeStr);
    if (type < 0) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't get valid virDomainMetadataType from string '%s'.",
                    typeStr);
        return;
    }

    ret = virDomainGetMetadata(domain, type, uri, flags);
    if (!ret)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(s)", ret);
}

static void
virtDBusDomainGetNumaParameters(GVariant *inArgs,
                                GUnixFDList *inFDs G_GNUC_UNUSED,
                                const gchar *objectPath,
                                gpointer userData,
                                GVariant **outArgs,
                                GUnixFDList **outFDs G_GNUC_UNUSED,
                                GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    gint ret;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetNumaParameters(domain, NULL, &params.nparams, flags);
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);
    if (params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetNumaParameters(domain, params.params,
                                       &params.nparams, flags) < 0) {
            return virtDBusUtilSetLastVirtError(error);
        }
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetPerfEvents(GVariant *inArgs,
                            GUnixFDList *inFDs G_GNUC_UNUSED,
                            const gchar *objectPath,
                            gpointer userData,
                            GVariant **outArgs,
                            GUnixFDList **outFDs G_GNUC_UNUSED,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    GVariant *grecords;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetPerfEvents(domain, &params.params,
                               &params.nparams, flags) < 0) {
        return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetSchedulerParameters(GVariant *inArgs,
                                     GUnixFDList *inFDs G_GNUC_UNUSED,
                                     const gchar *objectPath,
                                     gpointer userData,
                                     GVariant **outArgs,
                                     GUnixFDList **outFDs G_GNUC_UNUSED,
                                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;
    GVariant *grecords;
    g_autofree gchar *ret = NULL;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainGetSchedulerType(domain, &params.nparams);
    if (ret && params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetSchedulerParametersFlags(domain, params.params,
                                                 &params.nparams, 0))
            return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

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
virtDBusDomainGetTime(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint64 seconds;
    guint nseconds;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetTime(domain, (long long *)&seconds, &nseconds, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((tu))", seconds, nseconds);
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
virtDBusDomainInjectNMI(GVariant *inArgs,
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

    if (virDomainInjectNMI(domain, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
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
virtDBusDomainMemoryPeek(GVariant *inArgs,
                         GUnixFDList *inFDs G_GNUC_UNUSED,
                         const gchar *objectPath,
                         gpointer userData,
                         GVariant **outArgs,
                         GUnixFDList **outFDs G_GNUC_UNUSED,
                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong offset;
    gsize size;
    guint flags;
    g_autofree guchar *buffer = NULL;
    GVariantBuilder builder;
    GVariant *res;

    g_variant_get(inArgs, "(ttu)", &offset, &size, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    buffer = g_new0(guchar, size);
    if (virDomainMemoryPeek(domain, offset, size, buffer, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("ay"));
    for (unsigned int i = 0; i < size; i++)
        g_variant_builder_add(&builder, "y", buffer[i]);

    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
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
virtDBusDomainMigrateGetCompressionCache(GVariant *inArgs,
                                         GUnixFDList *inFDs G_GNUC_UNUSED,
                                         const gchar *objectPath,
                                         gpointer userData,
                                         GVariant **outArgs,
                                         GUnixFDList **outFDs G_GNUC_UNUSED,
                                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong cacheSize;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateGetCompressionCache(domain,
                                            (unsigned long long *)&cacheSize,
                                            flags) < 0) {
        return virtDBusUtilSetLastVirtError(error);
    }

    *outArgs = g_variant_new("(t)", cacheSize);
}

static void
virtDBusDomainMigrateGetMaxSpeed(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateGetMaxSpeed(domain, &bandwidth, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(t)", bandwidth);
}

static void
virtDBusDomainMigrateSetCompressionCache(GVariant *inArgs,
                                         GUnixFDList *inFDs G_GNUC_UNUSED,
                                         const gchar *objectPath,
                                         gpointer userData,
                                         GVariant **outArgs G_GNUC_UNUSED,
                                         GUnixFDList **outFDs G_GNUC_UNUSED,
                                         GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong cacheSize;
    guint flags;

    g_variant_get(inArgs, "(tu)", &cacheSize, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateSetCompressionCache(domain, cacheSize, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
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
virtDBusDomainMigrateSetMaxSpeed(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs G_GNUC_UNUSED,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong bandwidth;
    guint flags;

    g_variant_get(inArgs, "(tu)", &bandwidth, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateSetMaxSpeed(domain, bandwidth, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainMigrateStartPostCopy(GVariant *inArgs,
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

    if (virDomainMigrateStartPostCopy(domain, flags) < 0)
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
virtDBusDomainRename(GVariant *inArgs,
                     GUnixFDList *inFDs G_GNUC_UNUSED,
                     const gchar *objectPath,
                     gpointer userData,
                     GVariant **outArgs G_GNUC_UNUSED,
                     GUnixFDList **outFDs G_GNUC_UNUSED,
                     GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *name;
    guint flags;

    g_variant_get(inArgs, "(&su)", &name, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainRename(domain, name, flags) < 0)
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
virtDBusDomainSave(GVariant *inArgs,
                   GUnixFDList *inFDs G_GNUC_UNUSED,
                   const gchar *objectPath,
                   gpointer userData,
                   GVariant **outArgs G_GNUC_UNUSED,
                   GUnixFDList **outFDs G_GNUC_UNUSED,
                   GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *to;
    const gchar *xml;
    guint flags;

    g_variant_get(inArgs, "(&s&su)", &to, &xml, &flags);
    if (g_str_equal(xml, ""))
        xml = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSaveFlags(domain, to, xml, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSendKey(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint codeset;
    guint holdtime;
    const guint *keycodes;
    gsize nkeycodes = 0;
    gint ret;
    guint flags;
    GVariant *v;

    g_variant_get(inArgs, "(uu@auu)", &codeset, &holdtime, &v, &flags);

    keycodes = g_variant_get_fixed_array(v, &nkeycodes, sizeof(guint));
    g_variant_unref(v);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ret = virDomainSendKey(domain, codeset, holdtime, (guint *)keycodes,
                           nkeycodes, flags);
    if (ret < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSendProcessSignal(GVariant *inArgs,
                                GUnixFDList *inFDs G_GNUC_UNUSED,
                                const gchar *objectPath,
                                gpointer userData,
                                GVariant **outArgs G_GNUC_UNUSED,
                                GUnixFDList **outFDs G_GNUC_UNUSED,
                                GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint64 pidValue;
    guint sigNum;
    guint flags;

    g_variant_get(inArgs, "(xuu)", &pidValue, &sigNum, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSendProcessSignal(domain, pidValue, sigNum, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetBlkioParameters(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs G_GNUC_UNUSED,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(a{sv}u)", &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetBlkioParameters(domain, params.params,
                                    params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetBlockIOTune(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs G_GNUC_UNUSED,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    const gchar *disk;
    guint flags;

    g_variant_get(inArgs, "(&sa{sv}u)", &disk, &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetBlockIoTune(domain, disk, params.params,
                                params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetInterfaceParameters(GVariant *inArgs,
                                     GUnixFDList *inFDs G_GNUC_UNUSED,
                                     const gchar *objectPath,
                                     gpointer userData,
                                     GVariant **outArgs G_GNUC_UNUSED,
                                     GUnixFDList **outFDs G_GNUC_UNUSED,
                                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    const gchar *device;
    guint flags;

    g_variant_get(inArgs, "(&sa{sv}u)", &device, &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetInterfaceParameters(domain, device, params.params,
                                        params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetMemory(GVariant *inArgs,
                        GUnixFDList *inFDs G_GNUC_UNUSED,
                        const gchar *objectPath,
                        gpointer userData,
                        GVariant **outArgs G_GNUC_UNUSED,
                        GUnixFDList **outFDs G_GNUC_UNUSED,
                        GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong memory;
    guint flags;

    g_variant_get(inArgs, "(tu)", &memory, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetMemoryFlags(domain, memory, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetMemoryParameters(GVariant *inArgs,
                                  GUnixFDList *inFDs G_GNUC_UNUSED,
                                  const gchar *objectPath,
                                  gpointer userData,
                                  GVariant **outArgs G_GNUC_UNUSED,
                                  GUnixFDList **outFDs G_GNUC_UNUSED,
                                  GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(a{sv}u)", &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetMemoryParameters(domain, params.params,
                                     params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetMemoryStatsPeriod(GVariant *inArgs,
                                   GUnixFDList *inFDs G_GNUC_UNUSED,
                                   const gchar *objectPath,
                                   gpointer userData,
                                   GVariant **outArgs G_GNUC_UNUSED,
                                   GUnixFDList **outFDs G_GNUC_UNUSED,
                                   GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint period;
    guint flags;

    g_variant_get(inArgs, "(iu)", &period, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetMemoryStatsPeriod(domain, period, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetMetadata(GVariant *inArgs,
                          GUnixFDList *inFDs G_GNUC_UNUSED,
                          const gchar *objectPath,
                          gpointer userData,
                          GVariant **outArgs G_GNUC_UNUSED,
                          GUnixFDList **outFDs G_GNUC_UNUSED,
                          GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *typeStr;
    gint type;
    const gchar *metadata;
    const gchar *key;
    const gchar *uri;
    guint flags;

    g_variant_get(inArgs, "(&s&s&s&su)", &typeStr, &metadata, &key, &uri, &flags);
    if (g_str_equal(key, ""))
        key = NULL;
    if (g_str_equal(uri, ""))
        uri = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    type = virtDBusDomainMetadataTypeFromString(typeStr);
    if (type < 0) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "Can't get valid virDomainMetadataType from string '%s'.",
                    typeStr);
        return;
    }

    if (virDomainSetMetadata(domain, type, metadata, key, uri, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetNumaParameters(GVariant *inArgs,
                                GUnixFDList *inFDs G_GNUC_UNUSED,
                                const gchar *objectPath,
                                gpointer userData,
                                GVariant **outArgs G_GNUC_UNUSED,
                                GUnixFDList **outFDs G_GNUC_UNUSED,
                                GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(a{sv}u)", &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetNumaParameters(domain, params.params,
                                   params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetPerfEvents(GVariant *inArgs,
                            GUnixFDList *inFDs G_GNUC_UNUSED,
                            const gchar *objectPath,
                            gpointer userData,
                            GVariant **outArgs G_GNUC_UNUSED,
                            GUnixFDList **outFDs G_GNUC_UNUSED,
                            GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(a{sv}u)", &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetPerfEvents(domain, params.params, params.nparams, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetSchedulerParameters(GVariant *inArgs,
                                     GUnixFDList *inFDs G_GNUC_UNUSED,
                                     const gchar *objectPath,
                                     gpointer userData,
                                     GVariant **outArgs G_GNUC_UNUSED,
                                     GUnixFDList **outFDs G_GNUC_UNUSED,
                                     GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autoptr(GVariantIter) iter = NULL;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(a{sv}u)", &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetSchedulerParametersFlags(domain, params.params,
                                             params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
}

static void
virtDBusDomainSetUserPassword(GVariant *inArgs,
                              GUnixFDList *inFDs G_GNUC_UNUSED,
                              const gchar *objectPath,
                              gpointer userData,
                              GVariant **outArgs G_GNUC_UNUSED,
                              GUnixFDList **outFDs G_GNUC_UNUSED,
                              GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gchar *user;
    const gchar *password;
    guint flags;

    g_variant_get(inArgs, "(&s&su)", &user, &password, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetUserPassword(domain, user, password, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainSetTime(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gulong seconds;
    guint nseconds;
    guint flags;

    g_variant_get(inArgs, "(tuu)", &seconds, &nseconds, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainSetTime(domain, seconds, nseconds, flags) < 0)
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

static void
virtDBusDomainUpdateDevice(GVariant *inArgs,
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

    if (virDomainUpdateDeviceFlags(domain, xml, flags) < 0)
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
    { "Updated", virtDBusDomainGetUpdated, NULL },
    { "UUID", virtDBusDomainGetUUID, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusDomainMethodTable[] = {
    { "AbortJob", virtDBusDomainAbortJob },
    { "AddIOThread", virtDBusDomainAddIOThread },
    { "AttachDevice", virtDBusDomainAttachDevice },
    { "BlockCommit", virtDBusDomainBlockCommit },
    { "BlockJobAbort", virtDBusDomainBlockJobAbort },
    { "BlockJobSetSpeed", virtDBusDomainBlockJobSetSpeed },
    { "BlockPeek", virtDBusDomainBlockPeek },
    { "BlockPull", virtDBusDomainBlockPull },
    { "BlockRebase", virtDBusDomainBlockRebase },
    { "BlockResize", virtDBusDomainBlockResize },
    { "CoreDump", virtDBusDomainCoreDumpWithFormat },
    { "Create", virtDBusDomainCreate },
    { "DelIOThread", virtDBusDomainDelIOThread },
    { "Destroy", virtDBusDomainDestroy },
    { "DetachDevice", virtDBusDomainDetachDevice },
    { "FSFreeze", virtDBusDomainFSFreeze },
    { "FSThaw", virtDBusDomainFSThaw },
    { "FSTrim", virtDBusDomainFSTrim },
    { "GetBlkioParameters", virtDBusDomainGetBlkioParameters },
    { "GetBlockIOTune", virtDBusDomainGetBlockIOTune },
    { "GetBlockJobInfo", virtDBusDomainGetBlockJobInfo },
    { "GetControlInfo", virtDBusDomainGetControlInfo },
    { "GetDiskErrors", virtDBusDomainGetDiskErrors },
    { "GetFSInfo", virtDBusDomainGetFSInfo },
    { "GetGuestVcpus", virtDBusDomainGetGuestVcpus },
    { "GetHostname", virtDBusDomainGetHostname },
    { "GetInterfaceParameters", virtDBusDomainGetInterfaceParameters },
    { "GetIOThreadInfo", virtDBusDomainGetIOThreadInfo },
    { "GetJobInfo", virtDBusDomainGetJobInfo },
    { "GetJobStats", virtDBusDomainGetJobStats },
    { "GetMemoryParameters", virtDBusDomainGetMemoryParameters },
    { "GetMetadata", virtDBusDomainGetMetadata },
    { "GetNumaParameters", virtDBusDomainGetNumaParameters },
    { "GetPerfEvents", virtDBusDomainGetPerfEvents },
    { "GetSchedulerParameters", virtDBusDomainGetSchedulerParameters },
    { "GetStats", virtDBusDomainGetStats },
    { "GetTime", virtDBusDomainGetTime },
    { "GetVcpus", virtDBusDomainGetVcpus },
    { "GetXMLDesc", virtDBusDomainGetXMLDesc },
    { "HasManagedSaveImage", virtDBusDomainHasManagedSaveImage },
    { "InjectNMI", virtDBusDomainInjectNMI },
    { "ManagedSave", virtDBusDomainManagedSave },
    { "ManagedSaveRemove", virtDBusDomainManagedSaveRemove },
    { "MemoryPeek", virtDBusDomainMemoryPeek },
    { "MemoryStats", virtDBusDomainMemoryStats },
    { "MigrateGetCompressionCache", virtDBusDomainMigrateGetCompressionCache },
    { "MigrateGetMaxSpeed", virtDBusDomainMigrateGetMaxSpeed },
    { "MigrateSetCompressionCache", virtDBusDomainMigrateSetCompressionCache },
    { "MigrateSetMaxDowntime", virtDBusDomainMigrateSetMaxDowntime },
    { "MigrateSetMaxSpeed", virtDBusDomainMigrateSetMaxSpeed },
    { "MigrateStartPostCopy", virtDBusDomainMigrateStartPostCopy },
    { "Reboot", virtDBusDomainReboot },
    { "Rename", virtDBusDomainRename },
    { "Reset", virtDBusDomainReset },
    { "Resume", virtDBusDomainResume },
    { "Save", virtDBusDomainSave },
    { "SendKey", virtDBusDomainSendKey },
    { "SendProcessSignal", virtDBusDomainSendProcessSignal },
    { "SetBlkioParameters", virtDBusDomainSetBlkioParameters },
    { "SetBlockIOTune", virtDBusDomainSetBlockIOTune },
    { "SetInterfaceParameters", virtDBusDomainSetInterfaceParameters },
    { "SetVcpus", virtDBusDomainSetVcpus },
    { "SetMemory", virtDBusDomainSetMemory },
    { "SetMemoryParameters", virtDBusDomainSetMemoryParameters },
    { "SetMemoryStatsPeriod", virtDBusDomainSetMemoryStatsPeriod },
    { "SetMetadata", virtDBusDomainSetMetadata },
    { "SetNumaParameters", virtDBusDomainSetNumaParameters },
    { "SetPerfEvents", virtDBusDomainSetPerfEvents },
    { "SetSchedulerParameters", virtDBusDomainSetSchedulerParameters },
    { "SetTime", virtDBusDomainSetTime },
    { "SetUserPassword", virtDBusDomainSetUserPassword },
    { "Shutdown", virtDBusDomainShutdown },
    { "Suspend", virtDBusDomainSuspend },
    { "Undefine", virtDBusDomainUndefine },
    { "UpdateDevice", virtDBusDomainUpdateDevice },
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
