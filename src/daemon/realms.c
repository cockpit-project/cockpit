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

#include <gsystem-local-alloc.h>

#include "utils.h"
#include "daemon.h"
#include "auth.h"
#include "realms.h"

typedef struct _RealmData
{
  Realms *owner;
  gboolean valid;

  gchar *name;
  gboolean configured;
  GVariant *details;

  GDBusProxy *realmd_object;
} RealmData;

static void
realm_data_free (int n,
                 RealmData *data)
{
  int i;
  for (i = 0; i < n; i++)
    {
      g_free (data[i].name);
      g_variant_unref (data[i].details);
      g_object_unref (data[i].realmd_object);
    }
  g_free (data);
}

/**
 * @title: Realms
 */

typedef struct _RealmsClass RealmsClass;

/**
 * Realms:
 *
 * The #Realms structure contains only private data and
 * should only be accessed using the provided API.
 */

struct _Realms
{
  CockpitRealmsSkeleton parent_instance;
  Daemon *daemon;
  GDBusProxy *realmd;

  int n_realms, n_ready;
  gboolean need_realm_update;
  RealmData *data;

  guint next_op_id;

  GDBusMethodInvocation *op_invocation;
  const gchar *op;
  gchar *op_name;
  GVariant *op_creds;
  GVariant *op_options;
  gchar *op_id;
  gboolean op_cancelled;

  GString *diagnostics;
};

struct _RealmsClass
{
  CockpitRealmsSkeletonClass parent_class;
};

enum {
  PROP_0,
  PROP_DAEMON,
};

static void realms_iface_init (CockpitRealmsIface *iface);

G_DEFINE_TYPE_WITH_CODE (Realms, realms, COCKPIT_TYPE_REALMS_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_REALMS, realms_iface_init));

static void
realms_finalize (GObject *object)
{
  Realms *realms = REALMS (object);

  if (realms->realmd)
    g_object_unref (realms->realmd);

  realm_data_free (realms->n_realms, realms->data);

  g_string_free (realms->diagnostics, TRUE);

  if (G_OBJECT_CLASS (realms_parent_class)->finalize != NULL)
    G_OBJECT_CLASS (realms_parent_class)->finalize (object);
}

static void
realms_get_property (GObject *object,
                     guint prop_id,
                     GValue *value,
                     GParamSpec *pspec)
{
  Realms *realms = REALMS (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, realms_get_daemon (realms));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
realms_set_property (GObject *object,
                     guint prop_id,
                     const GValue *value,
                     GParamSpec *pspec)
{
  Realms *realms = REALMS (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (realms->daemon == NULL);
      realms->daemon = g_value_dup_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
realms_init (Realms *realms)
{
  realms->diagnostics = g_string_new ("");
}

static gboolean
set_invocation (Realms *realms,
                GDBusMethodInvocation *invocation,
                const gchar *op,
                const gchar *name,
                GVariant *creds,
                GVariant *options)
{
  if (realms->op_invocation == NULL)
    {
      realms->op_invocation = invocation;
      realms->op = op;
      realms->op_name = g_strdup (name);
      realms->op_creds = g_variant_ref (creds);
      realms->op_options = g_variant_ref (options);
      realms->op_id = g_strdup_printf ("cockpitd-%u", realms->next_op_id++);
      realms->op_cancelled = FALSE;
      cockpit_realms_set_busy (COCKPIT_REALMS (realms),
                               g_variant_new ("(ss)", op, name));
      g_string_assign (realms->diagnostics, "");
      return TRUE;
    }
  else
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Busy");
      return FALSE;
    }
}

static void
clear_invocation (Realms *realms)
{
  if (realms->op_invocation)
    {
      g_free (realms->op_name);
      g_free (realms->op_id);
      realms->op_id = NULL;
      g_variant_unref (realms->op_creds);
      g_variant_unref (realms->op_options);
      realms->op_invocation = NULL;
    }

  cockpit_realms_set_busy (COCKPIT_REALMS (realms),
                           g_variant_new ("(ss)", "", ""));
}

static void
end_invocation_with_error (Realms *realms,
                           int code,
                           const gchar *msg,
                           ...)
{
  va_list ap;
  va_start (ap, msg);
  g_dbus_method_invocation_return_error_valist (realms->op_invocation,
                                                COCKPIT_ERROR,
                                                code, msg, ap);
  va_end (ap);
  clear_invocation (realms);
}

static void
end_invocation_take_gerror (Realms *realms,
                            GError *error)
{
  gchar *remote_error = g_dbus_error_get_remote_error (error);
  if (remote_error)
    {
      if (strcmp (remote_error, "org.freedesktop.realmd.Error.AuthenticationFailed") == 0
          || strcmp (remote_error, "org.freedesktop.DBus.Error.NotSupported") == 0)
        {
          g_dbus_method_invocation_return_error (realms->op_invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                                 "Authentication failed");
        }
      else if (strcmp (remote_error, "org.freedesktop.realmd.Error.Cancelled") == 0)
        {
          g_dbus_method_invocation_return_error (realms->op_invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_CANCELLED,
                                                 "Operation was cancelled");
        }
      else
        {
          g_dbus_error_strip_remote_error (error);
          g_dbus_method_invocation_return_error (realms->op_invocation,
                                                 COCKPIT_ERROR,
                                                 COCKPIT_ERROR_FAILED,
                                                 "%s (%s)", error->message, remote_error);
        }
      g_free (remote_error);
      g_error_free (error);
    }
  else
    g_dbus_method_invocation_take_error (realms->op_invocation, error);
  clear_invocation (realms);
}

/* VARIANT UTILTIES
 */

static const gchar *
variant_lookup (GVariant *dictionary,
                const gchar *key)
{
  const gchar *v;

  if (dictionary == NULL
      || !g_variant_lookup (dictionary, key, "&s", &v)
      || v[0] == '\0')
    return NULL;

  return v;
}

static const gchar *
variant_ass_lookup (GVariant *dictionary,
                    const gchar *key)
{
  GVariantIter iter;
  const gchar *k;
  const gchar *v;

  if (dictionary == NULL)
    return NULL;

  g_variant_iter_init (&iter, dictionary);
  while (g_variant_iter_next (&iter, "(&s&s)", &k, &v))
    {
      if (strcmp (k, key) == 0)
        return v;
    }
  return NULL;
}

static void
copy_option (GVariantBuilder *dest,
             GVariant *source,
             const gchar *key)
{
  const gchar *val = variant_lookup (source, key);
  if (val)
    g_variant_builder_add (dest, "{sv}", key, g_variant_new_string (val));
}

static void
copy_ass_option (GVariantBuilder *dest,
                 GVariant *source,
                 const gchar *key)
{
  const gchar *val = variant_ass_lookup (source, key);
  if (val)
    g_variant_builder_add (dest, "{sv}", key, g_variant_new_string (val));
}

/* REALMD UTILITIES
 */

static GVariant *
translate_kerberos_credential_types (GVariant *creds)
{
  GVariantBuilder bob;
  g_variant_builder_init (&bob, G_VARIANT_TYPE_STRING_ARRAY);

  int i;
  for (i = 0; i < g_variant_n_children (creds); i++)
    {
      const gchar *type;
      const gchar *owner;

      g_variant_get_child (creds, i, "(&s&s)", &type, &owner);

      if (strcmp (type, "password") == 0)
        {
          if (strcmp (owner, "user") == 0)
            g_variant_builder_add (&bob, "s", "user");
          else if (strcmp (owner, "administrator") == 0)
            g_variant_builder_add (&bob, "s", "admin");
        }
      else if (strcmp (type, "secret") == 0)
        {
          g_variant_builder_add (&bob, "s", "otp");
        }
      else if (strcmp (type, "automatic") == 0)
        {
          // XXX - check whether we have the required credentials
          //       before offereing this option
          g_variant_builder_add (&bob, "s", "none");
        }
    }

  return g_variant_builder_end (&bob);
}

static GVariant *
translate_kerberos_credentials (GVariant *creds)
{
  gchar *type;
  gchar *arg1;
  gchar *arg2;

  g_variant_get (creds, "(&s&s&s)", &type, &arg1, &arg2);
  if (strcmp (type, "user") == 0)
    {
      return g_variant_new ("(ssv)",
                            "password", "user", g_variant_new ("(ss)", arg1, arg2));
    }
  else if (strcmp (type, "admin") == 0)
    {
      return g_variant_new ("(ssv)",
                            "password", "administrator", g_variant_new ("(ss)", arg1, arg2));
    }
  else if (strcmp (type, "otp") == 0)
    {
      return g_variant_new ("(ssv)",
                            "secret", "none", g_variant_new_bytestring (arg1));
    }
  else if (strcmp (type, "none") == 0)
    {
      return g_variant_new ("(ssv)",
                            "automatic", "none", g_variant_new ("s", ""));
    }
  else
    return NULL;
}

static GVariant *
get_realm_details (GDBusProxy *realm,
                   GDBusProxy *kerberos)
{
  GVariantBuilder details;
  g_variant_builder_init (&details, G_VARIANT_TYPE("a{sv}"));

  if (realm)
    {
      gs_unref_variant GVariant *d = g_dbus_proxy_get_cached_property (realm, "Details");
      copy_ass_option (&details, d, "server-software");
      copy_ass_option (&details, d, "client-software");
    }

  if (kerberos)
    {
      gs_unref_variant GVariant *j = g_dbus_proxy_get_cached_property (kerberos, "SupportedJoinCredentials");
      if (j)
        g_variant_builder_add (&details, "{sv}", "supported-join-credentials",
                               translate_kerberos_credential_types (j));

      gs_unref_variant GVariant *l = g_dbus_proxy_get_cached_property (kerberos, "SupportedLeaveCredentials");
      if (l)
        g_variant_builder_add (&details, "{sv}", "supported-leave-credentials",
                               translate_kerberos_credential_types (l));

      gs_unref_variant GVariant *a = g_dbus_proxy_get_cached_property (kerberos, "SuggestedAdministrator");
      if (a)
        g_variant_builder_add (&details, "{sv}", "suggested-administrator", a);
    }

  return g_variant_builder_end (&details);
}

/* THE 'JOINED' PROPERTY
 */

/* Set he "Joined" property to its correct value, according to what is
   currently in REALMS->DATA.
*/
static void
set_joined_prop (Realms *realms)
{
  int i;

  RealmData *data = realms->data;

  GVariantBuilder joined;
  g_variant_builder_init (&joined, G_VARIANT_TYPE("a(sa{sv})"));
  for (i = 0; i < realms->n_realms; i++)
    if (data[i].valid && data[i].configured)
      g_variant_builder_add (&joined, "(s@a{sv})", data[i].name, data[i].details);

  cockpit_realms_set_joined (COCKPIT_REALMS (realms), g_variant_builder_end (&joined));
}

static void
update_realm_configured (RealmData *data)
{
  gs_unref_variant GVariant *c = g_dbus_proxy_get_cached_property (data->realmd_object, "Configured");
  if (c && g_variant_is_of_type (c, G_VARIANT_TYPE ("s")))
    {
      const gchar *configured = "";
      g_variant_get (c, "&s", &configured);
      data->configured = (configured && *configured);
      if (data->valid)
        set_joined_prop (data->owner);
    }
}

static void
on_realm_properties_changed (GDBusProxy *proxy,
                             GVariant *changed_properties,
                             const gchar * const *invalidated_properties,
                             gpointer user_data)
{
  RealmData *data = user_data;
  if (g_variant_lookup (changed_properties, "Configured", "&s", NULL))
    update_realm_configured (data);
}

static void update_realms (Realms *realms);

static void
mark_realm_ready (RealmData *data)
{
  Realms *realms = data->owner;
  realms->n_ready += 1;
  if (realms->n_ready == realms->n_realms)
    {
      if (realms->need_realm_update)
        {
          realms->need_realm_update = FALSE;
          update_realms (realms);
        }
      else
        set_joined_prop (realms);
    }
}

static void
on_kerberos_proxy_ready (GObject *object,
                         GAsyncResult *res,
                         gpointer user_data)
{
  RealmData *data = (RealmData *)user_data;

  GError *error = NULL;
  GDBusProxy *proxy = g_dbus_proxy_new_for_bus_finish (res, &error);

  if (error)
    {
      g_warning ("Unable to create realmd KerberosMembership proxy: %s", error->message);
      g_error_free (error);
    }

  data->details = get_realm_details (data->realmd_object, proxy);
  g_variant_ref (data->details);
  g_clear_object (&proxy);

  update_realm_configured (data);

  data->valid = TRUE;
  mark_realm_ready (data);
}

static void
on_realm_proxy_ready (GObject *object,
                      GAsyncResult *res,
                      gpointer user_data)
{
  RealmData *data = (RealmData *)user_data;

  GError *error = NULL;
  GDBusProxy *proxy = g_dbus_proxy_new_for_bus_finish (res, &error);

  if (error)
    {
      g_warning ("Unable to create realmd proxy: %s", error->message);
      g_error_free (error);
      mark_realm_ready (data);
      return;
    }

  g_signal_connect (proxy,
                    "g-properties-changed",
                    G_CALLBACK (on_realm_properties_changed),
                    data);

  data->realmd_object = proxy;

  gs_unref_variant GVariant *n = g_dbus_proxy_get_cached_property (proxy, "Name");

  if (n && g_variant_is_of_type (n, G_VARIANT_TYPE ("s")))
    {
      g_variant_get (n, "s", &data->name);

      g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                                0,
                                NULL,
                                "org.freedesktop.realmd",
                                g_dbus_proxy_get_object_path (data->realmd_object),
                                "org.freedesktop.realmd.KerberosMembership",
                                NULL,
                                on_kerberos_proxy_ready,
                                data);
    }
  else
    mark_realm_ready (data);
}

/* Reconstruct all data about known realms when the global "Realms"
   property changes.
 */
static void
update_realms (Realms *realms)
{
  if (realms->n_ready != realms->n_realms)
    {
      realms->need_realm_update = TRUE;
      return;
    }

  gs_unref_variant GVariant *r = g_dbus_proxy_get_cached_property (realms->realmd, "Realms");

  if (r && g_variant_is_of_type (r, G_VARIANT_TYPE("ao")))
    {
      realm_data_free (realms->n_realms, realms->data);

      realms->n_realms = g_variant_n_children (r);
      realms->n_ready = 0;
      realms->data = g_new0 (RealmData, realms->n_realms);

      int i;
      for (i = 0; i < realms->n_realms; i++)
        {
          RealmData *data = realms->data + i;
          data->owner = realms;

          const gchar *path;
          g_variant_get_child (r, i, "&o", &path);

          g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                                    0,
                                    NULL,
                                    "org.freedesktop.realmd",
                                    path,
                                    "org.freedesktop.realmd.Realm",
                                    NULL,
                                    on_realm_proxy_ready,
                                    data);
        }
    }
}

static void
on_properties_changed (GDBusProxy *proxy,
                       GVariant *changed_properties,
                       const gchar * const *invalidated_properties,
                       gpointer user_data)
{
  Realms *realms = REALMS (user_data);
  update_realms (realms);
}

static void
on_diagnostics_signal (GDBusConnection *connection,
                       const gchar *sender_name,
                       const gchar *object_path,
                       const gchar *interface_name,
                       const gchar *signal_name,
                       GVariant *parameters,
                       gpointer user_data)
{
  Realms *realms = REALMS (user_data);

  const gchar *operation_id;
  const gchar *text;

  g_variant_get (parameters, "(&s&s)", &text, &operation_id);
  if (realms->op_id && strcmp (operation_id, realms->op_id) == 0)
    {
      g_string_append (realms->diagnostics, text);
      g_string_append (realms->diagnostics, "\n");
    }
}

static void
realms_constructed (GObject *_object)
{
  Realms *realms = REALMS (_object);
  GError *error = NULL;

  realms->realmd = g_dbus_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                 0,
                                 NULL,
                                 "org.freedesktop.realmd",
                                 "/org/freedesktop/realmd",
                                 "org.freedesktop.realmd.Provider",
                                 NULL,
                                 &error);

  if (error)
    {
      g_warning ("Unable to create realmd proxy: %s", error->message);
      g_error_free (error);
      return;
    }

  clear_invocation (realms);

  GDBusConnection *connection;

  connection = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, &error);
  if (error == NULL)
    {
      g_dbus_connection_signal_subscribe (connection,
                                          "org.freedesktop.realmd",
                                          "org.freedesktop.realmd.Service",
                                          "Diagnostics",
                                          "/org/freedesktop/realmd",
                                          NULL, G_DBUS_SIGNAL_FLAGS_NONE,
                                          on_diagnostics_signal, realms, NULL);
    }
  else
    {
      g_warning ("Unable to subscribe to realmd diagnostics: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
      g_error_free (error);
    }

  if (G_OBJECT_CLASS (realms_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (realms_parent_class)->constructed (_object);

  g_signal_connect (realms->realmd,
                    "g-properties-changed",
                    G_CALLBACK (on_properties_changed),
                    realms);

  update_realms (realms);
}

static void
realms_class_init (RealmsClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = realms_finalize;
  gobject_class->constructed  = realms_constructed;
  gobject_class->set_property = realms_set_property;
  gobject_class->get_property = realms_get_property;

  /**
   * Realms:daemon:
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
 * realms_new:
 * @daemon: A #Daemon.
 *
 * Create a new #Realms instance.
 *
 * Returns: A #Realms object. Free with g_object_unref().
 */
CockpitRealms *
realms_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_REALMS (g_object_new (TYPE_REALMS,
                                       "daemon", daemon,
                                       NULL));
}

Daemon *
realms_get_daemon (Realms *realms)
{
  g_return_val_if_fail (IS_REALMS (realms), NULL);
  return realms->daemon;
}

/* JOINING AND LEAVING

   For super extra robustness, we don't rely on our accumulated state
   when performing a "Join" or "Leave" operation.  Instead, we
   retrieve all information from scratch from realmd.
*/

static gboolean handle_op (CockpitRealms *object, GDBusMethodInvocation *invocation, const gchar *op,
                           const gchar *arg_name, GVariant *arg_creds, GVariant *arg_options);
static void on_discover_for_op_done (GObject *object, GAsyncResult *res, gpointer user_data);
static void on_op_done (GObject *object, GAsyncResult *res, gpointer user_data);

static gboolean
handle_join (CockpitRealms *object,
             GDBusMethodInvocation *invocation,
             const gchar *arg_name,
             GVariant *arg_creds,
             GVariant *arg_options)
{
  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_REALM_ADMIN))
    return TRUE;

  return handle_op (object, invocation, "Join", arg_name, arg_creds, arg_options);
}

static gboolean
handle_leave (CockpitRealms *object,
              GDBusMethodInvocation *invocation,
              const gchar *arg_name,
              GVariant *arg_creds,
              GVariant *arg_options)
{
  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_REALM_ADMIN))
    return TRUE;

  return handle_op (object, invocation, "Leave", arg_name, arg_creds, arg_options);
}

static gboolean
handle_op (CockpitRealms *object,
           GDBusMethodInvocation *invocation,
           const gchar *op,
           const gchar *arg_name,
           GVariant *arg_creds,
           GVariant *arg_options)
{
  Realms *realms = REALMS (object);

  if (!set_invocation (realms, invocation, op, arg_name, arg_creds, arg_options))
    return TRUE;

  GVariantBuilder discover_options;
  g_variant_builder_init (&discover_options, G_VARIANT_TYPE ("a{sv}"));

  copy_option (&discover_options, arg_options, "client-software");
  copy_option (&discover_options, arg_options, "server-software");
  g_variant_builder_add (&discover_options, "{sv}",
                         "operation", g_variant_new_string (realms->op_id));

  g_dbus_proxy_call (realms->realmd,
                     "Discover",
                     g_variant_new ("(sa{sv})", arg_name, &discover_options),
                     G_DBUS_CALL_FLAGS_NONE,
                     G_MAXINT,
                     NULL,
                     on_discover_for_op_done,
                     realms);

  return TRUE;
}

static void
on_discover_for_op_done (GObject *object,
                         GAsyncResult *res,
                         gpointer user_data)
{
  Realms *realms = REALMS (user_data);

  if (realms->op_cancelled)
    {
      end_invocation_with_error (realms, COCKPIT_ERROR_CANCELLED,
                                 "Cancelled");
      return;
    }

  GError *error = NULL;
  gs_unref_variant GVariant *discover_result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      end_invocation_take_gerror (realms, error);
      return;
    }

  gs_free_variant_iter GVariantIter *object_paths = NULL;
  g_variant_get (discover_result, "(iao)", NULL, &object_paths);

  const gchar *first_object = NULL;
  if (!g_variant_iter_next (object_paths, "&o", &first_object))
    {
      end_invocation_with_error (realms, COCKPIT_ERROR_NO_SUCH_REALM,
                                 "No such realm: %s", realms->op_name);
      return;
    }

  gs_unref_object GDBusProxy *kerberos =
    g_dbus_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                   (G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES
                                    | G_DBUS_PROXY_FLAGS_DO_NOT_CONNECT_SIGNALS),
                                   NULL,
                                   "org.freedesktop.realmd",
                                   first_object,
                                   "org.freedesktop.realmd.KerberosMembership",
                                   NULL,
                                   &error);
  if (error)
    {
      end_invocation_take_gerror (realms, error);
      return;
    }

  GVariant *creds = translate_kerberos_credentials (realms->op_creds);

  GVariantBuilder options;
  g_variant_builder_init (&options, G_VARIANT_TYPE ("a{sv}"));

  copy_option (&options, realms->op_options, "computer-ou");
  g_variant_builder_add (&options, "{sv}",
                         "operation", g_variant_new_string (realms->op_id));

  g_dbus_proxy_call (kerberos,
                     realms->op,
                     g_variant_new ("(@(ssv)a{sv})", creds, &options),
                     G_DBUS_CALL_FLAGS_NONE,
                     G_MAXINT,
                     NULL,
                     on_op_done,
                     realms);
}

static void
on_op_done (GObject *object,
            GAsyncResult *res,
            gpointer user_data)
{
  Realms *realms = REALMS (user_data);

  GError *error = NULL;
  GVariant *join_result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);

  if (error)
    end_invocation_take_gerror (realms, error);
  else
    {
      if (strcmp (realms->op, "Join") == 0)
        cockpit_realms_complete_join (COCKPIT_REALMS (realms), realms->op_invocation);
      else
        cockpit_realms_complete_leave (COCKPIT_REALMS (realms), realms->op_invocation);
      clear_invocation (realms);
      g_variant_unref (join_result);
    }
}

/* DISCOVER */

struct DiscoverData {
  Realms *realms;
  GDBusMethodInvocation *invocation;

  GVariantIter *object_paths;
  GDBusProxy *cur_proxy;
  const gchar *cur_path;

  gchar *name;
  GVariantBuilder all_details;
};

static void get_next_discover_info (struct DiscoverData *data);

static void
on_discover_done (GObject *object,
                  GAsyncResult *res,
                  gpointer user_data)
{
  struct DiscoverData *data = (struct DiscoverData *)user_data;

  GError *error = NULL;
  gs_unref_variant GVariant *discover_result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_return_error (data->invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_free (data);
      g_error_free (error);
      return;
    }

  g_variant_builder_init (&(data->all_details), G_VARIANT_TYPE ("aa{sv}"));
  g_variant_get (discover_result, "(iao)", NULL, &(data->object_paths));

  data->cur_proxy = NULL;

  get_next_discover_info (data);
}

static void
on_kerberos_ready_for_discover_info (GObject *object,
                                     GAsyncResult *res,
                                     gpointer user_data)
{
  struct DiscoverData *data = (struct DiscoverData *)user_data;
  GError *error = NULL;

  GDBusProxy *kerberos = g_dbus_proxy_new_for_bus_finish (res, &error);
  if (kerberos)
    {
      gs_unref_variant GVariant *n = g_dbus_proxy_get_cached_property (data->cur_proxy, "Name");

      if (n == NULL)
        {
          get_next_discover_info (data);
          return;
        }

      if (data->name == NULL)
        data->name = g_variant_dup_string (n, NULL);
      else if (strcmp (data->name, g_variant_get_string (n, NULL)) != 0)
        {
          get_next_discover_info (data);
          return;
        }

      g_variant_builder_add (&(data->all_details), "@a{sv}", get_realm_details (data->cur_proxy, kerberos));
      get_next_discover_info (data);
    }
  if (error)
    {
      g_warning ("Failed to connect to realmd: %s", error->message);
      g_clear_error (&error);
    }
}

static void
on_proxy_ready_for_discover_info (GObject *object,
                                  GAsyncResult *res,
                                  gpointer user_data)
{
  struct DiscoverData *data = (struct DiscoverData *)user_data;

  data->cur_proxy = g_dbus_proxy_new_for_bus_finish (res, NULL);
  if (data->cur_proxy)
    {
      g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                                0,
                                NULL,
                                "org.freedesktop.realmd",
                                data->cur_path,
                                "org.freedesktop.realmd.KerberosMembership",
                                NULL,
                                on_kerberos_ready_for_discover_info,
                                data);
    }
  else
    get_next_discover_info (data);
}

static void
get_next_discover_info (struct DiscoverData *data)
{
  g_clear_object (&(data->cur_proxy));

  if (g_variant_iter_next (data->object_paths, "&o", &(data->cur_path)))
    {
      g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                                0,
                                NULL,
                                "org.freedesktop.realmd",
                                data->cur_path,
                                "org.freedesktop.realmd.Realm",
                                NULL,
                                on_proxy_ready_for_discover_info,
                                data);
    }
  else
    {
      cockpit_realms_complete_discover (COCKPIT_REALMS (data->realms), data->invocation,
                                        data->name? data->name : "", g_variant_builder_end (&(data->all_details)));
      g_variant_iter_free (data->object_paths);
      g_free (data);
    }
}

static gboolean
handle_discover (CockpitRealms *object,
                 GDBusMethodInvocation *invocation,
                 const gchar *arg_name,
                 GVariant *arg_options)
{
  Realms *realms = REALMS (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_REALM_ADMIN))
    return TRUE;

  GVariantBuilder discover_options;
  g_variant_builder_init (&discover_options, G_VARIANT_TYPE ("a{sv}"));

  copy_option (&discover_options, arg_options, "client-software");
  copy_option (&discover_options, arg_options, "server-software");

  struct DiscoverData *data = g_new0(struct DiscoverData, 1);
  data->realms = realms;
  data->invocation = invocation;

  g_dbus_proxy_call (realms->realmd,
                     "Discover",
                     g_variant_new ("(sa{sv})", arg_name, &discover_options),
                     G_DBUS_CALL_FLAGS_NONE,
                     G_MAXINT,
                     NULL,
                     on_discover_done,
                     data);

  return TRUE;
}

/* CANCEL */

static void
on_cancel_done (GObject *object,
                GAsyncResult *res,
                gpointer user_data)
{
  GError *error = NULL;

  GVariant *result = g_dbus_proxy_call_finish (G_DBUS_PROXY (object), res, &error);
  if (error)
    {
      g_warning ("Failed to cancel: %s", error->message);
      g_error_free (error);
    }
  else
    {
      g_variant_unref (result);
    }
}

static gboolean
handle_cancel (CockpitRealms *object,
               GDBusMethodInvocation *invocation)
{
  Realms *realms = REALMS (object);
  GError *error = NULL;

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_REALM_ADMIN))
    return TRUE;

  if (realms->op_invocation)
    {
      realms->op_cancelled = TRUE;
      gs_unref_object GDBusProxy *service =
        g_dbus_proxy_new_for_bus_sync (G_BUS_TYPE_SYSTEM,
                                       (G_DBUS_PROXY_FLAGS_DO_NOT_LOAD_PROPERTIES
                                        | G_DBUS_PROXY_FLAGS_DO_NOT_CONNECT_SIGNALS),
                                       NULL,
                                       "org.freedesktop.realmd",
                                       "/org/freedesktop/realmd",
                                       "org.freedesktop.realmd.Service",
                                       NULL,
                                       &error);
      if (error)
        {
          g_warning ("Failed to connect to realmd: %s", error->message);
          g_clear_error (&error);
        }

      if (service)
        g_dbus_proxy_call (service,
                           "Cancel",
                           g_variant_new ("(s)", realms->op_id),
                           G_DBUS_CALL_FLAGS_NONE,
                           -1,
                           NULL,
                           on_cancel_done,
                           realms);
    }

  cockpit_realms_complete_cancel (object, invocation);
  return TRUE;
}

/* DIAGNOSTISC */

static gboolean
handle_get_diagnostics (CockpitRealms *object,
                        GDBusMethodInvocation *invocation)
{
  Realms *realms = REALMS (object);

  if (!auth_check_sender_role (invocation, COCKPIT_ROLE_REALM_ADMIN))
    return TRUE;

  cockpit_realms_complete_get_diagnostics (object, invocation, realms->diagnostics->str);
  return TRUE;
}

/* INTERFACE */

static void
realms_iface_init (CockpitRealmsIface *iface)
{
  iface->handle_leave = handle_leave;
  iface->handle_join = handle_join;
  iface->handle_discover = handle_discover;
  iface->handle_cancel = handle_cancel;
  iface->handle_get_diagnostics = handle_get_diagnostics;
}
