#include "domain.h"
#include "util.h"

#include <gio/gunixfdlist.h>
#include <libvirt/libvirt.h>

static gchar *
virtDBusDomainConvertBoolArrayToGuestVcpumap(GVariantIter *iter)
{
    gboolean set;
    gboolean first = TRUE;
    guint intervalStart = 0;
    gboolean setPrev = 0;
    g_autofree GString *ret = NULL;

    ret = g_string_new("");
    for (guint i = 0; ; i++) {
        gboolean stop = !g_variant_iter_loop(iter, "b", &set);

        if (set && !setPrev) {
            intervalStart = i;
        } else if (!set && setPrev) {
            if (!first)
                g_string_append_printf(ret, ",");
            else
                first = FALSE;

            if (intervalStart != i - 1)
                g_string_append_printf(ret, "%d-%d", intervalStart, i - 1);
            else
                g_string_append_printf(ret, "%d", intervalStart);
        }
        setPrev = set;

        if (stop)
            break;
    }

    return ret->str;
}

struct _virtDBusDomainFSInfoList {
    virDomainFSInfoPtr *info;
    gint count;
};

typedef struct _virtDBusDomainFSInfoList virtDBusDomainFSInfoList;

struct _virtDBusDomainInterfaceList {
    virDomainInterfacePtr *ifaces;
    gint count;
};

typedef struct _virtDBusDomainInterfaceList virtDBusDomainInterfaceList;

static void
virtDBusDomainInterfaceListClear(virtDBusDomainInterfaceList *ifaces)
{
    for (gint i = 0; i < ifaces->count; i++)
        virDomainInterfaceFree(ifaces->ifaces[i]);

    g_free(ifaces->ifaces);
}

G_DEFINE_AUTO_CLEANUP_CLEAR_FUNC(virtDBusDomainInterfaceList,
                                 virtDBusDomainInterfaceListClear);

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

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a{it}"));

    for (gint i = 0; i < nr_stats; i++)
        g_variant_builder_add(&builder, "{it}", stats[i].tag, stats[i].val);

    return g_variant_builder_end(&builder);
}

static void
virtDBusDomainGVariantToMountpoints(GVariantIter *iter,
                                    const gchar ***mountpoints,
                                    guint *nmountpoints)
{
    const gchar **tmp;

    *nmountpoints = g_variant_iter_n_children(iter);
    if (*nmountpoints > 0) {
        *mountpoints = g_new0(const gchar *, *nmountpoints);
        tmp = *mountpoints;
        while (g_variant_iter_next(iter, "&s", tmp))
            tmp++;
    }
}

static void
virtDBusDomainGVariantToCpumap(GVariantIter *iter,
                               guchar **cpumap,
                               guint *cpumaplen)
{
    gboolean usable;
    guint cpus = g_variant_iter_n_children(iter);
    guint cnt = 0;

    *cpumaplen = VIR_CPU_MAPLEN(cpus);
    *cpumap = g_new0(guchar, cpumaplen);

    while (g_variant_iter_loop(iter, "b", &usable)) {
        if (usable)
            VIR_USE_CPU(*cpumap, cnt);
        cnt++;
    }
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
virtDBusDomainBlockCopy(GVariant *inArgs,
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
    const gchar *destxml;
    g_autoptr(GVariantIter) iter = NULL;
    guint flags;
    g_auto(virtDBusUtilTypedParams) params = { 0 };

    g_variant_get(inArgs, "(&s&sa{sv}u)", &disk, &destxml, &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainBlockCopy(domain, disk, destxml, params.params,
                           params.nparams, flags) < 0) {
        virtDBusUtilSetLastVirtError(error);
    }
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
virtDBusDomainCreateWithFiles(GVariant *inArgs,
                              GUnixFDList *inFDs,
                              const gchar *objectPath,
                              gpointer userData,
                              GVariant **outArgs G_GNUC_UNUSED,
                              GUnixFDList **outFDs G_GNUC_UNUSED,
                              GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    const gint *files = NULL;
    guint nfiles = 0;
    guint flags;

    g_variant_get(inArgs, "(ahu)", NULL, &flags);

    if (inFDs) {
        nfiles = g_unix_fd_list_get_length(inFDs);
        if (nfiles > 0)
            files = g_unix_fd_list_peek_fds(inFDs, NULL);
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainCreateWithFiles(domain, nfiles, (gint *)files, flags) < 0)
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
    g_autoptr(GVariantIter) iter;
    guint nmountpoints;
    guint flags;
    gint ret;

    g_variant_get(inArgs, "(asu)", &iter, &flags);

    virtDBusDomainGVariantToMountpoints(iter, &mountpoints, &nmountpoints);

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
    g_autoptr(GVariantIter) iter;
    guint nmountpoints;
    guint flags;
    gint ret;

    g_variant_get(inArgs, "(asu)", &iter, &flags);

    virtDBusDomainGVariantToMountpoints(iter, &mountpoints, &nmountpoints);

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
virtDBusDomainGetBlockIOParameters(GVariant *inArgs,
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

    if (params.nparams != 0) {
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

    g_variant_get(inArgs, "(&su)", &disk, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetBlockJobInfo(domain, disk, &info, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((ittt))", info.type, info.bandwidth,
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
    guint flags;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    controlInfo = g_new0(virDomainControlInfo, 1);
    if (virDomainGetControlInfo(domain, controlInfo, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((uut))", controlInfo->state,
                             controlInfo->details, controlInfo->stateTime);
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

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(si)"));
    for (gint i = 0; i < count; i++) {
        g_variant_builder_open(&builder, G_VARIANT_TYPE("(si)"));
        g_variant_builder_add(&builder, "s", disks[i].disk);
        g_variant_builder_add(&builder, "i", disks[i].error);
        g_variant_builder_close(&builder);
    }
    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
}

static void
virtDBusDomainGetEmulatorPinInfo(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;
    gint cpuCount;
    g_autofree guchar *cpumap = NULL;
    gint cpumaplen;
    GVariantBuilder builder;
    GVariant *gret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    cpuCount = virNodeGetCPUMap(connect->connection, NULL, NULL, 0);
    if (cpuCount < 0)
        return virtDBusUtilSetLastVirtError(error);

    cpumaplen = VIR_CPU_MAPLEN(cpuCount);
    cpumap = g_new0(guchar, cpumaplen);

    if (virDomainGetEmulatorPinInfo(domain, cpumap, cpumaplen, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("ab"));

    for (gint i = 0; i < cpuCount; i++)
        g_variant_builder_add(&builder, "b", VIR_CPU_USED(cpumap, i));

    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
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

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    jobInfo = g_new0(virDomainJobInfo, 1);
    if (virDomainGetJobInfo(domain, jobInfo) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((ittttttttttt))", jobInfo->type,
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

    g_variant_builder_init(&builder, G_VARIANT_TYPE("(ia{sv})"));
    g_variant_builder_add(&builder, "i", type);
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
    if (ret < 0)
        return virtDBusUtilSetLastVirtError(error);

    if (params.nparams != 0) {
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
    gint type;
    const gchar *uri;
    guint flags;
    g_autofree gchar *ret = NULL;

    g_variant_get(inArgs, "(i&su)", &type, &uri, &flags);
    if (g_str_equal(uri, ""))
        uri = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

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
    if (!ret)
        return virtDBusUtilSetLastVirtError(error);

    if (params.nparams != 0) {
        params.params = g_new0(virTypedParameter, params.nparams);
        if (virDomainGetSchedulerParametersFlags(domain, params.params,
                                                 &params.nparams, 0))
            return virtDBusUtilSetLastVirtError(error);
    }

    grecords = virtDBusUtilTypedParamsToGVariant(params.params, params.nparams);

    *outArgs = g_variant_new_tuple(&grecords, 1);
}

static void
virtDBusDomainGetSecurityLabelList(GVariant *inArgs G_GNUC_UNUSED,
                                   GUnixFDList *inFDs G_GNUC_UNUSED,
                                   const gchar *objectPath,
                                   gpointer userData,
                                   GVariant **outArgs,
                                   GUnixFDList **outFDs G_GNUC_UNUSED,
                                   GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    g_autofree virSecurityLabelPtr seclabels = NULL;
    gint nseclabels;
    GVariantBuilder builder;
    GVariant *gret;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    nseclabels = virDomainGetSecurityLabelList(domain, &seclabels);
    if (nseclabels < 0)
        return virtDBusUtilSetLastVirtError(error);

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(sb)"));
    for (gint i = 0; i < nseclabels; i++) {
        g_variant_builder_add(&builder, "(sb)", seclabels[i].label,
                              !!seclabels[i].enforcing);
    }
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
}

static void
virtDBusDomainGetState(GVariant *inArgs,
                       GUnixFDList *inFDs G_GNUC_UNUSED,
                       const gchar *objectPath,
                       gpointer userData,
                       GVariant **outArgs,
                       GUnixFDList **outFDs G_GNUC_UNUSED,
                       GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;
    gint state;
    gint reason;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetState(domain, &state, &reason, flags) < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("((ii))", state, reason);
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
virtDBusDomainGetVcpuPinInfo(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs G_GNUC_UNUSED,
                             GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint flags;
    virDomainInfo domInfo;
    gint vcpuCount;
    gint cpuCount;
    g_autofree guchar *cpumaps = NULL;
    gint cpumaplen;
    GVariantBuilder builder;
    GVariant *gret;

    g_variant_get(inArgs, "(u)", &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainGetInfo(domain, &domInfo) < 0)
        return virtDBusUtilSetLastVirtError(error);

    vcpuCount = domInfo.nrVirtCpu;

    cpuCount = virNodeGetCPUMap(connect->connection, NULL, NULL, 0);
    if (cpuCount < 0)
        return virtDBusUtilSetLastVirtError(error);

    cpumaplen = VIR_CPU_MAPLEN(cpuCount);
    cpumaps = g_new0(guchar, cpumaplen * vcpuCount);

    if (virDomainGetVcpuPinInfo(domain, vcpuCount, cpumaps,
                                cpumaplen, flags) < 0) {
        return virtDBusUtilSetLastVirtError(error);
    }

    g_variant_builder_init(&builder, G_VARIANT_TYPE("aab"));
    for (gint i = 0; i < vcpuCount; i++) {
        g_variant_builder_open(&builder, G_VARIANT_TYPE("ab"));
        for (gint j = 0; j < cpuCount; j++) {
            g_variant_builder_add(&builder, "b",
                                  VIR_CPU_USABLE(cpumaps, cpumaplen, i, j));
        }
        g_variant_builder_close(&builder);
    }
    gret = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&gret, 1);
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
virtDBusDomainInterfaceAddresses(GVariant *inArgs,
                                 GUnixFDList *inFDs G_GNUC_UNUSED,
                                 const gchar *objectPath,
                                 gpointer userData,
                                 GVariant **outArgs G_GNUC_UNUSED,
                                 GUnixFDList **outFDs G_GNUC_UNUSED,
                                 GError **error)
{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    gint source;
    g_auto(virtDBusDomainInterfaceList) ifaces = { 0 };
    guint flags;
    GVariantBuilder builder;
    GVariant *res;

    g_variant_get(inArgs, "(uu)", &source, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    ifaces.count = virDomainInterfaceAddresses(domain, &(ifaces.ifaces),
                                               source, flags);
    if (ifaces.count < 0)
        return virtDBusUtilSetLastVirtError(error);


    g_variant_builder_init(&builder, G_VARIANT_TYPE("a(ssa(isu))"));
    for (gint i = 0; i < ifaces.count; i++) {
        virDomainInterfacePtr iface = ifaces.ifaces[i];

        g_variant_builder_open(&builder, G_VARIANT_TYPE("(ssa(isu))"));
        g_variant_builder_add(&builder, "s", iface->name);
        g_variant_builder_add(&builder, "s",
                              iface->hwaddr ? iface->hwaddr : "");
        g_variant_builder_open(&builder, G_VARIANT_TYPE("a(isu)"));
        for (guint j = 0; j < iface->naddrs; j++) {
            g_variant_builder_open(&builder, G_VARIANT_TYPE("(isu)"));
            g_variant_builder_add(&builder, "i", iface->addrs[j].type);
            g_variant_builder_add(&builder, "s", iface->addrs[j].addr);
            g_variant_builder_add(&builder, "u", iface->addrs[j].prefix);
            g_variant_builder_close(&builder);
        }
        g_variant_builder_close(&builder);
        g_variant_builder_close(&builder);
    }
    res = g_variant_builder_end(&builder);

    *outArgs = g_variant_new_tuple(&res, 1);
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
virtDBusDomainMigrateToURI3(GVariant *inArgs,
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
    const gchar *dconuri;
    g_auto(virtDBusUtilTypedParams) params = { 0 };
    guint flags;

    g_variant_get(inArgs, "(&sa{sv}u)", &dconuri, &iter, &flags);

    if (!virtDBusUtilGVariantToTypedParams(iter, &params.params,
                                           &params.nparams, error)) {
        return;
    }

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainMigrateToURI3(domain, dconuri, params.params,
                               params.nparams, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainOpenGraphicsFD(GVariant *inArgs,
                             GUnixFDList *inFDs G_GNUC_UNUSED,
                             const gchar *objectPath,
                             gpointer userData,
                             GVariant **outArgs,
                             GUnixFDList **outFDs,
                             GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint idx;
    guint flags;
    gint fd;

    g_variant_get(inArgs, "(uu)", &idx, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    fd = virDomainOpenGraphicsFD(domain, idx, flags);
    if (fd < 0)
        return virtDBusUtilSetLastVirtError(error);

    *outArgs = g_variant_new("(h)", 0);
    *outFDs = g_unix_fd_list_new_from_array(&fd, 1);
}

static void
virtDBusDomainPinEmulator(GVariant *inArgs,
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
    guint flags;
    guint cpumaplen;
    g_autofree guchar *cpumap = NULL;

    g_variant_get(inArgs, "(abu)", &iter, &flags);

    virtDBusDomainGVariantToCpumap(iter, &cpumap, &cpumaplen);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainPinEmulator(domain, cpumap, cpumaplen, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainPinIOThread(GVariant *inArgs,
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
    g_autoptr(GVariantIter) iter = NULL;
    guint flags;
    guint cpumaplen;
    g_autofree guchar *cpumap = NULL;

    g_variant_get(inArgs, "(uabu)", &iothreadId, &iter, &flags);

    virtDBusDomainGVariantToCpumap(iter, &cpumap, &cpumaplen);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainPinIOThread(domain, iothreadId, cpumap, cpumaplen, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainPinVcpu(GVariant *inArgs,
                      GUnixFDList *inFDs G_GNUC_UNUSED,
                      const gchar *objectPath,
                      gpointer userData,
                      GVariant **outArgs G_GNUC_UNUSED,
                      GUnixFDList **outFDs G_GNUC_UNUSED,
                      GError **error)

{
    virtDBusConnect *connect = userData;
    g_autoptr(virDomain) domain = NULL;
    guint vcpu;
    g_autoptr(GVariantIter) iter = NULL;
    guint flags;
    guint cpumaplen;
    g_autofree guchar *cpumap = NULL;

    g_variant_get(inArgs, "(uabu)", &vcpu, &iter, &flags);

    virtDBusDomainGVariantToCpumap(iter, &cpumap, &cpumaplen);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    if (virDomainPinVcpuFlags(domain, vcpu, cpumap, cpumaplen, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
}

static void
virtDBusDomainPMWakeup(GVariant *inArgs,
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

    if (virDomainPMWakeup(domain, flags) < 0)
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
virtDBusDomainSetBlockIOParameters(GVariant *inArgs,
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
virtDBusDomainSetGuestVcpus(GVariant *inArgs,
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
    gint state;
    guint flags;
    g_autofree gchar *cpumap = NULL;

    g_variant_get(inArgs, "(abiu)", &iter, &state, &flags);

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

    cpumap = virtDBusDomainConvertBoolArrayToGuestVcpumap(iter);

    if (virDomainSetGuestVcpus(domain, cpumap, state, flags) < 0)
        virtDBusUtilSetLastVirtError(error);
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
    gint type;
    const gchar *metadata;
    const gchar *key;
    const gchar *uri;
    guint flags;

    g_variant_get(inArgs, "(i&s&s&su)", &type, &metadata, &key, &uri, &flags);
    if (g_str_equal(key, ""))
        key = NULL;
    if (g_str_equal(uri, ""))
        uri = NULL;

    domain = virtDBusDomainGetVirDomain(connect, objectPath, error);
    if (!domain)
        return;

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
    { "Updated", virtDBusDomainGetUpdated, NULL },
    { "UUID", virtDBusDomainGetUUID, NULL },
    { 0 }
};

static virtDBusGDBusMethodTable virtDBusDomainMethodTable[] = {
    { "AbortJob", virtDBusDomainAbortJob },
    { "AddIOThread", virtDBusDomainAddIOThread },
    { "AttachDevice", virtDBusDomainAttachDevice },
    { "BlockCommit", virtDBusDomainBlockCommit },
    { "BlockCopy", virtDBusDomainBlockCopy },
    { "BlockJobAbort", virtDBusDomainBlockJobAbort },
    { "BlockJobSetSpeed", virtDBusDomainBlockJobSetSpeed },
    { "BlockPeek", virtDBusDomainBlockPeek },
    { "BlockPull", virtDBusDomainBlockPull },
    { "BlockRebase", virtDBusDomainBlockRebase },
    { "BlockResize", virtDBusDomainBlockResize },
    { "CoreDump", virtDBusDomainCoreDumpWithFormat },
    { "Create", virtDBusDomainCreate },
    { "CreateWithFiles", virtDBusDomainCreateWithFiles },
    { "DelIOThread", virtDBusDomainDelIOThread },
    { "Destroy", virtDBusDomainDestroy },
    { "DetachDevice", virtDBusDomainDetachDevice },
    { "FSFreeze", virtDBusDomainFSFreeze },
    { "FSThaw", virtDBusDomainFSThaw },
    { "FSTrim", virtDBusDomainFSTrim },
    { "GetBlockIOParameters", virtDBusDomainGetBlockIOParameters },
    { "GetBlockIOTune", virtDBusDomainGetBlockIOTune },
    { "GetBlockJobInfo", virtDBusDomainGetBlockJobInfo },
    { "GetControlInfo", virtDBusDomainGetControlInfo },
    { "GetDiskErrors", virtDBusDomainGetDiskErrors },
    { "GetEmulatorPinInfo", virtDBusDomainGetEmulatorPinInfo },
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
    { "GetSecurityLabelList", virtDBusDomainGetSecurityLabelList },
    { "GetState", virtDBusDomainGetState },
    { "GetStats", virtDBusDomainGetStats },
    { "GetTime", virtDBusDomainGetTime },
    { "GetVcpuPinInfo", virtDBusDomainGetVcpuPinInfo },
    { "GetVcpus", virtDBusDomainGetVcpus },
    { "GetXMLDesc", virtDBusDomainGetXMLDesc },
    { "HasManagedSaveImage", virtDBusDomainHasManagedSaveImage },
    { "InjectNMI", virtDBusDomainInjectNMI },
    { "InterfaceAddresses", virtDBusDomainInterfaceAddresses },
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
    { "MigrateToURI3", virtDBusDomainMigrateToURI3 },
    { "OpenGraphicsFD", virtDBusDomainOpenGraphicsFD },
    { "PinEmulator", virtDBusDomainPinEmulator },
    { "PinIOThread", virtDBusDomainPinIOThread },
    { "PinVcpu", virtDBusDomainPinVcpu },
    { "PMWakeup", virtDBusDomainPMWakeup },
    { "Reboot", virtDBusDomainReboot },
    { "Rename", virtDBusDomainRename },
    { "Reset", virtDBusDomainReset },
    { "Resume", virtDBusDomainResume },
    { "Save", virtDBusDomainSave },
    { "SendKey", virtDBusDomainSendKey },
    { "SendProcessSignal", virtDBusDomainSendProcessSignal },
    { "SetBlockIOParameters", virtDBusDomainSetBlockIOParameters },
    { "SetBlockIOTune", virtDBusDomainSetBlockIOTune },
    { "SetGuestVcpus", virtDBusDomainSetGuestVcpus },
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
