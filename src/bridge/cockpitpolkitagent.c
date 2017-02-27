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

#include "common/cockpitlog.h"
#include "common/cockpitmemory.h"
#include "common/cockpitunixfd.h"

#define POLKIT_AGENT_I_KNOW_API_IS_SUBJECT_TO_CHANGE 1
#include <polkitagent/polkitagent.h>

#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <termios.h>

#define COCKPIT_TYPE_POLKIT_AGENT          (cockpit_polkit_agent_get_type())
#define COCKPIT_POLKIT_AGENT(o)            (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_POLKIT_AGENT, CockpitPolkitAgent))
#define COCKPIT_IS_POLKIT_AGENT(o)         (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_POLKIT_AGENT))

typedef struct {
  PolkitAgentListener parent_instance;
  int tty;

  /* Polkit helper sessions active */
  GHashTable *callers;

  /* A list of password requests */
  GQueue requests;
  GString *prompt;
  GString *reply;
  struct termios reset;
  guint timeout;
  guint tag;
} CockpitPolkitAgent;

typedef struct {
  gchar *cookie;

  GSimpleAsyncResult *result;
  CockpitPolkitAgent *self;

  PolkitAgentSession *session;
  gulong completed_sig;
  gulong request_sig;
  gulong info_sig;
  gulong error_sig;

  GCancellable *cancellable;
  gulong cancel_sig;
} ReauthorizeCaller;

typedef struct {
  PolkitAgentListenerClass parent_class;
} CockpitPolkitAgentClass;

static GType cockpit_polkit_agent_get_type (void) G_GNUC_CONST;

G_DEFINE_TYPE (CockpitPolkitAgent, cockpit_polkit_agent, POLKIT_AGENT_TYPE_LISTENER);

static void
caller_free (gpointer data)
{
  ReauthorizeCaller *caller = data;
  if (caller->cancel_sig)
    g_signal_handler_disconnect (caller->cancellable, caller->cancel_sig);
  if (caller->cancellable)
    g_object_unref (caller->cancellable);

  if (caller->session)
    {
      g_signal_handler_disconnect (caller->session, caller->completed_sig);
      g_signal_handler_disconnect (caller->session, caller->request_sig);
      g_signal_handler_disconnect (caller->session, caller->info_sig);
      g_signal_handler_disconnect (caller->session, caller->error_sig);
      polkit_agent_session_cancel (caller->session);
      g_object_unref (caller->session);
    }

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
  const char *tty_name;

  self->callers = g_hash_table_new_full (g_str_hash, g_str_equal,
                                         NULL, caller_free);

  g_queue_init (&self->requests);

  tty_name = ctermid (NULL);
  if (tty_name == NULL)
    {
      g_warning ("couldn't determine pathname for current controlling terminal for cockpit-bridge: %s",
                 g_strerror (errno));
    }
  else
    {
      self->tty = open (tty_name, O_RDWR | O_NONBLOCK);
      if (self->tty < 0)
        {
          g_warning ("couldn't open current controlling terminal for cockpit-bridge: %s",
                     g_strerror (errno));
        }
    }

  self->prompt = g_string_new ("");
  self->reply = g_string_new ("");
}

static void
finish_request (CockpitPolkitAgent *self);

static gboolean
on_tty_request_read (gint fd,
                     GIOCondition cond,
                     gpointer user_data)
{
  CockpitPolkitAgent *self = user_data;
  ssize_t res;
  gchar ch;

  g_assert (fd == self->tty);

  res = read (fd, &ch, 1);
  if (res < 0)
    {
      if (errno != EINTR && errno != EAGAIN)
        {
          g_warning ("could not write polkit agent prompt to tty: %s", g_strerror (errno));
          finish_request (self);
          return FALSE;
        }
    }
  else if (res == 0)
    {
      if (cond & (G_IO_HUP | G_IO_ERR))
        {
          finish_request (self);
          return FALSE;
        }
    }
  else if (ch == '\n')
    {
      finish_request (self);
      return FALSE;
    }
  else
    {
      g_string_append_c (self->reply, ch);
    }

  return TRUE;
}

static gboolean
on_tty_request_write (gint fd,
                      GIOCondition cond,
                      gpointer user_data)
{
  CockpitPolkitAgent *self = user_data;
  ssize_t res = 0;

  g_assert (fd == self->tty);

  if (self->prompt->len > 0)
    res = write (fd, self->prompt->str, self->prompt->len);
  if (res < 0)
    {
      if (errno != EINTR && errno != EAGAIN)
        {
          g_warning ("could not write polkit agent prompt to tty: %s", g_strerror (errno));
          finish_request (self);
          return FALSE;
        }
    }
  else
    {
      g_string_erase (self->prompt, 0, res);
    }

  /* Finished writing the prompt, read the response */
  if (self->prompt->len == 0)
    {
      self->tag = cockpit_unix_fd_add (self->tty, G_IO_IN, on_tty_request_read, self);
      return FALSE;
    }

  return TRUE;
}

static gboolean
on_tty_request_timeout (gpointer user_data)
{
  g_message ("timed out waiting for polkit request on tty");
  finish_request (user_data);
  return FALSE;
}

static void
start_request (CockpitPolkitAgent *self)
{
  PolkitAgentSession *session = g_queue_peek_head (&self->requests);
  uid_t uid = getuid ();
  struct termios ts;

  if (!session)
    return;

  g_string_printf (self->prompt, "@authorize@%d:%d@authorize@ ", (int)uid, (int)uid);
  g_string_truncate (self->reply, 0);

  if (self->tty >= 0)
    {
      tcgetattr (self->tty, &ts);
      self->reset = ts;
      ts.c_lflag &= ~(ECHO | ECHOE | ECHOK | ECHONL);
      tcsetattr (self->tty, TCSAFLUSH, &ts);

      self->tag = cockpit_unix_fd_add (self->tty, G_IO_OUT, on_tty_request_write, self);
      self->timeout = g_timeout_add_seconds (120, on_tty_request_timeout, self);
    }
  else
    {
      /* Immediately finish the request */
      finish_request (self);
    }
}

static void
finish_request (CockpitPolkitAgent *self)
{
  PolkitAgentSession *session = g_queue_pop_head (&self->requests);
  g_return_if_fail (session != NULL);

  if (self->tty >= 0)
    {
      polkit_agent_session_response (session, self->reply->str);
      cockpit_secclear (self->reply->str, self->reply->len);
      tcsetattr (self->tty, TCSAFLUSH, &self->reset);
    }

  if (self->tag)
    {
      g_source_remove (self->tag);
      self->tag = 0;
    }
  if (self->timeout)
    {
      g_source_remove (self->timeout);
      self->timeout = 0;
    }

  g_object_unref (session);

  start_request (self);
}

static void
cockpit_polkit_agent_dispose (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  if (self->tty)
    {
      close (self->tty);
      self->tty = -1;
    }

  g_hash_table_remove_all (self->callers);

  while (!g_queue_is_empty (&self->requests))
    finish_request (self);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->dispose (object);
}


static void
cockpit_polkit_agent_finalize (GObject *object)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (object);

  g_hash_table_destroy (self->callers);
  g_assert (g_queue_is_empty (&self->requests));
  g_assert (self->tty < 0);

  g_string_free (self->reply, TRUE);
  g_string_free (self->prompt, TRUE);

  G_OBJECT_CLASS (cockpit_polkit_agent_parent_class)->finalize (object);
}

static void
on_completed (PolkitAgentSession *session,
              gboolean gained_authorization,
              gpointer user_data)
{
  ReauthorizeCaller *caller = user_data;

  g_debug ("polkit authentication completed");

  g_warn_if_fail (g_hash_table_steal (caller->self->callers, caller->cookie));
  g_simple_async_result_complete_in_idle (caller->result);

  g_object_unref (caller->result);
  caller->result = NULL;

  caller_free (caller);
}

static void
on_request (PolkitAgentSession *session,
            const gchar *request,
            gboolean echo_on,
            gpointer user_data)
{
  CockpitPolkitAgent *self = COCKPIT_POLKIT_AGENT (user_data);
  gboolean empty;

  if (echo_on)
    {
      g_message ("ignoring polkit helper request: %s", request);
      polkit_agent_session_response (session, "");
    }
  else
    {
      empty = g_queue_is_empty (&self->requests);
      g_queue_push_tail (&self->requests, g_object_ref (session));
      if (empty)
        start_request (self);
    }
}

static void
on_show_error (PolkitAgentSession *session,
               const gchar *text,
               gpointer user_data)
{
  g_message ("polkit helper error: %s", text);
}

static void
on_show_info (PolkitAgentSession *session,
              const gchar *text,
              gpointer user_data)
{
  g_message ("polkit helper info: %s", text);
}

static void
on_cancelled (GCancellable *cancellable,
              gpointer user_data)
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

  g_debug ("polkit is requesting authentication");

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_polkit_agent_initiate_authentication);

  if (self->tty < 0)
    {
      g_message ("polkit agent wanted to prompt, but no terminal available");
      g_simple_async_result_set_error (result, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                       "Could not open terminal in Cockpit for prompting");
      g_simple_async_result_complete_in_idle (result);
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
      g_simple_async_result_set_error (result, POLKIT_ERROR, POLKIT_ERROR_FAILED,
                                       "Reauthorization not supported for identity");
      g_simple_async_result_complete_in_idle (result);
      goto out;
    }

  string = polkit_identity_to_string (identity);
  g_free (string);

  caller = g_new0 (ReauthorizeCaller, 1);
  caller->cookie = g_strdup (cookie);
  caller->session = polkit_agent_session_new (identity, cookie);
  caller->completed_sig = g_signal_connect (caller->session, "completed", G_CALLBACK (on_completed), caller);
  caller->request_sig = g_signal_connect (caller->session, "request", G_CALLBACK (on_request), self);
  caller->info_sig = g_signal_connect (caller->session, "show-info", G_CALLBACK (on_show_info), NULL);
  caller->error_sig = g_signal_connect (caller->session, "show-error", G_CALLBACK (on_show_error), NULL);
  caller->cancellable = g_object_ref (cancellable);
  caller->cancel_sig = g_cancellable_connect (cancellable, G_CALLBACK (on_cancelled), caller, NULL);

  caller->result = g_object_ref (result);
  caller->self = self;

  polkit_agent_session_initiate (caller->session);
  g_hash_table_replace (self->callers, caller->cookie, caller);

  g_debug ("polkit helper starting");

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

  gobject_class->dispose = cockpit_polkit_agent_dispose;
  gobject_class->finalize = cockpit_polkit_agent_finalize;

  listener_class->initiate_authentication = cockpit_polkit_agent_initiate_authentication;
  listener_class->initiate_authentication_finish = cockpit_polkit_agent_initiate_authentication_finish;
}

typedef struct {
    PolkitAgentListener *listener;
    gpointer registration_handle;
} CockpitPolkitRegistered;

gpointer
cockpit_polkit_agent_register (GCancellable *cancellable)
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

  listener = g_object_new (COCKPIT_TYPE_POLKIT_AGENT, NULL);
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
