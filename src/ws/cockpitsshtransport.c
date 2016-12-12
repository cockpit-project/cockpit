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

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpitauth.h"
#include "cockpitauthoptions.h"
#include "cockpitauthprocess.h"
#include "cockpitsshtransport.h"
#include "cockpitsshagent.h"
#include "cockpitws.h"

#include "common/cockpitconf.h"
#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitpipetransport.h"

#include <libssh/libssh.h>
#include <libssh/callbacks.h>

#include <glib/gstdio.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

/**
 * CockpitSshTransport:
 *
 * A #CockpitTransport implementation that spawns a command to start a
 * cockpit-bridge over ssh. Note this is the client side
 * of an SSH connection.  Differs from CockpitPipeTransport in that the pipe
 * isn't started until after authentication has been succesfull.
 * See doc/protocol.md for information on how the
 * framing looks ... including the MSB length prefix.
 */

/* ----------------------------------------------------------------------------
 * CockpitSshTransport implementation
 */

enum {
  PROP_0,
  PROP_NAME,
  PROP_HOST,
  PROP_PORT,
  PROP_CREDS,
  PROP_COMMAND,
  PROP_HOST_KEY,
  PROP_HOST_FINGERPRINT,
  PROP_KNOWN_HOSTS,
  PROP_IGNORE_KEY,
  PROP_AGENT,
  PROP_PROMPT_HOSTKEY,
};

enum
{
  PROMPT,
  NUM_SIGNALS,
};

static guint signals[NUM_SIGNALS];

struct _CockpitSshTransport {
  CockpitTransport parent_instance;

  gboolean closed;
  gboolean closing;
  gboolean connecting;

  CockpitAuthProcess *auth_process;

  CockpitPipe *pipe;
  gulong read_sig;
  gulong close_sig;

  CockpitCreds *creds;

  gchar *host;
  gchar *command;
  gchar *knownhosts_file;
  gchar *expected_hostkey;
  guint port;
  gboolean ignore_hostkey;
  gboolean prompt_hostkey;

  /* Name used for logging */
  gchar *logname;

  /* Transport for ssh agent */
  CockpitSshAgent *agent;

  GQueue *queue;

  // Output from auth
  gchar *host_key;
  gchar *host_fingerprint;
  JsonObject *auth_results;
};

struct _CockpitSshTransportClass {
  CockpitTransportClass parent_class;
};

G_DEFINE_TYPE (CockpitSshTransport, cockpit_ssh_transport, COCKPIT_TYPE_TRANSPORT);


static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (user_data);
  GError *error = NULL;
  gint status;

  self->closing = TRUE;
  self->closed = TRUE;

  /* This function is called by the base class when it is closed */
  if (cockpit_pipe_get_pid (pipe, NULL))
    {
      if (problem == NULL ||
          g_str_equal (problem, "internal-error") ||
          g_str_equal (problem, "terminated"))
        {
          status = cockpit_pipe_exit_status (pipe);
          if (WIFSIGNALED (status) && WTERMSIG (status) == SIGTERM)
            problem = "terminated";
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 127)
            problem = "no-cockpit";      // cockpit-bridge not installed
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 255)
            problem = "terminated";      // failed or got a signal, etc.
          else if (WIFEXITED (status) && WEXITSTATUS (status) == 254)
            problem = "disconnected";    // got IO_ERR.
          else if (!g_spawn_check_exit_status (status, &error))
            {
              if (problem == NULL)
                problem = "internal-error";
              g_warning ("%s: ssh session failed: %s", self->logname, error->message);
              g_error_free (error);
            }
        }
    }

  g_debug ("%s: closed%s%s", self->logname,
           problem ? ": " : "", problem ? problem : "");

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), problem);
}

static void
cockpit_ssh_transport_remove_auth_process (CockpitSshTransport *self)
{
  g_return_if_fail (self->auth_process != NULL);
  if (self->agent)
    cockpit_ssh_agent_close (self->agent);

  if (!self->pipe)
    cockpit_auth_process_terminate (self->auth_process);

  g_clear_object (&self->auth_process);
}

static void
cockpit_ssh_transport_close (CockpitTransport *transport,
                             const gchar *problem)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (transport);

  if (self->closed)
    return;

  self->closing = TRUE;

  /* If still connecting and there isn't a problem
   * don't do anything yet
   */
  if (self->connecting && !problem)
    return;

  if (self->pipe)
    {
      cockpit_pipe_close (self->pipe, problem);
    }
  else if (self->auth_process)
    {
      cockpit_ssh_transport_remove_auth_process (self);
      self->closed = TRUE;
      cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), problem);
    }
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (user_data);
  cockpit_transport_read_from_pipe (COCKPIT_TRANSPORT (self), self->logname,
                                    pipe, &self->closed, input, end_of_data);
}

static void
cockpit_ssh_transport_attach_pipe (CockpitSshTransport *self)
{
  g_return_if_fail (self->pipe == NULL);
  g_return_if_fail (self->auth_process != NULL);

  if (self->agent)
    cockpit_ssh_agent_close (self->agent);

  self->pipe = cockpit_auth_process_claim_as_pipe (self->auth_process);
  self->read_sig = g_signal_connect (self->pipe, "read",
                                     G_CALLBACK (on_pipe_read),
                                     self);
  self->close_sig = g_signal_connect (self->pipe, "close", G_CALLBACK (on_pipe_close), self);
  cockpit_ssh_transport_remove_auth_process (self);

  while (g_queue_peek_head (self->queue))
    {
      GBytes *block = g_queue_pop_head (self->queue);
      cockpit_pipe_write (self->pipe, block);
      g_bytes_unref (block);
    }

  if (self->closing && !self->closed)
    cockpit_pipe_close (self->pipe, NULL);
}

static void
on_auth_process_message (CockpitAuthProcess *auth_process,
                         GBytes *bytes,
                         gpointer user_data)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (user_data);
  JsonObject *json = NULL;
  gchar *response = NULL;
  GError *error = NULL;
  gsize len;
  gboolean prompt_claimed;
  gboolean final = TRUE;
  GBytes *blank = NULL;

  const gchar *user;
  const gchar *error_str;
  const gchar *prompt;
  const gchar *message;
  const gchar *host_key = NULL;
  const gchar *host_fp = NULL;
  JsonObject *auth_result = NULL;
  const gchar *problem = "internal-error";

  len = g_bytes_get_size (bytes);
  response = g_strndup (g_bytes_get_data (bytes, NULL), len);
  json = cockpit_auth_process_parse_result (self->auth_process, response, &error);
  if (json)
    {
      if (!cockpit_json_get_string (json, "error", NULL, &error_str) ||
          !cockpit_json_get_string (json, "message", NULL, &message) ||
          !cockpit_json_get_string (json, "prompt", NULL, &prompt) ||
          !cockpit_json_get_string (json, "user", NULL, &user))
        {
          g_warning ("%s: got invalid authentication json", self->logname);
        }
      else if (error_str)
        {
          problem = error_str;
          g_debug ("%s: got authentication error %s: %s", self->logname, error_str, message);
        }
      else if (prompt)
        {
          final = FALSE;
          problem = NULL;
          // Send the signal, if nothing handles it write a blank response.
          g_signal_emit (self, signals[PROMPT], 0, json, &prompt_claimed);
          if (!prompt_claimed)
            {
              blank = g_bytes_new_static ("", 0);
              cockpit_auth_process_write_auth_bytes (self->auth_process, blank);
              g_bytes_unref (blank);
            }
        }
      else if (user)
        {
          problem = NULL;
          cockpit_ssh_transport_attach_pipe (self);
        }
      else
        {
          g_warning ("%s: got invalid authentication json", self->logname);
        }
    }
  else
    {
      g_warning ("%s: got unexpected response: %s", self->logname, error->message);
    }

  if (final)
    {
      g_return_if_fail (self->host_key == NULL);
      g_return_if_fail (self->host_fingerprint == NULL);
      g_return_if_fail (self->auth_results == NULL);

      self->connecting = FALSE;
      if (!cockpit_json_get_string (json, "host-key", NULL, &host_key) ||
          !cockpit_json_get_string (json, "host-fingerprint", NULL, &host_fp) ||
          !cockpit_json_get_object (json, "auth-method-results", NULL, &auth_result))
        {
          g_warning ("%s: got invalid authentication json", self->logname);
        }

      self->host_key = g_strdup (host_key);
      self->host_fingerprint = g_strdup (host_fp);

      /* Take a ref so we can keep this data until the instance is destroyed */
      if (auth_result)
        self->auth_results = json_object_ref (auth_result);
    }

  if (problem)
    cockpit_ssh_transport_close (COCKPIT_TRANSPORT (self), problem);

  g_clear_error (&error);
  if (json)
    json_object_unref (json);
  g_free (response);
}


static void
on_auth_process_close (CockpitAuthProcess *auth_process,
                       GError *error,
                       const gchar *problem,
                       gpointer user_data)
{
  /* If we get this signal something went wrong
   * with authentication close with authentication-failed.
   */
  CockpitSshTransport *self = user_data;
  g_signal_handlers_disconnect_by_data (self->auth_process, self);
  if (self->connecting && error)
    cockpit_ssh_transport_close (COCKPIT_TRANSPORT (self),
                                 problem ? problem : "internal-error");
}

static gboolean
cockpit_ssh_transport_fail_process (gpointer data)
{
  CockpitSshTransport *self = data;
  if (data)
    cockpit_ssh_transport_close (COCKPIT_TRANSPORT (self), "internal-error");
  return FALSE;
}

static void
cockpit_ssh_transport_start_process (CockpitSshTransport *self,
                                     guint wanted_fd)
{
  gint agent_fd = -1;
  const gchar *argv[] = {
      cockpit_ws_ssh_program,
      NULL,
      NULL,
  };

  gchar **env = g_get_environ ();
  GError *error = NULL;
  GBytes *input = NULL;
  CockpitAuthOptions *options = g_new0 (CockpitAuthOptions, 1);
  CockpitSshOptions *ssh_options = g_new0 (CockpitSshOptions, 1);

  GBytes *password;
  const gchar *gssapi_creds;
  gchar *host_arg = NULL;

  self->connecting = TRUE;

  options->remote_peer = cockpit_creds_get_rhost (self->creds);
  ssh_options->allow_unknown_hosts = TRUE;
  ssh_options->supports_hostkey_prompt = self->prompt_hostkey;
  ssh_options->command = self->command;
  ssh_options->knownhosts_file = self->knownhosts_file;
  ssh_options->ignore_hostkey = self->ignore_hostkey;
  ssh_options->knownhosts_data = self->expected_hostkey;

  password = cockpit_creds_get_password (self->creds);
  gssapi_creds = cockpit_creds_get_gssapi_creds (self->creds);

  if (cockpit_creds_has_gssapi (self->creds))
    {
      ssh_options->krb5_ccache_name = cockpit_creds_get_krb5_ccache_name (self->creds);
      options->auth_type = "gssapi-mic";
      input = g_bytes_new_static (gssapi_creds, strlen (gssapi_creds));
      g_debug ("%s: preparing gssapi creds", self->logname);
    }
  else if (password)
    {
      options->auth_type = "password";
      input = g_bytes_ref (password);
      g_debug ("%s: preparing password creds", self->logname);
    }

  host_arg = g_strdup_printf ("%s@%s:%d",
                              cockpit_creds_get_user (self->creds),
                              self->host,
                              self->port ? self->port : 22);

  if (self->agent)
    agent_fd = cockpit_ssh_agent_steal_fd (self->agent);

  if (agent_fd > 0)
    ssh_options->agent_fd = wanted_fd + 1;

  env = cockpit_auth_options_to_env (options, env);
  env = cockpit_ssh_options_to_env (ssh_options, env);
  argv[1] = host_arg;

  if (!cockpit_auth_process_start (self->auth_process,
                                   argv,
                                   (const gchar **)env,
                                   agent_fd,
                                   input ? FALSE : TRUE,
                                   &error))
    {
      g_warning ("%s: couldn't start auth process: %s", self->logname, error->message);
      g_idle_add_full (G_PRIORITY_HIGH_IDLE,
                       cockpit_ssh_transport_fail_process,
                       self, NULL);
    }
  else
    {
      g_signal_connect (self->auth_process, "message",
                        G_CALLBACK (on_auth_process_message), self);
      g_signal_connect (self->auth_process, "close",
                        G_CALLBACK (on_auth_process_close), self);

      if (input)
        cockpit_auth_process_write_auth_bytes (self->auth_process, input);
    }

  g_strfreev (env);
  g_free (options);
  g_free (ssh_options);
  g_free (host_arg);
  g_bytes_unref (input);
}

static void
cockpit_ssh_transport_init (CockpitSshTransport *self)
{
  self->queue = g_queue_new ();
}

static void
cockpit_ssh_transport_constructed (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);
  guint pipe_timeout;
  guint idle_timeout;
  guint wanted_fd;

  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->constructed (object);

  g_return_if_fail (self->creds != NULL);
  g_return_if_fail (self->host != NULL);

  /* How long to wait for the auth process to send some data */
  pipe_timeout = cockpit_conf_guint (SSH_SECTION, "timeout",
                                     cockpit_ws_auth_process_timeout, 1, 999);
  /* How long to wait for a response from the client to a auth prompt */
  idle_timeout = cockpit_conf_guint (SSH_SECTION, "response-timeout",
                                     cockpit_ws_auth_response_timeout, 1, 999);
  /* The wanted authfd for this command, default is 3 */
  wanted_fd = cockpit_conf_guint (SSH_SECTION, "authFD", 3, 1024, 3);

  self->auth_process = g_object_new (COCKPIT_TYPE_AUTH_PROCESS,
                                   "pipe-timeout", pipe_timeout,
                                   "idle-timeout", idle_timeout,
                                   "logname", cockpit_ws_ssh_program,
                                   "name", self->logname,
                                   "wanted-auth-fd", wanted_fd,
                                   NULL);
  cockpit_ssh_transport_start_process (self, wanted_fd);
  g_debug ("%s: constructed", self->logname);
}

static void
cockpit_ssh_transport_set_property (GObject *obj,
                                    guint prop_id,
                                    const GValue *value,
                                    GParamSpec *pspec)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (obj);

  switch (prop_id)
    {
    case PROP_HOST:
      self->logname = g_value_dup_string (value);
      self->host = g_value_dup_string (value);
      break;
    case PROP_PORT:
        self->port = g_value_get_uint (value);
      break;
    case PROP_KNOWN_HOSTS:
      self->knownhosts_file = g_value_dup_string (value);
      break;
    case PROP_CREDS:
      self->creds = g_value_dup_boxed (value);
      break;
    case PROP_AGENT:
      self->agent = g_value_dup_object (value);
      break;
    case PROP_COMMAND:
      self->command = g_value_dup_string (value);
      break;
    case PROP_HOST_KEY:
      self->expected_hostkey = g_value_dup_string (value);
      break;
    case PROP_IGNORE_KEY:
      self->ignore_hostkey = g_value_get_boolean (value);
      break;
    case PROP_PROMPT_HOSTKEY:
      self->prompt_hostkey = g_value_get_boolean (value);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_ssh_transport_get_property (GObject *obj,
                                    guint prop_id,
                                    GValue *value,
                                    GParamSpec *pspec)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (obj);

  switch (prop_id)
    {
    case PROP_NAME:
      g_value_set_string (value, self->logname);
      break;
    case PROP_HOST_KEY:
      g_value_set_string (value, cockpit_ssh_transport_get_host_key (self));
      break;
    case PROP_HOST_FINGERPRINT:
      g_value_set_string (value, cockpit_ssh_transport_get_host_fingerprint (self));
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_ssh_transport_finalize (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);

  if (self->agent)
    g_object_unref (self->agent);

  if (self->creds)
    cockpit_creds_unref (self->creds);

  g_free (self->logname);
  g_free (self->host);
  g_free (self->command);
  g_free (self->knownhosts_file);
  g_free (self->expected_hostkey);

  g_free (self->host_key);
  g_free (self->host_fingerprint);

  if (self->auth_results)
    json_object_unref (self->auth_results);


  if (self->pipe)
    {
      g_signal_handler_disconnect (self->pipe, self->read_sig);
      g_signal_handler_disconnect (self->pipe, self->close_sig);
      g_object_unref (self->pipe);
    }

  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);
  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->finalize (object);
}

static void
cockpit_ssh_transport_send (CockpitTransport *transport,
                            const gchar *channel,
                            GBytes *payload)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (transport);
  gchar *prefix;
  GBytes *prefix_bytes;
  gsize channel_len;
  gsize payload_len;

  if (self->closed)
    {
      g_debug ("dropping message on closed transport");
      return;
    }

  channel_len = channel ? strlen (channel) : 0;
  payload_len = g_bytes_get_size (payload);

  prefix = g_strdup_printf ("%" G_GSIZE_FORMAT "\n%s\n",
                                channel_len + 1 + payload_len,
                                channel ? channel : "");
  prefix_bytes = g_bytes_new_take (prefix, strlen (prefix));

  if (!self->pipe)
    {
      g_queue_push_tail (self->queue, g_bytes_ref (prefix_bytes));
      g_queue_push_tail (self->queue, g_bytes_ref (payload));
    }
  else
    {
      cockpit_pipe_write (self->pipe, prefix_bytes);
      cockpit_pipe_write (self->pipe, payload);
    }

  g_bytes_unref (prefix_bytes);
  g_debug ("%s: queued %" G_GSIZE_FORMAT " byte payload", self->logname, payload_len);
}

static void
cockpit_ssh_transport_dispose (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);

  if (!self->closed)
    cockpit_ssh_transport_close (COCKPIT_TRANSPORT (self), "disconnected");

  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->dispose (object);
}

static void
cockpit_ssh_transport_class_init (CockpitSshTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);

  transport_class->send = cockpit_ssh_transport_send;
  transport_class->close = cockpit_ssh_transport_close;

  object_class->constructed = cockpit_ssh_transport_constructed;
  object_class->get_property = cockpit_ssh_transport_get_property;
  object_class->set_property = cockpit_ssh_transport_set_property;
  object_class->dispose = cockpit_ssh_transport_dispose;
  object_class->finalize = cockpit_ssh_transport_finalize;

  g_object_class_install_property (object_class, PROP_HOST,
         g_param_spec_string ("host", NULL, NULL, "localhost",
                              G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_PORT,
         g_param_spec_uint ("port", NULL, NULL, 0, 65535, 0,
                            G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_COMMAND,
         g_param_spec_string ("command", NULL, NULL, NULL,
                              G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_KNOWN_HOSTS,
         g_param_spec_string ("known-hosts", NULL, NULL, NULL,
                              G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_HOST_KEY,
         g_param_spec_string ("host-key", NULL, NULL, NULL,
                              G_PARAM_READWRITE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_HOST_FINGERPRINT,
         g_param_spec_string ("host-fingerprint", NULL, NULL, NULL,
                              G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_IGNORE_KEY,
         g_param_spec_boolean ("ignore-key", NULL, NULL, FALSE,
                               G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_PROMPT_HOSTKEY,
         g_param_spec_boolean ("prompt-hostkey", NULL, NULL, FALSE,
                               G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_CREDS,
         g_param_spec_boxed ("creds", NULL, NULL, COCKPIT_TYPE_CREDS,
                             G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (object_class, PROP_AGENT,
         g_param_spec_object ("agent", NULL, NULL, COCKPIT_TYPE_SSH_AGENT,
                             G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  signals[PROMPT] = g_signal_new ("prompt", COCKPIT_TYPE_SSH_TRANSPORT, G_SIGNAL_RUN_LAST,
                                  0, g_signal_accumulator_true_handled, NULL,
                                  g_cclosure_marshal_generic, G_TYPE_BOOLEAN, 1, JSON_TYPE_OBJECT);

  g_object_class_override_property (object_class, PROP_NAME, "name");
}

/**
 * cockpit_ssh_transport_new:
 * @host: host to connect to
 * @port: the port to connect to, or 0 for default
 * @creds: credentials to use for authentication
 *
 * Create a new CockpitSshTransport to connect to
 * a host.
 *
 * Returns: (transfer full): the new transport
 */
CockpitTransport *
cockpit_ssh_transport_new (const gchar *host,
                           guint port,
                           CockpitCreds *creds)
{
  return g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                       "host", host,
                       "port", port,
                       "creds", creds,
                       NULL);
}

/**
 * cockpit_ssh_transport_get_host_key:
 * @self: the ssh tranpsort
 *
 * Get the host key of the ssh connection. This is only
 * valid after the transport opens ... and since you
 * can't detect that reliably, you really should only
 * be calling this after the transport closes.
 *
 * The host key is a opaque string.
 *
 * Returns: (transfer none): the host key
 */
const gchar *
cockpit_ssh_transport_get_host_key (CockpitSshTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_SSH_TRANSPORT (self), NULL);
  return self->host_key;
}

/**
 * cockpit_ssh_transport_get_host_fingerprint:
 * @self: the ssh tranpsort
 *
 * Get the host fingerprint of the ssh connection. This is only
 * valid after the transport opens ... and since you
 * can't detect that reliably, you really should only
 * be calling this after the transport closes.
 *
 * Returns: (transfer none): the host key
 */
const gchar *
cockpit_ssh_transport_get_host_fingerprint (CockpitSshTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_SSH_TRANSPORT (self), NULL);
  return self->host_fingerprint;
}

/**
 * cockpit_ssh_transport_get_auth_method_results
 * @self: the ssh tranpsort
 *
 * This is only valid after the transport opens ...
 * and since you can't detect that reliably, you really
 * should only be calling this after the transport closes.
 *
 * Returns: (transfer none): a JsonObject with a key for
 * each supported auth method. Possible values are:
 *   not-provided
 *   no-server-support
 *   succeeded
 *   denied
 *   partial
 *   error
 */
JsonObject *
cockpit_ssh_transport_get_auth_method_results (CockpitSshTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_SSH_TRANSPORT (self), NULL);
  return self->auth_results;
}

/**
 * cockpit_ssh_transport_get_auth_process
 * @self: the ssh tranpsort
 *
 * Once authentication succeeds this will be null.
 */
CockpitAuthProcess *
cockpit_ssh_transport_get_auth_process (CockpitSshTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_SSH_TRANSPORT (self), NULL);
  return self->auth_process;
}
