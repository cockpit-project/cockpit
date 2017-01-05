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

#include "cockpitdbuscache.h"

#include "cockpitdbusrules.h"
#include "cockpitpaths.h"

#include <string.h>

#define DEBUG_BATCHES 0

/*
 * This is a cache of properties which tracks updates. The best way to do
 * this is via ObjectManager. But it also does introspection and uses that
 * to get both interface info, and information about which paths are present
 * and the interfaces they implement.
 *
 * One big complication is that all of this needs to have ordering guarantees,
 * including introspection. We keep track of which batch of properties we're
 * working on, and associate barrier callbacks which can only happen once
 * a given batch of properties has completed processing.
 *
 * Also information about an interface will be available before we notify
 * about properties on an interface. This is a further ordering guarantee.
 *
 * Since there are lots of strings, to help with allocation churn, we have our
 * own string intern table, where path, interface and property names are
 * stored while the cache is active. Each time we get a path etc. from an
 * external source source (such as GVariant) and we know we'll need it later
 * then we intern it, so it sticks around.
 */

struct _CockpitDBusCache {
  GObject parent;

  /* Cancelled on dispose */
  GCancellable *cancellable;

  /* The connection to talk on */
  GDBusConnection *connection;

  /* The readable DBus name, and actual unique owner */
  gchar *logname;
  gchar *name;

  /* Introspection stuff */
  GHashTable *introspected;
  GQueue *introspects;
  GHashTable *introsent;
  GList *trash;

  /* The main data cache: paths > interfaces -> properties -> values */
  GHashTable *cache;

  /* The paths and interfaces we should watch */
  CockpitDBusRules *rules;

  /* Accumulated information about these various paths */
  GTree *managed;

  /* Signal Subscriptions */
  gboolean subscribed;
  guint subscribe_properties;
  guint subscribe_manager;

  /* Barrier related stuff */
  GQueue *batches;
  GQueue *barriers;
  guint number;
  GHashTable *update;

  /* Interned strings */
  GHashTable *interned;
};

enum {
  PROP_CONNECTION = 1,
  PROP_NAME,
  PROP_LOGNAME,
  PROP_INTERFACE_INFO
};

static guint signal_meta;
static guint signal_update;

G_DEFINE_TYPE (CockpitDBusCache, cockpit_dbus_cache, G_TYPE_OBJECT);

static void
hash_table_unref_or_null (gpointer data)
{
  if (data)
    g_hash_table_unref (data);
}

static const gchar *
intern_string (CockpitDBusCache *self,
               const gchar *string)
{
  const gchar * interned;
  gchar *copy;

  interned = g_hash_table_lookup (self->interned, string);
  if (!interned)
    {
      copy = g_strdup (string);
      g_hash_table_add (self->interned, copy);
      interned = copy;
    }

  return interned;
}

typedef struct {
  guint number;
  CockpitDBusBarrierFunc callback;
  gpointer user_data;
} BarrierData;

typedef struct {
  gint refs;
  guint number;
  gboolean orphan;
#if DEBUG_BATCHES
  GSList *debug;
#endif
} BatchData;

static void
barrier_progress (CockpitDBusCache *self)
{
  BarrierData *barrier;
  BatchData *batch;

  batch = g_queue_peek_head (self->batches);

  for (;;)
    {
      barrier = g_queue_peek_head (self->barriers);
      if (!barrier)
        return;

      /*
       * If there is a batch being processed, we must block
       * barriers that have an equal or later batch number.
       */
      if (batch && batch->number <= barrier->number)
        return;

      g_queue_pop_head (self->barriers);
      (barrier->callback) (self, barrier->user_data);
      g_slice_free (BarrierData, barrier);
    }
}

static void
barrier_flush (CockpitDBusCache *self)
{
  BarrierData *barrier;

  for (;;)
    {
      barrier = g_queue_pop_head (self->barriers);
      if (!barrier)
        return;
      (barrier->callback) (self, barrier->user_data);
      g_slice_free (BarrierData, barrier);
    }
}

#if DEBUG_BATCHES
static void
batch_dump (BatchData *batch)
{
  GSList *l;
  g_printerr ("BATCH %u (refs %d)\n", batch->number, batch->refs);
  batch->debug = g_slist_reverse (batch->debug);
  for (l = batch->debug; l != NULL; l = g_slist_next (l))
    g_printerr (" * %s\n", (gchar *)l->data);
  batch->debug = g_slist_reverse (batch->debug);
}
#endif /* DEBUG_BATCHES */

static void
batch_free (BatchData *batch)
{
#if DEBUG_BATCHES
  g_slist_foreach (batch->debug, (GFunc)g_free, NULL);
#endif
  g_slice_free (BatchData, batch);
}

static void
batch_progress (CockpitDBusCache *self)
{
  BatchData *batch;
  GHashTable *update;

  for (;;)
    {
      batch = g_queue_peek_head (self->batches);

      /*
       * Once a batch has completed it's refs field will be zero.
       * This means we can send notify of any property changes,
       * process any barriers waiting on this batch, and move on
       * to the next batch.
       */
      if (!batch || batch->refs > 0)
        return;

      g_queue_pop_head (self->batches);
      update = self->update;
      self->update = NULL;

      if (update)
        {
          g_signal_emit (self, signal_update, 0, update);
          g_hash_table_unref (update);
        }

      batch_free (batch);
      barrier_progress (self);
    }
}

static void
batch_flush (CockpitDBusCache *self)
{
  BatchData *batch;

  for (;;)
    {
      batch = g_queue_pop_head (self->batches);
      if (!batch)
        return;
      if (batch->refs == 0)
        batch_free (batch);
      else
        batch->orphan = TRUE;
    }
}

static BatchData *
batch_create (CockpitDBusCache *self)
{
  BatchData *batch = g_slice_new0 (BatchData);
  batch->refs = 1;
  self->number++;
  batch->number = self->number;
  g_queue_push_tail (self->batches, batch);
  return batch;
}

static BatchData *
_batch_ref (BatchData *batch,
            const gchar *function,
            gint line)
{
  g_assert (batch != NULL);
  batch->refs++;
#if DEBUG_BATCHES
  batch->debug = g_slist_prepend (batch->debug, g_strdup_printf (" * ref -> %d %s:%d",
                                                                 batch->refs, function, line));
#endif
  return batch;
}

#define batch_ref(batch) \
  (_batch_ref((batch), G_STRFUNC, __LINE__))

static void
_batch_unref (CockpitDBusCache *self,
              BatchData *batch,
              const gchar *function,
              gint line)
{
  g_assert (batch != NULL);
#if DEBUG_BATCHES
  if (!(batch->refs > 0))
      batch_dump (batch);
#endif
  g_assert (batch->refs > 0);
  batch->refs--;
#if DEBUG_BATCHES
  batch->debug = g_slist_prepend (batch->debug, g_strdup_printf (" * unref -> %d %s:%d",
                                                                 batch->refs, function, line));
#endif

  if (batch->refs == 0 && batch->orphan)
    batch_free (batch);
  else
    batch_progress (self);
}

#define batch_unref(self, batch) \
  (_batch_unref((self), (batch), G_STRFUNC, __LINE__))

static void
cockpit_dbus_cache_init (CockpitDBusCache *self)
{
  self->number = 1;

  self->cancellable = g_cancellable_new ();

  self->managed = cockpit_paths_new ();

  /* Becomes a whole tree of hash tables */
  self->cache = g_hash_table_new_full (g_str_hash, g_str_equal, NULL,
                                       (GDestroyNotify)g_hash_table_unref);

  /* All of these are sets. ie: key and value identical */
  self->rules = cockpit_dbus_rules_new ();

  self->introspects = g_queue_new ();
  self->introsent = g_hash_table_new (g_str_hash, g_str_equal);

  self->batches = g_queue_new ();
  self->barriers = g_queue_new ();

  /* Put allocations we need to keep around, but can't handily track */
  self->trash = NULL;
  self->interned = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
}

typedef struct {
  const gchar *interface;
  const gchar *path;
  CockpitDBusIntrospectFunc callback;
  gpointer user_data;
  BatchData *batch;
  gboolean introspecting;
} IntrospectData;

static void
introspect_next (CockpitDBusCache *self);

static void
scrape_variant (CockpitDBusCache *self,
                BatchData *batch,
                GVariant *data);

static void
introspect_complete (CockpitDBusCache *self,
                     IntrospectData *id)
{
  GDBusInterfaceInfo *iface = NULL;

  if (id->interface)
    {
      iface = cockpit_dbus_interface_info_lookup (self->introspected, id->interface);
      if (!iface)
        {
          g_debug ("%s: introspect interface %s didn't work", self->logname, id->interface);

          /*
           * So we were expecting an interface that wasn't found at the expected
           * object. This means that something is wrong with the introspection
           * on the DBus service. We create a pretend empty interface, so that
           * the ordering guarantees are met.
           */

          iface = g_new0 (GDBusInterfaceInfo, 1);
          iface->ref_count = 1;
          iface->name = g_strdup (id->interface);

          cockpit_dbus_interface_info_push (self->introspected, iface);
          g_dbus_interface_info_unref (iface);
        }
    }

  if (id->callback)
    (id->callback) (self, iface, id->user_data);

  /* Mark as having called, as a double check */
  id->callback = NULL;

  batch_unref (self, id->batch);
  g_assert (id->callback == NULL);
  g_slice_free (IntrospectData, id);
}

static void
process_introspect_node (CockpitDBusCache *self,
                         BatchData *batch,
                         const gchar *path,
                         GDBusNodeInfo *node,
                         gboolean recursive);

static gboolean
dbus_error_matches_unknown (GError *error)
{
  gboolean ret = FALSE;

  if (g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_METHOD) ||
      g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_ACCESS_DENIED) ||
      g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CLOSED))
    return TRUE;

#if GLIB_CHECK_VERSION(2,42,0)
  ret = g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_INTERFACE) ||
        g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_OBJECT) ||
        g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_PROPERTY);
#else

  gchar *remote = g_dbus_error_get_remote_error (error);
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
      ret = (g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownMethod") ||
             g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownObject") ||
             g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownInterface") ||
             g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownProperty"));
      g_free (remote);
    }
#endif

  return ret;
}

static void
on_introspect_reply (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  CockpitDBusCache *self = user_data;
  IntrospectData *id;
  GDBusNodeInfo *node;
  GError *error = NULL;
  GVariant *retval;
  const gchar *xml;

  /* All done with this introspect */
  id = g_queue_pop_head (self->introspects);

  /* Introspects have been flushed */
  if (!id)
    {
      g_object_unref (self);
      return;
    }

  g_assert (id->introspecting);

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);

  if (retval)
    {
      g_debug ("%s: reply from Introspect() at %s", self->logname, id->path);

      g_variant_get (retval, "(&s)", &xml);

      node = g_dbus_node_info_new_for_xml (xml, &error);
      if (node)
        {
          process_introspect_node (self, id->batch, id->path, node, id->interface == NULL);
          g_dbus_node_info_unref (node);
        }
      g_variant_unref (retval);
    }

  if (error)
    {
      if (!dbus_error_matches_unknown (error))
        g_message ("%s: couldn't introspect %s: %s", self->logname, id->path, error->message);
      g_error_free (error);
    }

  introspect_complete (self, id);
  introspect_next (self);

  g_object_unref (self);
}

static void
introspect_next (CockpitDBusCache *self)
{
  IntrospectData *id;

  id = g_queue_peek_head (self->introspects);
  if (id && !id->introspecting)
    {
      if (g_cancellable_is_cancelled (self->cancellable))
        {
          g_queue_pop_head (self->introspects);
          introspect_complete (self, id);
        }
      else
        {
          g_debug ("%s: calling Introspect() on %s", self->logname, id->path);

          id->introspecting = TRUE;
          g_dbus_connection_call (self->connection, self->name, id->path,
                                  "org.freedesktop.DBus.Introspectable", "Introspect",
                                  g_variant_new ("()"), G_VARIANT_TYPE ("(s)"),
                                  G_DBUS_CALL_FLAGS_NONE, -1,
                                  self->cancellable, on_introspect_reply,
                                  g_object_ref (self));
        }
    }
}

static void
introspect_flush (CockpitDBusCache *self)
{
  gboolean note = FALSE;
  IntrospectData *id;
  GQueue *queue;

  queue = g_queue_new ();
  for (;;)
    {
      /* Steal everything, more could be added by callback */
      for (;;)
        {
          id = g_queue_pop_tail (self->introspects);
          if (!id)
            break;
          g_queue_push_head (queue, id);
        }

      id = g_queue_pop_head (queue);
      if (!id)
        {
          g_queue_free (queue);
          return;
        }

      if (!note)
        g_debug ("%s: flushing introspect queue", self->logname);
      note = TRUE;
      introspect_complete (self, id);
    }
}

static void
introspect_queue (CockpitDBusCache *self,
                  BatchData *batch,
                  const gchar *path,
                  const gchar *interface,
                  CockpitDBusIntrospectFunc callback,
                  gpointer user_data)
{
  IntrospectData *id;

  g_assert (path != NULL);
  g_assert (batch != NULL);

  id = g_slice_new0 (IntrospectData);
  id->interface = interface;
  id->batch = batch_ref (batch);
  id->path = path;
  id->callback = callback;
  id->user_data = user_data;

  g_debug ("%s: queueing introspect %s %s%s", self->logname, path,
           interface ? "for " : "", interface ? interface : "");
  g_queue_push_tail (self->introspects, id);

  introspect_next (self);
}

static void
introspect_maybe (CockpitDBusCache *self,
                  BatchData *batch,
                  const gchar *path,
                  const gchar *interface,
                  CockpitDBusIntrospectFunc callback,
                  gpointer user_data)
{
  GDBusInterfaceInfo *iface;

  g_assert (path);
  g_assert (interface);

  iface = cockpit_dbus_interface_info_lookup (self->introspected, interface);
  if (iface)
    {
      (callback) (self, iface, user_data);
    }
  else
    {
      if (batch == NULL)
        batch = batch_create (self);
      else
        batch = batch_ref (batch);

      introspect_queue (self, batch,
                        intern_string (self, path),
                        intern_string (self, interface),
                        callback, user_data);

      batch_unref (self, batch);
    }
}

void
cockpit_dbus_cache_introspect (CockpitDBusCache *self,
                               const gchar *path,
                               const gchar *interface,
                               CockpitDBusIntrospectFunc callback,
                               gpointer user_data)
{
  g_return_if_fail (self != NULL);
  g_return_if_fail (path != NULL);

  introspect_maybe (self, NULL, path, interface, callback, user_data);
}

static GHashTable *
emit_interfaces (CockpitDBusCache *self,
                 const gchar *path)
{
  GHashTable *interfaces;

  g_assert (path != NULL);

  if (!self->update)
    {
      self->update = g_hash_table_new_full (g_str_hash, g_str_equal,
                                            NULL, hash_table_unref_or_null);
    }

  interfaces = g_hash_table_lookup (self->update, path);
  if (!interfaces)
    {
      interfaces = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          NULL, hash_table_unref_or_null);
      g_hash_table_replace (self->update, (gchar *)path, interfaces);
    }

  return interfaces;
}

static void
emit_remove (CockpitDBusCache *self,
             const gchar *path,
             const gchar *interface)
{
  GHashTable *interfaces = emit_interfaces (self, path);

  g_assert (interface != NULL);
  g_hash_table_replace (interfaces, (gchar *)interface, NULL);
}

static void
emit_change (CockpitDBusCache *self,
             const gchar *path,
             GDBusInterfaceInfo *iface,
             const gchar *property,
             GVariant *value)
{
  GHashTable *interfaces = emit_interfaces (self, path);
  GHashTable *properties;

  g_assert (iface != NULL);

  properties = g_hash_table_lookup (interfaces, iface->name);
  if (!properties)
    {
      properties = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          NULL, (GDestroyNotify)g_variant_unref);
      g_hash_table_replace (interfaces, iface->name, properties);
    }

  if (property)
    {
      g_assert (value != NULL);
      g_hash_table_replace (properties, (gchar *)property, g_variant_ref (value));
    }
}

static GHashTable *
ensure_interfaces (CockpitDBusCache *self,
                   const gchar *path)
{
  GHashTable *interfaces;

  interfaces = g_hash_table_lookup (self->cache, path);
  if (!interfaces)
    {
      interfaces = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          NULL, (GDestroyNotify)g_hash_table_unref);
      g_hash_table_replace (self->cache, (gchar *)path, interfaces);
    }

  return interfaces;
}

static GHashTable *
ensure_properties (CockpitDBusCache *self,
                   const gchar *path,
                   GDBusInterfaceInfo *iface)
{
  GHashTable *interfaces;
  GHashTable *properties;
  const gchar *name;

  interfaces = ensure_interfaces (self, path);
  properties = g_hash_table_lookup (interfaces, iface->name);
  if (!properties)
    {
      properties = g_hash_table_new_full (g_str_hash, g_str_equal,
                                          NULL, (GDestroyNotify)g_variant_unref);
      g_hash_table_replace (interfaces, iface->name, properties);

      g_debug ("%s: present %s at %s", self->logname, iface->name, path);
      emit_change (self, path, iface, NULL, NULL);
    }

  name = intern_string (self, iface->name);
  if (!g_hash_table_lookup (self->introsent, name))
    {
      g_hash_table_add (self->introsent, (gpointer)name);
      g_signal_emit (self, signal_meta, 0, iface);
    }

  return properties;
}

static void
process_value (CockpitDBusCache *self,
               GHashTable *properties,
               const gchar *path,
               GDBusInterfaceInfo *iface,
               const gchar *property,
               GVariant *variant)
{
  gpointer prev;
  GVariant *value;
  gpointer key;

  value = g_variant_get_variant (variant);

  if (g_hash_table_lookup_extended (properties, property, &key, &prev))
    {
      if (g_variant_equal (prev, value))
        {
          g_variant_unref (value);
          return;
        }

      g_hash_table_steal (properties, key);
      g_hash_table_replace (properties, key, value);
      g_variant_unref (prev);
    }
  else
    {
      g_hash_table_replace (properties, (gchar *)property, value);
    }

  g_debug ("%s: changed %s %s at %s", self->logname, iface->name, property, path);
  emit_change (self, path, iface, property, value);
}

typedef struct {
  CockpitDBusCache *self;
  const gchar *path;
  const gchar *property;
  BatchData *batch;
  GDBusInterfaceInfo *iface;
} GetData;

static void
process_get (CockpitDBusCache *self,
             BatchData *batch,
             const gchar *path,
             GDBusInterfaceInfo *iface,
             const gchar *property,
             GVariant *retval)
{
  GHashTable *properties;
  GVariant *variant;

  g_variant_get (retval, "(@v)", &variant);

  properties = ensure_properties (self, path, iface);
  process_value (self, properties, path, iface, property, variant);
  cockpit_dbus_cache_scrape (self, variant);
  g_variant_unref (variant);
}

static void
on_get_reply (GObject *source,
              GAsyncResult *result,
              gpointer user_data)
{
  GetData *gd = user_data;
  CockpitDBusCache *self = gd->self;
  GVariant *retval;
  GError *error = NULL;

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      if (!g_cancellable_is_cancelled (self->cancellable))
        {
          if (dbus_error_matches_unknown (error))
            {
              g_debug ("%s: couldn't get property %s %s at %s: %s", self->logname,
                       gd->iface->name, gd->property, gd->path, error->message);
            }
          else
            {
              g_message ("%s: couldn't get property %s %s at %s: %s", self->logname,
                         gd->iface->name, gd->property, gd->path, error->message);
            }
        }
      g_error_free (error);
    }

  if (retval)
    {
      g_debug ("%s: reply from Get() on %s", self->logname, gd->path);

      process_get (self, gd->batch, gd->path, gd->iface, gd->property, retval);
      g_variant_unref (retval);
    }

  batch_unref (self, gd->batch);

  g_object_unref (gd->self);
  g_slice_free (GetData, gd);
}

static void
process_properties (CockpitDBusCache *self,
                    BatchData *batch,
                    const gchar *path,
                    GDBusInterfaceInfo *iface,
                    GVariant *dict)
{
  GHashTable *properties;
  const gchar *property;
  GVariant *variant;
  GVariantIter iter;

  properties = ensure_properties (self, path, iface);

  g_variant_iter_init (&iter, dict);
  while (g_variant_iter_loop (&iter, "{s@v}", &property, &variant))
    {
      process_value (self, properties, path, iface,
                     intern_string (self, property), variant);
    }
}

typedef struct {
  const gchar *path;
  GVariant *body;
  BatchData *batch;
} PropertiesChangedData;

static void
process_properties_changed (CockpitDBusCache *self,
                            GDBusInterfaceInfo *iface,
                            gpointer user_data)
{
  PropertiesChangedData *pcd = user_data;
  GetData *gd;
  GVariantIter iter;
  const gchar *property;
  GVariant *changed;
  GVariant *invalidated;

  g_variant_get (pcd->body, "(@s@a{sv}@as)", NULL, &changed, &invalidated);

  process_properties (self, pcd->batch, pcd->path, iface, changed);

  /*
   * These are properties which the service didn't want to broadcast because
   * they're either calculated per-peer or expensive to calculate if nobody
   * is listening to them. We want them ... so get them and include them
   * in the current batch.
   */

  g_variant_iter_init (&iter, invalidated);
  while (g_variant_iter_loop (&iter, "&s", &property))
    {
      g_debug ("%s: calling Get() for %s %s at %s", self->logname, iface->name, property, pcd->path);

      gd = g_slice_new0 (GetData);
      gd->self = g_object_ref (self);
      gd->property = intern_string (self, property);
      gd->batch = batch_ref (pcd->batch);
      gd->path = pcd->path;
      gd->iface = iface;

      g_dbus_connection_call (self->connection, self->name, gd->path,
                              "org.freedesktop.DBus.Properties", "Get",
                              g_variant_new ("(ss)", iface->name, property),
                              G_VARIANT_TYPE ("(v)"),
                              G_DBUS_CALL_FLAGS_NONE, -1,
                              self->cancellable, on_get_reply, gd);
    }

  g_variant_unref (invalidated);
  g_variant_unref (changed);

  batch_unref (self, pcd->batch);

  g_variant_unref (pcd->body);
  g_slice_free (PropertiesChangedData, pcd);
}

static void
process_properties_barrier (CockpitDBusCache *self,
                            gpointer user_data)
{
  PropertiesChangedData *pcd = user_data;
  const gchar *interface;
  GVariant *changed;
  BatchData *batch;

  g_variant_get (pcd->body, "(&s@a{sv}@as)", &interface, &changed, NULL);

  batch = batch_create (self);

  pcd->batch = batch_ref (batch);
  introspect_maybe (self, pcd->batch, pcd->path, interface, process_properties_changed, pcd);

  scrape_variant (self, batch, changed);
  batch_unref (self, batch);

  g_variant_unref (changed);
}

static void
on_properties_signal (GDBusConnection *connection,
                      const gchar *sender,
                      const gchar *path,
                      const gchar *properties_iface,
                      const gchar *member,
                      GVariant *body,
                      gpointer user_data)
{
  CockpitDBusCache *self = user_data;
  PropertiesChangedData *pcd;
  const gchar *interface;

  if (!g_variant_is_of_type (body, G_VARIANT_TYPE ("(sa{sv}as)")))
    {
      g_debug ("%s: received PropertiesChanged with bad type", self->logname);
      return;
    }

  g_debug ("%s: signal PropertiesChanged at %s", self->logname, path);
  g_variant_get (body, "(&s@a{sv}@as)", &interface, NULL, NULL);

  if (!cockpit_dbus_rules_match (self->rules, path, interface, NULL, NULL))
    return;

  pcd = g_slice_new0 (PropertiesChangedData);
  pcd->body = g_variant_ref (body);
  pcd->path = intern_string (self, path);
  cockpit_dbus_cache_barrier (self, process_properties_barrier, pcd);
}

typedef struct {
  const gchar *path;
  GVariant *dict;
  BatchData *batch;
} ProcessInterfaceData;

static void
process_interface (CockpitDBusCache *self,
                   GDBusInterfaceInfo *iface,
                   gpointer user_data)
{
  ProcessInterfaceData *pid = user_data;

  process_properties (self, pid->batch, pid->path, iface, pid->dict);

  batch_unref (self, pid->batch);

  g_variant_unref (pid->dict);
  g_slice_free (ProcessInterfaceData, pid);
}

static void
process_interfaces (CockpitDBusCache *self,
                    BatchData *batch,
                    GHashTable *snapshot,
                    const gchar *path,
                    GVariant *dict)
{
  ProcessInterfaceData *pid;
  GVariant *inner;
  const gchar *interface;
  GVariantIter iter;

  if (batch)
    batch = batch_ref (batch);

  g_variant_iter_init (&iter, dict);
  while (g_variant_iter_loop (&iter, "{s@a{sv}}", &interface, &inner))
    {
      if (!cockpit_dbus_rules_match (self->rules, path, interface, NULL, NULL))
        continue;

      if (!batch)
        batch = batch_create (self);

      if (snapshot)
        g_hash_table_remove (snapshot, interface);

      pid = g_slice_new0 (ProcessInterfaceData);
      pid->batch = batch_ref (batch);
      pid->path = path;
      pid->dict = g_variant_ref (inner);
      cockpit_dbus_cache_introspect (self, path, interface, process_interface, pid);

      scrape_variant (self, batch, inner);
    }

  if (batch)
    batch_unref (self, batch);
}

typedef struct {
  GVariant *body;
  const gchar *manager_added;
} ProcessInterfacesData;

static void
retrieve_managed_objects (CockpitDBusCache *self,
                          const gchar *namespace_path,
                          BatchData *batch);

static void
process_interfaces_added (CockpitDBusCache *self,
                          gpointer user_data)
{
  ProcessInterfacesData *pis = user_data;
  BatchData *batch = NULL;
  GVariant *interfaces;
  const gchar *path;

  /*
   * We added a manager while processing this message, perform a full manager
   * load as part of the same batch.
   */
  if (pis->manager_added)
    {
      batch = batch_create (self);
      retrieve_managed_objects (self, pis->manager_added, batch);
    }

  g_variant_get (pis->body, "(&o@a{sa{sv}})", &path, &interfaces);
  process_interfaces (self, batch, NULL, intern_string (self, path), interfaces);
  g_variant_unref (interfaces);

  if (batch)
    batch_unref (self, batch);

  g_variant_unref (pis->body);
  g_slice_free (ProcessInterfacesData, pis);
}

static void
process_removed (CockpitDBusCache *self,
                 const gchar *path,
                 const gchar *interface)
{
  GHashTable *interfaces;
  GHashTable *properties;

  interfaces = g_hash_table_lookup (self->cache, path);
  if (!interfaces)
    return;

  properties = g_hash_table_lookup (interfaces, interface);
  if (!properties)
    return;

  g_hash_table_remove (interfaces, interface);

  g_debug ("%s: removed %s at %s", self->logname, interface, path);
  emit_remove (self, path, interface);
}

static void
process_interfaces_removed (CockpitDBusCache *self,
                            gpointer user_data)
{
  ProcessInterfacesData *pis = user_data;
  GVariant *array;
  const gchar *path;
  const gchar *interface;
  GVariantIter iter;
  BatchData *batch;

  batch = batch_create (self);

  /*
   * We added a manager while processing this message, perform a full manager
   * load as part of the same batch.
   */
  if (pis->manager_added)
    retrieve_managed_objects (self, pis->manager_added, batch);

  g_variant_get (pis->body, "(&o@as)", &path, &array);
  path = intern_string (self, path);

  g_variant_iter_init (&iter, array);
  while (g_variant_iter_loop (&iter, "&s", &interface))
    process_removed (self, path, intern_string (self, interface));

  batch_unref (self, batch);

  g_variant_unref (array);
  g_variant_unref (pis->body);
  g_slice_free (ProcessInterfacesData, pis);
}

static void
on_manager_signal (GDBusConnection *connection,
                   const gchar *sender,
                   const gchar *path,
                   const gchar *interface,
                   const gchar *member,
                   GVariant *body,
                   gpointer user_data)
{
  CockpitDBusCache *self = user_data;
  CockpitDBusBarrierFunc barrier_func = NULL;
  const gchar * manager_added;
  ProcessInterfacesData *pis;

  /* Note that this is an ObjectManager */
  manager_added = cockpit_paths_add (self->managed, path);

  if (g_str_equal (member, "InterfacesAdded"))
    {
      if (g_variant_is_of_type (body, G_VARIANT_TYPE ("(oa{sa{sv}})")))
        {
          g_debug ("%s: signal InterfacesAdded at %s", self->logname, path);
          barrier_func = process_interfaces_added;
        }
      else
        {
          g_debug ("%s: received InterfacesAdded with bad type", self->logname);
        }
    }
  else if (g_str_equal (member, "InterfacesRemoved"))
    {
      if (g_variant_is_of_type (body, G_VARIANT_TYPE ("(oas)")))
        {
          g_debug ("%s: signal InterfacesRemoved at %s", self->logname, path);
          barrier_func = process_interfaces_removed;
        }
      else
        {
          g_debug ("%s: received InterfacesRemoved with bad type", self->logname);
        }
    }

  if (barrier_func)
    {
      pis = g_slice_new0 (ProcessInterfacesData);
      pis->body = g_variant_ref (body);
      pis->manager_added = manager_added;
      cockpit_dbus_cache_barrier (self, barrier_func, pis);
    }
}

static void
cockpit_dbus_cache_constructed (GObject *object)
{
  CockpitDBusCache *self = COCKPIT_DBUS_CACHE (object);

  g_return_if_fail (self->connection != NULL);

  if (!self->introspected)
    self->introspected = cockpit_dbus_interface_info_new ();

  self->subscribe_properties = g_dbus_connection_signal_subscribe (self->connection,
                                                                   self->name,
                                                                   "org.freedesktop.DBus.Properties",
                                                                   "PropertiesChanged",
                                                                   NULL, /* object_path */
                                                                   NULL, /* arg0 */
                                                                   G_DBUS_SIGNAL_FLAGS_NONE,
                                                                   on_properties_signal,
                                                                   self, NULL);

  self->subscribe_manager = g_dbus_connection_signal_subscribe (self->connection,
                                                                self->name,
                                                                "org.freedesktop.DBus.ObjectManager",
                                                                NULL, /* member */
                                                                NULL, /* object_path */
                                                                NULL, /* arg0 */
                                                                G_DBUS_SIGNAL_FLAGS_NONE,
                                                                on_manager_signal,
                                                                self, NULL);

  self->subscribed = TRUE;
}

static void
cockpit_dbus_cache_set_property (GObject *obj,
                                 guint prop_id,
                                 const GValue *value,
                                 GParamSpec *pspec)
{
  CockpitDBusCache *self = COCKPIT_DBUS_CACHE (obj);

  switch (prop_id)
    {
      case PROP_CONNECTION:
        self->connection = g_value_dup_object (value);
        break;
      case PROP_NAME:
        self->name = g_value_dup_string (value);
        break;
      case PROP_LOGNAME:
        self->logname = g_value_dup_string (value);
        break;
      case PROP_INTERFACE_INFO:
        self->introspected = g_value_dup_boxed (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
        break;
    }
}

static void
cockpit_dbus_cache_dispose (GObject *object)
{
  CockpitDBusCache *self = COCKPIT_DBUS_CACHE (object);

  g_cancellable_cancel (self->cancellable);

  if (self->subscribed)
    {
      g_dbus_connection_signal_unsubscribe (self->connection, self->subscribe_properties);
      g_dbus_connection_signal_unsubscribe (self->connection, self->subscribe_manager);
      self->subscribed = FALSE;
    }

  introspect_flush (self);
  batch_flush (self);
  barrier_flush (self);

  G_OBJECT_CLASS (cockpit_dbus_cache_parent_class)->dispose (object);
}

static void
cockpit_dbus_cache_finalize (GObject *object)
{
  CockpitDBusCache *self = COCKPIT_DBUS_CACHE (object);

  g_clear_object (&self->connection);
  g_object_unref (self->cancellable);

  g_free (self->name);
  g_free (self->logname);

  cockpit_dbus_rules_free (self->rules);
  g_tree_destroy (self->managed);

  g_queue_free (self->batches);
  g_queue_free (self->barriers);

  g_assert (self->introspects->head == NULL);
  g_queue_free (self->introspects);

  g_hash_table_unref (self->introsent);
  g_hash_table_unref (self->introspected);
  g_hash_table_unref (self->cache);

  g_hash_table_destroy (self->interned);
  g_list_free_full (self->trash, g_free);

  G_OBJECT_CLASS (cockpit_dbus_cache_parent_class)->finalize (object);
}

static void
cockpit_dbus_cache_class_init (CockpitDBusCacheClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->constructed = cockpit_dbus_cache_constructed;
  gobject_class->set_property = cockpit_dbus_cache_set_property;
  gobject_class->dispose = cockpit_dbus_cache_dispose;
  gobject_class->finalize = cockpit_dbus_cache_finalize;

  signal_meta = g_signal_new ("meta", COCKPIT_TYPE_DBUS_CACHE, G_SIGNAL_RUN_LAST,
                              G_STRUCT_OFFSET (CockpitDBusCacheClass, meta),
                              NULL, NULL, NULL, G_TYPE_NONE,
                              1, G_TYPE_DBUS_INTERFACE_INFO);

  signal_update = g_signal_new ("update", COCKPIT_TYPE_DBUS_CACHE, G_SIGNAL_RUN_LAST,
                                G_STRUCT_OFFSET (CockpitDBusCacheClass, update),
                                NULL, NULL, NULL, G_TYPE_NONE,
                                1, G_TYPE_HASH_TABLE);

  g_object_class_install_property (gobject_class, PROP_CONNECTION,
       g_param_spec_object ("connection", "connection", "connection", G_TYPE_DBUS_CONNECTION,
                            G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_NAME,
       g_param_spec_string ("name", "name", "name", NULL,
                            G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
  g_object_class_install_property (gobject_class, PROP_LOGNAME,
       g_param_spec_string ("logname", "logname", "logname", "internal",
                            G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
  g_object_class_install_property (gobject_class, PROP_INTERFACE_INFO,
       g_param_spec_boxed ("interface-info", NULL, NULL, G_TYPE_HASH_TABLE,
                           G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

static GHashTable *
snapshot_string_keys (GHashTable *table)
{
  GHashTable *set;
  GHashTableIter iter;
  gpointer key;

  set = g_hash_table_new (g_str_hash, g_str_equal);
  if (table)
    {
      g_hash_table_iter_init (&iter, table);
      while (g_hash_table_iter_next (&iter, &key, NULL))
        g_hash_table_add (set, key);
    }

  return set;
}

static void
process_get_all (CockpitDBusCache *self,
                 BatchData *batch,
                 const gchar *path,
                 GDBusInterfaceInfo *iface,
                 GVariant *retval)
{
  GVariant *dict;

  g_variant_get (retval, "(@a{sv})", &dict);

  process_properties (self, batch, path, iface, dict);
  scrape_variant (self, batch, dict);

  g_variant_unref (dict);
}

static void
process_removed_path (CockpitDBusCache *self,
                      const gchar *path)
{
  GHashTable *interfaces;
  GHashTableIter iter;
  gpointer interface;
  GHashTable *snapshot;

  interfaces = g_hash_table_lookup (self->cache, path);
  if (interfaces)
    {
      snapshot = snapshot_string_keys (interfaces);
      g_hash_table_iter_init (&iter, snapshot);
      while (g_hash_table_iter_next (&iter, &interface, NULL))
        process_removed (self, path, interface);
      g_hash_table_destroy (snapshot);
    }
}

static void
process_paths (CockpitDBusCache *self,
               BatchData *batch,
               GHashTable *snapshot,
               GVariant *dict)
{
  GVariant *inner;
  GHashTable *snap;
  const gchar *path;
  GVariantIter iter;
  GHashTableIter hter;
  gpointer key;

  g_variant_iter_init (&iter, dict);
  while (g_variant_iter_loop (&iter, "{o@a{sa{sv}}}", &path, &inner))
    {
      snap = NULL;
      if (snapshot)
        {
          g_hash_table_remove (snapshot, path);
          snap = snapshot_string_keys (g_hash_table_lookup (self->cache, path));
        }

      process_interfaces (self, batch, snap, intern_string (self, path), inner);

      if (snap)
        {
          g_hash_table_iter_init (&hter, snap);
          while (g_hash_table_iter_next (&hter, &key, NULL))
            process_removed (self, path, key);
          g_hash_table_destroy (snap);
        }
    }
}

static void
process_get_managed_objects (CockpitDBusCache *self,
                             BatchData *batch,
                             const gchar *manager_path,
                             GVariant *retval)
{
  /*
   * So here we handle things slightly differently than just pushing the
   * result through all the properties update mechanics. We get
   * indications of interfaces and entire paths disappearing here,
   * so we have to handle that.
   */

  GVariant *inner;
  GHashTableIter iter;
  GHashTable *snapshot;
  gpointer path;

  /* Snapshot everything under control of the path of the object manager */
  snapshot = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_iter_init (&iter, self->cache);
  while (g_hash_table_iter_next (&iter, &path, NULL))
    {
      if (cockpit_path_has_ancestor (path, manager_path))
        g_hash_table_add (snapshot, path);
    }

  g_variant_get (retval, "(@a{oa{sa{sv}}})", &inner);
  process_paths (self, batch, snapshot, inner);
  g_variant_unref (inner);

  g_hash_table_iter_init (&iter, snapshot);
  while (g_hash_table_iter_next (&iter, &path, NULL))
    process_removed_path (self, path);
  g_hash_table_unref (snapshot);
}

static void
process_introspect_children (CockpitDBusCache *self,
                             BatchData *batch,
                             const gchar *parent_path,
                             GDBusNodeInfo *node)
{
  GDBusNodeInfo *child;
  GHashTable *snapshot;
  GHashTableIter iter;
  gchar *child_path;
  gpointer path;
  guint i;

  /* Snapshot all direct children of path */
  snapshot = g_hash_table_new (g_str_hash, g_str_equal);
  g_hash_table_iter_init (&iter, self->cache);
  while (g_hash_table_iter_next (&iter, &path, NULL))
    {
      if (cockpit_path_has_parent (path, parent_path))
        g_hash_table_add (snapshot, path);
    }

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
      else if (g_str_equal (parent_path, "/"))
        child_path = g_strdup_printf ("/%s", child->path);
      else
        child_path = g_strdup_printf ("%s/%s", parent_path, child->path);

      /* Remove everything in the snapshot related to this child */
      g_hash_table_remove (snapshot, child_path);

      if (cockpit_dbus_rules_match (self->rules, child_path, NULL, NULL, NULL) &&
          !cockpit_paths_contain_or_ancestor (self->managed, child_path))
        {
          /* Inline child interfaces are rare but possible */
          if (child->interfaces && child->interfaces[0])
            {
              process_introspect_node (self, batch,
                                       intern_string (self, child_path),
                                       child, TRUE);
            }

          /* If we have no knowledge of this child, then introspect it */
          else
            {
              introspect_queue (self, batch,
                                intern_string (self, child_path),
                                NULL, NULL, NULL);
            }
        }

      g_free (child_path);
    }

  /* Anything remaining in snapshot stays */
  g_hash_table_iter_init (&iter, snapshot);
  while (g_hash_table_iter_next (&iter, &path, NULL))
    process_removed_path (self, path);
  g_hash_table_unref (snapshot);
}

typedef struct {
  CockpitDBusCache *self;
  const gchar *path;
  GDBusInterfaceInfo *iface;
  BatchData *batch;
} GetAllData;

static void
on_get_all_reply (GObject *source,
                  GAsyncResult *result,
                  gpointer user_data)
{
  GetAllData *gad = user_data;
  CockpitDBusCache *self = gad->self;
  GError *error = NULL;
  GVariant *retval;

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      if (!g_cancellable_is_cancelled (self->cancellable))
        {
          if (dbus_error_matches_unknown (error))
            {
              g_debug ("%s: couldn't get all properties of %s at %s: %s", self->logname,
                       gad->iface->name, gad->path, error->message);
            }
          else
            {
              g_message ("%s: couldn't get all properties of %s at %s: %s", self->logname,
                         gad->iface->name, gad->path, error->message);
            }
        }
      g_error_free (error);
    }

  if (retval)
    {
      g_debug ("%s: reply to GetAll() for %s at %s", self->logname, gad->iface->name, gad->path);
      process_get_all (self, gad->batch, gad->path, gad->iface, retval);

      g_variant_unref (retval);
    }

  /* Whether or not this failed, we know the interface exists */
  ensure_properties (self, gad->path, gad->iface);
  emit_change (self, gad->path, gad->iface, NULL, NULL);

  batch_unref (self, gad->batch);

  g_object_unref (gad->self);
  g_slice_free (GetAllData, gad);
}

static void
retrieve_properties (CockpitDBusCache *self,
                     BatchData *batch,
                     const gchar *path,
                     GDBusInterfaceInfo *iface)
{
  GetAllData *gad;

  /* Don't bother getting properties for this well known interface
   * that doesn't have any.  Also, NetworkManager returns an error.
   */
  if (g_strcmp0 (iface->name, "org.freedesktop.DBus.Properties") == 0)
    return;

  g_debug ("%s: calling GetAll() for %s at %s", self->logname, iface->name, path);

  gad = g_slice_new0 (GetAllData);
  gad->self = g_object_ref (self);
  gad->batch = batch_ref (batch);
  gad->path = path;
  gad->iface = iface;

  g_dbus_connection_call (self->connection, self->name, path,
                          "org.freedesktop.DBus.Properties", "GetAll",
                          g_variant_new ("(s)", iface->name), G_VARIANT_TYPE ("(a{sv})"),
                          G_DBUS_CALL_FLAGS_NONE, -1,
                          self->cancellable, on_get_all_reply, gad);
}

static void
process_introspect_node (CockpitDBusCache *self,
                         BatchData *batch,
                         const gchar *path,
                         GDBusNodeInfo *node,
                         gboolean recursive)
{
  GDBusInterfaceInfo *iface;
  GDBusInterfaceInfo *prev;
  GHashTable *snapshot;
  GHashTableIter iter;
  gpointer interface;
  guint i;

  if (cockpit_paths_contain_or_ancestor (self->managed, path))
    recursive = FALSE;

  snapshot = snapshot_string_keys (g_hash_table_lookup (self->cache, path));

  for (i = 0; node->interfaces && node->interfaces[i] != NULL; i++)
    {
      iface = node->interfaces[i];
      if (!iface->name)
        {
          g_warning ("Received interface from %s at %s without name", self->logname, path);
          continue;
        }

      /* Cache this interface for later use elsewhere */
      prev = cockpit_dbus_interface_info_lookup (self->introspected, iface->name);
      if (prev)
        {
          iface = prev;
        }
      else
        {
          cockpit_dbus_interface_info_push (self->introspected, iface);
        }

      /* Skip these interfaces */
      if (g_str_has_prefix (iface->name, "org.freedesktop.DBus."))
        {
          /* But make sure we track the fact that something is here */
          ensure_interfaces (self, path);
          continue;
        }

      g_hash_table_remove (snapshot, iface->name);

      if (recursive && cockpit_dbus_rules_match (self->rules, path, iface->name, NULL, NULL))
        retrieve_properties (self, batch, path, iface);
    }

  /* Remove any interfaces not seen */
  g_hash_table_iter_init (&iter, snapshot);
  while (g_hash_table_iter_next (&iter, &interface, NULL))
    process_removed (self, path, interface);
  g_hash_table_destroy (snapshot);

  if (recursive)
    process_introspect_children (self, batch, path, node);
}

typedef struct {
  CockpitDBusCache *self;
  const gchar *path;
  BatchData *batch;
} GetManagedObjectsData;

static void
on_get_managed_objects_reply (GObject *source,
                              GAsyncResult *result,
                              gpointer user_data)
{
  GetManagedObjectsData *gmod = user_data;
  CockpitDBusCache *self = gmod->self;
  GError *error = NULL;
  GVariant *retval;

  retval = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      if (!g_cancellable_is_cancelled (self->cancellable))
        {
          /* Doesn't support ObjectManager? */
          if (dbus_error_matches_unknown (error))
            {
              g_debug ("%s: no ObjectManager at %s", self->logname, gmod->path);
            }
          else
            {
              g_message ("%s: couldn't get managed objects at %s: %s",
                         self->logname, gmod->path, error->message);
            }
        }
      g_error_free (error);
    }

  if (retval)
    {
      g_debug ("%s: reply from GetManagedObjects() on %s", self->logname, gmod->path);

      /* Note that this is indeed an object manager */
      cockpit_paths_add (self->managed, gmod->path);

      process_get_managed_objects (self, gmod->batch, gmod->path, retval);
      g_variant_unref (retval);
    }

  /*
   * The ObjectManager itself still needs introspecting ... since the
   * ObjectManager path itself cannot be included in the objects reported
   * by the ObjectManager ... dumb design decision in the dbus spec IMO.
   *
   * But we delay on this so that any children are treated as part of
   * object manager, and we don't go introspecting everything.
   */
  introspect_queue (self, gmod->batch, gmod->path, NULL, NULL, NULL);

  batch_unref (self, gmod->batch);

  g_object_unref (gmod->self);
  g_slice_free (GetManagedObjectsData, gmod);
}

static void
retrieve_managed_objects (CockpitDBusCache *self,
                          const gchar *namespace_path,
                          BatchData *batch)
{
  GetManagedObjectsData *gmod;

  g_assert (namespace_path != NULL);

  gmod = g_slice_new0 (GetManagedObjectsData);
  gmod->batch = batch_ref (batch);
  gmod->path = namespace_path;
  gmod->self = g_object_ref (self);

  g_debug ("%s: calling GetManagedObjects() on %s", self->logname, namespace_path);

  g_dbus_connection_call (self->connection, self->name, namespace_path,
                          "org.freedesktop.DBus.ObjectManager", "GetManagedObjects",
                          g_variant_new ("()"), G_VARIANT_TYPE ("(a{oa{sa{sv}}})"),
                          G_DBUS_CALL_FLAGS_NONE, -1, /* timeout */
                          self->cancellable, on_get_managed_objects_reply, gmod);
}


void
cockpit_dbus_cache_watch (CockpitDBusCache *self,
                          const gchar *path,
                          gboolean is_namespace,
                          const gchar *interface)
{
  const gchar *namespace_path;
  BatchData *batch;

  if (!cockpit_dbus_rules_add (self->rules, path, is_namespace, interface, NULL, NULL))
    return;

  if (!path)
    {
      path = "/";
      is_namespace = TRUE;
    }

  batch = batch_create (self);
  path = intern_string (self, path);

  namespace_path = is_namespace ? path : NULL;

  if (!namespace_path)
    namespace_path = cockpit_paths_contain_or_ancestor (self->managed, path);

  if (namespace_path)
    {
      retrieve_managed_objects (self, namespace_path, batch);
    }
  else
    {
      introspect_queue (self, batch, path, NULL, NULL, NULL);
    }

  batch_unref (self, batch);
}

gboolean
cockpit_dbus_cache_unwatch (CockpitDBusCache *self,
                            const gchar *path,
                            gboolean is_namespace,
                            const gchar *interface)
{
  return cockpit_dbus_rules_remove (self->rules, path, is_namespace, interface, NULL, NULL);
}

static void
scrape_variant_paths (GVariant *data,
                      GHashTable *paths)
{
  GVariantIter iter;
  GVariant *child;

  if (g_variant_is_of_type (data, G_VARIANT_TYPE_OBJECT_PATH))
    {
      g_hash_table_add (paths, (gchar *)g_variant_get_string (data, NULL));
    }
  else if (g_variant_is_container (data))
    {
      g_variant_iter_init (&iter, data);
      while ((child = g_variant_iter_next_value (&iter)) != NULL)
        {
          scrape_variant_paths (child, paths);
          g_variant_unref (child);
        }
    }
}

void
cockpit_dbus_cache_barrier (CockpitDBusCache *self,
                            CockpitDBusBarrierFunc callback,
                            gpointer user_data)
{
  BatchData *batch;
  BarrierData *barrier;

  g_return_if_fail (callback != NULL);

  batch = g_queue_peek_head (self->batches);
  if (batch)
    {
      barrier = g_slice_new0 (BarrierData);
      barrier->number = batch->number;
      barrier->callback = callback;
      barrier->user_data = user_data;
      g_queue_push_tail (self->barriers, barrier);
    }
  else
    {
      (callback) (self, user_data);
    }
}

static void
scrape_variant (CockpitDBusCache *self,
                BatchData *batch,
                GVariant *data)
{
  GHashTable *paths;
  GHashTableIter iter;
  gpointer path;

  paths = g_hash_table_new (g_str_hash, g_str_equal);
  scrape_variant_paths (data, paths);

  if (batch)
    batch = batch_ref (batch);

  g_hash_table_iter_init (&iter, paths);
  while (g_hash_table_iter_next (&iter, &path, NULL))
    {
      /* Used as a NULL path, we never use it when scraped */
      if (g_str_equal (path, "/"))
        continue;

      /* Do we have it already? */
      if (g_hash_table_lookup (self->cache, path))
        continue;

      /* Is it a managed path? */
      if (cockpit_paths_contain_or_ancestor (self->managed, path))
        continue;

      /* Does it fit our rules */
      if (!cockpit_dbus_rules_match (self->rules, path, NULL, NULL, NULL))
        continue;

      if (!batch)
        batch = batch_create (self);

      introspect_queue (self, batch, intern_string (self, path), NULL, NULL, NULL);
    }

  if (batch)
    batch_unref (self, batch);

  g_hash_table_destroy (paths);
}

void
cockpit_dbus_cache_scrape (CockpitDBusCache *self,
                           GVariant *data)
{
  scrape_variant (self, NULL, data);
}

typedef struct {
  const gchar *path;
  BatchData *batch;
} PokeData;

static void
process_poke (CockpitDBusCache *self,
              GDBusInterfaceInfo *iface,
              gpointer user_data)
{
  PokeData *pd = user_data;

  retrieve_properties (self, pd->batch, pd->path, iface);

  batch_unref (self, pd->batch);
  g_slice_free (PokeData, pd);
}

void
cockpit_dbus_cache_poke (CockpitDBusCache *self,
                         const gchar *path,
                         const gchar *interface)
{
  GHashTable *interfaces;
  BatchData *batch;
  PokeData *pd;

  /* Check if we have this thing */
  interfaces = g_hash_table_lookup (self->cache, path);
  if (interfaces)
    {
      if (!interface)
        return;
      else if (g_hash_table_lookup (interfaces, interface))
        return;
    }

  /* Is it a managed path? */
  if (cockpit_paths_contain_or_ancestor (self->managed, path))
    return;

  /* Does it fit our rules */
  if (!cockpit_dbus_rules_match (self->rules, path, interface, NULL, NULL))
    return;

  batch = batch_create (self);
  path = intern_string (self, path);

  if (interface)
    {
      /*
       * A specific interface was poked. This means that we don't have to
       * go interspecting the entire path ... if we already have information
       * about the interface itself. So try that route.
       */

      pd = g_slice_new0 (PokeData);
      pd->path = path;
      pd->batch = batch_ref (batch);
      introspect_maybe (self, batch, path, interface, process_poke, pd);
    }
  else
    {
      /* The entire path was poked, must introspect to find out about it */
      introspect_queue (self, batch, path, NULL, NULL, NULL);
    }

  batch_unref (self, batch);
}

CockpitDBusCache *
cockpit_dbus_cache_new (GDBusConnection *connection,
                        const gchar *name,
                        const gchar *logname,
                        GHashTable *interface_info)
{
  return g_object_new (COCKPIT_TYPE_DBUS_CACHE,
                       "connection", connection,
                       "name", name,
                       "logname", logname,
                       "interface-info", interface_info,
                       NULL);
}

GHashTable *
cockpit_dbus_interface_info_new (void)
{
  /* The key is owned by the value */
  return g_hash_table_new_full (g_str_hash, g_str_equal, NULL,
                                (GDestroyNotify)g_dbus_interface_info_unref);
}

GDBusInterfaceInfo *
cockpit_dbus_interface_info_lookup (GHashTable *interface_info,
                                    const gchar *interface_name)
{
  g_return_val_if_fail (interface_info != NULL, NULL);
  g_return_val_if_fail (interface_name != NULL, NULL);
  return g_hash_table_lookup (interface_info, interface_name);
}

void
cockpit_dbus_interface_info_push (GHashTable *interface_info,
                                  GDBusInterfaceInfo *iface)
{
  g_return_if_fail (interface_info != NULL);
  g_return_if_fail (iface != NULL);
  g_hash_table_replace (interface_info, iface->name,
                        g_dbus_interface_info_ref (iface));
}
