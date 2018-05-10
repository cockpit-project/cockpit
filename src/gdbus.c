#include "gdbus.h"

#include <gio/gunixfdlist.h>
#include <glib/gprintf.h>

struct _virtDBusGDBusMethodData {
    virtDBusGDBusMethodTable *methods;
    virtDBusGDBusPropertyTable *properties;
    gpointer *userData;
};
typedef struct _virtDBusGDBusMethodData virtDBusGDBusMethodData;

struct _virtDBusGDBusSubtreeData {
    GDBusInterfaceInfo *interface;
    virtDBusGDBusEnumerateFunc enumerate;
    virtDBusGDBusMethodData *methodData;
};
typedef struct _virtDBusGDBusSubtreeData virtDBusGDBusSubtreeData;

struct _virtDBusGDBusThreadData {
    const gchar *objectPath;
    const gchar *interfaceName;
    const gchar *methodName;
    GVariant *parameters;
    GDBusMethodInvocation *invocation;
    virtDBusGDBusMethodData *methodData;
};
typedef struct _virtDBusGDBusThreadData virtDBusGDBusThreadData;

static const gchar *dbusInterfacePrefix = NULL;

/**
 * virtDBusGDBusLoadIntrospectData:
 * @interface: name of the interface
 * @error: return location for error
 *
 * Reads an interface XML description from file and returns new
 * interface info.  The caller owns an reference to the returned info.
 *
 * The file path is constructed as:
 *
 *  VIRT_DBUS_INTERFACES_DIR/{@interface}.xml
 *
 * Returns interface info on success, NULL on failure.
 */
GDBusInterfaceInfo *
virtDBusGDBusLoadIntrospectData(gchar const *interface,
                                GError **error)
{
    g_autofree gchar *introspectFile = NULL;
    g_autofree gchar *introspectXML = NULL;
    g_autoptr(GDBusNodeInfo) nodeInfo = NULL;
    GDBusInterfaceInfo *ret;

    if (!dbusInterfacePrefix) {
        dbusInterfacePrefix = g_getenv("VIRT_DBUS_INTERFACES_DIR");
        if (!dbusInterfacePrefix)
            dbusInterfacePrefix = VIRT_DBUS_INTERFACES_DIR;
    }

    introspectFile = g_strdup_printf("%s/%s.xml", dbusInterfacePrefix, interface);

    if (!g_file_get_contents(introspectFile, &introspectXML, NULL, error))
        return NULL;

    nodeInfo = g_dbus_node_info_new_for_xml(introspectXML, error);
    if (!nodeInfo)
        return NULL;

    ret = nodeInfo->interfaces[0];
    if (!ret) {
        g_set_error(error, G_FILE_ERROR, G_FILE_ERROR_FAILED,
                    "no interface defined in '%s'", introspectFile);
        return NULL;
    }

    return g_dbus_interface_info_ref(ret);
}

static void
virtDBusGDBusHandlePropertyGet(GVariant *parameters,
                               GDBusMethodInvocation *invocation,
                               const gchar *objectPath,
                               virtDBusGDBusMethodData *data)
{
    virtDBusGDBusPropertyGetFunc getFunc = NULL;
    const gchar *interface;
    const gchar *name;
    GVariant *value = NULL;
    g_autoptr(GError) error = NULL;

    g_variant_get(parameters, "(&s&s)", &interface, &name);

    for (gint i = 0; data->properties[i].name; i++) {
        if (g_str_equal(name, data->properties[i].name)) {
            getFunc = data->properties[i].getFunc;
            break;
        }
    }

    if (!getFunc) {
        g_dbus_method_invocation_return_error(invocation,
                                              G_DBUS_ERROR,
                                              G_DBUS_ERROR_UNKNOWN_PROPERTY,
                                              "unknown property '%s'", name);
        return;
    }

    getFunc(objectPath, data->userData, &value, &error);

    if (error) {
        g_dbus_method_invocation_return_gerror(invocation, error);
        return;
    }

    g_return_if_fail(value);

    g_dbus_method_invocation_return_value(invocation,
                                          g_variant_new("(v)", value));
}

static void
virtDBusGDBusHandlePropertySet(GVariant *parameters,
                               GDBusMethodInvocation *invocation,
                               const gchar *objectPath,
                               virtDBusGDBusMethodData *data)
{
    virtDBusGDBusPropertySetFunc setFunc = NULL;
    const gchar *interface;
    const gchar *name;
    g_autoptr(GVariant) value = NULL;
    g_autoptr(GError) error = NULL;

    g_variant_get(parameters, "(&s&sv)", &interface, &name, &value);

    for (gint i = 0; data->properties[i].name; i++) {
        if (g_str_equal(name, data->properties[i].name)) {
            setFunc = data->properties[i].setFunc;
            break;
        }
    }

    if (!setFunc) {
        g_dbus_method_invocation_return_error(invocation,
                                              G_DBUS_ERROR,
                                              G_DBUS_ERROR_UNKNOWN_PROPERTY,
                                              "unknown property '%s'", name);
        return;
    }

    setFunc(value, objectPath, data->userData, &error);

    if (error)
        g_dbus_method_invocation_return_gerror(invocation, error);
    else
        g_dbus_method_invocation_return_value(invocation, NULL);
}

static void
virtDBusGDBusHandlePropertyGetAll(GDBusMethodInvocation *invocation,
                                  const gchar *objectPath,
                                  virtDBusGDBusMethodData *data)
{
    GVariant *value;
    g_auto(GVariantBuilder) builder;
    g_autoptr(GError) error = NULL;

    g_variant_builder_init(&builder, G_VARIANT_TYPE("(a{sv})"));

    g_variant_builder_open(&builder, G_VARIANT_TYPE("a{sv}"));

    for (gint i = 0; data->properties[i].name; i++) {
        data->properties[i].getFunc(objectPath, data->userData,
                                    &value, &error);

        if (error) {
            g_dbus_method_invocation_return_gerror(invocation, error);
            return;
        }

        g_return_if_fail(value);

        g_variant_builder_add(&builder, "{sv}",
                              data->properties[i].name,
                              g_variant_new_variant(value));
    }

    g_variant_builder_close(&builder);

    g_dbus_method_invocation_return_value(invocation,
                                          g_variant_builder_end(&builder));
}

static void
virtDBusGDBusHandleMethod(GVariant *parameters,
                          GDBusMethodInvocation *invocation,
                          const gchar *objectPath,
                          const gchar *methodName,
                          virtDBusGDBusMethodData *data)
{
    virtDBusGDBusMethodFunc methodFunc = NULL;
    GDBusMessage *msg = g_dbus_method_invocation_get_message(invocation);
    GUnixFDList *inFDs = NULL;
    GVariant *outArgs = NULL;
    g_autoptr(GUnixFDList) outFDs = NULL;
    g_autoptr(GError) error = NULL;

    for (gint i = 0; data->methods[i].name; i++) {
        if (g_str_equal(methodName, data->methods[i].name)) {
            methodFunc = data->methods[i].methodFunc;
            break;
        }
    }

    if (!methodFunc) {
        g_dbus_method_invocation_return_error(invocation,
                                              G_DBUS_ERROR,
                                              G_DBUS_ERROR_UNKNOWN_METHOD,
                                              "unknown method '%s'", methodName);
        return;
    }

    inFDs = g_dbus_message_get_unix_fd_list(msg);

    methodFunc(parameters, inFDs, objectPath, data->userData,
               &outArgs, &outFDs, &error);

    if (error) {
        g_dbus_method_invocation_return_gerror(invocation, error);
        return;
    }

    g_return_if_fail(outArgs || !outFDs);

    g_dbus_method_invocation_return_value_with_unix_fd_list(invocation,
                                                            outArgs,
                                                            outFDs);
}

static void
virtDBusGDBusMethodCallThread(gpointer threadData,
                              gpointer userData G_GNUC_UNUSED)
{
    g_autofree virtDBusGDBusThreadData *data = threadData;

    if (g_str_equal(data->interfaceName, "org.freedesktop.DBus.Properties")) {
        if (g_str_equal(data->methodName, "Get")) {
            virtDBusGDBusHandlePropertyGet(data->parameters, data->invocation,
                                           data->objectPath, data->methodData);
        } else if (g_str_equal(data->methodName, "Set")) {
            virtDBusGDBusHandlePropertySet(data->parameters, data->invocation,
                                           data->objectPath, data->methodData);
        } else if (g_str_equal(data->methodName, "GetAll")) {
            virtDBusGDBusHandlePropertyGetAll(data->invocation, data->objectPath,
                                              data->methodData);
        } else {
            g_dbus_method_invocation_return_error(data->invocation,
                                                  G_DBUS_ERROR,
                                                  G_DBUS_ERROR_UNKNOWN_METHOD,
                                                  "unknown method '%s'",
                                                  data->methodName);
        }
    } else {
        virtDBusGDBusHandleMethod(data->parameters, data->invocation,
                                  data->objectPath, data->methodName,
                                  data->methodData);
    }
}

GThreadPool *threadPool;

static void
virtDBusGDBusHandleMethodCall(GDBusConnection *connection G_GNUC_UNUSED,
                              const gchar *sender G_GNUC_UNUSED,
                              const gchar *objectPath,
                              const gchar *interfaceName,
                              const gchar *methodName,
                              GVariant *parameters,
                              GDBusMethodInvocation *invocation,
                              gpointer userData)
{
    virtDBusGDBusThreadData *data = g_new0(virtDBusGDBusThreadData, 1);

    data->objectPath = objectPath;
    data->interfaceName = interfaceName;
    data->methodName = methodName;
    data->parameters = parameters;
    data->invocation = invocation;
    data->methodData = userData;

    g_thread_pool_push(threadPool, data, NULL);
}

static const GDBusInterfaceVTable virtDBusGDBusVtable = {
    virtDBusGDBusHandleMethodCall,
    NULL,
    NULL,
    { 0 }
};

/**
 * virtDBusGDBusRegisterObject:
 * @bus: GDBus connection
 * @objectPath: object path
 * @interface: interface info of the object
 * @methods: table of method handlers
 * @properties: table of property handlers
 * @userData: data that are passed to method and property handlers
 *
 * Registers a new D-Bus object that we would like to handle.
 */
void
virtDBusGDBusRegisterObject(GDBusConnection *bus,
                            gchar const *objectPath,
                            GDBusInterfaceInfo *interface,
                            virtDBusGDBusMethodTable *methods,
                            virtDBusGDBusPropertyTable *properties,
                            gpointer userData)
{
    virtDBusGDBusMethodData *data = g_new0(virtDBusGDBusMethodData, 1);

    data->methods = methods;
    data->properties = properties;
    data->userData = userData;

    g_dbus_connection_register_object(bus,
                                      objectPath,
                                      interface,
                                      &virtDBusGDBusVtable,
                                      data, g_free,
                                      NULL);
}

static gchar **
virtDBusGDBusEnumerate(GDBusConnection *connection G_GNUC_UNUSED,
                       const gchar *sender G_GNUC_UNUSED,
                       const gchar *objectPath G_GNUC_UNUSED,
                       gpointer userData)
{
    virtDBusGDBusSubtreeData *data = userData;

    if (data->enumerate)
        return data->enumerate(data->methodData->userData);

    return NULL;
}

static GDBusInterfaceInfo **
virtDBusGDBusIntrospect(GDBusConnection *bus G_GNUC_UNUSED,
                        const gchar *sender G_GNUC_UNUSED,
                        const gchar *objectPath G_GNUC_UNUSED,
                        const gchar *node G_GNUC_UNUSED,
                        gpointer userData)
{
    virtDBusGDBusSubtreeData *data = userData;
    GDBusInterfaceInfo **ret = g_new0(GDBusInterfaceInfo *, 2);

    ret[0] = g_dbus_interface_info_ref(data->interface);

    return ret;
}

static const GDBusInterfaceVTable *
virtDBusGDBusDispatch(GDBusConnection *bus G_GNUC_UNUSED,
                      const gchar *sender G_GNUC_UNUSED,
                      const gchar *objectPath G_GNUC_UNUSED,
                      const gchar *interfaceName G_GNUC_UNUSED,
                      const gchar *node G_GNUC_UNUSED,
                      gpointer *outUserData,
                      gpointer userData)
{
    virtDBusGDBusSubtreeData *data = userData;

    *outUserData = data->methodData;
    return &virtDBusGDBusVtable;
}

static const GDBusSubtreeVTable virtDBusGDBusSubreeVtable = {
    virtDBusGDBusEnumerate,
    virtDBusGDBusIntrospect,
    virtDBusGDBusDispatch,
    { 0 }
};

static void
virtDBusGDBusSubtreeDataFree(gpointer opaque)
{
    virtDBusGDBusSubtreeData *data = opaque;
    g_free(data->methodData);
    g_free(data);
}

/**
 * virtDBusGDBusRegisterSubtree:
 * @bus: GDBus connection
 * @objectPath: object prefix path
 * @interface: interface info of the object
 * @methods: table of method handlers
 * @properties: table of property handlers
 * @userData: data that are passed to method and property handlers
 *
 * Registers a new D-Bus object prefix that we would like to handle.
 */
void
virtDBusGDBusRegisterSubtree(GDBusConnection *bus,
                             gchar const *objectPath,
                             GDBusInterfaceInfo *interface,
                             virtDBusGDBusEnumerateFunc enumerate,
                             virtDBusGDBusMethodTable *methods,
                             virtDBusGDBusPropertyTable *properties,
                             gpointer userData)
{
    virtDBusGDBusSubtreeData *data = g_new0(virtDBusGDBusSubtreeData, 1);

    data->methodData = g_new0(virtDBusGDBusMethodData, 1);

    data->interface = interface;
    data->enumerate = enumerate;
    data->methodData->methods = methods;
    data->methodData->properties = properties;
    data->methodData->userData = userData;

    g_dbus_connection_register_subtree(bus,
                                       objectPath,
                                       &virtDBusGDBusSubreeVtable,
                                       G_DBUS_SUBTREE_FLAGS_DISPATCH_TO_UNENUMERATED_NODES,
                                       data,
                                       virtDBusGDBusSubtreeDataFree,
                                       NULL);
}

/**
 * virtDBusGDBusPrepareThreadPool:
 * @maxThreads: the number of maximum threads in thread pool
 * @error: return location for error or NULL
 *
 * Initializes thread pool to be used to process D-Bus messages.
 *
 * Returns TRUE on success, FALSE on error and sets @error.
 */
gboolean
virtDBusGDBusPrepareThreadPool(gint maxThreads,
                               GError **error)
{
    threadPool = g_thread_pool_new(virtDBusGDBusMethodCallThread,
                                   NULL,
                                   maxThreads,
                                   FALSE,
                                   error);

    return !!threadPool;
}
