#include "util.h"

#include <libvirt/virterror.h>
#include <string.h>

static const GDBusErrorEntry virtDBusUtilErrorEntries[] = {
    { VIRT_DBUS_ERROR_LIBVIRT, "org.libvirt.Error" },
};

G_STATIC_ASSERT(G_N_ELEMENTS(virtDBusUtilErrorEntries) == VIRT_DBUS_N_ERRORS);

GQuark
virtDBusErrorQuark(void)
{
    static volatile gsize quarkVolatile = 0;
    g_dbus_error_register_error_domain("virt-dbus-error-quark",
                                       &quarkVolatile,
                                       virtDBusUtilErrorEntries,
                                       G_N_ELEMENTS(virtDBusUtilErrorEntries));
    return (GQuark) quarkVolatile;
}

GVariant *
virtDBusUtilTypedParamsToGVariant(virTypedParameterPtr params,
                                  gint nparams)
{
    GVariantBuilder builder;

    g_variant_builder_init(&builder, G_VARIANT_TYPE("a{sv}"));

    for (gint i = 0; i < nparams; i++) {
        GVariant *value = NULL;

        switch (params[i].type) {
        case VIR_TYPED_PARAM_INT:
            value = g_variant_new("i", params[i].value.i);
            break;
        case VIR_TYPED_PARAM_UINT:
            value = g_variant_new("u", params[i].value.ui);
            break;
        case VIR_TYPED_PARAM_LLONG:
            value = g_variant_new("x", params[i].value.l);
            break;
        case VIR_TYPED_PARAM_ULLONG:
            value = g_variant_new("t", params[i].value.ul);
            break;
        case VIR_TYPED_PARAM_DOUBLE:
            value = g_variant_new("d", params[i].value.d);
            break;
        case VIR_TYPED_PARAM_BOOLEAN:
            value = g_variant_new("b", params[i].value.b);
            break;
        case VIR_TYPED_PARAM_STRING:
            value = g_variant_new("s", params[i].value.s);
            break;
        }

        g_variant_builder_add(&builder, "{sv}",
                              params[i].field,
                              g_variant_new_variant(value));
    }

    return g_variant_builder_end(&builder);
}

void
virtDBusUtilSetLastVirtError(GError **error)
{
    virErrorPtr vir_error;

    vir_error = virGetLastError();
    if (!vir_error) {
        g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                    "unknown error");
    } else {
        g_set_error_literal(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                            vir_error->message);
    }
}

static gchar *
virtDBusUtilEncodeUUID(const gchar *uuid)
{
    gchar *ret = g_strdup_printf("_%s", uuid);
    return g_strdelimit(ret, "-", '_');
}

static gchar *
virtDBusUtilDecodeUUID(const gchar *uuid)
{
    gchar *ret = g_strdup(uuid+1);
    return g_strdelimit(ret, "_", '-');
}

gchar *
virtDBusUtilBusPathForVirDomain(virDomainPtr domain,
                                const gchar *domainPath)
{
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";
    g_autofree gchar *newUuid = NULL;
    virDomainGetUUIDString(domain, uuid);
    newUuid = virtDBusUtilEncodeUUID(uuid);
    return g_strdup_printf("%s/%s", domainPath, newUuid);
}

virDomainPtr
virtDBusUtilVirDomainFromBusPath(virConnectPtr connection,
                                 const gchar *path,
                                 const gchar *domainPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(domainPath) + 1;

    name = virtDBusUtilDecodeUUID(path+prefixLen);

    return virDomainLookupByUUIDString(connection, name);
}

void
virtDBusUtilVirDomainListFree(virDomainPtr *domains)
{
    for (gint i = 0; domains[i] != NULL; i += 1)
        virDomainFree(domains[i]);

    g_free(domains);
}
