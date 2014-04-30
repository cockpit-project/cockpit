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

#include "cockpitreauthorize.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpitunixfd.h"

#include "reauthorize/reauthorize.h"

#include <glib-unix.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

/**
 * CockpitReauthorize:
 *
 * Use the reauthorize logic to perform reauthorizations for cockpit-agent,
 * sends the challenges down the transport and waits for them back.
 *
 * See doc/authorize.md for information about how reauthorization works
 * with polkit or sudo.
 */

enum {
    REAUTHORIZE_WAITING,
    REAUTHORIZE_AUTHORIZING,
    REAUTHORIZE_RESPONDING,
};

typedef struct {
    gint64 cookie;
    int state;
    int sock;
    guint watch;
    gchar *response;
    CockpitReauthorize *self;
} ReauthorizeCaller;

struct _CockpitReauthorize {
  GObject parent;
  CockpitTransport *transport;
  gulong control_sig;
  int master;
  guint watch;
  GHashTable *callers;
  gint64 last_cookie;
};

typedef struct {
    GObjectClass parent;
} CockpitReauthorizeClass;

enum {
    PROP_0,
    PROP_TRANSPORT,
};

static void  caller_input (ReauthorizeCaller *caller);

static void  caller_output (ReauthorizeCaller *caller);

G_DEFINE_TYPE (CockpitReauthorize, cockpit_reauthorize, G_TYPE_OBJECT);

static void
caller_free (gpointer data)
{
  ReauthorizeCaller *caller = data;
  if (caller->watch)
    g_source_remove (caller->watch);
  g_free (caller->response);
  close (caller->sock);
  g_free (caller);
}

static void
cockpit_reauthorize_init (CockpitReauthorize *self)
{
  self->callers = g_hash_table_new_full (cockpit_json_int_hash,
                                         cockpit_json_int_equal,
                                         NULL, caller_free);
  self->master = -1;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      guint channel,
                      JsonObject *options,
                      gpointer user_data)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (user_data);
  ReauthorizeCaller *caller;
  const gchar *response;
  gint64 cookie;

  if (!g_str_equal (command, "authorize"))
    return FALSE;

  if (!cockpit_json_get_int (options, "cookie", -1, &cookie) ||
      !cockpit_json_get_string (options, "response", NULL, &response) ||
      cookie < 0 || !response)
    {
      g_warning ("got an invalid authorize command from cockpit-ws");
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }

  caller = g_hash_table_lookup (self->callers, &cookie);
  if (!caller)
    {
      g_debug ("received authorize response for caller that has gone away");
      return TRUE;
    }

  if (caller->state != REAUTHORIZE_AUTHORIZING)
    {
      g_warning ("received an authorize response but caller is not authorizing");
      return TRUE;
    }

  g_debug ("got \"authorize\" response from cockpit-ws, will send to caller");

  caller->response = g_strdup (response);
  caller->state = REAUTHORIZE_RESPONDING;
  caller_output (caller);
  return TRUE;
}

static gboolean
on_caller_connected (gint fd,
                     GIOCondition condition,
                     gpointer user_data)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (user_data);
  ReauthorizeCaller *caller;
  GError *error = NULL;
  int sock;
  int rc;

  rc = reauthorize_accept (self->master, &sock);
  if (rc < 0)
    {
      g_warning ("couldn't accept reauthorize caller: %s",
                 g_strerror (-rc));
      return FALSE;
    }

  if (!g_unix_set_fd_nonblocking (sock, TRUE, &error))
    {
      g_warning ("couldn't set reauthorize caller socket to non-blocking: %s", error->message);
      g_clear_error (&error);
      close (sock);
      return TRUE;
    }

  g_debug ("accepted reauthorize caller");

  caller = g_new0 (ReauthorizeCaller, 1);
  caller->cookie = self->last_cookie++;
  caller->self = self;
  caller->sock = sock;
  caller->state = REAUTHORIZE_WAITING;
  g_hash_table_replace (self->callers, &caller->cookie, caller);

  caller_input (caller);

  return TRUE;
}

static void
cockpit_reauthorize_constructed (GObject *object)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (object);
  GError *error = NULL;
  int rc;

  G_OBJECT_CLASS (cockpit_reauthorize_parent_class)->constructed (object);

  self->last_cookie = 1;

  self->control_sig = g_signal_connect (self->transport, "control",
                                        G_CALLBACK (on_transport_control), self);

  rc = reauthorize_listen (0, &self->master);
  if (rc < 0)
    {
      g_warning ("couldn't listen for reauthorize challenges");
      return;
    }

  if (!g_unix_set_fd_nonblocking (self->master, TRUE, &error))
    {
      g_warning ("couldn't set reauthorize master socket to non-blocking: %s", error->message);
      g_clear_error (&error);
      return;
    }

  self->watch = cockpit_unix_fd_add (self->master, G_IO_IN, on_caller_connected, self);
  g_debug ("listening for reauthorize callers");
}

static void
cockpit_reauthorize_set_property (GObject *object,
                                  guint prop_id,
                                  const GValue *value,
                                  GParamSpec *pspec)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (object);

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
cockpit_reauthorize_dispose (GObject *object)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (object);

  if (self->control_sig)
    {
      g_signal_handler_disconnect (self->transport, self->control_sig);
      self->control_sig = 0;
    }

  g_hash_table_remove_all (self->callers);

  if (self->watch)
    {
      g_source_remove (self->watch);
      self->watch = 0;
    }

  if (self->master != -1)
    {
      close (self->master);
      self->master = -1;
    }

  G_OBJECT_CLASS (cockpit_reauthorize_parent_class)->dispose (object);
}

static void
cockpit_reauthorize_finalize (GObject *object)
{
  CockpitReauthorize *self = COCKPIT_REAUTHORIZE (object);

  g_object_unref (self->transport);
  g_hash_table_destroy (self->callers);

  G_OBJECT_CLASS (cockpit_reauthorize_parent_class)->finalize (object);
}

static void
on_reauthorize_log (const char *message)
{
  g_log ("reauthorize", G_LOG_LEVEL_WARNING, "%s", message);
}

static void
cockpit_reauthorize_class_init (CockpitReauthorizeClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  const gchar *env;
  int verbose = 0;

  env = g_getenv ("G_MESSAGES_DEBUG");
  if (env && strstr (env, "reauthorize"))
    verbose = 1;

  reauthorize_logger (on_reauthorize_log, verbose);

  gobject_class->constructed = cockpit_reauthorize_constructed;
  gobject_class->set_property = cockpit_reauthorize_set_property;
  gobject_class->dispose = cockpit_reauthorize_dispose;
  gobject_class->finalize = cockpit_reauthorize_finalize;

  g_object_class_install_property (gobject_class, PROP_TRANSPORT,
             g_param_spec_object ("transport", "transport", "transport", COCKPIT_TYPE_TRANSPORT,
                                  G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));
}

static void
caller_close (ReauthorizeCaller *caller)
{
  /* Closes the caller socket and cleans up */
  g_hash_table_remove (caller->self->callers, &caller->cookie);
}

static gboolean
on_caller_output (gint fd,
                  GIOCondition condition,
                  gpointer user_data)
{
  ReauthorizeCaller *caller = user_data;
  int rc;

  g_return_val_if_fail (caller->response != NULL, FALSE);

  rc = reauthorize_send (caller->sock, caller->response);
  if (rc < 0)
    {
      if (rc == -EAGAIN || rc == -EINTR)
        return TRUE;
      if (rc != -ECONNRESET || rc != -EPIPE)
        {
          g_warning ("couldn't send challenge to reauthorize caller: %s",
                     g_strerror (-rc));
        }
      caller_close (caller);
      return FALSE;
    }

  g_debug ("sent reauthorize response to caller: %s", caller->response);

  caller->watch = 0;
  g_free (caller->response);
  caller->response = NULL;

  caller->state = REAUTHORIZE_WAITING;
  caller_input (caller);
  return FALSE;
}

static void
caller_output (ReauthorizeCaller *caller)
{
  g_assert (caller->watch == 0);
  caller->watch = cockpit_unix_fd_add (caller->sock, G_IO_OUT, on_caller_output, caller);
}

static gboolean
on_caller_input (gint fd,
                 GIOCondition condition,
                 gpointer user_data)
{
  ReauthorizeCaller *caller = user_data;
  char *challenge = NULL;
  JsonObject *object;
  GBytes *bytes;
  int rc;

  if (!(condition & G_IO_HUP))
    {
      rc = reauthorize_recv (caller->sock, &challenge);
      if (rc < 0)
        {
          if (rc == -EAGAIN || rc == -EINTR)
            return TRUE;
          if (rc != -ECONNRESET)
            {
              g_warning ("couldn't receive input from reauthorize caller: %s",
                         g_strerror (-rc));
              caller_close (caller);
              return FALSE;
            }
        }
    }

  if (!challenge || g_str_equal (challenge, ""))
    {
      g_debug ("reauthorize caller disconnected");
      caller_close (caller);
      free (challenge);
      return FALSE;
    }

  g_debug ("received reauthorize challenge from caller: %s", challenge);

  caller->watch = 0;

  /* send an authorize packet here */
  object = json_object_new ();
  json_object_set_string_member (object, "command", "authorize");
  json_object_set_int_member (object, "cookie", caller->cookie);
  json_object_set_string_member (object, "challenge", challenge);
  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);
  cockpit_transport_send (caller->self->transport, 0, bytes);
  g_bytes_unref (bytes);

  /* Wait for a response from the server */
  caller->state = REAUTHORIZE_AUTHORIZING;

  free (challenge);
  return FALSE;
}

static void
caller_input (ReauthorizeCaller *caller)
{
  g_assert (caller->watch == 0);
  caller->watch = cockpit_unix_fd_add (caller->sock, G_IO_IN, on_caller_input, caller);
}

CockpitReauthorize *
cockpit_reauthorize_new (CockpitTransport *transport)
{
  return g_object_new (COCKPIT_TYPE_REAUTHORIZE,
                       "transport", transport,
                       NULL);
}
