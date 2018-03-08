#include "util.h"

#include <libvirt/virterror.h>

int
virtDBusUtilMessageAppendTypedParameters(sd_bus_message *message,
                                         virTypedParameterPtr parameters,
                                         int n_parameters)
{
    int r;

    r = sd_bus_message_open_container(message, 'a', "{sv}");
    if (r < 0)
        return r;

    for (int i = 0; i < n_parameters; i += 1) {
        r = sd_bus_message_open_container(message, SD_BUS_TYPE_DICT_ENTRY, "sv");
        if (r < 0)
            return r;

        r = sd_bus_message_append(message, "s", parameters[i].field);
        if (r < 0)
            return r;

        switch (parameters[i].type) {
            case VIR_TYPED_PARAM_INT:
                r = sd_bus_message_append(message, "v", "i", parameters[i].value.i);
                break;
            case VIR_TYPED_PARAM_UINT:
                r = sd_bus_message_append(message, "v", "u", parameters[i].value.ui);
                break;
            case VIR_TYPED_PARAM_LLONG:
                r = sd_bus_message_append(message, "v", "x", parameters[i].value.l);
                break;
            case VIR_TYPED_PARAM_ULLONG:
                r = sd_bus_message_append(message, "v", "t", parameters[i].value.ul);
                break;
            case VIR_TYPED_PARAM_DOUBLE:
                r = sd_bus_message_append(message, "v", "d", parameters[i].value.d);
                break;
            case VIR_TYPED_PARAM_BOOLEAN:
                r = sd_bus_message_append(message, "v", "b", parameters[i].value.b);
                break;
            case VIR_TYPED_PARAM_STRING:
                r = sd_bus_message_append(message, "v", "s", parameters[i].value.s);
                break;
        }

        if (r < 0)
            return r;

        r = sd_bus_message_close_container(message);
        if (r < 0)
            return r;
    }

    return sd_bus_message_close_container(message);
}

int
virtDBusUtilSetLastVirtError(sd_bus_error *error)
{
    virErrorPtr vir_error;

    vir_error = virGetLastError();
    if (!vir_error)
        return 0;

    return sd_bus_error_set(error, "org.libvirt.Error", vir_error->message);
}

int
virtDBusUtilSetError(sd_bus_error *error,
                     const char *message)
{
    return sd_bus_error_set(error, "org.libvirt.Error", message);
}

char *
virtDBusUtilBusPathForVirDomain(virDomainPtr domain,
                                const char *domainPath)
{
    char *path = NULL;
    char uuid[VIR_UUID_STRING_BUFLEN] = "";

    virDomainGetUUIDString(domain, uuid);
    sd_bus_path_encode(domainPath, uuid, &path);

    return path;
}

virDomainPtr
virtDBusUtilVirDomainFromBusPath(virConnectPtr connection,
                                 const char *path,
                                 const char *domainPath)
{
    _cleanup_(virtDBusUtilFreep) char *name = NULL;
    int r;

    r = sd_bus_path_decode(path, domainPath, &name);
    if (r < 0)
        return NULL;

    return virDomainLookupByUUIDString(connection, name);
}

void
virtDBusUtilFreep(void *p)
{
    free(*(void **)p);
}

void
virtDBusUtilClosep(int *fdp)
{
    if (*fdp >= 0)
        close(*fdp);
}

void
virtDBusUtilStrvFreep(void *p)
{
    char **strv = *(char ***)p;

    if (strv == NULL)
        return;

    for (unsigned i = 0; strv[i] != NULL; i++)
        free(strv[i]);

    free(strv);
}

void
virtDBusUtilVirDomainFreep(virDomainPtr *domainp)
{
    if (*domainp)
        virDomainFree(*domainp);
}

void
virtDBusUtilVirDomainListFreep(virDomainPtr **domainsp)
{
    virDomainPtr *domains = *domainsp;

    if (!domains)
        return;

    for (int i = 0; domains[i] != NULL; i += 1)
        virDomainFree(domains[i]);

    free(domains);
}
