#include "util.h"

#include <libvirt/virterror.h>

int
bus_message_append_typed_parameters(sd_bus_message *message,
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

int bus_error_set_last_virt_error(sd_bus_error *error)
{
    virErrorPtr vir_error;

    vir_error = virGetLastError();
    if (!vir_error)
        return 0;

    return sd_bus_error_set(error, "org.libvirt.Error", vir_error->message);
}
