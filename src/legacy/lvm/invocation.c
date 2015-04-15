/*
 * Copyright (C) 2012-2014 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation; either version 2 of the licence or (at
 * your option) any later version.
 *
 * See the included COPYING file for more information.
 *
 * Author: Stef Walter <stefw@gnome.org>
 */

#include "config.h"

#include "daemon.h"
#include "com.redhat.lvm2.h"
#include "invocation.h"
#include "udisksclient.h"
#include "util.h"

#include <glib.h>
#include <glib/gi18n.h>

#include <polkit/polkit.h>

#include <string.h>

enum {
  UID_FAILED = -1,
  UID_LOADING = 0,
  UID_VALID = 1,
};

struct {
  GTypeClass *dbus_interface_skeleton_class;
  GObject * (* overridden_constructor) (GType, guint, GObjectConstructParam *);

  StorageClientFunc client_appeared;
  StorageClientFunc client_disappeared;
  gpointer client_user_data;

  GMutex mutex;
  GCond wait_cond;
  GHashTable *clients;
  PolkitAuthority *authority;
} inv;

typedef struct {
  gint refs;

  /* Guarded by the mutex */
  uid_t uid_peer;
  gint uid_state;

  /* Never change once configured */
  guint watch;
  gboolean callback;
  gchar *bus_name;
  PolkitSubject *subject;
} InvocationClient;

static void
invocation_client_unref (gpointer data)
{
  InvocationClient *client = data;
  if (g_atomic_int_dec_and_test (&client->refs))
    {
      g_object_unref (client->subject);
      if (client->watch)
        g_bus_unwatch_name (client->watch);
      g_free (client->bus_name);
      g_free (client);
    }
}

static InvocationClient *
invocation_client_ref (InvocationClient *client)
{
  g_atomic_int_inc (&client->refs);
  return client;
}

static InvocationClient *
invocation_client_lookup (GDBusMethodInvocation *invocation,
                          uid_t *uid_of_client,
                          GError **error)
{
  InvocationClient *client;
  const gchar *sender;

  sender = g_dbus_method_invocation_get_sender (invocation);
  g_return_val_if_fail (sender != NULL, NULL);

  g_mutex_lock (&inv.mutex);

  client = g_hash_table_lookup (inv.clients, sender);
  if (client)
    {
      invocation_client_ref (client);
      if (uid_of_client)
        {
          *uid_of_client = G_MAXUINT;
          while (client->uid_state == UID_LOADING)
            g_cond_wait (&inv.wait_cond, &inv.mutex);

          switch (client->uid_state)
            {
            case UID_VALID:
              *uid_of_client = client->uid_peer;
              break;
            case UID_FAILED:
              g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                           "Cannot determine the unix credentials of the calling process");
              break;
            default:
              g_assert_not_reached ();
              break;
            }
        }
    }
  else
    {
      g_critical ("Invocation from invalid caller: %s", sender);
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_FAILED,
                   "Method call from unknown caller (internal error)");
    }

  g_mutex_unlock (&inv.mutex);

  return client;
}

static void
on_get_connection_unix_user (GObject *source,
                             GAsyncResult *res,
                             gpointer user_data)
{
  gchar *bus_name = user_data;
  InvocationClient *client;
  GError *error = NULL;
  GVariant *value;

  value = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source),
                                         res, &error);

  g_mutex_lock (&inv.mutex);

  client = g_hash_table_lookup (inv.clients, bus_name);

  if (error == NULL)
    {
      if (client)
        {
          g_variant_get (value, "(u)", &client->uid_peer);
          client->uid_state = UID_VALID;
          g_debug ("GetConnectionUnixUser('%s') == %u", bus_name, client->uid_peer);
        }
      g_variant_unref (value);
    }
  else
    {
      if (client)
        client->uid_state = UID_FAILED;
      g_critical ("GetConnectionUnixUser('%s') failed: %s", bus_name, error->message);
      g_error_free (error);
    }

  g_cond_broadcast (&inv.wait_cond);
  g_mutex_unlock (&inv.mutex);

  g_free (bus_name);
}

static gboolean
on_invoke_client_appeared (gpointer user_data)
{
  const gchar *bus_name = user_data;
  if (inv.client_appeared)
    (inv.client_appeared) (bus_name, inv.client_user_data);
  return FALSE;
}

static gboolean
on_invoke_client_disappeared (gpointer user_data)
{
  const gchar *bus_name = user_data;
  if (inv.client_disappeared)
    (inv.client_disappeared) (bus_name, inv.client_user_data);
  return FALSE;
}

static void
on_client_vanished (GDBusConnection *connection,
                    const gchar *name,
                    gpointer user_data)
{
  InvocationClient *client;

  g_mutex_lock (&inv.mutex);
  client = g_hash_table_lookup (inv.clients, name);
  if (client)
    g_hash_table_steal (inv.clients, name);
  g_mutex_unlock (&inv.mutex);

  if (client)
    {
      g_main_context_invoke_full (NULL, G_PRIORITY_DEFAULT,
                                  on_invoke_client_disappeared,
                                  g_strdup (name), g_free);
      invocation_client_unref (client);
    }
}

static void
invocation_client_create (GDBusConnection *connection,
                          const gchar *bus_name)
{
  InvocationClient *client;

  g_mutex_lock (&inv.mutex);
  client = g_hash_table_lookup (inv.clients, bus_name);
  g_mutex_unlock (&inv.mutex);

  if (client != NULL)
    return;

  /*
   * Each time we see an incoming function call, keep the service alive for
   * that client, and each invocation of the client
   *
   * We would also like to get client credentials here and not pass client
   * messages into the rest of the machinery until that has completed.
   * Unfortunately the necessary patch in gio has not yet been merged.
   *
   * So we do an async call and if it hasn't completed by the time we need
   * the caller credentials, then we block and wait for it. Since it's the
   * system bus responding, it should respond pretty quickly.
   *
   * See invocation_client_lookup() for the waiting side of things.
   */

  client = g_new0 (InvocationClient, 1);
  client->bus_name = g_strdup (bus_name);
  client->subject = polkit_system_bus_name_new (bus_name);
  client->refs = 1;
  client->uid_peer = ~0;
  client->uid_state = UID_LOADING;

  client->watch = g_bus_watch_name_on_connection (connection, bus_name,
                                                  G_BUS_NAME_WATCHER_FLAGS_NONE,
                                                  NULL, on_client_vanished, NULL, NULL);

  g_debug ("GetConnectionUnixUser('%s') ...", bus_name);

  /*
   * This async call in the GDBusWorker thread main context will not
   * be blocked by the daemon main context blocking.
   */

  g_dbus_connection_call (connection,
                          "org.freedesktop.DBus",  /* bus name */
                          "/org/freedesktop/DBus", /* object path */
                          "org.freedesktop.DBus",  /* interface */
                          "GetConnectionUnixUser", /* method */
                          g_variant_new ("(s)", bus_name),
                          G_VARIANT_TYPE ("(u)"),
                          G_DBUS_CALL_FLAGS_NONE,
                          -1, /* timeout_msec */
                          NULL, on_get_connection_unix_user,
                          g_strdup (bus_name));

  g_mutex_lock (&inv.mutex);
  if (!g_hash_table_lookup (inv.clients, bus_name))
    {
      g_hash_table_replace (inv.clients, client->bus_name, client);
      client = NULL;
    }
  g_mutex_unlock (&inv.mutex);

  if (client)
    {
      invocation_client_unref (client);
    }
  else
    {
      g_main_context_invoke_full (NULL, G_PRIORITY_DEFAULT,
                                  on_invoke_client_appeared,
                                  g_strdup (bus_name), g_free);
    }
}

static GDBusMessage *
on_connection_filter (GDBusConnection *connection,
                      GDBusMessage *message,
                      gboolean incoming,
                      gpointer user_data)
{
  GDBusMessageType type;
  const gchar *sender;

  if (!incoming)
    return message;

  type = g_dbus_message_get_message_type (message);
  if (type == G_DBUS_MESSAGE_TYPE_METHOD_CALL)
    {
      sender = g_dbus_message_get_sender (message);
      g_return_val_if_fail (sender != NULL, NULL);
      invocation_client_create (connection, sender);
    }

  return message;
}

typedef struct {
  GObject *instance;
  PolkitDetails *details;
} ObjectGetDetails;

static gboolean
object_get_polkit_details (gpointer user_data)
{
  ObjectGetDetails *ogd = user_data;
  g_object_get (ogd->instance, "polkit-details", &ogd->details, NULL);
  g_mutex_lock (&inv.mutex);
  g_cond_broadcast (&inv.wait_cond);
  g_mutex_unlock (&inv.mutex);
  return FALSE;
}

static const gchar *
lookup_method_action_and_details (gpointer instance,
                                  InvocationClient *client,
                                  uid_t uid,
                                  const GDBusMethodInfo *method,
                                  PolkitDetails **details)
{
  GObjectClass *object_class;
  const gchar *message;

  /* Exception: The Job interface is not marked up like all our others */
  if (UDISKS_IS_JOB (instance) && g_str_equal (method->name, "Cancel"))
    {
      *details = polkit_details_new ();
      polkit_details_insert (*details, "polkit.message",
                             N_("Authentication is required to cancel a job"));

      /* This is a thread-safe call */
      if (uid != udisks_job_get_started_by_uid (instance))
        return "org.freedesktop.udisks2.cancel-job-other-user";
      else
        return "org.freedesktop.udisks2.cancel-job";
    }

  *details = NULL;

  object_class = G_OBJECT_GET_CLASS (instance);
  if (g_object_class_find_property (object_class, "polkit-details") != NULL)
    {
      ObjectGetDetails ogd = { instance, NULL };

      g_main_context_invoke (NULL, object_get_polkit_details, &details);

      g_mutex_lock (&inv.mutex);
      while (ogd.details == NULL)
        g_cond_wait (&inv.wait_cond, &inv.mutex);
      g_mutex_unlock (&inv.mutex);

      *details = ogd.details;
    }

  if (!*details || polkit_details_lookup (*details, "polkit.message"))
    {
      message = g_dbus_annotation_info_lookup (method->annotations, "polkit.message");
      if (message)
        {
          if (!*details)
            *details = polkit_details_new ();
          polkit_details_insert (*details, "polkit.message", message);
        }
    }

  return g_dbus_annotation_info_lookup (method->annotations, "polkit.action_id");
}

static PolkitCheckAuthorizationFlags
lookup_invocation_flags (GDBusMethodInvocation *invocation,
                         const GDBusMethodInfo *info)
{
  gboolean auth_no_user_interaction;
  GVariant *params;
  GVariant *options;
  gint i;

  auth_no_user_interaction = FALSE;

  /* Find an options, a{sv} */
  if (info->in_args)
    {
      for (i = 0; info->in_args[i] != NULL; i++)
        {
          if (g_str_equal (info->in_args[i]->name, "options") &&
              g_str_equal (info->in_args[i]->signature, "a{sv}"))
            {
              params = g_dbus_method_invocation_get_parameters (invocation);
              g_variant_get_child (params, i, "@a{sv}", &options);
              g_variant_lookup (options, "auth.no_user_interaction", "b",
                                &auth_no_user_interaction);
              g_variant_unref (options);
            }
        }
    }

  return auth_no_user_interaction ?
      POLKIT_CHECK_AUTHORIZATION_FLAGS_NONE :
      POLKIT_CHECK_AUTHORIZATION_FLAGS_ALLOW_USER_INTERACTION;
}

static gboolean
authorize_without_polkit (InvocationClient *client,
                          uid_t uid,
                          GDBusMethodInvocation *invocation)
{
  if (uid == 0)
    return TRUE;

  g_dbus_method_invocation_return_error_literal (invocation, UDISKS_ERROR, UDISKS_ERROR_NOT_AUTHORIZED,
                                                 "Not authorized to perform operation (polkit authority not available and caller is not uid 0)");

  return FALSE;
}

static gboolean
on_authorize_method (GDBusInterfaceSkeleton *instance,
                     GDBusMethodInvocation *invocation,
                     gpointer user_data)
{
  const GDBusMethodInfo *info;
  PolkitAuthorizationResult *result = NULL;
  PolkitCheckAuthorizationFlags flags;
  const gchar *action_id;
  PolkitDetails *details;
  GError *error = NULL;
  InvocationClient *client;
  gboolean ret = FALSE;
  uid_t uid;

  info = g_dbus_method_invocation_get_method_info (invocation);

  client = invocation_client_lookup (invocation, &uid, &error);
  if (error)
    {
      g_dbus_method_invocation_return_gerror (invocation, error);
      g_error_free (error);
      return TRUE;
    }

  /* Only allow root when no polkit authority */
  if (inv.authority == NULL)
    {
      ret = authorize_without_polkit (client, uid, invocation);
      goto out;
    }

  action_id = lookup_method_action_and_details (instance, client, uid, info, &details);
  if (action_id == NULL)
    action_id = "com.redhat.Cockpit.manage-lvm";

  flags = lookup_invocation_flags (invocation, info);

  result = polkit_authority_check_authorization_sync (inv.authority,
                                                      client->subject,
                                                      action_id,
                                                      details,
                                                      flags,
                                                      NULL, /* GCancellable* */
                                                      &error);

  g_clear_object (&details);

  if (result == NULL)
    {
      if (error->domain != POLKIT_ERROR)
        {
          /* assume polkit authority is not available (e.g. could be the service
           * manager returning org.freedesktop.systemd1.Masked)
           */
          g_debug ("CheckAuthorization() failed: %s", error->message);
          ret = authorize_without_polkit (client, uid, invocation);
          goto out;
        }
      else
        {
          g_dbus_method_invocation_return_error (invocation,
                                                 UDISKS_ERROR,
                                                 UDISKS_ERROR_FAILED,
                                                 "Error checking authorization: %s (%s, %d)",
                                                 error->message,
                                                 g_quark_to_string (error->domain),
                                                 error->code);
          goto out;
        }
    }

  if (!polkit_authorization_result_get_is_authorized (result))
    {
      if (polkit_authorization_result_get_dismissed (result))
        g_dbus_method_invocation_return_error_literal (invocation,
                                                       UDISKS_ERROR, UDISKS_ERROR_NOT_AUTHORIZED_DISMISSED,
                                                       "The authentication dialog was dismissed");
      else
        g_dbus_method_invocation_return_error_literal (invocation, UDISKS_ERROR,
                                                       polkit_authorization_result_get_is_challenge (result) ?
                                                       UDISKS_ERROR_NOT_AUTHORIZED_CAN_OBTAIN : UDISKS_ERROR_NOT_AUTHORIZED,
                                                       "Not authorized to perform operation");
      goto out;
    }

  ret = TRUE;

out:
  invocation_client_unref (client);
  g_clear_error (&error);
  g_clear_object (&result);
  return ret;
}

static GObject *
hook_dbus_interface_skeleton_constructor (GType type,
                                          guint n_construct_properties,
                                          GObjectConstructParam *construct_properties)
{
  GObject *instance;

  /*
   * We would like to use signal emission hooks for this, but alas GDBusObjectSkeleton
   * is crafty and doesn't fire the signal if there's no real listeners (hooks don't
   * count.
   */

  instance = (inv.overridden_constructor) (type, n_construct_properties, construct_properties);
  if (instance != NULL)
    g_signal_connect (instance, "g-authorize-method", G_CALLBACK (on_authorize_method), NULL);

  return instance;
}

void
storage_invocation_initialize (GDBusConnection *connection,
                               StorageClientFunc client_appeared,
                               StorageClientFunc client_disappeared,
                               gpointer user_data)
{
  GObjectClass *object_class;
  GError *error = NULL;

  inv.client_appeared = client_appeared;
  inv.client_disappeared = client_disappeared;
  inv.client_user_data = user_data;

  inv.dbus_interface_skeleton_class = g_type_class_ref (G_TYPE_DBUS_INTERFACE_SKELETON);

  object_class = G_OBJECT_CLASS (inv.dbus_interface_skeleton_class);
  inv.overridden_constructor = object_class->constructor;
  object_class->constructor = hook_dbus_interface_skeleton_constructor;

  inv.clients = g_hash_table_new_full (g_str_hash, g_str_equal,
                                       NULL, invocation_client_unref);

  g_dbus_connection_add_filter (connection, on_connection_filter, NULL, NULL);

  inv.authority = polkit_authority_get_sync (NULL, &error);
  if (error != NULL)
    {
      g_warning ("Couldn't connect to polkit: %s", error->message);
      g_error_free (error);
    }
}

void
storage_invocation_cleanup (void)
{
  inv.client_appeared = NULL;
  inv.client_disappeared = NULL;
  inv.client_user_data = NULL;

  if (inv.clients)
    g_hash_table_destroy (inv.clients);
  g_clear_object (&inv.authority);
}

uid_t
storage_invocation_get_caller_uid (GDBusMethodInvocation *invocation)
{
  InvocationClient *client;
  GError *error = NULL;
  uid_t uid;

  client = invocation_client_lookup (invocation, &uid, &error);
  if (client)
    {
      invocation_client_unref (client);
    }
  else if (error)
    {
      /*
       * This must have been checked before this call, invocation should not
       * have been authorized if this had failed. Something has gone wrong.
       * Since this is security sensitive, abort.
       */
      g_error ("%s", error->message);
      g_error_free (error);
    }

  return uid;
}
