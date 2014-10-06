/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include <string.h>
#include <stdio.h>
#include <stdint.h>

#include <gsystem-local-alloc.h>

#include "utils.h"
#include "daemon.h"
#include "services.h"
#include "cgroup-show.h"

/**
 * @title: Services
 */

typedef struct _ServicesClass ServicesClass;

/**
 * Services:
 *
 * The #Services structure contains only private data and
 * should only be accessed using the provided API.
 */

struct _Services
{
  CockpitServicesSkeleton parent_instance;
  Daemon *daemon;

  GDBusProxy *systemd;

  GHashTable *delayed_unit_news;
};

struct _ServicesClass
{
  CockpitServicesSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON,
};

static void services_iface_init (CockpitServicesIface *iface);

G_DEFINE_TYPE_WITH_CODE (Services, services, COCKPIT_TYPE_SERVICES_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_SERVICES, services_iface_init));

static void
services_finalize (GObject *object)
{
  Services *services = SERVICES (object);

  g_hash_table_destroy (services->delayed_unit_news);

  if (G_OBJECT_CLASS (services_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (services_parent_class)->finalize (object);
}

static void
services_get_property (GObject *object,
                       guint prop_id,
                       GValue *value,
                       GParamSpec *pspec)
{
  Services *services = SERVICES (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, services_get_daemon (services));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
services_set_property (GObject *object,
                       guint prop_id,
                       const GValue *value,
                       GParamSpec *pspec)
{
  Services *services = SERVICES (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (services->daemon == NULL);
      services->daemon = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
services_init (Services *services)
{
}

static void
on_unit_proxy_ready (GObject *object,
                     GAsyncResult *res,
                     gpointer user_data)
{
  Services *services = user_data;
  gs_unref_object GDBusProxy *unit = g_dbus_proxy_new_for_bus_finish (res, NULL);
  if (unit)
    {
      const gchar *name, *description, *load_state, *active_state, *sub_state, *file_state;
      gs_unref_variant GVariant *n = g_dbus_proxy_get_cached_property (unit, "Id");
      gs_unref_variant GVariant *d = g_dbus_proxy_get_cached_property (unit, "Description");
      gs_unref_variant GVariant *l = g_dbus_proxy_get_cached_property (unit, "LoadState");
      gs_unref_variant GVariant *a = g_dbus_proxy_get_cached_property (unit, "ActiveState");
      gs_unref_variant GVariant *s = g_dbus_proxy_get_cached_property (unit, "SubState");
      gs_unref_variant GVariant *f = g_dbus_proxy_get_cached_property (unit, "UnitFileState");
      g_variant_get (n, "&s", &name);
      g_variant_get (d, "&s", &description);
      g_variant_get (l, "&s", &load_state);
      g_variant_get (a, "&s", &active_state);
      g_variant_get (s, "&s", &sub_state);
      g_variant_get (f, "&s", &file_state);

      cockpit_services_emit_service_update (COCKPIT_SERVICES (services),
                                            g_variant_new ("(ssssss)",
                                                           name,
                                                           description,
                                                           load_state,
                                                           active_state,
                                                           sub_state,
                                                           file_state));
    }
}

static void
update_service (Services *services,
                const gchar *object_path)
{
  g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                            0,
                            NULL,
                            "org.freedesktop.systemd1",
                            object_path,
                            "org.freedesktop.systemd1.Unit",
                            NULL,
                            on_unit_proxy_ready,
                            services);
}

static void
on_unit_files_changed_signal (GDBusConnection *connection,
                              const gchar *sender_name,
                              const gchar *object_path,
                              const gchar *interface_name,
                              const gchar *signal_name,
                              GVariant *parameters,
                              gpointer user_data)
{
  Services *services = user_data;
  cockpit_services_emit_service_update_all (COCKPIT_SERVICES (services));
}

static void
on_systemd_properties_changed (GDBusConnection *connection,
                               const gchar *sender_name,
                               const gchar *object_path,
                               const gchar *interface_name,
                               const gchar *signal_name,
                               GVariant *parameters,
                               gpointer user_data)
{
  Services *services = user_data;
  const gchar *prop_interface;
  g_variant_get (parameters, "(&sa{sv}as)", &prop_interface, NULL, NULL);
  if (strcmp (prop_interface, "org.freedesktop.systemd1.Unit") == 0)
    update_service (services, object_path);
}

/* HACK
 *
 * We need to listen to the UnitNew signal so that we can catch the
 * first state change of a previously not-loaded unit.  Unfortunately,
 * the UnitNew signal does not carry the properties of the new object,
 * so we need to call GetAll on it (via the update_service function).
 *
 * Doubly unfortunately, systemd sometimes reacts to a GetAll call
 * with another UnitNew signal.  This happens for units that systemd
 * doesn't want to keep loaded.  Any action on them results in a
 * UnitNew/UnitRemoved signal pair.  Thus, we can easily get into a
 * tight and infinite loop.
 *
 * https://bugs.freedesktop.org/show_bug.cgi?id=69575
 *
 * To protect against this, we delay the GetAll calls when receiving a
 * UnitNew signal.  If we get a UnitRemoved before the delay is over,
 * GetAll is cancelled.
 */

typedef struct {
  Services *services;
  gchar *object_path;
  guint delay_id;
} DelayedUnitNewData;

static void
free_delayed_unit_new (gpointer user_data)
{
  DelayedUnitNewData *data = user_data;
  if (data->delay_id > 0)
    g_source_remove (data->delay_id);
  g_free (data->object_path);
  g_free (data);
}

static gboolean
on_delayed_unit_new_timeout (gpointer user_data)
{
  DelayedUnitNewData *data = user_data;
  update_service (data->services, data->object_path);
  g_hash_table_remove (data->services->delayed_unit_news, data->object_path);
  return FALSE;
}

static void
on_unit_new_signal (GDBusConnection *connection,
                    const gchar *sender_name,
                    const gchar *object_path,
                    const gchar *interface_name,
                    const gchar *signal_name,
                    GVariant *parameters,
                    gpointer user_data)
{
  Services *services = user_data;
  const gchar *new_object_path;
  g_variant_get (parameters, "(&s&o)", NULL, &new_object_path);
  if (!g_hash_table_lookup (services->delayed_unit_news, new_object_path))
    {
      DelayedUnitNewData *data = g_new0 (DelayedUnitNewData, 1);
      data->services = services;
      data->object_path = g_strdup (new_object_path);
      data->delay_id = g_timeout_add (100, on_delayed_unit_new_timeout, data);
      g_hash_table_insert (services->delayed_unit_news, data->object_path, data);
    }
}

static void
on_unit_removed_signal (GDBusConnection *connection,
                        const gchar *sender_name,
                        const gchar *object_path,
                        const gchar *interface_name,
                        const gchar *signal_name,
                        GVariant *parameters,
                        gpointer user_data)
{
  Services *services = user_data;
  const gchar *old_object_path;
  g_variant_get (parameters, "(&s&o)", NULL, &old_object_path);
  g_hash_table_remove (services->delayed_unit_news, old_object_path);
}

static void
on_subscribe_done (GObject *object,
                   GAsyncResult *res,
                   gpointer user_data)
{
  GError *error = NULL;
  GVariant *result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      g_warning ("Can't subscribe to systemd signals: %s", error->message);
      g_error_free (error);
    }
  else
    {
      g_variant_unref (result);
    }
}

static void
services_constructed (GObject *_object)
{
  Services *services = SERVICES (_object);
  GDBusConnection *connection;

  services->systemd = g_dbus_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                                     0,
                                                     NULL,
                                                     "org.freedesktop.systemd1",
                                                     "/org/freedesktop/systemd1",
                                                     "org.freedesktop.systemd1.Manager",
                                                     NULL,
                                                     NULL);

  connection = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, NULL);
  if (connection)
    {
      g_dbus_connection_signal_subscribe (connection,
                                          "org.freedesktop.systemd1",
                                          "org.freedesktop.systemd1.Manager",
                                          "UnitFilesChanged",
                                          "/org/freedesktop/systemd1",
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_unit_files_changed_signal, services, NULL);
      g_dbus_connection_signal_subscribe (connection,
                                          "org.freedesktop.systemd1",
                                          "org.freedesktop.DBus.Properties",
                                          "PropertiesChanged",
                                          NULL,
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_systemd_properties_changed, services, NULL);
      g_dbus_connection_signal_subscribe (connection,
                                          "org.freedesktop.systemd1",
                                          "org.freedesktop.systemd1.Manager",
                                          "UnitNew",
                                          "/org/freedesktop/systemd1",
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_unit_new_signal, services, NULL);
      g_dbus_connection_signal_subscribe (connection,
                                          "org.freedesktop.systemd1",
                                          "org.freedesktop.systemd1.Manager",
                                          "UnitRemoved",
                                          "/org/freedesktop/systemd1",
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_unit_removed_signal, services, NULL);
    }

  if (services->systemd)
    g_dbus_proxy_call (services->systemd,
                       "Subscribe",
                       NULL,
                       G_DBUS_CALL_FLAGS_NONE,
                       G_MAXINT,
                       NULL,
                       on_subscribe_done,
                       NULL);

  services->delayed_unit_news = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, free_delayed_unit_new);

  if (G_OBJECT_CLASS (services_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (services_parent_class)->constructed (_object);
}

static void
services_class_init (ServicesClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = services_finalize;
  gobject_class->constructed  = services_constructed;
  gobject_class->set_property = services_set_property;
  gobject_class->get_property = services_get_property;

  /**
   * Services:daemon:
   *
   * The #Daemon to use.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_DAEMON,
                                   g_param_spec_object ("daemon",
                                                        "Daemon",
                                                        "The Daemon to use",
                                                        TYPE_DAEMON,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * services_new:
 * @daemon: A #Daemon.
 *
 * Create a new #Services instance.
 *
 * Returns: A #Services object. Free with g_object_unref().
 */
CockpitServices *
services_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_SERVICES (g_object_new (TYPE_SERVICES,
                                         "daemon", daemon,
                                         NULL));
}

Daemon *
services_get_daemon (Services *services)
{
  g_return_val_if_fail (IS_SERVICES (services), NULL);
  return services->daemon;
}

static void
end_invocation_take_gerror (GDBusMethodInvocation *invocation,
                            GError *error)
{
  gchar *remote_error = g_dbus_error_get_remote_error (error);
  if (remote_error)
    {
      g_dbus_error_strip_remote_error (error);
      if (strcmp (remote_error, "org.freedesktop.DBus.Error.AccessDenied") == 0)
        {
          g_dbus_method_invocation_return_error (invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "You are not authorized for this operation.");
        }
      else
        {
          g_dbus_method_invocation_return_error (invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s (%s)", error->message, remote_error);
        }
      g_free (remote_error);
      g_error_free (error);
    }
  else
    g_dbus_method_invocation_take_error (invocation, error);
}

/* LIST SERVICES */

typedef struct {
  GDBusMethodInvocation *invocation;
  Services *services;

  GVariant *units;
  GVariant *files;

  GHashTable *result;
} ListServicesData;

typedef struct {
  const gchar *name;
  const gchar *description;
  const gchar *load_state;
  const gchar *active_state;
  const gchar *sub_state;
  const gchar *file_state;
  gboolean needs_free;
} ListedService;

static ListedService *
listed_service_new (void)
{
  return g_slice_new0 (ListedService);
}

static void
listed_service_free (gpointer p)
{
  ListedService *s = p;
  if (s->needs_free)
    {
      g_free ((gchar *)s->name);
      g_free ((gchar *)s->description);
    }
  g_slice_free (ListedService, s);
}

static void on_list_units_done (GObject *object, GAsyncResult *res, gpointer user_data);
static void on_list_files_done (GObject *object, GAsyncResult *res, gpointer user_data);

static gboolean
handle_list_services (CockpitServices *object,
                      GDBusMethodInvocation *invocation)
{
  Services *services = SERVICES (object);

  if (services->systemd == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "systemd not running");
      return TRUE;
    }

  ListServicesData *data = g_new0(ListServicesData, 1);
  data->services = services;
  data->invocation = invocation;

  g_dbus_proxy_call (services->systemd,
                     "ListUnits",
                     NULL,
                     G_DBUS_CALL_FLAGS_NONE,
                     G_MAXINT,
                     NULL,
                     on_list_units_done,
                     data);
  return TRUE;
}

static void
on_list_units_done (GObject *object,
                    GAsyncResult *res,
                    gpointer user_data)
{
  ListServicesData *data = user_data;
  GError *error = NULL;

  data->units = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      end_invocation_take_gerror (data->invocation, error);
      g_free (data);
      return;
    }

  g_dbus_proxy_call (data->services->systemd,
                     "ListUnitFiles",
                     NULL,
                     G_DBUS_CALL_FLAGS_NONE,
                     G_MAXINT,
                     NULL,
                     on_list_files_done,
                     data);
}

static void
add_listed_service_to_builder (gpointer key,
                               gpointer value,
                               gpointer user_data)
{
  GVariantBuilder *bob = user_data;
  ListedService *s = value;
  g_variant_builder_add (bob, "(ssssss)",
                         s->name, s->description, s->load_state, s->active_state, s->sub_state, s->file_state);
}

static gchar *
get_service_description (const gchar *file)
{
  GError *error = NULL;
  GKeyFile *kf = g_key_file_new ();
  g_key_file_load_from_file (kf, file, 0, &error);
  if (error)
    goto out;

  gchar *description = g_key_file_get_string (kf, "Unit", "Description", &error);
  if (error)
    goto out;

  g_key_file_free (kf);
  return description;

out:
  if (g_error_matches (error, G_KEY_FILE_ERROR, G_KEY_FILE_ERROR_GROUP_NOT_FOUND))
    g_warning ("Failed to load '%s': %s", file, error->message);
  g_error_free (error);
  g_key_file_free (kf);
  return g_strdup ("Unknown");
}

static void
on_list_files_done (GObject *object,
                    GAsyncResult *res,
                    gpointer user_data)
{
  ListServicesData *data = user_data;
  GError *error = NULL;

  data->files = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      end_invocation_take_gerror (data->invocation, error);
      g_variant_unref (data->units);
      g_free (data);
      return;
    }

  data->result = g_hash_table_new_full (g_str_hash, g_str_equal, NULL, listed_service_free);

  gs_free_variant_iter GVariantIter *unit_iter = NULL;
  const gchar *name, *description, *load_state, *active_state, *sub_state, *file_state;

  g_variant_get (data->units, "(a*)", &unit_iter);
  while (g_variant_iter_next (unit_iter, "(&s&s&s&s&s&s&ou&s&o)",
                              &name,
                              &description,
                              &load_state,
                              &active_state,
                              &sub_state,
                              NULL,   // follow unit
                              NULL,   // object path
                              NULL,   // job id
                              NULL,   // job type
                              NULL))  // job object path
    {
      if (!g_hash_table_lookup (data->result, name))
        {
          ListedService *s = listed_service_new ();
          s->name = name;
          s->description = description;
          s->load_state = load_state;
          s->active_state = active_state;
          s->sub_state = sub_state;
          s->file_state = "";
          g_hash_table_insert (data->result, (void *)name, s);
        }
    }

  gs_free_variant_iter GVariantIter *file_iter = NULL;

  g_variant_get (data->files, "(a*)", &file_iter);
  while (g_variant_iter_next (file_iter, "(&s&s)", &name, &file_state))
    {
      gchar *base = g_path_get_basename (name);
      ListedService *s = g_hash_table_lookup (data->result, base);
      if (s)
        s->file_state = file_state;
      else
        {
          ListedService *s = listed_service_new ();
          s->name = base;
          s->description = get_service_description (name);
          s->load_state = "";
          s->active_state = "";
          s->sub_state = "";
          s->file_state = file_state;
          s->needs_free = TRUE;
          g_hash_table_insert (data->result, (void *)base, s);
        }
    }

  GVariantBuilder bob;
  g_variant_builder_init (&bob, G_VARIANT_TYPE("a(ssssss)"));
  g_hash_table_foreach (data->result, add_listed_service_to_builder, &bob);

  cockpit_services_complete_list_services (COCKPIT_SERVICES (data->services), data->invocation,
                                           g_variant_builder_end (&bob));

  g_variant_unref (data->units);
  g_variant_unref (data->files);
  g_hash_table_destroy (data->result);
  g_free (data);
}

/* GET SERVICE INFO */

typedef struct {
  Services *services;
  GDBusMethodInvocation *invocation;

  gchar *name;
} GetServiceInfoData;

static void on_load_unit_done (GObject *object, GAsyncResult *res, gpointer user_data);
static void on_get_all_done_for_info (GObject *object, GAsyncResult *res, gpointer user_data);
static void on_get_unit_file_state_done (GObject *object, GAsyncResult *res, gpointer user_data);

static gboolean
handle_get_service_info (CockpitServices *object,
                         GDBusMethodInvocation *invocation,
                         const gchar *arg_name)
{
  Services *services = SERVICES (object);

  if (services->systemd == NULL)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "systemd not running");
      return TRUE;
    }

  GetServiceInfoData *data = g_new0(GetServiceInfoData, 1);
  data->services = services;
  data->invocation = invocation;

  gchar *t = strchr ((gchar *)arg_name, '@');
  gchar *s = strrchr ((gchar *)arg_name, '.');

  if (t > 0 && t + 1 == s)
    {
      // A template
      data->name = g_strdup (arg_name);
      g_dbus_proxy_call (services->systemd,
                         "GetUnitFileState",
                         g_variant_new ("(s)", arg_name),
                         G_DBUS_CALL_FLAGS_NONE,
                         G_MAXINT,
                         NULL,
                         on_get_unit_file_state_done,
                         data);
    }
  else
    g_dbus_proxy_call (services->systemd,
                       "LoadUnit",
                       g_variant_new ("(s)", arg_name),
                       G_DBUS_CALL_FLAGS_NONE,
                       G_MAXINT,
                       NULL,
                       on_load_unit_done,
                       data);
  return TRUE;
}

static void
on_load_unit_done (GObject *object,
                   GAsyncResult *res,
                   gpointer user_data)
{
  GetServiceInfoData *data = user_data;
  GError *error = NULL;

  gs_unref_variant GVariant *result = g_dbus_proxy_call_finish (G_DBUS_PROXY(object), res, &error);
  if (error)
    {
      end_invocation_take_gerror (data->invocation, error);
      g_free (data);
      return;
    }

  const gchar *path;
  g_variant_get (result, "(&o)", &path);
  if (path)
    {
      GDBusConnection *conn = g_dbus_proxy_get_connection (data->services->systemd);
      g_dbus_connection_call (conn,
                              "org.freedesktop.systemd1",
                              path,
                              "org.freedesktop.DBus.Properties",
                              "GetAll",
                              g_variant_new ("(s)", ""),
                              G_VARIANT_TYPE ("(a{sv})"),
                              0,
                              -1,
                              NULL,
                              on_get_all_done_for_info,
                              data);
    }
  else
    {
      g_dbus_method_invocation_return_error (data->invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "Heh.");
      g_free (data);
    }
}

static void
copy_entry (GVariantBuilder *dest,
            GVariant *src,
            const gchar *key)
{
  gs_unref_variant GVariant *val = g_variant_lookup_value (src, key, NULL);
  if (val)
    g_variant_builder_add (dest, "{sv}", key, val);
}

static void
on_get_all_done_for_info (GObject *object,
                          GAsyncResult *res,
                          gpointer user_data)
{
  GetServiceInfoData *data = user_data;
  GError *error = NULL;
  gs_unref_variant GVariant *reply = g_dbus_connection_call_finish (G_DBUS_CONNECTION (object), res, &error);

  if (error)
    {
      end_invocation_take_gerror (data->invocation, error);
      g_free (data);
      return;
    }

  gs_unref_variant GVariant *props;
  g_variant_get (reply, "(@a{sv})", &props);

  GVariantBuilder bob;
  g_variant_builder_init (&bob, G_VARIANT_TYPE("a{sv}"));

  copy_entry (&bob, props, "Id");
  copy_entry (&bob, props, "Description");
  copy_entry (&bob, props, "LoadState");
  copy_entry (&bob, props, "ActiveState");
  copy_entry (&bob, props, "SubState");
  copy_entry (&bob, props, "UnitFileState");
  copy_entry (&bob, props, "ExecMainStartTimestamp");
  copy_entry (&bob, props, "ExecMainExitTimestamp");
  copy_entry (&bob, props, "ActiveEnterTimestamp");
  copy_entry (&bob, props, "ActiveExitTimestamp");
  copy_entry (&bob, props, "InactiveEnterTimestamp");
  copy_entry (&bob, props, "InactiveExitTimestamp");
  copy_entry (&bob, props, "ConditionTimestamp");
  copy_entry (&bob, props, "SourcePath");
  copy_entry (&bob, props, "FragmentPath");
  copy_entry (&bob, props, "LoadError");
  copy_entry (&bob, props, "ConditionResult");
  copy_entry (&bob, props, "StatusText");
  copy_entry (&bob, props, "DefaultControlGroup");

  const gchar *id = NULL, *cgroup = NULL;
  uint32_t main_pid = 0, exec_main_pid = 0, control_pid = 0;

  g_variant_lookup (props, "Id", "&s", &id);
  g_variant_lookup (props, "DefaultControlGroup", "&s", &cgroup);
  g_variant_lookup (props, "ExecMainPid", "u", &exec_main_pid);
  g_variant_lookup (props, "MainPid", "u", &main_pid);
  g_variant_lookup (props, "ControlPid", "u", &control_pid);

  if (cgroup)
    {
      pid_t extra_pids[3];
      int n_extra_pids = 0;
      if (main_pid > 0)
        extra_pids[n_extra_pids++] = main_pid;
      if (exec_main_pid > 0)
        extra_pids[n_extra_pids++] = exec_main_pid;
      if (control_pid > 0)
        extra_pids[n_extra_pids++] = control_pid;

      GVariant *c = collect_cgroup_and_extra_by_spec (cgroup, FALSE, TRUE, extra_pids, n_extra_pids);
      if (c)
        g_variant_builder_add (&bob, "{sv}", "Processes", c);
    }

  cockpit_services_complete_get_service_info (COCKPIT_SERVICES (data->services), data->invocation,
                                              g_variant_builder_end (&bob));
  g_free (data);
}

static void
on_get_unit_file_state_done (GObject *object,
                             GAsyncResult *res,
                             gpointer user_data)
{
  GetServiceInfoData *data = user_data;
  GError *error = NULL;

  gs_unref_variant GVariant *result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      end_invocation_take_gerror (data->invocation, error);
      g_free (data);
      return;
    }

  const gchar *state;
  g_variant_get (result, "(&s)", &state);

  GVariantBuilder bob;
  g_variant_builder_init (&bob, G_VARIANT_TYPE("a{sv}"));

  g_variant_builder_add (&bob, "{sv}", "Id", g_variant_new_string (data->name));
  g_variant_builder_add (&bob, "{sv}", "IsTemplate", g_variant_new_boolean (TRUE));
  g_variant_builder_add (&bob, "{sv}", "UnitFileState", g_variant_new_string (state));

  cockpit_services_complete_get_service_info (COCKPIT_SERVICES (data->services), data->invocation,
                                              g_variant_builder_end (&bob));
  g_free (data->name);
  g_free (data);
}

/* SERVICE ACTION */

static gboolean
handle_service_action (CockpitServices *object,
                       GDBusMethodInvocation *invocation,
                       const gchar *arg_name,
                       const gchar *arg_action)
{
  GError *error;
  Services *services = SERVICES (object);
  const gchar *argv[6];
  int i;
  gint status;

  const gchar *method = arg_action;
  gboolean force = FALSE;

  if (g_str_has_prefix (arg_action, "force-"))
    {
      force = TRUE;
      method = arg_action + strlen ("force-");
    }

  i = 0;
  argv[i++] = "pkexec";
  argv[i++] = "systemctl";
  if (force)
    argv[i++] = "--force";
  argv[i++] = method;
  argv[i++] = arg_name;
  argv[i++] = NULL;

  error = NULL;
  if (g_spawn_sync (NULL, (gchar**)argv, NULL, G_SPAWN_SEARCH_PATH, NULL, NULL, NULL, NULL, &status, &error))
    g_spawn_check_exit_status (status, &error);

  if (error)
    end_invocation_take_gerror (invocation, error);
  else
    cockpit_services_complete_service_action (COCKPIT_SERVICES (services), invocation);

  return TRUE;
}

/* INTERFACE */

static void
services_iface_init (CockpitServicesIface *iface)
{
  iface->handle_list_services = handle_list_services;
  iface->handle_get_service_info = handle_get_service_info;
  iface->handle_service_action = handle_service_action;
}
