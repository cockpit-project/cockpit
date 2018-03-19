#pragma once

#include <gio/gio.h>

/**
 * virtDBusGDBusMethodFunc:
 * @inArgs: input arguments of the method call
 * @inFDs: list of input file descriptors
 * @objectPath: the object path the method was called on
 * @userData: user data passed when registering new object or subtree
 * @outArgs: return location of output arguments
 * @outFDs: return location of output file descriptors
 * @error: return location for error
 *
 * Handles D-Bus method call.  In case of error the handler has
 * to set an @error.
 */
typedef void
(*virtDBusGDBusMethodFunc)(GVariant *inArgs,
                           GUnixFDList *inFDs,
                           const gchar *objectPath,
                           gpointer userData,
                           GVariant **outArgs,
                           GUnixFDList **outFDs,
                           GError **error);

/**
 * virtDBusGDBusPropertyGetFunc:
 * @objectPath: the object path the method was called on
 * @userData: user data passed when registering new object or subtree
 * @value: return location for property value
 * @error: return location for error
 *
 * Handles D-Bus Get action on a property.  In case of error the handler
 * has to set an @error, otherwise @value has to be set.
 */
typedef void
(*virtDBusGDBusPropertyGetFunc)(const gchar *objectPath,
                                gpointer userData,
                                GVariant **value,
                                GError **error);

/**
 * virtDBusGDBusPropertySetFunc:
 * @objectPath: the object path the method was called on
 * @value: new value that should be set to the property
 * @userData: user data passed when registering new object or subtree
 * @error: return location for error
 *
 * Handles D-Bus Set action on a property.  In case of error the handler
 * has to set an @error.
 */
typedef void
(*virtDBusGDBusPropertySetFunc)(GVariant *value,
                                const gchar *objectPath,
                                gpointer userData,
                                GError **error);

/**
 * virtDBusGDBusEnumerateFunc:
 * @userData: user data passed when registering new subtree
 *
 * Handles D-Bus introspection for subtree of objects.
 *
 * Returns a list of objects or NULL.
 */
typedef gchar **
(*virtDBusGDBusEnumerateFunc)(gpointer userData);

struct _virtDBusGDBusMethodTable {
    const gchar *name;
    virtDBusGDBusMethodFunc methodFunc;
};
typedef struct _virtDBusGDBusMethodTable virtDBusGDBusMethodTable;

struct _virtDBusGDBusPropertyTable {
    const gchar *name;
    virtDBusGDBusPropertyGetFunc getFunc;
    virtDBusGDBusPropertySetFunc setFunc;
};
typedef struct _virtDBusGDBusPropertyTable virtDBusGDBusPropertyTable;

typedef guint virtDBusGDBusSource;
typedef guint virtDBusGDBusOwner;

GDBusInterfaceInfo *
virtDBusGDBusLoadIntrospectData(gchar const *interface,
                                GError **error);

void
virtDBusGDBusRegisterObject(GDBusConnection *bus,
                            gchar const *objectPath,
                            GDBusInterfaceInfo *interface,
                            virtDBusGDBusMethodTable *methods,
                            virtDBusGDBusPropertyTable *properties,
                            gpointer userData);

void
virtDBusGDBusRegisterSubtree(GDBusConnection *bus,
                             gchar const *objectPath,
                             GDBusInterfaceInfo *interface,
                             virtDBusGDBusEnumerateFunc enumerate,
                             virtDBusGDBusMethodTable *methods,
                             virtDBusGDBusPropertyTable *properties,
                             gpointer userData);

G_DEFINE_AUTO_CLEANUP_FREE_FUNC(virtDBusGDBusSource, g_source_remove, 0);
G_DEFINE_AUTO_CLEANUP_FREE_FUNC(virtDBusGDBusOwner, g_bus_unown_name, 0);
