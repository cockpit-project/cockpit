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

#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitlog.h"

#define POLKIT_AGENT_I_KNOW_API_IS_SUBJECT_TO_CHANGE 1
#include <polkitagent/polkitagent.h>

#include <sys/wait.h>
#include <string.h>

typedef struct {
    gchar *cookie;

    GSimpleAsyncResult *result;
    CockpitPolkitAgent *self;

    CockpitPipe *helper;
    gulong read_sig;
    gulong close_sig;

    GCancellable *cancellable;
    gulong cancel_sig;
} ReauthorizeCaller;

struct _CockpitPolkitAgent {
  PolkitAgentListener parent_instance;
  CockpitTransport *transport;
  gulong control_sig;
  GHashTable *callers;
};

typedef struct {
  PolkitAgentListenerClass parent_class;
} CockpitPolkitAgentClass;

enum {
    PROP_0,
    PROP_TRANSPORT,
};

G_DEFINE_TYPE (CockpitPolkitAgent, cockpit_polkit_agent, POLKIT_AGENT_TYPE_LISTENER);

static void
caller_free (gpointer data)
{
  ReauthorizeCaller *caller = data;
  if (caller->cancel_sig)
    g_signal_handler_disconnect (caller->cancellable, caller->cancel_sig);
  if (caller->cancellable)
    g_object_unref (caller->cancellable);
  g_signal_handler_disconnect (caller->helper, caller->read_sig);
  g_signal_handler_disconnect (caller->helper, caller->close_sig);
  g_object_unref (caller->helper);

  if (caller->result)
    {
      g_debug ("cancelling agent authentication");
      g_simple_async_result_set_error (caller->result, G_IO_ERROR, G_IO_ERROR_CANCELLED,
                                       "Operation was cancelled");
      g_simple_async_result_complete (caller->result);
      g_object_unref (caller->result);
    }

  g_free (caller->cookie);
  g_free (caller);
}

static void
cockpit_polkit_agent_init (CockpitPolkitAgent *self)
{
  self->callers = g_hash_table_new_full (g_str_hash, g_str_equal,
                                         NULL, caller_free);
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      guint channel,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (user_data);
  ReauthorizeCaller *caller;
  const gchar *response;
  const gchar *cookie;
  GBytes *bytes;

  if (!g_str_equal (command, "authorize"))
    return FALSE;

  if (!cockpit_json_get_string (options, "cookie", NULL, &cookie) ||
      !cockpit_json_get_string (options, "response", NULL, &response) ||
      !cookie || !response)
    {
      g_warning ("got an invalid authorize command from cockpit-ws");
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }

  caller = g_hash_table_lookup (self->callers, cookie);
  if (!caller)
    {
      g_debug ("received authorize response for caller that has gone away");
      return TRUE;
    }

  g_debug ("got \"authorize\" response from cockpit-ws, will send to helper: %s", response);

  bytes = g_bytes_new_with_free_func (response, strlen (response),
                                      (GDestroyNotify)json_object_unref,
                                      json_object_ref (options));
  cockpit_pipe_write (caller->helper, bytes);
  g_bytes_unref (bytes);

  bytes = g_bytes_new_static ("\n", 1);
  cockpit_pipe_write (caller->helper, bytes);
  g_bytes_unref (bytes);

  return TRUE;
}

static void
cockpit_polkit_agent_constructed (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->constructed (object);

  self->control_sig = g_signal_connect (self->transport, "control",
                                        G_CALLBACK (on_transport_control), self);
}

static void
cockpit_polkit_agent_set_property (GObject *object,
                                   guint prop_id,
                                   const GValue *value,
                                   GParamSpec *pspec)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  switch (prop_id)
    {
      case PROP_TRANSPORT:
        self->transport = g_value_dup_object (value);
        break;
      default:
        G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
        break;
    }
}

static void
cockpit_polkit_agent_dispose (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  if (self->control_sig)
    {
      g_signal_handler_disconnect (self->transport, self->control_sig);
      self->control_sig = 0;
    }

  g_hash_table_remove_all (self->callers);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->dispose (object);
}


static void
cockpit_polkit_agent_finalize (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  if (self->transport)
    g_object_unref (self->transport);
  g_hash_table_destroy (self->callers);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->finalize (object);
}

static void
on_helper_read (CockpitPipe *pipe,
                GByteArray *buffer,
                gboolean eof,
                gpointer user_data)
{
  ReauthorizeCaller *caller = user_data;
  JsonObject *object;
  GBytes *bytes;
  guint8 *lf;

  lf = memchr (buffer->data, '\n', buffer->len);
  if (!lf)
    return;

  /* Null terminate the challenge */
  *lf = 0;

  g_debug ("got challenge from helper, will send to cockpit-ws: %s", (gchar *)buffer->data);

  /* send an authorize packet here */
  object = json_object_new ();
  json_object_set_string_member (object, "command", "authorize");
  json_object_set_string_member (object, "cookie", caller->cookie);
  json_object_set_string_member (object, "challenge", (gchar *)buffer->data);
  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  /* Consume from buffer, including null termination */
  cockpit_pipe_skip (buffer, lf - buffer->data);

  cockpit_transport_send (caller->self->transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
on_helper_close (CockpitPipe *pipe,
                 const gchar *problem,
                 gpointer user_data)
{
  ReauthorizeCaller *caller = user_data;
  GSimpleAsyncResult *result;
  gint status;
  int res;

  g_warn_if_fail (g_hash_table_steal (caller->self->callers, caller->cookie));

  if (caller->result)
    {
      result = caller->result;
      caller->result = NULL;

      if (problem)
        {
          g_message ("cockpit-polkit helper had problem: %s", problem);
          res = 1;
        }
      else
        {
          status = cockpit_pipe_exit_status (pipe);
          if (WIFEXITED (status))
            {
              g_message ("cockpit-polkit helper exited with status: %d", (int)WEXITSTATUS (status));
              res = WEXITSTATUS (status);
            }
          else if (WIFSIGNALED (status))
            {
              g_message ("cockpit-polkit helper was terminated with signal: %d", (int)WTERMSIG (status));
              res = 1;
            }
          else
            {
              g_message ("cockpit-polkit helper terminated unexpectedly");
              res = 1;
            }
        }

      if (res != 0)
        {
          g_simple_async_result_set_error (result, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                           "Cockpit polkit agent helper failed");
        }
      g_simple_async_result_complete (result);
      g_object_unref (result);
    }

  g_debug ("closing agent authentication");
  caller_free (caller);
}

static void
on_cancelled (GCancellable *cancellable,
              gpointer      user_data)
{
  ReauthorizeCaller *caller = user_data;
  g_debug ("cancelled agent authentication");
  g_hash_table_remove (caller->self->callers, caller->cookie);
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
  GSimpleAsyncResult *result = NULL;
  GString *unsupported = NULL;
  ReauthorizeCaller *caller;
  gchar *string;
  uid_t uid;
  GList *l;

  const gchar *argv[] = {
    PACKAGE_LIBEXEC_DIR "/cockpit-polkit",
    cookie,
    NULL,
  };

  g_debug ("polkit is requesting authentication");

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_polkit_agent_initiate_authentication);

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
      g_simple_async_result_set_error (result, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                       "Reauthorization not supported for identity");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  string = polkit_identity_to_string (identity);
  g_message ("Reauthorizing %s", string);
  g_free (string);

  caller = g_new0 (ReauthorizeCaller, 1);
  caller->cookie = g_strdup (cookie);
  caller->helper = cockpit_pipe_spawn (argv, NULL, NULL, COCKPIT_PIPE_FLAGS_NONE);
  caller->read_sig = g_signal_connect (caller->helper, "read", G_CALLBACK (on_helper_read), caller);
  caller->close_sig = g_signal_connect (caller->helper, "close", G_CALLBACK (on_helper_close), caller);

  caller->cancellable = g_object_ref (cancellable);
  caller->cancel_sig = g_cancellable_connect (cancellable, G_CALLBACK (on_cancelled), caller, NULL);

  caller->result = g_object_ref (result);
  caller->self = self;

  g_hash_table_replace (self->callers, caller->cookie, caller);

  g_debug ("cockpit-polkit helper starting");

out:
  if (unsupported)
    g_string_free (unsupported, TRUE);
  g_object_unref (result);
  if (identity)
    g_object_unref (identity);
}

static gboolean
cockpit_polkit_agent_initiate_authentication_finish (PolkitAgentListener *listener,
                                                     GAsyncResult *res,
                                                     GError **error)
{
  g_warn_if_fail (g_simple_async_result_is_valid (res, G_OBJECT (listener),
                  cockpit_polkit_agent_initiate_authentication));

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (res), error))
    return FALSE;

  return TRUE;
}

static void
cockpit_polkit_agent_class_init (CockpitPolkitAgentClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  PolkitAgentListenerClass *listener_class = POLKIT_AGENT_LISTENER_CLASS (klass);

  gobject_class->constructed = cockpit_polkit_agent_constructed;
  gobject_class->set_property = cockpit_polkit_agent_set_property;
  gobject_class->dispose = cockpit_polkit_agent_dispose;
  gobject_class->finalize = cockpit_polkit_agent_finalize;

  listener_class->initiate_authentication = cockpit_polkit_agent_initiate_authentication;
  listener_class->initiate_authentication_finish = cockpit_polkit_agent_initiate_authentication_finish;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
             g_param_spec_object ("transport", "transport", "transport", COCKPIT_TYPE_TRANSPORT,
                                  G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

typedef struct {
    PolkitAgentListener *listener;
    gpointer registration_handle;
} CockpitPolkitRegistered;

gpointer
cockpit_polkit_agent_register (CockpitTransport *transport,
                               GCancellable *cancellable)
{
  CockpitPolkitRegistered *registered;
  PolkitAgentListener *listener = NULL;
  PolkitAuthority *authority = NULL;
  PolkitSubject *subject = NULL;
  GVariant *options;
  GLogLevelFlags fatal;
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
      /*
       * This can happen if there's a race between the polkit request and closing of
       * Cockpit. So it's not unheard of. We can complain, but not too loudly.
       */
      g_message ("couldn't create polkit session subject: %s", error->message);
      goto out;
    }

  listener = g_object_new (COCKPIT_TYPE_POLKIT_AGENT,
                           "transport", transport,
                           NULL);
  options = NULL;

  /*
   * HACK: Work around polkitagent warning:
   *
   * https://bugs.freedesktop.org/show_bug.cgi?id=78193
   */

  fatal = g_log_set_always_fatal (0);
  handler = g_log_set_handler (NULL, G_LOG_LEVEL_WARNING, cockpit_null_log_handler, NULL);

  handle = polkit_agent_listener_register_with_options (listener,
                                                        POLKIT_AGENT_REGISTER_FLAGS_NONE,
                                                        subject, NULL, options, cancellable, &error);

  g_log_set_always_fatal (fatal);
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
  g_clear_error (&error);

  if (handle)
    {
      registered = g_new0 (CockpitPolkitRegistered, 1);
      registered->registration_handle = handle;
      registered->listener = listener;
      return registered;
    }
  else
    {
      if (listener)
        g_object_unref (listener);
      return NULL;
    }
}

void
cockpit_polkit_agent_unregister (gpointer data)
{
  CockpitPolkitRegistered *registered = data;
  guint handler = 0;

  if (!registered)
    return;

  /* Explicitly cancel all pending operations */
  g_object_run_dispose (G_OBJECT (registered->listener));
  g_object_unref (registered->listener);

  /* Everything is shutting down at this point, prevent polkit from complaining */
  handler = g_log_set_handler (NULL, G_LOG_LEVEL_WARNING, cockpit_null_log_handler, NULL);

  /* Now unregister with polkit */
  polkit_agent_listener_unregister (registered->registration_handle);

  g_log_remove_handler (NULL, handler);

  g_free (registered);
}
