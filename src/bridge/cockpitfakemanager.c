/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitfakemanager.h"

/*
 * MT: This is not thread safe at all. It doesn't need to be for
 * running in cockpit-bridge
 *
 * TODO: One big lack is solving the races between looking up objects and
 * them changing during lookup. Have some ideas for how to solve this involving
 * notion of "generations".
 */

#define COCKPIT_TYPE_OBJECT_PROXY         (cockpit_object_proxy_get_type ())
#define COCKPIT_OBJECT_PROXY(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_OBJECT_PROXY, CockpitObjectProxy))
#define COCKPIT_IS_OBJECT_PROXY(k)        (G_TYPE_CHECK_INSTANCE_TYPE ((k), COCKPIT_TYPE_OBJECT_PROXY))

typedef struct _CockpitObjectProxy        CockpitObjectProxy;

static GType                cockpit_object_proxy_get_type    (void) G_GNUC_CONST;

static CockpitObjectProxy * cockpit_object_proxy_new         (CockpitFakeManager *manager,
                                                              const gchar *object_path);

static gboolean             cockpit_object_proxy_update      (CockpitObjectProxy *self,
                                                              GList *interfaces_to_add,
                                                              GList *interfaces_to_remove);

static GHashTable *         cockpit_object_proxy_interfaces  (CockpitObjectProxy *self);

/* ----------------------------------------------------------------------------
 * CockpitFakeManager
 */

struct _CockpitFakeManager {
  GObject parent;

  /* Construct properties */
  GBusType bus_type;
  GDBusObjectManagerClientFlags flags;
  gchar **initial_paths;
  gchar *bus_name;

  /* State */
  guint bus_name_watch;
  gchar *bus_name_owner;
  gint bus_appears;
  gint bus_disappears;
  GDBusConnection *connection;
  GSimpleAsyncResult *initializing;
  GHashTable *poking;
  GCancellable *cancellable;
  GHashTable *path_to_object;
};

typedef struct {
  GObjectClass parent_class;
} CockpitFakeManagerClass;

enum {
  PROP_BUS_TYPE = 1,
  PROP_FLAGS,
  PROP_NAME,
  PROP_OBJECT_PATHS,
  PROP_NAME_OWNER,
  PROP_CONNECTION,
};

/* Initialized in class_init */
static guint sig_manager__object_added;
static guint sig_manager__object_removed;
static guint sig_manager__interface_added;
static guint sig_manager__interface_removed;
static guint sig_manager__interface_proxy_signal;
static guint sig_manager__interface_proxy_properties_changed;

static void cockpit_async_initable_iface (GAsyncInitableIface *iface);
static void cockpit_dbus_object_manager_iface (GDBusObjectManagerIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitFakeManager, cockpit_fake_manager, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_DBUS_OBJECT_MANAGER, cockpit_dbus_object_manager_iface)
                         G_IMPLEMENT_INTERFACE (G_TYPE_ASYNC_INITABLE, cockpit_async_initable_iface)
);

static GHashTable *
path_to_object_new_table (void)
{
  /* Keys are owned by values */
  return g_hash_table_new_full (g_str_hash,
                                g_str_equal,
                                NULL, g_object_unref);
}

static void
cockpit_fake_manager_init (CockpitFakeManager *self)
{
  self->path_to_object = path_to_object_new_table ();
  self->poking = g_hash_table_new (g_str_hash, g_str_equal);
  self->cancellable = g_cancellable_new ();
}

static void
maybe_complete_async_init (CockpitFakeManager *self)
{
  GSimpleAsyncResult *async;
  GError *error = NULL;

  if (self->initializing)
    {
      if (g_cancellable_set_error_if_cancelled (self->cancellable, &error))
        g_simple_async_result_take_error (self->initializing, error);

      if (g_hash_table_size (self->poking) == 0)
        {
          g_debug ("fakemanager: initialization complete");
          async = self->initializing;
          self->initializing = NULL;
          g_simple_async_result_complete_in_idle (async);
          g_object_unref (async);
        }
    }
}

static void
manager_add_object (CockpitFakeManager *self,
                    CockpitObjectProxy *object)
{
  const gchar *object_path;

  object_path = g_dbus_object_get_object_path (G_DBUS_OBJECT (object));
  g_hash_table_insert (self->path_to_object, (gpointer)object_path,
                       g_object_ref (object));
  g_debug ("fakemanager: object-added: %s", object_path);
  g_signal_emit (self, sig_manager__object_added, 0, object);
}

static void
manager_remove_object (CockpitFakeManager *self,
                       const gchar *object_path,
                       CockpitObjectProxy *object)
{
  /*
   * TODO: If we start allowing concurrent pokes for the same object path
   * then we'll need to double check here that we're removing the right
   * object from the hash table.
   */

  g_object_ref (object);
  g_hash_table_remove (self->path_to_object, object_path);
  g_object_run_dispose (G_OBJECT (object));
  g_debug ("fakemanager: object-removed: %s", object_path);
  g_signal_emit (self, sig_manager__object_removed, 0, object);
  g_object_unref (object);
}

static void
manager_remove_all (CockpitFakeManager *self)
{
  CockpitObjectProxy *object;
  GHashTable *path_to_object;
  GHashTableIter iter;
  const gchar *object_path;

  path_to_object = self->path_to_object;
  self->path_to_object = path_to_object_new_table ();

  g_hash_table_iter_init (&iter, path_to_object);
  while (g_hash_table_iter_next (&iter, (gpointer *)&object_path, (gpointer *)&object))
    {
      g_object_run_dispose (G_OBJECT (object));
      g_debug ("fakemanager: object-removed: %s %p", object_path, object);
      g_signal_emit (self, sig_manager__object_removed, 0, object);
    }

  g_hash_table_destroy (path_to_object);
}

static void
on_bus_name_appeared (GDBusConnection *connection,
                      const gchar *name,
                      const gchar *name_owner,
                      gpointer user_data)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (user_data);
  int i;

  g_debug ("fakemanager: bus name appeared: %s = %s", name, name_owner);

  self->bus_appears++;
  g_clear_object (&self->connection);
  self->connection = g_object_ref (connection);
  self->bus_name_owner = g_strdup (name_owner);
  if (!self->cancellable)
    self->cancellable = g_cancellable_new ();

  if (self->initial_paths)
    {
      for (i = 0; self->initial_paths[i] != NULL; i++)
        cockpit_fake_manager_poke (self, self->initial_paths[i]);
    }
  else
    {
      /* By default start monitoring at the top */
      cockpit_fake_manager_poke (self, "/");
    }

  maybe_complete_async_init (self);

  g_object_notify (G_OBJECT (self), "connection");
  g_object_notify (G_OBJECT (self), "name-owner");
}

static void
on_bus_name_vanished (GDBusConnection *connection,
                      const gchar *name,
                      gpointer user_data)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (user_data);

  g_debug ("fakemanager: bus name vanished: %s", name);

  self->bus_disappears++;
  if (!connection)
    g_clear_object (&self->connection);
  g_free (self->bus_name_owner);
  self->bus_name_owner = NULL;
  maybe_complete_async_init (self);

  if (self->cancellable)
    {
      g_cancellable_cancel (self->cancellable);
      g_object_unref (self->cancellable);
      self->cancellable = NULL;
    }

  manager_remove_all (self);

  g_object_notify (G_OBJECT (self), "connection");
  g_object_notify (G_OBJECT (self), "name-owner");
}

static void
cockpit_fake_manager_constructed (GObject *object)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (object);
  GBusNameWatcherFlags flags;

  G_OBJECT_CLASS (cockpit_fake_manager_parent_class)->constructed (object);

  flags = G_BUS_NAME_WATCHER_FLAGS_NONE;
  if (!(self->flags & G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START))
    flags |= G_BUS_NAME_WATCHER_FLAGS_AUTO_START;

  g_debug ("fakemanager: watching bus name: %s", self->bus_name);
  self->bus_name_watch = g_bus_watch_name (self->bus_type, self->bus_name, flags,
                                           on_bus_name_appeared,
                                           on_bus_name_vanished,
                                           self, NULL);
}

static void
cockpit_fake_manager_get_property (GObject *obj,
                                   guint prop_id,
                                   GValue *value,
                                   GParamSpec *pspec)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (obj);

  switch (prop_id)
  {
    case PROP_FLAGS:
      g_value_set_flags (value, self->flags);
      break;
    case PROP_NAME:
      g_value_set_string (value, self->bus_name);
      break;
    case PROP_CONNECTION:
      g_value_set_object (value, cockpit_fake_manager_get_connection (self));
      break;
    case PROP_NAME_OWNER:
      g_value_set_string (value, self->bus_name_owner);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
  }
}

static void
cockpit_fake_manager_set_property (GObject *obj,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (obj);

  switch (prop_id)
    {
      case PROP_CONNECTION:
        self->connection = g_value_dup_object (value);
        break;
      case PROP_BUS_TYPE:
        self->bus_type = g_value_get_enum (value);
        break;
      case PROP_FLAGS:
        self->flags = g_value_get_flags (value);
        break;
      case PROP_OBJECT_PATHS:
        self->initial_paths = g_value_dup_boxed (value);
        break;
      case PROP_NAME:
        self->bus_name = g_value_dup_string (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_fake_manager_dispose (GObject *object)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (object);
  guint watch;

  if (self->bus_name_watch)
    {
      watch = self->bus_name_watch;
      self->bus_name_watch = 0;
      g_debug ("fakemanager: unwatching bus name: %s", self->bus_name);
      g_bus_unwatch_name (watch);
    }

  if (self->cancellable)
    g_cancellable_cancel (self->cancellable);

  maybe_complete_async_init (self);

  G_OBJECT_CLASS (cockpit_fake_manager_parent_class)->dispose (object);
}

static void
cockpit_fake_manager_finalize (GObject *object)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (object);

  /* Cleared in dispose */
  g_assert (self->bus_name_watch == 0);

  /* Each of these guys hold references to us, so must be empty */
  g_assert (g_hash_table_size (self->poking) == 0);
  g_hash_table_destroy (self->poking);

  /* The last poking guy should have completed async init */
  g_assert (self->initializing == NULL);

  g_free (self->bus_name);
  g_free (self->bus_name_owner);
  g_strfreev (self->initial_paths);
  g_clear_object (&self->connection);

  g_clear_object (&self->cancellable);
  g_hash_table_destroy (self->path_to_object);

  g_debug ("fakemanager: finalized");

  G_OBJECT_CLASS (cockpit_fake_manager_parent_class)->finalize (object);
}

static void
cockpit_fake_manager_class_init (CockpitFakeManagerClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_fake_manager_constructed;
  gobject_class->get_property = cockpit_fake_manager_get_property;
  gobject_class->set_property = cockpit_fake_manager_set_property;
  gobject_class->dispose = cockpit_fake_manager_dispose;
  gobject_class->finalize = cockpit_fake_manager_finalize;

  sig_manager__object_added = g_signal_lookup ("object-added", G_TYPE_DBUS_OBJECT_MANAGER);
  g_assert (sig_manager__object_added);

  sig_manager__object_removed = g_signal_lookup ("object-removed", G_TYPE_DBUS_OBJECT_MANAGER);
  g_assert (sig_manager__object_removed);

  sig_manager__interface_added = g_signal_lookup ("interface-added", G_TYPE_DBUS_OBJECT_MANAGER);
  g_assert (sig_manager__interface_added != 0);

  sig_manager__interface_removed = g_signal_lookup ("interface-removed", G_TYPE_DBUS_OBJECT_MANAGER);
  g_assert (sig_manager__interface_removed != 0);

  /* Same signature as equivalent signal on GDBusObjectManagerClient */
  sig_manager__interface_proxy_signal = g_signal_new ("interface-proxy-signal",
                                                      COCKPIT_TYPE_FAKE_MANAGER,
                                                      G_SIGNAL_RUN_LAST,
                                                      0, NULL, NULL, NULL,
                                                      G_TYPE_NONE, 5,
                                                      G_TYPE_DBUS_OBJECT_PROXY,
                                                      G_TYPE_DBUS_PROXY,
                                                      G_TYPE_STRING,
                                                      G_TYPE_STRING,
                                                      G_TYPE_VARIANT);

  /* Same signature as equivalent signal on GDBusObjectManagerClient */

  sig_manager__interface_proxy_properties_changed = g_signal_new ("interface-proxy-properties-changed",
                                                                  COCKPIT_TYPE_FAKE_MANAGER,
                                                                  G_SIGNAL_RUN_LAST,
                                                                  0, NULL, NULL, NULL,
                                                                  G_TYPE_NONE, 4,
                                                                  G_TYPE_DBUS_OBJECT_PROXY,
                                                                  G_TYPE_DBUS_PROXY,
                                                                  G_TYPE_VARIANT,
                                                                  G_TYPE_STRV);

  g_object_class_install_property (gobject_class, PROP_CONNECTION,
       g_param_spec_object ("connection", "Connection", "Connection", G_TYPE_DBUS_CONNECTION,
                            G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_BUS_TYPE,
       g_param_spec_enum ("bus-type", "Bus Type", "Bus type", G_TYPE_BUS_TYPE, G_BUS_TYPE_NONE,
                          G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_FLAGS,
       g_param_spec_flags ("flags", "Flags", "Flags",
                           G_TYPE_DBUS_OBJECT_MANAGER_CLIENT_FLAGS, G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                           G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_OBJECT_PATHS,
       g_param_spec_boxed ("object-paths", "Object Paths", "Object Paths", G_TYPE_STRV,
                           G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_NAME,
       g_param_spec_string ("name", "Bus name", "Bus name", NULL,
                            G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_NAME_OWNER,
       g_param_spec_string ("name-owner", "Bus Name Owner", "The owner of the name", NULL,
                            G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));
}

typedef struct {
    GCancellable *cancellable;
    gulong sig_cancelled;
} InitAsyncData;

static void
init_async_data_free (gpointer p)
{
  InitAsyncData *data = p;
  if (data->sig_cancelled)
    g_signal_handler_disconnect (data->cancellable, data->sig_cancelled);
  g_object_unref (data->cancellable);
  g_free (data);
}

static gboolean
on_cancelled_no_deadlock (gpointer user_data)
{
  /* Brings any init to an orderly stop */
  g_object_run_dispose (user_data);
  return FALSE;
}

static void
on_init_async_cancelled (GCancellable *cancellable,
                         gpointer user_data)
{
  /*
   * "cancelled" handlers are dangerous places. Doing *anything*
   * that involves any cancellable from here will result in a deadlock
   */

  g_idle_add_full (G_PRIORITY_HIGH, on_cancelled_no_deadlock,
                   g_object_ref (user_data), g_object_unref);
}

static void
cockpit_fake_manager_init_async (GAsyncInitable *initable,
                                 int io_priority,
                                 GCancellable *cancellable,
                                 GAsyncReadyCallback callback,
                                 gpointer user_data)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (initable);
  InitAsyncData *data;

  g_return_if_fail (self->initializing == NULL);

  g_debug ("fakemanager: initializing async");

  self->initializing = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                                  cockpit_fake_manager_init_async);

  if (cancellable)
    {
      data = g_new0 (InitAsyncData, 1);
      data->cancellable = g_object_ref (cancellable);
      g_simple_async_result_set_op_res_gpointer (self->initializing, data, init_async_data_free);
      data->sig_cancelled = g_cancellable_connect (cancellable, G_CALLBACK (on_init_async_cancelled), self, NULL);
    }

  /* The initialization started in constructor, may already be done? */
  if (self->bus_appears > 0 || self->bus_disappears > 0)
    maybe_complete_async_init (self);
}

static gboolean
cockpit_fake_manager_init_finish (GAsyncInitable *initable,
                                  GAsyncResult *result,
                                  GError **error)
{
  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (initable),
                        cockpit_fake_manager_init_async), FALSE);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    return FALSE;

  return TRUE;
}

static void
cockpit_async_initable_iface (GAsyncInitableIface *iface)
{
  iface->init_async = cockpit_fake_manager_init_async;
  iface->init_finish = cockpit_fake_manager_init_finish;
}

static const gchar *
cockpit_fake_manager_get_object_path (GDBusObjectManager *manager)
{
  /* Nobody should be calling this rather useless vfunc ... */
  g_return_val_if_reached ("/");
}

static GList *
cockpit_fake_manager_get_objects (GDBusObjectManager *manager)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (manager);
  GList *objects;

  objects = g_hash_table_get_values (self->path_to_object);
  g_list_foreach (objects, (GFunc)g_object_ref, NULL);
  return objects;
}

static GDBusObject *
cockpit_fake_manager_get_object (GDBusObjectManager *manager,
                                 const gchar *object_path)
{
  CockpitFakeManager *self = COCKPIT_FAKE_MANAGER (manager);
  GDBusObject *object;

  object = g_hash_table_lookup (self->path_to_object, object_path);
  if (object != NULL)
    g_object_ref (object);
  return object;
}

static GDBusInterface *
cockpit_fake_manager_get_interface (GDBusObjectManager *manager,
                                    const gchar *object_path,
                                    const gchar *interface_name)
{
  GDBusInterface *interface;
  GDBusObject *object;

  object = cockpit_fake_manager_get_object (manager, object_path);
  if (object == NULL)
    return NULL;

  interface = g_dbus_object_get_interface (object, interface_name);
  g_object_unref (object);

  return interface;
}

static void
cockpit_dbus_object_manager_iface (GDBusObjectManagerIface *iface)
{
  iface->get_object_path = cockpit_fake_manager_get_object_path;
  iface->get_objects = cockpit_fake_manager_get_objects;
  iface->get_object = cockpit_fake_manager_get_object;
  iface->get_interface = cockpit_fake_manager_get_interface;
}

/**
 * cockpit_fake_manager_new_for_bus:
 * @bus_type: dbus bus to listen on
 * @flags: flags for the object manager
 * @bus_name: name of service to look for objects on
 * @object_paths: the paths to initially poke
 * @cancellable: optional cancellation object
 * @callback: called when operation finishes
 * @user_data: data for callback
 *
 * Create a new CockpitFakeManager.
 *
 * The @object_paths are poked and introspected. These are added
 * as well as anything else discovered along the way, before the
 * async operation completes.
 *
 * If @object_paths is NULL it will default to the root '/' DBus
 * path. If @object_paths is an empty array, then nothing is
 * poked during initialization.
 */
void
cockpit_fake_manager_new_for_bus (GBusType bus_type,
                                  GDBusObjectManagerClientFlags flags,
                                  const gchar *bus_name,
                                  const gchar **object_paths,
                                  GCancellable *cancellable,
                                  GAsyncReadyCallback callback,
                                  gpointer user_data)
{
  g_return_if_fail (g_dbus_is_name (bus_name));

  g_async_initable_new_async (COCKPIT_TYPE_FAKE_MANAGER,
                              G_PRIORITY_DEFAULT,
                              cancellable,
                              callback,
                              user_data,
                              "bus-type", bus_type,
                              "flags", flags,
                              "name", bus_name,
                              "object-paths", object_paths,
                              NULL);
}

/**
 * cockpit_fake_manager_new_finish:
 * @result: an async result
 * @error: location to place an error or NULL
 *
 * Complete an async init of fake manager started with
 * cockpit_fake_manager_new_for_bus().
 *
 * Returns: (transfer full): the new manager or NULL
 */
GDBusObjectManager *
cockpit_fake_manager_new_finish (GAsyncResult *result,
                                 GError **error)
{
  GObject *source_object;
  GObject *object;

  source_object = g_async_result_get_source_object (result);
  object = g_async_initable_new_finish (G_ASYNC_INITABLE (source_object), result, error);
  g_object_unref (source_object);
  return object ? G_DBUS_OBJECT_MANAGER (object) : NULL;
}

typedef struct {
  CockpitFakeManager *manager;
  CockpitObjectProxy *object;
  gchar *object_path;
  GList *added;
  GList *removed;
  gint outstanding;
} PokeContext;

static PokeContext *
poke_context_start (CockpitFakeManager *self,
                    const gchar *object_path)
{
  PokeContext *poke;

  if (g_hash_table_lookup (self->poking, object_path))
    return NULL;

  g_debug ("fakemanager: poking: %s", object_path);

  poke = g_new0 (PokeContext, 1);
  poke->manager = g_object_ref (self);
  poke->object_path = g_strdup (object_path);
  poke->object = g_hash_table_lookup (self->path_to_object, object_path);
  if (poke->object)
    g_object_ref (poke->object);
  g_hash_table_insert (self->poking, poke->object_path, poke);

  return poke;
}

static void
poke_context_finish (CockpitFakeManager *self,
                     PokeContext *poke)
{
  g_debug ("fakemanager: poked: %s", poke->object_path);

  g_hash_table_remove (self->poking, poke->object_path);
  maybe_complete_async_init (self);

  g_object_unref (poke->manager);
  g_clear_object (&poke->object);
  g_free (poke->object_path);
  g_list_free_full (poke->added, g_object_unref);
  g_list_free_full (poke->removed, g_object_unref);
  g_free (poke);
}

static void
poke_remove_object_and_finish (CockpitFakeManager *self,
                               PokeContext *poke)
{
  if (poke->object)
    manager_remove_object (self, poke->object_path, poke->object);
  poke_context_finish (self, poke);
}

static void
poke_apply_changes_and_finish (CockpitFakeManager *self,
                               PokeContext *poke)
{
  gboolean valid = FALSE;

  if (poke->added || poke->removed)
    {
      if (poke->object == NULL)
        {
          poke->object = cockpit_object_proxy_new (self, poke->object_path);
          manager_add_object (self, poke->object);
        }

      valid = cockpit_object_proxy_update (poke->object, poke->added, poke->removed);

      if (!valid)
        manager_remove_object (self, poke->object_path, poke->object);
    }

  poke_context_finish (self, poke);
}

static void
process_introspect_node (CockpitFakeManager *self,
                         PokeContext *poke,
                         GDBusNodeInfo *node);

static void
process_introspect_children (CockpitFakeManager *self,
                             const gchar *object_path,
                             GDBusNodeInfo *node)
{
  GDBusNodeInfo *child;
  gchar *child_path;
  PokeContext *poke;
  int i;

  /* Poke any additional child nodes discovered */
  for (i = 0; node->nodes && node->nodes[i]; i++)
    {
      child = node->nodes[i];

      /* If the child has no path then it's useless */
      if (!child->path)
        continue;

      /* Figure out an object path for this node */
      if (g_str_has_prefix (child->path, "/"))
        child_path = g_strdup (child->path);
      else if (g_str_equal (object_path, "/"))
        child_path = g_strdup_printf ("/%s", child->path);
      else
        child_path = g_strdup_printf ("%s/%s", object_path, child->path);

      /* If the child has no interfaces, then poke it all over again */
      if (!child->interfaces || !child->interfaces[0])
        {
          cockpit_fake_manager_poke (self, child_path);
          g_free (child_path);
        }
      else
        {
          poke = poke_context_start (self, child_path);
          if (poke != NULL)
            process_introspect_node (self, poke, child);
          g_free (child_path);
        }
    }
}

static void
on_poke_proxy (GObject *source_object,
               GAsyncResult *result,
               gpointer user_data)
{
  PokeContext *poke = user_data;
  CockpitFakeManager *self = poke->manager;
  GError *error = NULL;
  GDBusProxy *proxy;

  g_assert (poke->outstanding > 0);
  poke->outstanding--;

  proxy = g_dbus_proxy_new_finish (result, &error);

  /* Bail fast if cancelled */
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
    {
      if (poke->outstanding == 0)
        poke_context_finish (self, poke);
      return;
    }

  if (error)
    {
      g_warning ("Couldn't create proxy: %s", error->message);
      g_error_free (error);
    }
  else
    {
      g_debug ("fakemanager: proxy created: %s %s", poke->object_path,
               g_dbus_proxy_get_interface_name (proxy));
      poke->added = g_list_prepend (poke->added, proxy);
    }

  if (poke->outstanding == 0)
    poke_apply_changes_and_finish (self, poke);
}

static void
process_introspect_node (CockpitFakeManager *self,
                         PokeContext *poke,
                         GDBusNodeInfo *node)
{
  GHashTable *present = NULL;
  GDBusInterfaceInfo *iface;
  GDBusProxyFlags flags;
  GHashTableIter iter;
  GDBusProxy *proxy;
  gint i;

  if (poke->object)
    present = cockpit_object_proxy_interfaces (poke->object);

  for (i = 0; node->interfaces && node->interfaces[i] != NULL; i++)
    {
      iface = node->interfaces[i];
      if (!iface->name)
        {
          g_warning ("Received interface from %s at %s without name",
                     self->bus_name, poke->object_path);
          continue;
        }

      /* No proxeis for these interfaces */
      if (g_str_equal (iface->name, "org.freedesktop.DBus.Properties") ||
          g_str_equal (iface->name, "org.freedesktop.DBus.Peer") ||
          g_str_equal (iface->name, "org.freedesktop.DBus.Introspectable"))
        continue;

      /* Already have this */
      if (present && g_hash_table_remove (present, iface->name))
        continue;

      flags = G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES |
              G_DBUS_PROXY_FLAGS_DO_NOT_AUTO_START;
      g_dbus_proxy_new (self->connection, flags, iface,
                        self->bus_name_owner, poke->object_path,
                        iface->name, self->cancellable, on_poke_proxy, poke);
      poke->outstanding++;
    }

  /* Remove any interfaces no longer in introspection data */
  if (present)
    {
      g_hash_table_iter_init (&iter, present);
      while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&proxy))
        poke->removed = g_list_prepend (poke->removed, g_object_ref (proxy));
      g_hash_table_destroy (present);
    }

  process_introspect_children (self, poke->object_path, node);

  if (poke->outstanding == 0)
    poke_apply_changes_and_finish (self, poke);
}

static void
on_poke_introspected (GObject *source_object,
                      GAsyncResult *result,
                      gpointer user_data)
{
  PokeContext *poke = user_data;
  CockpitFakeManager *self = poke->manager;
  GError *error = NULL;
  GDBusNodeInfo *node;
  gboolean expected;
  const gchar *xml;
  GVariant *retval;
  gchar *remote;

  retval = g_dbus_connection_call_finish (self->connection, result, &error);

  /* Bail fast if cancelled */
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
    {
      poke_context_finish (self, poke);
      g_error_free (error);
      return;
    }

  if (retval)
    {
      g_variant_get (retval, "(&s)", &xml);
      node = g_dbus_node_info_new_for_xml (xml, &error);
      process_introspect_node (self, poke, node);
      g_dbus_node_info_unref (node);
      g_variant_unref (retval);
    }

  if (error)
    {
      /*
       * Note that many DBus implementations don't return errors when
       * an unknown object path is introspected. They just return empty
       * introspect data. GDBus is one of these.
       */

      expected = FALSE;
      remote = g_dbus_error_get_remote_error (error);
      if (remote)
        {
          /*
           * DBus used to only have the UnknownMethod error. It didn't have
           * specific errors for UnknownObject and UnknownInterface. So we're
           * pretty liberal on what we treat as an expected error here.
           *
           * HACK: GDBus also doesn't understand the newer error codes :S
           *
           * https://bugzilla.gnome.org/show_bug.cgi?id=727900
           */
          expected = (g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownMethod") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownObject") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownInterface"));
          g_free (remote);
        }

      if (!expected)
        {
          g_warning ("Couldn't look up introspection data on %s at %s: %s",
                     self->bus_name, poke->object_path, error->message);
        }
      g_error_free (error);
      poke_remove_object_and_finish (self, poke);
      return;
    }
}

/**
 * cockpit_fake_manager_poke:
 * @self: a fake manager
 * @object_path: a object path to poke
 *
 * Introspect the object path and try to find out if there are
 * interfaces we don't know about at that object path.
 *
 * If it exists, add any new interfaces to this object manager.
 * Otherwise, remove the object from the object manager.
 */
void
cockpit_fake_manager_poke (CockpitFakeManager *self,
                           const gchar *object_path)
{
  PokeContext *poke;

  g_return_if_fail (COCKPIT_IS_FAKE_MANAGER (self));
  g_return_if_fail (g_variant_is_object_path (object_path));

  if (g_hash_table_lookup (self->poking, object_path))
    return;

  poke = poke_context_start (self, object_path);
  g_dbus_connection_call (self->connection, self->bus_name, object_path,
                          "org.freedesktop.DBus.Introspectable", "Introspect",
                          NULL, G_VARIANT_TYPE ("(s)"),
                          G_DBUS_CALL_FLAGS_NO_AUTO_START, -1, /* timeout */
                          self->cancellable, on_poke_introspected, poke);
}

/**
 * cockpit_fake_manager_scrape:
 * @self: a fake manager
 * @variant: a variant to scrape
 *
 * Get all object paths out of the variant in question
 * (which is usually the parameters to a signal) and
 * try and poke those object paths.
 */
void
cockpit_fake_manager_scrape (CockpitFakeManager *self,
                             GVariant *variant)
{
  GVariantIter iter;
  GVariant *child;
  const gchar *path;

  if (g_variant_is_of_type (variant, G_VARIANT_TYPE_OBJECT_PATH))
    {
      path = g_variant_get_string (variant, NULL);
      if (!g_str_equal (path, "/"))
        cockpit_fake_manager_poke (self, path);
    }
  else if (g_variant_is_container (variant))
    {
      g_variant_iter_init (&iter, variant);
      while ((child = g_variant_iter_next_value (&iter)) != NULL)
        {
          cockpit_fake_manager_scrape (self, child);
          g_variant_unref (child);
        }
    }
}

/**
 * cockpit_fake_manager_get_connection:
 * @self: a fake manager
 *
 * Get the connection associated with this manager. Will
 * become valid after init completes. Never changes after
 * that point.
 *
 * Returns: (transfer none): the connection
 */
GDBusConnection *
cockpit_fake_manager_get_connection (CockpitFakeManager *self)
{
  g_return_val_if_fail (COCKPIT_IS_FAKE_MANAGER (self), NULL);
  return self->connection;
}

/* ----------------------------------------------------------------------------
 * CockpitObjectProxy
 */

struct _CockpitObjectProxy {
  GDBusObjectProxy parent;
  CockpitFakeManager *manager;
  GHashTable *interfaces;
};

typedef struct {
  GDBusObjectProxyClass parent_class;
} CockpitObjectProxyClass;

enum {
  PROP_MANAGER = 1
};

/* Initialized in class_init below */
static gint sig_object__interface_added;
static gint sig_object__interface_removed;

static void cockpit_dbus_object_iface (GDBusObjectIface *iface);

/* Note that we're overriding the GDBusObjectProxy implementation of GDBusObject */
G_DEFINE_TYPE_WITH_CODE (CockpitObjectProxy, cockpit_object_proxy, G_TYPE_DBUS_OBJECT_PROXY,
                         G_IMPLEMENT_INTERFACE (G_TYPE_DBUS_OBJECT, cockpit_dbus_object_iface)
);

static void
cockpit_object_proxy_init (CockpitObjectProxy *self)
{
  /* The keys are owned by values, so no need to dup/free them */
  self->interfaces = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, g_object_unref);
}

static void
cockpit_object_proxy_set_property (GObject *obj,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (obj);

  switch (prop_id)
    {
      case PROP_MANAGER:
        /* No reference held, cleared in dispose */
        self->manager = g_value_get_object (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_object_proxy_dispose (GObject *object)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (object);

  self->manager = NULL;

  G_OBJECT_CLASS (cockpit_object_proxy_parent_class)->dispose (object);
}

static void
cockpit_object_proxy_finalize (GObject *object)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (object);

  g_assert (self->manager == NULL);
  g_hash_table_destroy (self->interfaces);

  G_OBJECT_CLASS (cockpit_object_proxy_parent_class)->finalize (object);
}

static void
cockpit_object_proxy_class_init (CockpitObjectProxyClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->set_property = cockpit_object_proxy_set_property;
  gobject_class->dispose = cockpit_object_proxy_dispose;
  gobject_class->finalize = cockpit_object_proxy_finalize;

  sig_object__interface_added = g_signal_lookup ("interface-added", G_TYPE_DBUS_OBJECT);
  g_assert (sig_object__interface_added != 0);

  sig_object__interface_removed = g_signal_lookup ("interface-removed", G_TYPE_DBUS_OBJECT);
  g_assert (sig_object__interface_removed != 0);

  g_object_class_install_property (gobject_class, PROP_MANAGER,
      g_param_spec_object  ("manager", "manager", "manager", COCKPIT_TYPE_FAKE_MANAGER,
                            G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

static GList *
cockpit_object_proxy_get_interfaces (GDBusObject *object)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (object);
  GList *interfaces;

  interfaces = g_hash_table_get_values (self->interfaces);
  g_list_foreach (interfaces, (GFunc)g_object_ref, NULL);
  return interfaces;
}

static GDBusInterface *
cockpit_object_proxy_get_interface (GDBusObject *object,
                                    const gchar *interface_name)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (object);
  GDBusInterface *interface;

  interface = g_hash_table_lookup (self->interfaces, interface_name);
  if (interface)
    g_object_ref (interface);
  return interface;
}

static void
cockpit_dbus_object_iface (GDBusObjectIface *iface)
{
  /* iface->get_object_path already set to parent impl */
  iface->get_interfaces = cockpit_object_proxy_get_interfaces;
  iface->get_interface = cockpit_object_proxy_get_interface;
}

static CockpitObjectProxy *
cockpit_object_proxy_new (CockpitFakeManager *manager,
                          const gchar *object_path)
{
  return g_object_new (COCKPIT_TYPE_OBJECT_PROXY,
                       "manager", manager,
                       "g-connection", manager->connection,
                       "g-object-path", object_path,
                       NULL);
}

static void
on_properties_changed (GDBusProxy *proxy,
                       GVariant *changed_properties,
                       GStrv invalidated_properties,
                       gpointer user_data)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (user_data);

  g_debug ("fakemanager: interface-proxy-properties-changed: %s %s",
           g_dbus_proxy_get_object_path (proxy),
           g_dbus_proxy_get_interface_name (proxy));

  if (self->manager)
    {
      g_object_ref (self->manager);
      if (changed_properties)
        cockpit_fake_manager_scrape (self->manager, changed_properties);
      g_signal_emit (self->manager, sig_manager__interface_proxy_properties_changed, 0,
                     self, proxy, changed_properties, invalidated_properties);
      g_object_unref (self->manager);
    }
}

static void
on_proxy_signal (GDBusProxy *proxy,
                 gchar *sender_name,
                 gchar *signal_name,
                 GVariant *parameters,
                 gpointer user_data)
{
  CockpitObjectProxy *self = COCKPIT_OBJECT_PROXY (user_data);

  g_debug ("fakemanager: interface-proxy-signal: %s %s %s",
           g_dbus_proxy_get_object_path (proxy),
           g_dbus_proxy_get_interface_name (proxy), signal_name);

  if (self->manager)
    {
      g_object_ref (self->manager);
      if (parameters)
        cockpit_fake_manager_scrape (self->manager, parameters);
      g_signal_emit (self->manager, sig_manager__interface_proxy_signal, 0,
                     self, proxy, sender_name, signal_name, parameters);
      g_object_unref (self->manager);
    }
}

static gboolean
cockpit_object_proxy_update (CockpitObjectProxy *self,
                             GList *interfaces_to_add,
                             GList *interfaces_to_remove)
{
  const gchar *iface_name;
  GList *removed = NULL;
  GList *added = NULL;
  GList *l;

  g_return_val_if_fail (COCKPIT_IS_OBJECT_PROXY (self), FALSE);

  /*
   * First we update the object, then we emit the signals. In the
   * the future we'll need to eliminate races with use of generations.
   */

  for (l = interfaces_to_add; l != NULL; l = g_list_next (l))
    {
      iface_name = g_dbus_proxy_get_interface_name (l->data);
      if (!g_hash_table_lookup (self->interfaces, iface_name))
        {
          g_debug ("fakemanager: interface-added: %s: %s",
                   g_dbus_proxy_get_object_path (l->data), iface_name);
          g_hash_table_insert (self->interfaces, (gpointer)iface_name,
                               g_object_ref (l->data));
          added = g_list_prepend (added, l->data);
          g_signal_connect (l->data, "g-signal", G_CALLBACK (on_proxy_signal), self);
          g_signal_connect (l->data, "g-properties-changed", G_CALLBACK (on_properties_changed), self);
        }
    }

  for (l = interfaces_to_remove; l != NULL; l = g_list_next (l))
    {
      iface_name = g_dbus_proxy_get_interface_name (l->data);

      /*
       * TODO: If we start allowing concurrent pokes for the same object path
       * then we'll need to double check here that we're removing the right
       * interface from the hash table.
       */

      /* Caller holds a reference so this is safe */
      if (g_hash_table_remove (self->interfaces, iface_name))
        {
          g_debug ("fakemanager: interface-removed: %s: %s",
                   g_dbus_proxy_get_object_path (l->data), iface_name);
          removed = g_list_prepend (removed, l->data);
          g_signal_handlers_disconnect_by_func (l->data, on_proxy_signal, self);
          g_signal_handlers_disconnect_by_func (l->data, on_properties_changed, self);
        }
    }

  for (l = added; l != NULL; l = g_list_next (l))
    {
      g_signal_emit (self, sig_object__interface_added, 0, l->data);
      if (self->manager)
        g_signal_emit (self->manager, sig_manager__interface_added, 0, self, l->data);
    }
  g_list_free (added);

  for (l = removed; l != NULL; l = g_list_next (l))
    {
      g_signal_emit (self, sig_object__interface_removed, 0, l->data);
      if (self->manager)
        g_signal_emit (self->manager, sig_manager__interface_removed, 0, self, l->data);
    }
  g_list_free (removed);

  return g_hash_table_size (self->interfaces) > 0;
}

static GHashTable *
cockpit_object_proxy_interfaces (CockpitObjectProxy *self)
{
  GHashTableIter iter;
  GHashTable *copy;
  gpointer value;
  gpointer key;

  copy = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, g_object_unref);
  g_hash_table_iter_init (&iter, self->interfaces);
  while (g_hash_table_iter_next (&iter, &key, &value))
    g_hash_table_insert (copy, key, g_object_ref (value));

  return copy;
}
