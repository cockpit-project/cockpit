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

#include "cockpitsessiontransport.h"

#include "common/cockpitpipe.h"

#include <glib/gstdio.h>

/**
 * CockpitSessionTransport:
 *
 * A #CockpitTransport implementation that shuttles data over a
 * CockpitPipeTransport after authenticating the user.
 */

#if 0
cockpit_ssh_authenticate (CockpitSshData *data)
{
  gss_cred_id_t gsscreds = GSS_C_NO_CREDENTIAL;
  const gchar *password = NULL;
  const gchar *problem;
  gboolean tried = FALSE;
  gchar *description;
  const gchar *msg;
  int methods;
  int rc;

  problem = "not-authorized";

  rc = ssh_userauth_none (data->session, NULL);
  if (rc == SSH_AUTH_ERROR)
    {
      if (g_atomic_int_get (data->connecting))
        g_message ("%s: server authentication handshake failed: %s",
                   data->logname, ssh_get_error (data->session));
      problem = "internal-error";
      goto out;
    }

  if (rc == SSH_AUTH_SUCCESS)
    {
      problem = NULL;
      goto out;
    }

  methods = ssh_userauth_list (data->session, NULL);
  if (methods & SSH_AUTH_METHOD_PASSWORD)
    {
      password = cockpit_creds_get_password (data->creds);
      if (password)
        {
          tried = TRUE;
          rc = ssh_userauth_password (data->session, NULL, password);
          switch (rc)
            {
            case SSH_AUTH_SUCCESS:
              g_debug ("%s: password auth succeeded", data->logname);
              problem = NULL;
              goto out;
            case SSH_AUTH_DENIED:
              g_debug ("%s: password auth failed", data->logname);
              break;
            case SSH_AUTH_PARTIAL:
              g_message ("%s: password auth worked, but server wants more authentication",
                         data->logname);
              break;
            case SSH_AUTH_AGAIN:
              g_message ("%s: password auth failed: server asked for retry",
                         data->logname);
              break;
            default:
              msg = ssh_get_error (data->session);
              if (g_atomic_int_get (data->connecting))
                g_message ("%s: couldn't authenticate: %s", data->logname, msg);
              if (ssh_msg_is_disconnected (msg))
                problem = "terminated";
              else
                problem = "internal-error";
              goto out;
            }
        }
    }

  if (methods & SSH_AUTH_METHOD_GSSAPI_MIC)
    {
      tried = TRUE;

      gsscreds = cockpit_creds_push_thread_default_gssapi (data->creds);
      if (gsscreds != GSS_C_NO_CREDENTIAL)
        {
#ifdef HAVE_SSH_GSSAPI_SET_CREDS
          ssh_gssapi_set_creds (data->session, gsscreds);
#else
          g_warning ("unable to forward delegated gssapi kerberos credentials because the "
                     "version of libssh on this system does not support it.");
#endif

          rc = ssh_userauth_gssapi (data->session);

#ifdef HAVE_SSH_GSSAPI_SET_CREDS
          ssh_gssapi_set_creds (data->session, NULL);
#endif

          switch (rc)
            {
            case SSH_AUTH_SUCCESS:
              g_debug("%s: gssapi auth succeeded", data->logname);
              problem = NULL;
              goto out;
            case SSH_AUTH_DENIED:
              g_debug ("%s: gssapi auth failed", data->logname);
              break;
            case SSH_AUTH_PARTIAL:
              g_message ("%s: gssapi auth worked, but server wants more authentication",
                         data->logname);
              break;
            default:
              msg = ssh_get_error (data->session);
              if (g_atomic_int_get (data->connecting))
                g_message ("%s: couldn't authenticate: %s", data->logname, msg);
              if (ssh_msg_is_disconnected (msg))
                problem = "terminated";
              else
                problem = "internal-error";
              goto out;
            }
        }
    }

  if (!tried)
    {
      description = auth_method_description (methods);
      g_message ("%s: server offered unsupported authentication methods: %s",
                 data->logname, description);
      g_free (description);
      problem = "not-authorized";
    }
  else if (!password && gsscreds == GSS_C_NO_CREDENTIAL)
    {
      problem = "no-forwarding";
    }
  else
    {
      problem = "not-authorized";
    }

out:
  cockpit_creds_pop_thread_default_gssapi (data->creds, gsscreds);
  return problem;
}

static const gchar *
cockpit_ssh_connect (CockpitSshData *data)
{
  const gchar *problem;
  int rc;

  /*
   * If connect_done is set prematurely by another thread then the
   * connection attempt was cancelled.
   */

  rc = ssh_connect (data->session);
  if (rc != SSH_OK)
    {
      if (g_atomic_int_get (data->connecting))
        g_message ("%s: couldn't connect: %s", data->logname,
                   ssh_get_error (data->session));
      return "no-host";
    }

  g_debug ("%s: connected", data->logname);

  if (!data->ignore_key)
    {
      problem = verify_knownhost (data);
      if (problem != NULL)
        return problem;
    }

  /* The problem returned when auth failure */
  problem = cockpit_ssh_authenticate (data);
  if (problem != NULL)
    return problem;

  data->channel = ssh_channel_new (data->session);
  g_return_val_if_fail (data->channel != NULL, NULL);

  rc = ssh_channel_open_session (data->channel);
  if (rc != SSH_OK)
    {
      if (g_atomic_int_get (data->connecting))
        g_message ("%s: couldn't open session: %s", data->logname,
                   ssh_get_error (data->session));
      return "internal-error";
    }

  rc = ssh_channel_request_exec (data->channel, data->command);
  if (rc != SSH_OK)
    {
      if (g_atomic_int_get (data->connecting))
        g_message ("%s: couldn't execute command: %s: %s", data->logname,
                   data->command, ssh_get_error (data->session));
      return "internal-error";
    }

  g_debug ("%s: opened channel", data->logname);

  /* Success */
  return NULL;
}

static gpointer
cockpit_ssh_connect_thread (gpointer user_data)
{
  CockpitSshData *data = user_data;
  data->problem = cockpit_ssh_connect (data);
  g_atomic_int_set (data->connecting, 0);
  g_main_context_wakeup (data->context);
  return data; /* give the data back */
}

static void
cockpit_ssh_data_free (CockpitSshData *data)
{
  if (data->context)
    g_main_context_unref (data->context);
  g_free (data->command);
  if (data->creds)
    cockpit_creds_unref (data->creds);
  g_free (data->expect_key);
  g_free (data->host_key);
  if (data->host_fingerprint)
    ssh_string_free_char (data->host_fingerprint);
  ssh_free (data->session);
  g_free (data->knownhosts_file);
  g_free (data);
}

#endif


enum {
  PROP_0,
  PROP_NAME,
  PROP_CREDS,
};

struct _CockpitSessionTransport {
  CockpitPipeTransport parent_instance;

#if 0
  /* Name used for logging */
  gchar *logname;
#endif

  CockpitPipe *auth_pipe;
  CockpitPipe *session_pipe;
  GBytes *authorization;
  gchar *remote_peer;
  gchar *auth_type;
};

struct _CockpitSessionTransportClass {
  CockpitPipeTransportClass parent_class;
};

#if 0
static void close_immediately (CockpitSshTransport *self,
                               const gchar *problem);
#endif

G_DEFINE_TYPE (CockpitSessionTransport, cockpit_session_transport, COCKPIT_TYPE_PIPE_TRANSPORT);

#if 0
static gboolean
on_timeout_close (gpointer data)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (data);
  self->timeout_close = 0;

  g_debug ("%s: forcing close after timeout", self->logname);
  close_immediately (self, NULL);

  return FALSE;
}

static gboolean
close_maybe (CockpitSshTransport *self,
             gint session_io_status)
{
  if (self->closed)
    return TRUE;

  if (!self->sent_close || !self->received_close)
    return FALSE;

  /*
   * Channel completely closed, and output buffers
   * are empty. We're in a good place to close the
   * SSH session and thus the transport.
   */
  if (self->received_exit && !(session_io_status & SSH_WRITE_PENDING))
    {
      close_immediately (self, NULL);
      return TRUE;
    }

  /*
   * Give a 3 second timeout for the session to get an
   * exit signal and or drain its buffers. Otherwise force.
   */
  if (!self->timeout_close)
    self->timeout_close = g_timeout_add_seconds (3, on_timeout_close, self);

  return FALSE;
}


static int
on_channel_data (ssh_session session,
                 ssh_channel channel,
                 void *data,
                 uint32_t len,
                 int is_stderr,
                 void *userdata)
{
  CockpitSshTransport *self = userdata;

  if (is_stderr)
    {
      g_debug ("%s: received %d stderr bytes", self->logname, (int)len);
      g_printerr ("%.*s", (int)len, (const char *)data);
    }
  else
    {
      g_debug ("%s: received %d bytes", self->logname, (int)len);
      g_byte_array_append (self->buffer, data, len);
      self->drain_buffer = TRUE;
    }
  return len;
}

static void
on_channel_eof (ssh_session session,
                ssh_channel channel,
                void *userdata)
{
  CockpitSshTransport *self = userdata;
  g_debug ("%s: received eof", self->logname);
  self->received_eof = TRUE;
  self->drain_buffer = TRUE;
}

static void
on_channel_close (ssh_session session,
                  ssh_channel channel,
                  void *userdata)
{
  CockpitSshTransport *self = userdata;
  g_debug ("%s: received close", self->logname);
  self->received_close = TRUE;
}

static void
on_channel_exit_signal (ssh_session session,
                        ssh_channel channel,
                        const char *signal,
                        int core,
                        const char *errmsg,
                        const char *lang,
                        void *userdata)
{
  CockpitSshTransport *self = userdata;
  const gchar *problem = NULL;

  g_return_if_fail (signal != NULL);

  self->received_exit = TRUE;

  if (g_ascii_strcasecmp (signal, "TERM") == 0 ||
      g_ascii_strcasecmp (signal, "Terminated") == 0)
    {
      g_debug ("%s: received TERM signal", self->logname);
      problem = "terminated";
    }
  else
    {
      if (errmsg)
        g_warning ("%s: session program killed: %s", self->logname, errmsg);
      else
        g_warning ("%s: session program killed by %s signal", self->logname, signal);
      problem = "internal-error";
    }

  if (!self->problem)
    self->problem = problem;

  close_maybe (self, ssh_get_status (session));
}

static void
on_channel_signal (ssh_session session,
                   ssh_channel channel,
                   const char *signal,
                   void *userdata)
{
  /*
   * HACK: So it looks like libssh is buggy and is confused about
   * the difference between "exit-signal" and "signal" in section 6.10
   * of the RFC. Accept signal as a usable substitute
   */
  if (g_ascii_strcasecmp (signal, "TERM") == 0 ||
      g_ascii_strcasecmp (signal, "Terminated") == 0)
    on_channel_exit_signal (session, channel, signal, 0, NULL, NULL, userdata);
}

static void
on_channel_exit_status (ssh_session session,
                        ssh_channel channel,
                        int exit_status,
                        void *userdata)
{
  CockpitSshTransport *self = userdata;
  const gchar *problem = NULL;

  self->received_exit = TRUE;
  if (exit_status == 127)
    {
      g_debug ("%s: received exit status %d", self->logname, exit_status);
      problem = "no-cockpit";        /* cockpit-bridge not installed */
    }
  else if (exit_status)
    {
      g_warning ("%s: session program exited with %d status", self->logname, exit_status);
      problem = "internal-error";
    }
  if (!self->problem)
    self->problem = problem;

  close_maybe (self, ssh_get_status (session));
}

#endif

static void
cockpit_session_transport_init (CockpitSshTransport *self)
{
  xxxx;
}

static void
cockpit_session_transport_constructed (GObject *object)
{
  CockpitSessionTransport *self = COCKPIT_SESSION_TRANSPORT (object);

  G_OBJECT_CLASS (cockpit_session_transport_parent_class)->constructed (object);

  xxx;
  g_debug ("%s: constructed", self->logname);
}

#if 0
static void
cockpit_ssh_transport_set_property (GObject *obj,
                                    guint prop_id,
                                    const GValue *value,
                                    GParamSpec *pspec)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (obj);
  const gchar *string;
  int port;

  switch (prop_id)
    {
    case PROP_HOST:
      self->logname = g_value_dup_string (value);
      self->data->logname = self->logname;
      g_warn_if_fail (ssh_options_set (self->data->session, SSH_OPTIONS_HOST,
                                       g_value_get_string (value)) == 0);
      break;
    case PROP_PORT:
      port = g_value_get_uint (value);
      if (port == 0)
        port = 22;
      g_warn_if_fail (ssh_options_set (self->data->session, SSH_OPTIONS_PORT, &port) == 0);
      break;
    case PROP_KNOWN_HOSTS:
      string = g_value_get_string (value);
      if (string == NULL)
        string = PACKAGE_LOCALSTATE_DIR "/lib/cockpit/known_hosts";
      ssh_options_set (self->data->session, SSH_OPTIONS_KNOWNHOSTS, string);
      self->data->knownhosts_file = g_strdup (string);
      break;
    case PROP_CREDS:
      self->data->creds = g_value_dup_boxed (value);
      break;
    case PROP_COMMAND:
      string = g_value_get_string (value);
      if (string == NULL)
        string = "cockpit-bridge";
      self->data->command = g_strdup (string);
      break;
    case PROP_HOST_KEY:
      self->data->expect_key = g_value_dup_string (value);
      break;
    case PROP_IGNORE_KEY:
      self->data->ignore_key = g_value_get_boolean (value);
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
cockpit_ssh_transport_dispose (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);

  close_immediately (self, "disconnected");

  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->finalize (object);
}
#endif

static void
cockpit_session_transport_finalize (GObject *object)
{
  CockpitSessionTransport *self = COCKPIT_SESSION_TRANSPORT (object);

  if (self->auth_pipe)
    g_object_unref (self->auth_pipe);
  if (self->authorization)
    g_bytes_unref (self->authorization);
  g_free (self->auth_type);
  g_free (self->remote_peer);

  G_OBJECT_CLASS (cockpit_session_transport_parent_class)->finalize (object);
}

static void
cockpit_ssh_transport_send (CockpitTransport *transport,
                            const gchar *channel,
                            GBytes *payload)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (transport);
  gchar *prefix;
  gsize channel_len;
  gsize payload_len;
  gsize length;

  g_return_if_fail (!self->closing);

  channel_len = channel ? strlen (channel) : 0;
  payload_len = g_bytes_get_size (payload);

  prefix = g_strdup_printf ("%" G_GSIZE_FORMAT "\n%s\n",
                                channel_len + 1 + payload_len,
                                channel ? channel : "");
  length = strlen (prefix);

  g_queue_push_tail (self->queue, g_bytes_new_take (prefix, length));
  g_queue_push_tail (self->queue, g_bytes_ref (payload));

  g_debug ("%s: queued %" G_GSIZE_FORMAT " byte payload", self->logname, payload_len);
}

static void
cockpit_ssh_transport_close (CockpitTransport *transport,
                             const gchar *problem)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (transport);

  self->closing = TRUE;

  if (problem)
    close_immediately (self, problem);
}

static void
cockpit_ssh_transport_class_init (CockpitSshTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);
  const gchar *env;

  transport_class->send = cockpit_ssh_transport_send;
  transport_class->close = cockpit_ssh_transport_close;

  env = g_getenv ("G_MESSAGES_DEBUG");
  if (env && strstr (env, "libssh"))
    ssh_set_log_level (SSH_LOG_FUNCTIONS);

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

  g_object_class_install_property (object_class, PROP_CREDS,
         g_param_spec_boxed ("creds", NULL, NULL, COCKPIT_TYPE_CREDS,
                             G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_signal_new ("result", COCKPIT_TYPE_SSH_TRANSPORT, G_SIGNAL_RUN_FIRST, 0, NULL, NULL,
                g_cclosure_marshal_generic, G_TYPE_NONE, 1, G_TYPE_STRING);

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
 * The host key is a opaque string.  You can pass it to the AddMachine
 * method of cockpitd, for example, but you should not try to
 * interpret it.
 *
 * Returns: (transfer none): the host key
 */
const gchar *
cockpit_ssh_transport_get_host_key (CockpitSshTransport *self)
{
  g_return_val_if_fail (COCKPIT_IS_SSH_TRANSPORT (self), NULL);

  if (!self->data)
    return NULL;
  return self->data->host_key;
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

  if (!self->data)
    return NULL;
  return self->data->host_fingerprint;
}
#endif
