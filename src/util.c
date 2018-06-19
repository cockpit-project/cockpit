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

void
virtDBusUtilTypedParamsClear(virtDBusUtilTypedParams *params)
{
    virTypedParamsFree(params->params, params->nparams);
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

gboolean
virtDBusUtilGVariantToTypedParams(GVariantIter *iter,
                                  virTypedParameterPtr *params,
                                  gint *nparams,
                                  GError **error)
{
    g_autofree gchar *name = NULL;
    g_autoptr(GVariant) value = NULL;
    gint maxParams = 0;

    while (g_variant_iter_loop(iter, "{sv}", &name, &value)) {
        const gchar *type = g_variant_get_type_string(value);

        switch (type[0]) {
        case 'i':
            if (virTypedParamsAddInt(params, nparams, &maxParams, name,
                                     g_variant_get_int32(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 'u':
            if (virTypedParamsAddUInt(params, nparams, &maxParams, name,
                                      g_variant_get_uint32(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 'x':
            if (virTypedParamsAddLLong(params, nparams, &maxParams, name,
                                       g_variant_get_int64(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 't':
            if (virTypedParamsAddULLong(params, nparams, &maxParams, name,
                                        g_variant_get_uint64(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 'd':
            if (virTypedParamsAddDouble(params, nparams, &maxParams, name,
                                        g_variant_get_double(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 'b':
            if (virTypedParamsAddBoolean(params, nparams, &maxParams, name,
                                         g_variant_get_boolean(value)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        case 's':
            if (virTypedParamsAddString(params, nparams, &maxParams, name,
                                        g_variant_get_string(value, NULL)) < 0) {
                virtDBusUtilSetLastVirtError(error);
                return FALSE;
            }
            break;

        default:
            g_set_error(error, VIRT_DBUS_ERROR, VIRT_DBUS_ERROR_LIBVIRT,
                        "Invalid typed parameter '%s'.", type);
            return FALSE;
        }
    }

    name = NULL;
    value = NULL;

    return TRUE;
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
    gchar *ret = g_strdup(uuid + 1);
    return g_strdelimit(ret, "_", '-');
}

static guchar
virtDBusUtilNumToHexchar(const guchar c)
{
    if (c < 10)
        return '0' + c;
    return 'a' + (c & 0x0f) - 10;
}

static guchar
virtDBusUtilHexcharToNum(const guchar c)
{
    if (c >= 'a')
        return 10 + c - 'a';
    return c - '0';
}

gchar *
virtDBusUtilEncodeStr(const gchar *str)
{
    gint len = strlen(str);
    gint j = 0;
    gchar *ret = g_new(gchar, len * 3 + 1);

    for (gint i = 0; i < len; i++) {
        guchar c = str[i];
        if ((c >= 'A' && c <= 'Z') ||
            (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9')) {
            ret[j++] = c;
        } else {
            ret[j] = '_';
            ret[j + 1] = virtDBusUtilNumToHexchar(c >> 4);
            ret[j + 2] = virtDBusUtilNumToHexchar(c);
            j += 3;
        }
    }
    ret[j] = 0;

    return ret;
}

gchar *
virtDBusUtilDecodeStr(const gchar *str)
{
    gint len = strlen(str);
    gint j = 0;
    gchar *ret = g_new(gchar, len + 1);

    for (gint i = 0; i < len; i++) {
        gchar c = str[i];
        if (c != '_' || (i + 2) >= len) {
            ret[j++] = c;
        } else {
            guchar a = virtDBusUtilHexcharToNum(str[i + 1]);
            guchar b = virtDBusUtilHexcharToNum(str[i + 2]);
            ret[j++] = (a << 4) + b;
            i += 2;
        }
    }
    ret[j] = 0;

    return ret;
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
    for (gint i = 0; domains[i] != NULL; i++)
        virDomainFree(domains[i]);

    g_free(domains);
}

virNetworkPtr
virtDBusUtilVirNetworkFromBusPath(virConnectPtr connection,
                                  const gchar *path,
                                  const gchar *networkPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(networkPath) + 1;

    name = virtDBusUtilDecodeUUID(path+prefixLen);

    return virNetworkLookupByUUIDString(connection, name);
}

gchar *
virtDBusUtilBusPathForVirNetwork(virNetworkPtr network,
                                 const gchar *networkPath)
{
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";
    g_autofree gchar *newUuid = NULL;
    virNetworkGetUUIDString(network, uuid);
    newUuid = virtDBusUtilEncodeUUID(uuid);
    return g_strdup_printf("%s/%s", networkPath, newUuid);
}

void
virtDBusUtilVirNetworkListFree(virNetworkPtr *networks)
{
    for (gint i = 0; networks[i] != NULL; i++)
        virNetworkFree(networks[i]);

    g_free(networks);
}

virNodeDevicePtr
virtDBusUtilVirNodeDeviceFromBusPath(virConnectPtr connection,
                                     const gchar *path,
                                     const gchar *nodeDevPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(nodeDevPath) + 1;

    name = virtDBusUtilDecodeStr(path + prefixLen);

    return virNodeDeviceLookupByName(connection, name);
}

gchar *
virtDBusUtilBusPathForVirNodeDevice(virNodeDevicePtr dev,
                                    const gchar *nodeDevPath)
{
    const gchar *name = NULL;
    g_autofree const gchar *encodedName = NULL;

    name = virNodeDeviceGetName(dev);
    encodedName = virtDBusUtilEncodeStr(name);

    return g_strdup_printf("%s/%s", nodeDevPath, encodedName);
}

void
virtDBusUtilVirNodeDeviceListFree(virNodeDevicePtr *devs)
{
    for (gint i = 0; devs[i] != NULL; i++)
        virNodeDeviceFree(devs[i]);

    g_free(devs);
}

virNWFilterPtr
virtDBusUtilVirNWFilterFromBusPath(virConnectPtr connection,
                                   const gchar *path,
                                   const gchar *nwfilterPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(nwfilterPath) + 1;

    name = virtDBusUtilDecodeUUID(path + prefixLen);

    return virNWFilterLookupByUUIDString(connection, name);
}

gchar *
virtDBusUtilBusPathForVirNWFilter(virNWFilterPtr nwfilter,
                                  const gchar *nwfilterPath)
{
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";
    g_autofree gchar *newUuid = NULL;
    virNWFilterGetUUIDString(nwfilter, uuid);
    newUuid = virtDBusUtilEncodeUUID(uuid);
    return g_strdup_printf("%s/%s", nwfilterPath, newUuid);
}

void
virtDBusUtilVirNWFilterListFree(virNWFilterPtr *nwfilters)
{
    for (gint i = 0; nwfilters[i] != NULL; i++)
        virNWFilterFree(nwfilters[i]);

    g_free(nwfilters);
}
void
virtDBusUtilStringListFree(virtDBusCharArray *item)
{
    for (gint i = 0; item[i] != NULL; i++)
        g_free(item[i]);

    g_free(item);
}

virSecretPtr
virtDBusUtilVirSecretFromBusPath(virConnectPtr connection,
                                 const gchar *path,
                                 const gchar *secretPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(secretPath) + 1;

    name = virtDBusUtilDecodeUUID(path + prefixLen);

    return virSecretLookupByUUIDString(connection, name);
}

gchar *
virtDBusUtilBusPathForVirSecret(virSecretPtr secret,
                                const gchar *secretPath)
{
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";
    g_autofree gchar *newUuid = NULL;
    virSecretGetUUIDString(secret, uuid);
    newUuid = virtDBusUtilEncodeUUID(uuid);
    return g_strdup_printf("%s/%s", secretPath, newUuid);
}

void
virtDBusUtilVirSecretListFree(virSecretPtr *secrets)
{
    for (gint i = 0; secrets[i] != NULL; i++)
        virSecretFree(secrets[i]);

    g_free(secrets);
}

virStoragePoolPtr
virtDBusUtilVirStoragePoolFromBusPath(virConnectPtr connection,
                                      const gchar *path,
                                      const gchar *storagePoolPath)
{
    g_autofree gchar *name = NULL;
    gsize prefixLen = strlen(storagePoolPath) + 1;

    name = virtDBusUtilDecodeUUID(path + prefixLen);

    return virStoragePoolLookupByUUIDString(connection, name);
}

gchar *
virtDBusUtilBusPathForVirStoragePool(virStoragePoolPtr storagePool,
                                     const gchar *storagePoolPath)
{
    gchar uuid[VIR_UUID_STRING_BUFLEN] = "";
    g_autofree gchar *newUuid = NULL;
    virStoragePoolGetUUIDString(storagePool, uuid);
    newUuid = virtDBusUtilEncodeUUID(uuid);
    return g_strdup_printf("%s/%s", storagePoolPath, newUuid);
}

void
virtDBusUtilVirStoragePoolListFree(virStoragePoolPtr *storagePools)
{
    for (gint i = 0; storagePools[i] != NULL; i++)
        virStoragePoolFree(storagePools[i]);

    g_free(storagePools);
}

virStorageVolPtr
virtDBusUtilVirStorageVolFromBusPath(virConnectPtr connection,
                                     const gchar *path,
                                     const gchar *storageVolPath)
{
    g_autofree gchar *key = NULL;
    gsize prefixLen = strlen(storageVolPath) + 1;

    key = virtDBusUtilDecodeStr(path + prefixLen);

    return virStorageVolLookupByKey(connection, key);
}

gchar *
virtDBusUtilBusPathForVirStorageVol(virStorageVolPtr storageVol,
                                    const gchar *storageVolPath)
{
    const gchar *key = NULL;
    g_autofree const gchar *encodedKey = NULL;

    key = virStorageVolGetKey(storageVol);
    encodedKey = virtDBusUtilEncodeStr(key);

    return g_strdup_printf("%s/%s", storageVolPath, encodedKey);
}

void
virtDBusUtilVirStorageVolListFree(virStorageVolPtr *storageVols)
{
    for (gint i = 0; storageVols[i] != NULL; i++)
        virStorageVolFree(storageVols[i]);

    g_free(storageVols);
}
