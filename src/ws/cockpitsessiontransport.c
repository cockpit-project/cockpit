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

#if 0
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
  PROP_HEADERS,
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
cockpit_session_transport_init (CockpitSessionTransport *self)
{

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
cockpit_session_transport_class_init (CockpitSessionTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->constructed = cockpit_session_transport_constructed;
  object_class->get_property = cockpit_session_transport_get_property;
  object_class->set_property = cockpit_session_transport_set_property;
  object_class->dispose = cockpit_session_transport_dispose;
  object_class->finalize = cockpit_session_transport_finalize;

  g_object_class_install_property (object_class, PROP_CREDS,
         g_param_spec_boxed ("creds", NULL, NULL, COCKPIT_TYPE_CREDS,
                             G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  g_signal_new ("result", COCKPIT_TYPE_SSH_TRANSPORT, G_SIGNAL_RUN_FIRST, 0, NULL, NULL,
                g_cclosure_marshal_generic, G_TYPE_NONE, 1, G_TYPE_STRING);

  g_object_class_override_property (object_class, PROP_NAME, "name");
}

static CockpitCreds *
create_creds_for_authenticated (const char *user,
                                SessionLoginData *sl,
                                JsonObject *results)
{
  const gchar *fullname = NULL;
  const gchar *password = NULL;
  const gchar *gssapi_creds = NULL;

  /*
   * Dig the password out of the authorization header, rather than having
   * cockpit-session pass it back and forth possibly leaking it.
   */

  if (g_str_equal (sl->auth_type, "basic"))
    password = parse_basic_auth_password (sl->authorization, NULL);

  if (!cockpit_json_get_string (results, "gssapi-creds", NULL, &gssapi_creds))
    {
      g_warning ("received bad gssapi-creds from cockpit-session");
      gssapi_creds = NULL;
    }

  if (!cockpit_json_get_string (results, "full-name", NULL, &fullname))
    {
      g_warning ("received bad full-name from cockpit-session");
      fullname = NULL;
    }

  /* TODO: Try to avoid copying password */
  return cockpit_creds_new (user,
                            COCKPIT_CRED_FULLNAME, fullname,
                            COCKPIT_CRED_PASSWORD, password,
                            COCKPIT_CRED_RHOST, sl->remote_peer,
                            COCKPIT_CRED_GSSAPI, gssapi_creds,
                            NULL);
}

static CockpitCreds *
parse_auth_results (SessionLoginData *sl,
                    GHashTable *headers,
                    GError **error)
{
  CockpitCreds *creds = NULL;
  GByteArray *buffer;
  GError *json_error = NULL;
  const gchar *pam_user;
  JsonObject *results;
  gint64 code = -1;

  buffer = cockpit_pipe_get_buffer (sl->auth_pipe);
  g_debug ("cockpit-session says: %.*s", (int)buffer->len, (const gchar *)buffer->data);

  results = cockpit_json_parse_object ((const gchar *)buffer->data, buffer->len, &json_error);

  if (g_error_matches (json_error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_DATA))
    {
      g_message ("got non-utf8 user name from cockpit-session");
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Login user name is not UTF8 encoded");
      g_error_free (json_error);
    }
  else if (!results)
    {
      g_warning ("couldn't parse session auth output: %s",
                 json_error ? json_error->message : NULL);
      g_error_free (json_error);
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Invalid data from session process: no results");
    }
  else if (!cockpit_json_get_int (results, "result-code", -1, &code) || code < 0)
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Invalid data from session process: bad PAM result");
    }
  else if (code == PAM_SUCCESS)
    {
      if (!cockpit_json_get_string (results, "user", NULL, &pam_user) || !pam_user)
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                       "Invalid data from session process: missing user");
        }
      else
        {
          g_debug ("user authenticated as %s", pam_user);
          creds = create_creds_for_authenticated (pam_user, sl, results);
        }
    }
  else if (code == PAM_AUTH_ERR || code == PAM_USER_UNKNOWN)
    {
      g_debug ("authentication failed: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                   "Authentication failed");
    }
  else if (code == PAM_PERM_DENIED)
    {
      g_debug ("permission denied: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_PERMISSION_DENIED,
                   "Permission denied");
    }
  else
    {
      g_debug ("pam error: %d", (int)code);
      g_set_error (error, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                   "%s", pam_strerror (NULL, code));
    }

  build_gssapi_output_header (headers, results);

  if (results)
    json_object_unref (results);
  return creds;
}


static void
cockpit_auth_session_login_async (CockpitAuth *self,
                                  GHashTable *headers,
                                  const gchar *remote_peer,
                                  GAsyncReadyCallback callback,
                                  gpointer user_data)
{
  GSimpleAsyncResult *result;
  SessionLoginData *sl;
  GBytes *input;
  gchar *type = NULL;

  result = g_simple_async_result_new (G_OBJECT (self), callback, user_data,
                                      cockpit_auth_session_login_async);

  input = cockpit_auth_parse_authorization (headers, &type);

  if (input)
    {
      sl = g_new0 (SessionLoginData, 1);
      sl->remote_peer = g_strdup (remote_peer);
      sl->auth_type = type;
      sl->authorization = input;
      g_simple_async_result_set_op_res_gpointer (result, sl, session_login_data_free);

      sl->session_pipe = spawn_session_process (type, input, remote_peer, &sl->auth_pipe);

      if (sl->session_pipe)
        {
          g_signal_connect (sl->auth_pipe, "close",
                            G_CALLBACK (on_session_login_done), g_object_ref (result));
        }
      else
        {
          g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                           "Internal error starting session process");
          g_simple_async_result_complete_in_idle (result);
        }
    }
  else
    {
      g_free (type);
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Authentication required");
      g_simple_async_result_complete_in_idle (result);
    }

  g_object_unref (result);
}


/* ------------------------------------------------------------------------
 * Remote login without cockpit-session by using ssh even locally
 */

typedef struct {
  CockpitCreds *creds;
  CockpitTransport *transport;
} RemoteLoginData;

static void
remote_login_data_free (gpointer data)
{
  RemoteLoginData *rl = data;
  if (rl->creds)
    cockpit_creds_unref (rl->creds);
  if (rl->transport)
    g_object_unref (rl->transport);
  g_free (rl);
}

 * add error property
 * add headers property
 * add headers property
 * add creds property
  g_async_initable_new_async (type, G_DEFAULT_PRIORITY, NULL,
                              on_session_initable_done, g_object_ref (task),
                              "headers", headers,
                              "remote", remote_peer,
                              NULL);

  input = cockpit_auth_parse_authorization (headers, &type);

  if (type && input && g_str_equal (type, "basic"))
    {
      password = parse_basic_auth_password (input, &user);
      if (password && user)
        {
          creds = cockpit_creds_new (user,
                                     COCKPIT_CRED_PASSWORD, password,
                                     COCKPIT_CRED_RHOST, remote_peer,
                                     NULL);
        }
      g_free (user);
    }

  if (creds)
    {
      rl = g_new0 (RemoteLoginData, 1);
      rl->creds = creds;
      if (auth->login_loopback)
        {
          rl->transport = g_object_new (COCKPIT_TYPE_SSH_TRANSPORT,
                                        "host", "127.0.0.1",
                                        "port", cockpit_ws_specific_ssh_port,
                                        "command", cockpit_ws_bridge_program,
                                        "creds", creds,
                                        "ignore-key", TRUE,
                                        NULL);
        }
      else
        {
          rl->transport = g_object_new (COCKPIT_TYPE_SESSION_TRANSPORT,
                                        "creds", creds,
                                        NULL);
        }

      g_simple_async_result_set_op_res_gpointer (task, rl, remote_login_data_free);
      g_signal_connect (rl->transport, "result", G_CALLBACK (on_remote_login_done), g_object_ref (task));
    }
  else
    {
      g_simple_async_result_set_error (task, COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                       "Basic authentication required");
      g_simple_async_result_complete_in_idle (task);
    }

  g_free (type);

static void
on_transport_login_done (CockpitTransport *transport,
                         const gchar *problem,
                         gpointer user_data)
{
  CockpitAuth *self = COCKPIT_AUTH (g_async_result_get_source_object (user_data));
  GSimpleAsyncResult *task = user_data;
  GError *error = NULL;

  if (problem)
    {
      if (g_str_equal (problem, "not-authorized"))
        {
          g_simple_async_result_set_error (task, COCKPIT_ERROR,
                                           COCKPIT_ERROR_AUTHENTICATION_FAILED,
                                           "Authentication failed");
        }
      else
        {
          g_object_get (transport, "error", &error, NULL);
          g_simple_async_result_take_error (task, error);
        }
    }

  g_simple_async_result_complete (task);
  g_object_unref (self);
  g_object_unref (task);
}

static void
build_gssapi_output_header (GHashTable *headers,
                            JsonObject *results)
{
  gchar *encoded;
  const gchar *output = NULL;
  gpointer data;
  gsize length;
  gchar *value;

  if (results)
    {
      if (!cockpit_json_get_string (results, "gssapi-output", NULL, &output))
        {
          g_warning ("received invalid gssapi-output field from cockpit-session");
          return;
        }
    }

  if (output)
    {
      data = cockpit_hex_decode (output, &length);
      if (!data)
        {
          g_warning ("received invalid gssapi-output from cockpit-session");
          return;
        }
      encoded = g_base64_encode (data, length);
      value = g_strdup_printf ("Negotiate %s", encoded);

      g_free (data);
      g_free (encoded);
    }
  else
    {
      value = g_strdup ("Negotiate");
    }

  g_hash_table_replace (headers, g_strdup ("WWW-Authenticate"), value);
  g_debug ("gssapi: WWW-Authenticate: %s", value);
}

static void
on_session_login_done (CockpitPipe *pipe,
                       const gchar *problem,
                       gpointer user_data)
{
  GSimpleAsyncResult *result = G_SIMPLE_ASYNC_RESULT (user_data);

  if (problem)
    {
      g_warning ("cockpit session failed during auth: %s", problem);
      g_simple_async_result_set_error (result, COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                       "Internal error in session process");
    }

  g_simple_async_result_complete (result);
  g_object_unref (result);
}

typedef struct {
  CockpitPipe *session_pipe;
  CockpitPipe *auth_pipe;
  GBytes *authorization;
  gchar *remote_peer;
  gchar *auth_type;
} SessionLoginData;

/* ------------------------------------------------------------------------
 *  Login via cockpit-session
 */

static void
session_child_setup (gpointer data)
{
  gint auth_fd = GPOINTER_TO_INT (data);

  if (cockpit_unix_fd_close_all (3, auth_fd) < 0)
    {
      g_printerr ("couldn't close file descriptors: %m");
      _exit (127);
    }

  /* When running cockpit-session fd 3 is always auth */
  if (dup2 (auth_fd, 3) < 0)
    {
      g_printerr ("couldn't dup file descriptor: %m");
      _exit (127);
    }

  close (auth_fd);
}

static CockpitPipe *
spawn_session_process (const gchar *type,
                       GBytes *input,
                       const gchar *remote_peer,
                       CockpitPipe **auth_pipe)
{
  CockpitPipe *pipe;
  int pwfds[2] = { -1, -1 };
  GError *error = NULL;
  GPid pid = 0;
  gint in_fd = -1;
  gint out_fd = -1;

  const gchar *argv[] = {
      cockpit_ws_session_program,
      type,
      remote_peer ? remote_peer : "",
      NULL,
  };

  g_return_val_if_fail (input != NULL, NULL);

  if (socketpair (PF_UNIX, SOCK_STREAM, 0, pwfds) < 0)
    g_return_val_if_reached (NULL);

  g_debug ("spawning %s", cockpit_ws_session_program);

  if (!g_spawn_async_with_pipes (NULL, (gchar **)argv, NULL,
                                 G_SPAWN_DO_NOT_REAP_CHILD | G_SPAWN_LEAVE_DESCRIPTORS_OPEN,
                                 session_child_setup, GINT_TO_POINTER (pwfds[1]),
                                 &pid, &in_fd, &out_fd, NULL, &error))
    {
      g_warning ("failed to start %s: %s", cockpit_ws_session_program, error->message);
      g_error_free (error);
      return NULL;
    }
  else
    {
      pipe = g_object_new (COCKPIT_TYPE_PIPE,
                           "name", "localhost",
                           "pid", pid,
                           "in-fd", out_fd,
                           "out-fd", in_fd,
                           NULL);

      /* Child process end of pipe */
      close (pwfds[1]);

      *auth_pipe = cockpit_pipe_new ("auth-pipe", pwfds[0], pwfds[0]);
      cockpit_pipe_write (*auth_pipe, input);
      cockpit_pipe_close (*auth_pipe, NULL);
    }

  return pipe;
}

static CockpitCreds *
cockpit_auth_login_finish (CockpitAuth *self,
                           GAsyncResult *result,
                           GHashTable *headers,
                           CockpitTransport **transport,
                           GError **error)
{
  CockpitCreds *creds;
  SessionLoginData *sl;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, G_OBJECT (self),
                        cockpit_auth_login_async), NULL);

  if (g_simple_async_result_propagate_error (G_SIMPLE_ASYNC_RESULT (result), error))
    {
      build_gssapi_output_header (headers, NULL);
      return NULL;
    }

  sl = g_simple_async_result_get_op_res_gpointer (G_SIMPLE_ASYNC_RESULT (result));

  creds = parse_auth_results (sl, headers, error);
  if (!creds)
    return NULL;

  if (transport)
    *transport = cockpit_pipe_transport_new (sl->session_pipe);

  return creds;
}



#endif
