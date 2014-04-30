/*
 * Copyright (C) 2008 Red Hat, Inc.
 * Copyright (C) 2014 Red Hat, Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 *
 * Author: David Zeuthen <davidz@redhat.com>
 *         Cockpit Authors
 */

#include "config.h"

#include "cockpitpolkitagent.h"

#include "cockpit/cockpitlog.h"

#define POLKIT_AGENT_I_KNOW_API_IS_SUBJECT_TO_CHANGE 1
#include <polkitagent/polkitagent.h>

#include <string.h>

struct _CockpitPolkitAgent
{
  PolkitAgentListener parent_instance;

  GSimpleAsyncResult *simple;
  PolkitAgentSession *active_session;
  gulong cancel_id;
  GCancellable *cancellable;
};

typedef struct
{
  PolkitAgentListenerClass parent_class;
} CockpitPolkitAgentClass;

G_DEFINE_TYPE (CockpitPolkitAgent, cockpit_polkit_agent, POLKIT_AGENT_TYPE_LISTENER);

static void
cockpit_polkit_agent_init (CockpitPolkitAgent *self)
{

}

static void
cockpit_polkit_agent_finalize (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  if (self->active_session != NULL)
    g_object_unref (self->active_session);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->finalize (object);
}

static void
on_completed (PolkitAgentSession *session,
              gboolean gained_authorization,
              gpointer user_data)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (user_data);

  g_simple_async_result_complete_in_idle (self->simple);
  g_object_unref (self->simple);
  self->simple = NULL;

  g_object_unref (self->active_session);
  self->active_session = NULL;

  g_cancellable_disconnect (self->cancellable, self->cancel_id);
  g_object_unref (self->cancellable);
  self->cancel_id = 0;
}

static void
on_request (PolkitAgentSession *session,
            const gchar *request,
            gboolean echo_on,
            gpointer user_data)
{
  /*
   * We never authorize by prompting. So always cancel
   * if someone is trying to authenticate.
   */

  g_message ("Polkit asked us to prompt%s, but that's not supported by Cockpit. "
             "Maybe the pam_reauthorize.so module isn't present and enabled.",
             echo_on ? "" : " for a password");

  polkit_agent_session_cancel (session);
}

static void
on_show_error (PolkitAgentSession *session,
               const gchar *text,
               gpointer user_data)
{
  g_message ("%s", text);
}

static void
on_show_info (PolkitAgentSession *session,
              const gchar *text,
              gpointer user_data)
{
  g_info ("%s", text);
}

static void
on_cancelled (GCancellable *cancellable,
              gpointer      user_data)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (user_data);
  if (self->active_session)
    polkit_agent_session_cancel (self->active_session);
}

static void
cockpit_polkit_agent_initiate_authentication (PolkitAgentListener *listener,
                                              const gchar *action_id,
                                              const gchar *message,
                                              const gchar *icon_name,
                                              PolkitDetails *details,
                                              const gchar *cookie,
                                              GList *identities,
                                              GCancellable *cancellable,
                                              GAsyncReadyCallback callback,
                                              gpointer user_data)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (listener);
  PolkitIdentity *identity = NULL;
  GSimpleAsyncResult *simple = NULL;
  GString *unsupported = NULL;
  gchar *string;
  uid_t uid;
  GList *l;

  g_debug ("polkit is requesting authentication");

  simple = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_polkit_agent_initiate_authentication);
  if (self->active_session != NULL)
    {
      g_simple_async_result_set_error (simple, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                       "An authentication session is already underway.");
      g_simple_async_result_complete_in_idle (simple);
      goto out;
    }

  uid = getuid ();

  unsupported = g_string_new ("");
  for (l = identities; l != NULL; l = g_list_next (l))
    {
      if (POLKIT_IS_UNIX_USER (l->data))
        {
          if (polkit_unix_user_get_uid (l->data) == uid)
            {
              identity = g_object_ref (l->data);
              break;
            }
        }

      string = polkit_identity_to_string (l->data);
      g_string_append_printf (unsupported, "%s ", string);
      g_free (string);
    }

  if (!identity)
    {
      g_message ("cannot reauthorize identity(s): %s", unsupported->str);
      g_simple_async_result_set_error (simple, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                       "Reauthorization not supported for identity");
      g_simple_async_result_complete_in_idle (simple);
      goto out;
    }

  string = polkit_identity_to_string (identity);
  g_message ("Reauthorizing %s", string);
  g_free (string);

  self->active_session = polkit_agent_session_new (identity, cookie);
  g_signal_connect (self->active_session,
                    "completed",
                    G_CALLBACK (on_completed),
                    self);
  g_signal_connect (self->active_session,
                    "request",
                    G_CALLBACK (on_request),
                    self);
  g_signal_connect (self->active_session,
                    "show-info",
                    G_CALLBACK (on_show_info),
                    self);
  g_signal_connect (self->active_session,
                    "show-error",
                    G_CALLBACK (on_show_error),
                    self);

  self->simple = g_object_ref (simple);
  self->cancellable = g_object_ref (cancellable);
  self->cancel_id = g_cancellable_connect (cancellable, G_CALLBACK (on_cancelled),
                                           listener, NULL);

  polkit_agent_session_initiate (self->active_session);

  g_debug ("polkit authenticate session initiated");

out:
  if (unsupported)
    g_string_free (unsupported, TRUE);
  g_object_unref (simple);
  if (identity)
    g_object_unref (identity);
}

static gboolean
cockpit_polkit_agent_initiate_authentication_finish (PolkitAgentListener *listener,
                                                     GAsyncResult *res,
                                                     GError **error)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (listener);

  g_warn_if_fail (g_simple_async_result_is_valid (res, G_OBJECT (listener),
                  cockpit_polkit_agent_initiate_authentication));
  g_warn_if_fail (self->active_session == NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (res), error))
    return FALSE;

  return TRUE;
}

static void
cockpit_polkit_agent_class_init (CockpitPolkitAgentClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  PolkitAgentListenerClass *listener_class = POLKIT_AGENT_LISTENER_CLASS (klass);

  gobject_class->finalize = cockpit_polkit_agent_finalize;

  listener_class->initiate_authentication = cockpit_polkit_agent_initiate_authentication;
  listener_class->initiate_authentication_finish = cockpit_polkit_agent_initiate_authentication_finish;
}

gpointer
cockpit_polkit_agent_register (GCancellable *cancellable)
{
  PolkitAgentListener *listener = NULL;
  PolkitAuthority *authority = NULL;
  PolkitSubject *subject = NULL;
  GVariant *options;
  GError *error = NULL;
  gpointer handle = NULL;
  guint handler = 0;
  gchar *string;

  authority = polkit_authority_get_sync (cancellable, &error);
  if (authority == NULL)
    {
      g_message ("couldn't get polkit authority: %s", error->message);
      goto out;
    }

  subject = polkit_unix_session_new_for_process_sync (getpid (), cancellable, &error);
  if (subject == NULL)
    {
      g_warning ("couldn't create polkit session subject: %s", error->message);
      goto out;
    }

  listener = g_object_new (COCKPIT_TYPE_POLKIT_AGENT, NULL);
  options = NULL;

  /*
   * HACK: Work around polkitagent warning:
   *
   * https://bugs.freedesktop.org/show_bug.cgi?id=78193
   */

  handler = g_log_set_handler (NULL, G_LOG_LEVEL_WARNING, cockpit_null_log_handler, NULL);

  handle = polkit_agent_listener_register_with_options (listener,
                                                        POLKIT_AGENT_REGISTER_FLAGS_NONE,
                                                        subject, NULL, options, cancellable, &error);

  g_log_remove_handler (NULL, handler);

  if (error != NULL)
    {
      if ((g_error_matches (error, POLKIT_ERROR, POLKIT_ERROR_FAILED) &&
           error->message && strstr (error->message, "already exists")) ||
          g_error_matches (error, G_DBUS_ERROR, G_DBUS_ERROR_SERVICE_UNKNOWN))
        {
          g_debug ("couldn't register polkit agent: %s", error->message);
        }
      else
        {
          g_dbus_error_strip_remote_error (error);
          g_message ("couldn't register polkit authentication agent: %s", error->message);
        }
      goto out;
    }

  string = polkit_subject_to_string (subject);

  g_debug ("registered polkit authentication agent for subject: %s", string);
  g_free (string);

out:
  if (subject)
    g_object_unref (subject);
  if (authority)
    g_object_unref (authority);
  if (listener)
    g_object_unref (listener);
  g_clear_error (&error);
  return handle;
}

void
cockpit_polkit_agent_unregister (gpointer handle)
{
  if (handle)
    polkit_agent_listener_unregister (handle);
}
