/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitpeer.h"
#include "cockpitrouter.h"

#include "common/cockpitauthorize.h"
#include "common/cockpitfdpassing.h"
#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpittransport.h"

#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <errno.h>
#include <pty.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

struct _CockpitPeer {
  GObject parent;

  /* Our bridge configuration */
  const gchar *name;
  JsonObject *config;
  guint timeout;

  /* The channels we're dealing with */
  GHashTable *channels;
  GQueue *frozen;

  /* Authorize types we will reply to */
  GHashTable *authorize_values;
  guint authorize_values_timeout;

  /* first_host */
  gboolean first_channel_done;
  gchar *init_host;
  gchar *init_superuser;

  /* The transport we're routing from */
  CockpitTransport *transport;
  CockpitRouter *router;
  gulong transport_recv;
  gulong transport_control;
  GBytes *last_init;

  /* When open and ready */
  CockpitTransport *other;
  gulong other_recv;
  gulong other_control;
  gulong other_closed;
  gboolean inited;
  gboolean closed;
  gchar *problem;
  JsonObject *failure;

  /* Startup */
  gchar *startup_auth_cookie;
  CockpitPeerDoneFunction *startup_done_function;
  gpointer startup_done_data;
};

enum {
  PROP_0,
  PROP_TRANSPORT,
  PROP_ROUTER,
  PROP_CONFIG,
};

G_DEFINE_TYPE (CockpitPeer, cockpit_peer, G_TYPE_OBJECT);

static gchar *
startup_take_stderr (CockpitPeer *self)
{
  if (!self->other)
    return NULL;

  CockpitPipe *pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (self->other));
  return cockpit_pipe_take_stderr_as_utf8 (pipe);
}

static void
startup_done (CockpitPeer *self,
              const gchar *problem)
{
  gchar *stderr = startup_take_stderr (self);

  if (self->other)
    {
      CockpitPipe *pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (self->other));
      cockpit_pipe_stop_stderr_capture (pipe);
    }

  if (self->startup_done_function)
    {
      self->startup_done_function (problem, stderr, self->startup_done_data);
      self->startup_done_function = NULL;
    }

  g_free (stderr);
}

static void
reply_channel_closed (CockpitPeer *self,
                      const gchar *channel,
                      const gchar *problem)
{
  JsonObject *object;
  GBytes *message;
  GList *l, *names;

  object = json_object_new ();

  /* Copy over any failures from a "problem" in an "init" message */
  if (self->failure)
    {
      names = json_object_get_members (self->failure);
      for (l = names; l != NULL; l = g_list_next (l))
        json_object_set_member (object, l->data, json_object_dup_member (self->failure, l->data));
      g_list_free (names);
    }

  json_object_set_string_member (object, "command", "close");
  json_object_set_string_member (object, "channel", channel);
  json_object_set_string_member (object, "problem", problem);

  message = cockpit_json_write_bytes (object);
  cockpit_transport_send (self->transport, NULL, message);

  json_object_unref (object);
  g_bytes_unref (message);
}

static void
clear_authorize_value (gpointer pointer)
{
  char *data = pointer;
  if (data)
    cockpit_memory_clear (data, -1);
  g_free (data);
}

static gboolean
on_other_recv (CockpitTransport *transport,
              const gchar *channel,
              GBytes *payload,
              gpointer user_data)
{
  CockpitPeer *self = user_data;

  if (channel)
    {
      cockpit_transport_send (self->transport, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_timeout_reset (gpointer user_data)
{
  CockpitPeer *self = user_data;

  self->timeout = 0;
  if (g_hash_table_size (self->channels) == 0)
    {
      g_debug ("%s: peer timed out without channels", self->name);
      cockpit_peer_reset (self);
    }

  return FALSE;
}


static void
on_answer (const gchar *value,
           gpointer user_data)
{
  CockpitPeer *self = user_data;

  if (self->startup_auth_cookie)
    {
      GBytes *reply = cockpit_transport_build_control ("command", "authorize",
                                                       "cookie", self->startup_auth_cookie,
                                                       "response",
                                                       value,
                                                       NULL);
      cockpit_transport_send (self->other, NULL, reply);
      g_bytes_unref (reply);
      g_free (self->startup_auth_cookie);
      self->startup_auth_cookie = NULL;
    }
}

static gboolean
cockpit_peer_delete_authorize_values (gpointer user_data)
{
  CockpitPeer *self = user_data;
  g_hash_table_remove_all (self->authorize_values);
  self->authorize_values_timeout = 0;
  return G_SOURCE_REMOVE;
}

static gboolean
on_other_control (CockpitTransport *transport,
                  const char *command,
                  const gchar *channel,
                  JsonObject *options,
                  GBytes *payload,
                  gpointer user_data)
{
  CockpitPeer *self = user_data;
  const gchar *problem = NULL;
  const gchar *cookie = NULL;
  const gchar *challenge = NULL;
  const gchar *prompt;
  gboolean privileged;
  GBytes *reply;
  gint64 timeout;
  gint64 version;
  char *type = NULL;
  GList *l;

  /* Got an init message thaw all channels */
  if (g_str_equal (command, "init"))
    {
      JsonObject *capabilities;
      gboolean explicit_superuser_capability = FALSE;

      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        {
          g_warning ("%s: invalid \"problem\" field in init message", self->name);
          problem = "protocol-error";
        }
      else if (problem)
        {
          if (self->failure)
            json_object_unref (self->failure);
          self->failure = json_object_ref (options);
          json_object_remove_member (self->failure, "version");
        }
      else if (!cockpit_json_get_int (options, "version", -1, &version))
        {
          g_warning ("%s: invalid \"version\" field in init message", self->name);
          problem = "protocol-error";
        }
      else if (version == -1)
        {
          g_warning ("%s: missing \"version\" field in init message", self->name);
          problem = "protocol-error";
        }
      else if (version != 1)
        {
          g_message ("%s: unsupported \"version\" of cockpit protocol: %" G_GINT64_FORMAT,
                     self->name, version);
          problem = "not-supported";
        }

      if (cockpit_json_get_object (options, "capabilities", NULL, &capabilities) && capabilities)
        {
          if (!cockpit_json_get_bool (capabilities, "explicit-superuser", FALSE, &explicit_superuser_capability))
            g_warning ("invalid 'explicit-superuser' value in init message");
        }

      // Authorization for SSH is over now, but we still need the
      // authorize_values for superuser initialization.
      //
      // If the peer has the explicit-superuser capability, we know it
      // will send us a "superuser-init-done" message, and we can
      // delete the creds at that time.  For a legacy bridge without
      // explicit-superuser, we give it two minutes to start up sudo.

      if (self->authorize_values_timeout)
        g_source_remove (self->authorize_values_timeout);
      self->authorize_values_timeout = g_timeout_add (2*60*1000, cockpit_peer_delete_authorize_values, self);

      if (problem)
        {
          startup_done (self, problem);
          cockpit_transport_close (transport, problem);
        }
      else
        {
          g_debug ("%s: received init message from peer bridge", self->name);
          self->inited = TRUE;
          startup_done (self, NULL);

          if (!self->last_init)
            {
              JsonObject *object = cockpit_transport_build_json ("command", "init", NULL);
              json_object_set_int_member (object, "version", 1);
              json_object_set_string_member (object, "host", self->init_host ? self->init_host : "localhost");

              if (explicit_superuser_capability)
                {
                  const gchar *superuser = "none";
                  if (self->init_superuser && *self->init_superuser)
                    superuser = self->init_superuser;

                  if (!g_str_equal (superuser, "none"))
                    {
                      JsonObject *superuser_options;

                      superuser_options = json_object_new ();
                      json_object_set_string_member (superuser_options, "id", superuser);
                      json_object_set_object_member (object, "superuser", superuser_options);
                    }
                  else
                    {
                      json_object_set_boolean_member (object, "superuser", FALSE);
                      g_hash_table_remove_all (self->authorize_values);
                    }
                }

              self->last_init = cockpit_json_write_bytes (object);
              json_object_unref (object);
            }
          cockpit_transport_send (transport, NULL, self->last_init);

          if (self->frozen)
            {
              for (l = self->frozen->head; l != NULL; l = g_list_next (l))
                cockpit_transport_thaw (self->transport, l->data);
              g_queue_free_full (self->frozen, g_free);
              self->frozen = NULL;
            }
        }
    }

  else if (g_str_equal (command, "superuser-init-done"))
    {
      cockpit_peer_delete_authorize_values (self);
    }

  else if (g_str_equal (command, "authorize"))
    {
      if (!cockpit_json_get_string (options, "cookie", NULL, &cookie) || cookie == NULL)
        {
          g_message ("%s: received \"authorize\" request without a valid cookie", self->name);
        }

      else if (!cockpit_json_get_string (options, "challenge", NULL, &challenge))
        {
          g_message ("%s: received \"authorize\" request with a invalid challenge", self->name);
        }
      else if (!cockpit_json_get_string (options, "prompt", NULL, &prompt))
        {
          g_message ("%s: received \"authorize\" request with a invalid prompt", self->name);
        }

      /* Hook into the superuser startup mechanism for privileged bridges.
       */
      else if (cockpit_json_get_bool (self->config, "privileged", FALSE, &privileged) && privileged)
        {
          if (self->startup_auth_cookie)
            g_warning ("%s: received overlapping \"authorize\" requests", self->name);
          else if (!self->router)
            g_warning ("%s: no router for answering \"authorize\" request", self->name);
          else
            {
              gchar *user_hex;
              char *user;
              gchar *stderr;
              self->startup_auth_cookie = g_strdup (cookie);
              cockpit_authorize_subject (challenge, &user_hex);
              user = cockpit_hex_decode (user_hex, -1, NULL);
              stderr = startup_take_stderr (self);
              cockpit_router_prompt (self->router, user, prompt, stderr, on_answer, self);
              g_free (user);
              free (user_hex);
              g_free (stderr);
            }
        }

      /* If we have info we can respond to basic authorize challenges.
         This is used for remote machines.
      */
      else if (challenge && g_hash_table_contains (self->authorize_values, challenge))
        {
          reply = cockpit_transport_build_control ("command", "authorize",
                                                   "cookie", cookie,
                                                   "response",
                                                   g_hash_table_lookup (self->authorize_values, challenge),
                                                   NULL);
          g_hash_table_remove (self->authorize_values, challenge);
          cockpit_transport_send (transport, NULL, reply);
          g_bytes_unref (reply);
        }

      /* Don't pass on "authorize" messages.
       */
      else
        {
          reply = cockpit_transport_build_control ("command", "authorize",
                                                   "cookie", cookie,
                                                   "response", "",
                                                   NULL);
          cockpit_transport_send (transport, NULL, reply);
          g_bytes_unref (reply);
        }
    }

  /* cockpit-bridge --privileged expects to receive a copy of our stderr */
  else if (g_str_equal (command, "send-stderr") &&
           cockpit_json_get_bool (self->config, "privileged", FALSE, &privileged) && privileged)
    {
      CockpitPipe *pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (transport));

      int out_fd;
      g_object_get (pipe, "out-fd", &out_fd, NULL);

      if (!cockpit_socket_send_fd (out_fd, STDERR_FILENO))
        {
          g_critical ("sendmsg() with stderr fd failed: %m");
          cockpit_transport_close (transport, "internal-error");
        }
    }

  /* Otherwise we need an init message first */
  else if (!self->inited)
    {
      g_warning ("%s: did not receive an \"init\" message first", self->name);
      cockpit_transport_close (transport, "protocol-error");
    }

  /* A channel specific control message */
  else if (channel)
    {
      /* Stop keeping track of channels that are closed */
      if (g_str_equal (command, "close"))
        {
          g_hash_table_remove (self->channels, channel);
          if (g_hash_table_size (self->channels) == 0)
            {
              g_debug ("%s: removed last channel for peer", self->name);
              if (self->timeout)
                g_source_remove (self->timeout);
              self->timeout = 0;
              if (cockpit_json_get_int (self->config, "timeout", -1, &timeout) && timeout >= 0)
                self->timeout = g_timeout_add_seconds (timeout, on_timeout_reset, self);
            }
        }

      /* All control messages with a channel get forwarded */
      cockpit_transport_send (self->transport, NULL, payload);
    }

  g_free (type);
  return TRUE;
}

static const gchar *
fail_start_problem (CockpitPeer *self)
{
  const gchar *problem = NULL;

  /* This might be a "problem" in an "init" message from other bridge */
  if (self->failure)
    {
      if (!cockpit_json_get_string (self->failure, "problem", NULL, &problem))
        problem = NULL;
    }

  if (!problem)
    {
      if (!cockpit_json_get_string (self->config, "problem", NULL, &problem))
        problem = NULL;
    }

  g_free (self->problem);
  self->problem = g_strdup (problem);

  return self->problem;
}

static void
on_other_closed (CockpitTransport *transport,
                 const gchar *problem,
                 gpointer user_data)
{
  CockpitPeer *self = COCKPIT_PEER (user_data);
  const gchar *channel;
  GList *l, *channels;
  CockpitPipe *pipe;
  gint status = 0;
  gint64 timeout;
  const gchar *startup_problem = problem;

  /*
   * If we haven't yet gotten an "init" message, then we use the
   * problem code that is in the config. If no problem is configured
   * then we don't close the channel, but let the channel be handled
   * elsewhere or eventually fail with "not-supported".
   */
  if (!self->inited)
    {
      g_debug ("%s: bridge failed to start%s%s", self->name,
               problem ? ": " : "", problem ? problem : "");
      problem = fail_start_problem (self);
    }

  /*
   * The peer has closed after we received an init message. It was
   * up and running and now it's gone. We're more verbose here
   * and end up closing channels that were open.
   */
  else if (!self->closed)
    {
      pipe = cockpit_pipe_transport_get_pipe (COCKPIT_PIPE_TRANSPORT (transport));

      if (cockpit_pipe_get_pid (pipe, NULL))
        status = cockpit_pipe_exit_status (pipe);

      if (WIFSIGNALED (status) && (WTERMSIG (status) == SIGTERM || WTERMSIG (status) == SIGHUP))
        {
          g_debug ("%s: bridge was terminated", self->name);
          if (!problem)
            problem = "terminated";
        }
      else if (WIFSIGNALED (status))
        {
          g_message ("%s: bridge was killed: %d", self->name, (int)WTERMSIG (status));
          if (!problem)
            problem = "internal-error";
        }
      else if (WIFEXITED (status) && WEXITSTATUS (status) != 0)
        {
          g_message ("%s: bridge failed: %d", self->name, (int)WEXITSTATUS (status));
          if (!problem)
            problem = "internal-error";
        }
      else
        {
          g_debug ("%s: bridge exited", self->name);
          if (!problem)
            problem = "disconnected";
        }
    }

  startup_done (self, problem ? problem : startup_problem);

  g_signal_handler_disconnect (self->other, self->other_closed);
  g_signal_handler_disconnect (self->other, self->other_recv);
  g_signal_handler_disconnect (self->other, self->other_control);
  g_object_unref (self->other);
  self->other = NULL;

  self->closed = TRUE;

  /* Handle any remaining open channels */
  channels = g_hash_table_get_values (self->channels);
  g_hash_table_steal_all (self->channels);
  for (l = channels; l != NULL; l = g_list_next (l))
    {
      channel = l->data;

      /*
       * If we have a problem code, that either means that we failed
       * after the peer bridge came up ... or it didn't come up at
       * all yet. See above. In these cases we close the channel.
       */
      if (problem)
        reply_channel_closed (self, channel, problem);

      /*
       * When we don't have a problem code we want this channel
       * to be handled elsewhere. So thaw it and let that happen.
       */
      else
        g_assert (!self->inited);

      cockpit_transport_thaw (self->transport, channel);
    }
  g_list_free_full (channels, g_free);

  /* If the timeout is set, then expect that this bridge can cycle back up */
  if (cockpit_json_get_int (self->config, "timeout", -1, &timeout) && timeout >= 0)
    cockpit_peer_reset (self);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   gpointer user_data)
{
  CockpitPeer *self = COCKPIT_PEER (user_data);

  if (self->other && channel && g_hash_table_lookup (self->channels, channel))
    {
      cockpit_transport_send (self->other, channel, payload);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *payload,
                      gpointer user_data)
{
  CockpitPeer *self = user_data;
  gboolean forward = FALSE;
  gboolean handled = FALSE;

  if (g_str_equal (command, "init"))
    {
      if (self->last_init)
        g_bytes_unref (self->last_init);
      self->last_init = g_bytes_ref (payload);
    }
  else if (channel && g_hash_table_lookup (self->channels, channel))
    {
      handled = forward = TRUE;
      if (g_str_equal (command, "close"))
        g_hash_table_remove (self->channels, channel);
    }
  else if (self->inited)
    {
      if (g_str_equal (command, "kill"))
        {
          forward = TRUE;
        }
    }

  if (forward && self->other)
    cockpit_transport_send (self->other, NULL, payload);

  return handled;
}

static void
cockpit_peer_init (CockpitPeer *self)
{
  self->channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  self->authorize_values = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                  g_free, clear_authorize_value);
}

static void
cockpit_peer_get_property (GObject *object,
                           guint prop_id,
                           GValue *value,
                           GParamSpec *pspec)
{
  CockpitPeer *self = COCKPIT_PEER (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      g_value_set_object (value, self->transport);
      break;
    case PROP_ROUTER:
      g_value_set_object (value, self->router);
      break;
    case PROP_CONFIG:
      g_value_set_boxed (value, self->config);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_peer_set_property (GObject *object,
                           guint prop_id,
                           const GValue *value,
                           GParamSpec *pspec)
{
  CockpitPeer *self = COCKPIT_PEER (object);

  switch (prop_id)
    {
    case PROP_TRANSPORT:
      self->transport = g_value_dup_object (value);
      break;
    case PROP_ROUTER:
      self->router = g_value_get_object (value);
      if (self->router)
        g_object_add_weak_pointer (G_OBJECT(self->router), (gpointer *)&self->router);
      break;
    case PROP_CONFIG:
      self->config = g_value_dup_boxed (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_peer_dispose (GObject *object)
{
  CockpitPeer *self = COCKPIT_PEER (object);

  cockpit_peer_reset (self);
  self->closed = TRUE;

  if (self->transport_recv)
    {
      g_signal_handler_disconnect (self->transport, self->transport_recv);
      self->transport_recv = 0;
    }
  if (self->transport_control)
    {
      g_signal_handler_disconnect (self->transport, self->transport_control);
      self->transport_control = 0;
    }

  G_OBJECT_CLASS (cockpit_peer_parent_class)->dispose (object);
}

static void
cockpit_peer_finalize (GObject *object)
{
  CockpitPeer *self = COCKPIT_PEER (object);

  g_hash_table_destroy (self->channels);
  g_hash_table_destroy (self->authorize_values);

  if (self->config)
    json_object_unref (self->config);
  if (self->transport)
    g_object_unref (self->transport);
  if (self->router)
    {
      cockpit_router_prompt_cancel (self->router, self);
      g_object_remove_weak_pointer (G_OBJECT(self->router), (gpointer *)&self->router);
    }
  if (self->last_init)
    g_bytes_unref (self->last_init);

  g_free (self->problem);
  g_free (self->init_host);
  g_free (self->init_superuser);

  G_OBJECT_CLASS (cockpit_peer_parent_class)->finalize (object);
}

static void
cockpit_peer_constructed (GObject *object)
{
  CockpitPeer *self = COCKPIT_PEER (object);
  JsonArray *array;
  JsonNode *node;

  G_OBJECT_CLASS (cockpit_peer_parent_class)->constructed (object);

  g_return_if_fail (self->config != NULL);
  g_return_if_fail (self->transport != NULL);

  self->transport_recv = g_signal_connect (self->transport, "recv", G_CALLBACK (on_transport_recv), self);
  self->transport_control = g_signal_connect (self->transport, "control", G_CALLBACK (on_transport_control), self);

  /* Get a name */
  if (!cockpit_json_get_array (self->config, "spawn", NULL, &array))
    array = NULL;
  if (array && json_array_get_length (array) > 0)
    {
      node = json_array_get_element (array, 0);
      if (node && JSON_NODE_HOLDS_VALUE (node) && json_node_get_value_type (node) == G_TYPE_STRING)
        self->name = json_node_get_string (node);
    }
}

static void
cockpit_peer_class_init (CockpitPeerClass *class)
{
  GObjectClass *object_class = G_OBJECT_CLASS (class);

  object_class->get_property = cockpit_peer_get_property;
  object_class->set_property = cockpit_peer_set_property;
  object_class->constructed = cockpit_peer_constructed;
  object_class->finalize = cockpit_peer_finalize;
  object_class->dispose = cockpit_peer_dispose;

  g_object_class_install_property (object_class, PROP_TRANSPORT,
                                   g_param_spec_object ("transport", "transport", "transport",
                                                        COCKPIT_TYPE_TRANSPORT,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_ROUTER,
                                   g_param_spec_object ("router", "router", "router",
                                                        COCKPIT_TYPE_ROUTER,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_CONFIG,
                                   g_param_spec_boxed ("config", "config", "config",
                                                       JSON_TYPE_OBJECT,
                                                       G_PARAM_WRITABLE |
                                                       G_PARAM_CONSTRUCT_ONLY |
                                                       G_PARAM_STATIC_STRINGS));
}

/**
 * cockpit_peer_new:
 * @transport: Transport to talk to cockpit-ws with
 * @config: The peer bridge configuration
 *
 * Create a new peer bridge object. The configuration is in the
 * manifest.json format as documented in doc/guide/
 *
 * Returns: (transfer full): The new peer object.
 */
CockpitPeer *
cockpit_peer_new (CockpitTransport *transport,
                  JsonObject *config)
{
  return g_object_new (COCKPIT_TYPE_PEER,
                       "transport", transport,
                       "config", config,
                       NULL);
}

static void
spawn_setup (gpointer data)
{
  int fd = GPOINTER_TO_INT (data);

  /* Send this signal to all direct child processes, when bridge dies */
  prctl (PR_SET_PDEATHSIG, SIGHUP);

  if (dup2 (fd, 0) < 0 || dup2 (fd, 1) < 0)
    {
      perror ("couldn't set peer stdin/stout file descriptors");
      _exit (1);
    }

  close (fd);
}

static CockpitPipe *
spawn_process_for_config (CockpitPeer *self,
                          gboolean capture_stderr)
{
  const gchar *default_argv[] = { "/bin/false", NULL };
  CockpitPipe *pipe = NULL;
  const gchar *directory = NULL;
  const gchar **argv = NULL;
  const gchar **envset = NULL;
  gchar **env = NULL;
  GError *error = NULL;
  GPid pid = 0;
  int fds[2];
  int stderr_fd = -1;

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, fds) < 0)
    {
      g_warning ("couldn't create loopback socket: %s", g_strerror (errno));
    }
  else if (!cockpit_json_get_string (self->config, "directory", NULL, &directory) ||
           !cockpit_json_get_strv (self->config, "environ", NULL, &envset) ||
           !cockpit_json_get_strv (self->config, "spawn", default_argv, &argv))
    {
      g_message ("%s: invalid bridge configuration, cannot spawn channel", self->name);
    }
  else
    {
      g_debug ("%s: spawning peer bridge process", self->name);

      env = cockpit_pipe_get_environ (envset, NULL);
      g_spawn_async_with_pipes (directory, (gchar **)argv, env,
                                G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_SEARCH_PATH,
                                spawn_setup, GINT_TO_POINTER (fds[0]),
                                &pid, NULL, NULL, capture_stderr ? &stderr_fd : NULL, &error);

      if (error)
        {
          if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT) ||
              g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_PERM) ||
              g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_ACCES))
            {
              g_debug ("%s: couldn't run %s: %s", self->name, argv[0], error->message);
            }
          else
            {
              g_message ("%s: couldn't run %s: %s", self->name, argv[0], error->message);
            }
          g_error_free (error);
        }
      else
        {
          pipe = g_object_new (COCKPIT_TYPE_PIPE,
                               "name", self->name,
                               "in-fd", fds[1],
                               "out-fd", fds[1],
                               "err-fd", stderr_fd,
                               "pid", pid,
                               NULL);
          fds[1] = -1;
        }
    }

  if (!pipe)
    fail_start_problem (self);

  if (fds[0] >= 0)
    close (fds[0]);
  if (fds[1] >= 0)
    close (fds[1]);

  g_free (envset);
  g_free (argv);
  g_strfreev (env);

  return pipe;
}

/**
 * cockpit_peer_handle:
 * @peer: The peer object
 * @channel: The channel to handle
 * @options: The parsed "open" message
 * @data: The raw payload for the "open" message
 *
 * Tell the peer bridge to handle this channel.
 *
 * Returns: TRUE if handled, FALSE if the peer bridge has closed.
 */
gboolean
cockpit_peer_handle (CockpitPeer *self,
                     const gchar *channel,
                     JsonObject *options,
                     GBytes *data)
{
  const gchar *user = NULL;
  const gchar *password = NULL;
  const gchar *host = NULL;
  const gchar *host_key = NULL;
  const gchar *superuser = NULL;

  g_return_val_if_fail (COCKPIT_IS_PEER (self), FALSE);
  g_return_val_if_fail (channel != NULL, FALSE);
  g_return_val_if_fail (options != NULL, FALSE);
  g_return_val_if_fail (data != NULL, FALSE);

  if (!self->closed)
    cockpit_peer_ensure (self);

  if (self->closed)
    {
      /* There was an actual problem, close the channel */
      if (self->problem)
        {
          g_debug ("%s: closing channel \"%s\" with \"%s\" because peer closed",
                   self->name, channel, self->problem);
          reply_channel_closed (self, channel, self->problem);
          return TRUE;
        }

      /* We failed to handle channels, let someone else do it */
      g_debug ("%s: refusing to handle channel \"%s\" because peer closed", self->name, channel);
      return FALSE;
    }

  /* If this is the first channel, we can cache data from it */
  if (!self->first_channel_done)
    {
      self->first_channel_done = TRUE;

      if (!self->init_host && cockpit_json_get_string (options, "host", NULL, &host))
        self->init_host = g_strdup (host);

      /* Setup authorize_values
       * TODO: Should this be configurable?
       */
      if (cockpit_json_get_string (options, "user", NULL, &user) &&
          cockpit_json_get_string (options, "password", NULL, &password) && password)
        {
          const gchar *at_host = self->init_host ? strchr (self->init_host, '@') : NULL;
          gchar *user_at_host = NULL;

          if (!user && at_host)
            {
              user_at_host = g_strndup (self->init_host, at_host - self->init_host);
              user = user_at_host;
            }

          if (!user)
            user = g_getenv ("USER");
          // $USER is set in bridge main()
          g_assert (user);

          char *user_hex = cockpit_hex_encode (user, -1);
          gchar *plain1_challenge = g_strdup_printf ("plain1:%s:", user_hex);

          g_hash_table_insert (self->authorize_values, g_strdup ("basic"),
                               cockpit_authorize_build_basic (user, password));
          g_hash_table_insert (self->authorize_values, plain1_challenge,
                               g_strdup (password));

          free (user_hex);
          g_free (user_at_host);
        }

      if (cockpit_json_get_string (options, "host-key", NULL, &host_key))
        {
          g_hash_table_insert (self->authorize_values, g_strdup ("x-host-key"),
                               host_key ? g_strdup_printf ("x-host-key %s", host_key) : g_strdup (""));
        }

      if (cockpit_json_get_string (options, "init-superuser", NULL, &superuser))
        {
          g_free (self->init_superuser);
          self->init_superuser = g_strdup (superuser);
        }
    }

  g_hash_table_add (self->channels, g_strdup (channel));

  if (self->timeout)
    {
      g_source_remove (self->timeout);
      self->timeout = 0;
    }

  /* If already inited send the message through */
  if (self->inited)
    {
      g_debug ("%s: handling channel \"%s\" on peer", self->name, channel);
      on_transport_control (self->transport, "open", channel, options, data, self);
    }

  /* Not yet inited, so freeze this channel and push back into the queue */
  else
    {
      g_debug ("%s: trying to handle channel \"%s\" on peer", self->name, channel);
      if (!self->frozen)
        self->frozen = g_queue_new ();
      g_queue_push_tail (self->frozen, g_strdup (channel));
      cockpit_transport_freeze (self->transport, channel);
      cockpit_transport_emit_recv (self->transport, NULL, data);
    }

  return TRUE;
}

/**
 * cockpit_peer_ensure:
 * @peer: The peer object
 *
 * Ensures that the peer is spawned and initialized, if that's not
 * already the case. If the peer failed this will not restart it and
 * this function will return NULL.
 *
 * Returns: (transfer none): The transport to talk to the peer, or NULL
 */

CockpitTransport *
cockpit_peer_ensure (CockpitPeer *self)
{
  return cockpit_peer_ensure_with_done (self, NULL, NULL);
}

CockpitTransport *
cockpit_peer_ensure_with_done (CockpitPeer *self,
                               CockpitPeerDoneFunction *done_function,
                               gpointer done_data)
{
  CockpitPipe *pipe;

  g_return_val_if_fail (COCKPIT_IS_PEER (self), NULL);

  if (!self->other)
    {
      self->startup_done_function = done_function;
      self->startup_done_data = done_data;

      pipe = spawn_process_for_config (self, done_function != NULL);
      if (!pipe)
        {
          self->closed = TRUE;
          startup_done (self, "spawn failed");
          return NULL;
        }

      self->other = cockpit_pipe_transport_new (pipe);
      g_object_unref (pipe);

      self->other_recv = g_signal_connect (self->other, "recv", G_CALLBACK (on_other_recv), self);
      self->other_closed = g_signal_connect (self->other, "closed", G_CALLBACK (on_other_closed), self);
      self->other_control = g_signal_connect (self->other, "control", G_CALLBACK (on_other_control), self);
    }
  else
    {
      if (done_function)
        done_function (NULL, NULL, done_data);
    }

  return self->other;
}

void
cockpit_peer_reset (CockpitPeer *self)
{
  if (self->timeout)
    {
      g_source_remove (self->timeout);
      self->timeout = 0;
    }

  if (self->other)
    cockpit_transport_close (self->other, "terminated");
  if (self->other)
    on_other_closed (self->other, "terminated", self);
  g_assert (self->other == NULL);

  if (self->frozen)
    g_queue_free_full (self->frozen, g_free);
  self->frozen = NULL;

  g_hash_table_remove_all (self->channels);
  g_hash_table_remove_all (self->authorize_values);
  if (self->authorize_values_timeout)
    {
      g_source_remove (self->authorize_values_timeout);
      self->authorize_values_timeout = 0;
    }

  g_free (self->startup_auth_cookie);
  self->startup_auth_cookie = NULL;

  g_free (self->init_superuser);
  self->init_superuser = NULL;

  if (self->failure)
    {
      json_object_unref (self->failure);
      self->failure = NULL;
    }

  g_free (self->problem);
  self->problem = NULL;
  self->closed = FALSE;
  self->inited = FALSE;
  self->first_channel_done = FALSE;
}
