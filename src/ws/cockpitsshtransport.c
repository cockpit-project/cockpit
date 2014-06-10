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

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "config.h"

#include "cockpitsshtransport.h"

#include "cockpit/cockpitpipe.h"

#include <libssh/libssh.h>
#include <libssh/callbacks.h>

#include <glib/gstdio.h>

#include <stdlib.h>
#include <string.h>

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

/**
 * CockpitSshTransport:
 *
 * A #CockpitTransport implementation that shuttles data over an
 * ssh connection to an ssh server. Note this is the client side
 * of an SSH connection.  See doc/protocol.md for information on how the
 * framing looks ... including the MSB length prefix.
 */

/* ----------------------------------------------------------------------------
 * Connect and Authenticate Thread
 *
 * Authentication happens in a secondary thread. This is because krb5 cannot
 * be made async anyway, and we hope that's our ideal form of authentication.
 * So rather than special case it, do all auth in a thread. This obviously only
 * ever happens for authenticated users, so isn't really the end of the world.
 *
 * We pass CockpitSshData to the thread. Everything here should be either
 * thread-safe or only accessed by the thread.
 *
 * The connecting flag is set by the connect thread when it's done. It's also
 * used as a way for the main thread to cancel the connect thread. In that case
 * the main thread also closes the socket, to cause the connect/auth to stop
 * immediately.
 */

typedef struct {
  /* context of the main thread */
  GMainContext *context;

  /* Input to the connect thread*/
  const gchar *logname;
  ssh_session session;
  CockpitCreds *creds;
  gchar *command;
  gchar *expect_key;
  gchar *knownhosts_file;

  /* Output from the connect thread */
  ssh_channel channel;
  const gchar *problem;
  gchar *host_key;
  gchar *host_fingerprint;

  /* When connect is done this flag is cleared */
  gint *connecting;
} CockpitSshData;

static gchar *
auth_method_description (int methods)
{
  GString *string;

  string = g_string_new ("");
  if (methods == 0)
    g_string_append (string, "unknown");
  if (methods & SSH_AUTH_METHOD_NONE)
    g_string_append (string, "none ");
  if (methods & SSH_AUTH_METHOD_PASSWORD)
    g_string_append (string, "password ");
  if (methods & SSH_AUTH_METHOD_PUBLICKEY)
    g_string_append (string, "public-key ");
  if (methods & SSH_AUTH_METHOD_HOSTBASED)
    g_string_append (string, "host-based ");
  if (methods & SSH_AUTH_METHOD_GSSAPI_MIC)
    g_string_append (string, "gssapi-mic ");

  return g_string_free (string, FALSE);
}

/*
 * NOTE: This function changes the SSH_OPTIONS_KNOWNHOSTS option on
 * the session.
 *
 * We can't save and restore it since ssh_options_get doesn't allow us
 * to retrieve the old value of SSH_OPTIONS_KNOWNHOSTS.
 *
 * HACK: This function should be provided by libssh.
 *
 * https://red.libssh.org/issues/162
*/
static gchar *
get_knownhosts_line (ssh_session session)
{
  char name[] = "/tmp/cockpit-XXXXXX";
  int fd;
  GError *error = NULL;
  gchar *line = NULL;

  fd = mkstemp (name);
  if (fd == -1)
    {
      g_warning ("Couldn't make temporary name for knownhosts line: %m");
      goto out;
    }

  close (fd);

  if (ssh_options_set (session, SSH_OPTIONS_KNOWNHOSTS, name) != SSH_OK)
    {
      g_warning ("Couldn't set SSH_OPTIONS_KNOWNHOSTS option.");
      goto out;
    }

  if (ssh_write_knownhost (session) != SSH_OK)
    {
      g_warning ("Couldn't write knownhosts file: %s", ssh_get_error (session));
      goto out;
    }

  if (!g_file_get_contents (name, &line, NULL, &error))
    {
      g_warning ("Couldn't read temporary known_hosts %s: %s", name, error->message);
      g_clear_error (&error);
      goto out;
    }

  g_strstrip (line);

out:
  if (fd != -1)
    g_unlink (name);

  return line;
}

static const gchar *
verify_knownhost (CockpitSshData *data)
{
  const gchar *ret = "unknown-hostkey";
  ssh_key key = NULL;
  unsigned char *hash = NULL;
  const char *type = NULL;
  int state;
  gsize len;

  data->host_key = get_knownhosts_line (data->session);
  if (data->host_key == NULL)
    {
      ret = "internal-error";
      goto done;
    }

  if (ssh_get_publickey (data->session, &key) != SSH_OK)
    {
      g_warning ("Couldn't look up ssh host key");
      ret = "internal-error";
      goto done;
    }

  type = ssh_key_type_to_char (ssh_key_type (key));
  if (type == NULL)
    {
      g_warning ("Couldn't lookup host key type");
      ret = "internal-error";
      goto done;
    }

  if (ssh_get_publickey_hash (key, SSH_PUBLICKEY_HASH_MD5, &hash, &len) < 0)
    {
      g_warning ("Couldn't hash ssh public key");
      ret = "internal-error";
      goto done;
    }
  else
    {
      data->host_fingerprint = ssh_get_hexa (hash, len);
      ssh_clean_pubkey_hash (&hash);
    }

  if (data->expect_key)
    {
      /* Only check that the host key matches this specifically */
      if (g_str_equal (data->host_key, data->expect_key))
        {
          g_debug ("%s: host key matched expected", data->logname);
          ret = NULL; /* success */
        }
      else
        {
          /* A empty expect_key is used by the frontend to force
             failure.  Don't warn about it.
          */
          if (data->expect_key[0])
            g_message ("%s: host key did not match expected", data->logname);
        }
    }
  else
    {
      if (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS, data->knownhosts_file) != SSH_OK)
        {
          g_warning ("Couldn't set knownhosts file location");
          ret = "internal-error";
          goto done;
        }

      state = ssh_is_server_known (data->session);
      if (state == SSH_SERVER_KNOWN_OK)
        {
          g_debug ("%s: verified host key", data->logname);
          ret = NULL; /* success */
          goto done;
        }
      else if (state == SSH_SERVER_ERROR)
        {
          if (g_atomic_int_get (data->connecting))
            g_warning ("%s: couldn't check host key: %s", data->logname,
                       ssh_get_error (data->session));
          ret = "internal-error";
          goto done;
        }

      switch (state)
        {
        case SSH_SERVER_KNOWN_OK:
        case SSH_SERVER_ERROR:
          g_assert_not_reached ();
          break;
        case SSH_SERVER_KNOWN_CHANGED:
          g_message ("%s: %s host key for server has changed to: %s",
                     data->logname, type, data->host_fingerprint);
          break;
        case SSH_SERVER_FOUND_OTHER:
          g_message ("%s: host key for this server changed key type: %s",
                     data->logname, type);
          break;
        case SSH_SERVER_FILE_NOT_FOUND:
          g_debug ("Couldn't find the known hosts file");
          /* fall through */
        case SSH_SERVER_NOT_KNOWN:
          g_message ("%s: %s host key for server is not known: %s",
                     data->logname, type, data->host_fingerprint);
          break;
        }
    }

done:
  if (key)
    ssh_key_free (key);
  return ret;
}

static const gchar *
cockpit_ssh_connect (CockpitSshData *data)
{
  const gchar *password;
  const gchar *problem;
  gchar *description;
  int methods;
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

  problem = verify_knownhost (data);
  if (problem != NULL)
    return problem;

  rc = ssh_userauth_none (data->session, NULL);
  if (rc == SSH_AUTH_ERROR)
    {
      if (g_atomic_int_get (data->connecting))
        g_message ("%s: server authentication handshake failed: %s",
                   data->logname, ssh_get_error (data->session));
      return "internal-error";
    }

  if (rc != SSH_AUTH_SUCCESS)
    {
      methods = ssh_userauth_list (data->session, NULL);
      if (methods & SSH_AUTH_METHOD_PASSWORD)
        {
          password = cockpit_creds_get_password (data->creds);
          rc = ssh_userauth_password (data->session, NULL, password);
          switch (rc)
            {
            case SSH_AUTH_SUCCESS:
              g_debug ("%s: password auth succeeded", data->logname);
              break;
            case SSH_AUTH_DENIED:
              g_debug ("%s: password auth failed", data->logname);
              return "not-authorized";
            case SSH_AUTH_PARTIAL:
              g_message ("%s: password auth worked, but server wants more authentication",
                         data->logname);
              return "not-authorized";
            default:
              if (g_atomic_int_get (data->connecting))
                g_message ("%s: couldn't authenticate: %s", data->logname,
                           ssh_get_error (data->session));
              return "internal-error";
            }
        }
      else
        {
          description = auth_method_description (methods);
          g_message ("%s: server offered unsupported authentication methods: %s",
                     data->logname, description);
          g_free (description);
          return "not-authorized";
        }
    }

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
};

struct _CockpitSshTransport {
  CockpitTransport parent_instance;

  /* Name used for logging */
  gchar *logname;

  /* Connecting happens in a thread */
  GThread *connect_thread;
  gint connecting;
  gint connect_fd;

  /* Data shared with connect thread*/
  CockpitSshData *data;

  GSource *io;
  gboolean closing;
  gboolean closed;
  guint timeout_close;
  const gchar *problem;
  ssh_event event;
  struct ssh_channel_callbacks_struct channel_cbs;

  /* Output */
  GQueue *queue;
  gsize partial;
  gboolean send_eof;
  gboolean sent_eof;
  gboolean sent_close;

  /* Input */
  GByteArray *buffer;
  gboolean drain_buffer;
  gboolean received_eof;
  gboolean received_close;
  gboolean received_exit;
};

struct _CockpitSshTransportClass {
  CockpitTransportClass parent_class;
};

static void close_immediately (CockpitSshTransport *self,
                               const gchar *problem);

G_DEFINE_TYPE (CockpitSshTransport, cockpit_ssh_transport, COCKPIT_TYPE_TRANSPORT);

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
      problem = "no-agent";        /* cockpit-agent not installed */
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

static void
cockpit_ssh_transport_init (CockpitSshTransport *self)
{
  static struct ssh_channel_callbacks_struct channel_cbs = {
    .channel_data_function = on_channel_data,
    .channel_eof_function = on_channel_eof,
    .channel_close_function = on_channel_close,
    .channel_signal_function = on_channel_signal,
    .channel_exit_signal_function = on_channel_exit_signal,
    .channel_exit_status_function = on_channel_exit_status,
  };

  self->data = g_new0 (CockpitSshData, 1);

  self->data->context = g_main_context_get_thread_default ();
  if (self->data->context)
    g_main_context_ref (self->data->context);

  self->data->session = ssh_new ();
  g_return_if_fail (self->data->session != NULL);

  self->buffer = g_byte_array_new ();
  self->queue = g_queue_new ();

  memcpy (&self->channel_cbs, &channel_cbs, sizeof (channel_cbs));
  self->channel_cbs.userdata = self;
  ssh_callbacks_init (&self->channel_cbs);

  self->event = ssh_event_new ();
}

static void
close_immediately (CockpitSshTransport *self,
                   const gchar *problem)
{
  GSource *source;
  GThread *thread;

  if (self->timeout_close)
    {
      g_source_remove (self->timeout_close);
      self->timeout_close = 0;
    }

  if (self->closed)
    return;

  self->closed = TRUE;

  if (self->connect_thread)
    {
      thread = self->connect_thread;
      self->connect_thread = NULL;

      /* This causes thread to fail */
      g_atomic_int_set (&self->connecting, 0);
      close (self->connect_fd);
      self->connect_fd = -1;
      g_assert (self->data == NULL);
      self->data = g_thread_join (thread);
    }

  g_assert (self->data != NULL);

  if (problem == NULL)
    problem = self->problem;

  g_debug ("%s: closing io%s%s", self->logname,
           problem ? ": " : "", problem ? problem : "");

  if (self->io)
    {
      source = self->io;
      self->io = NULL;
      g_source_destroy (source);
      g_source_unref (source);
    }

  if (self->data->channel && ssh_channel_is_open (self->data->channel))
    ssh_channel_close (self->data->channel);
  ssh_disconnect (self->data->session);

  cockpit_transport_emit_closed (COCKPIT_TRANSPORT (self), problem);
}

static void
drain_buffer (CockpitSshTransport *self)
{
  GBytes *message;
  GBytes *payload;
  gchar *channel;
  guint32 size;

  for (;;)
    {
      if (self->buffer->len < sizeof (size))
        {
          if (!self->received_eof)
            g_debug ("%s: want len have %d", self->logname, (int)self->buffer->len);
          break;
        }

      memcpy (&size, self->buffer->data, sizeof (size));
      size = GUINT32_FROM_BE (size);
      if (self->buffer->len < size + sizeof (size))
        {
          g_debug ("%s: want %d have %d", self->logname,
                   (int)(size + sizeof (size)), (int)self->buffer->len);
          break;
        }

      message = cockpit_pipe_consume (self->buffer, sizeof (size), size);
      payload = cockpit_transport_parse_frame (message, &channel);
      if (payload)
        {
          g_debug ("%s: received a %d byte payload", self->logname, (int)g_bytes_get_size (payload));
          cockpit_transport_emit_recv ((CockpitTransport *)self, channel, payload);
          g_bytes_unref (payload);
          g_free (channel);
        }
      g_bytes_unref (message);
    }

  if (self->received_eof)
    {
      /* Received a partial message */
      if (self->buffer->len > 0)
        {
          g_warning ("%s: received truncated %d byte frame", self->logname, (int)self->buffer->len);
          close_immediately (self, "internal-error");
        }
    }
}

static void
dispatch_close (CockpitSshTransport *self)
{
  g_assert (!self->sent_close);

  switch (ssh_channel_close (self->data->channel))
    {
    case SSH_AGAIN:
      g_debug ("%s: will send close later", self->logname);
      break;
    case SSH_OK:
      g_debug ("%s: sent close", self->logname);
      self->sent_close = TRUE;
      break;
    default:
      g_warning ("%s: couldn't send close: %s", self->logname,
                 ssh_get_error (self->data->session));
      close_immediately (self, "internal-error");
      break;
    }
}

static void
dispatch_eof (CockpitSshTransport *self)
{
  g_assert (!self->sent_eof);

  switch (ssh_channel_send_eof (self->data->channel))
    {
    case SSH_AGAIN:
      g_debug ("%s: will send eof later", self->logname);
      break;
    case SSH_OK:
      g_debug ("%s: sent eof", self->logname);
      self->sent_eof = TRUE;
      break;
    default:
      g_warning ("%s: couldn't send eof: %s", self->logname,
                 ssh_get_error (self->data->session));
      close_immediately (self, "internal-error");
      break;
    }
}

static gboolean
dispatch_queue (CockpitSshTransport *self)
{
  GBytes *block;
  const guchar *data;
  gsize length;
  gsize want;
  int rc;

  if (self->sent_eof)
    return FALSE;

  for (;;)
    {
      block = g_queue_peek_head (self->queue);
      if (!block)
        return FALSE;

      data = g_bytes_get_data (block, &length);
      g_assert (self->partial <= length);

      want = length - self->partial;
      rc = ssh_channel_write (self->data->channel, data + self->partial, want);
      if (rc < 0)
        {
          g_warning ("%s: couldn't write: %s", self->logname,
                     ssh_get_error (self->data->session));
          close_immediately (self, "internal-error");
          break;
        }

      if (rc == want)
        {
          g_debug ("%s: wrote %d bytes", self->logname, rc);
          g_queue_pop_head (self->queue);
          g_bytes_unref (block);
          self->partial = 0;
        }
      else
        {
          g_debug ("%s: wrote %d of %d bytes", self->logname, rc, (int)want);
          g_return_val_if_fail (rc < want, FALSE);
          self->partial += rc;
          if (rc == 0)
            break;
        }
    }

  return TRUE;
}

typedef struct {
  GSource source;
  GPollFD pfd;
  CockpitSshTransport *transport;
} CockpitSshSource;

static gboolean
cockpit_ssh_source_check (GSource *source)
{
  CockpitSshSource *cs = (CockpitSshSource *)source;
  return cs->transport->drain_buffer || (cs->pfd.events & cs->pfd.revents) != 0;
}

static gboolean
cockpit_ssh_source_prepare (GSource *source,
                            gint *timeout)
{
  CockpitSshSource *cs = (CockpitSshSource *)source;
  CockpitSshTransport *self = cs->transport;
  GThread *thread;
  gint status;

  *timeout = 1;

  /* Connecting, check if done */
  if (G_UNLIKELY (!self->data))
    {
      if (g_atomic_int_get (&self->connecting))
        return FALSE;

      /* Get the result from connecting thread */
      thread = self->connect_thread;
      self->connect_fd = -1;
      self->connect_thread = NULL;
      self->data = g_thread_join (thread);
      g_assert (self->data != NULL);

      if (self->data->problem)
        {
          close_immediately (self, self->data->problem);
          return FALSE;
        }

      ssh_event_add_session (self->event, self->data->session);
      ssh_set_channel_callbacks (self->data->channel, &self->channel_cbs);

      /* Start watching the fd */
      ssh_set_blocking (self->data->session, 0);
      cs->pfd.fd = ssh_get_fd (self->data->session);
      g_source_add_poll (source, &cs->pfd);

      g_debug ("%s: starting io", self->logname);
    }

  status = ssh_get_status (self->data->session);

  /* Short cut this ... we're ready now */
  if (self->drain_buffer)
    return TRUE;

  /*
   * Channel completely closed, and output buffers
   * are empty. We're in a good place to close the
   * SSH session and thus the transport.
   */
  if (close_maybe (self, status))
    return FALSE;

  cs->pfd.revents = 0;
  cs->pfd.events = G_IO_IN | G_IO_ERR | G_IO_NVAL | G_IO_HUP;

  /* libssh has something in its buffer: want to write */
  if (status & SSH_WRITE_PENDING)
    cs->pfd.events |= G_IO_OUT;

  /* We have something in our queue: want to write */
  else if (!g_queue_is_empty (self->queue))
    cs->pfd.events |= G_IO_OUT;

  /* We are closing and need to send eof: want to write */
  else if (self->closing && !self->sent_eof)
    cs->pfd.events |= G_IO_OUT;

  /* Need to reply to an EOF or close */
  if ((self->received_eof && self->sent_eof && !self->sent_close) ||
      (self->received_close && !self->sent_close))
    cs->pfd.events |= G_IO_OUT;

  return cockpit_ssh_source_check (source);
}

static gboolean
cockpit_ssh_source_dispatch (GSource *source,
                             GSourceFunc callback,
                             gpointer user_data)
{
  CockpitSshSource *cs = (CockpitSshSource *)source;
  CockpitSshTransport *self = cs->transport;
  GIOCondition cond = cs->pfd.revents;
  const gchar *msg;
  gint rc;

  g_return_val_if_fail ((cond & G_IO_NVAL) == 0, FALSE);
  g_assert (self->data != NULL);

  if (self->drain_buffer)
    {
      self->drain_buffer = 0;
      drain_buffer (self);
    }

  if (cond & (G_IO_HUP | G_IO_ERR))
    {
      if (self->sent_close || self->sent_eof)
        {
          self->received_eof = TRUE;
          self->received_close = TRUE;
        }
    }

  /*
   * HACK: Yes this is anohter poll() call. The async support in
   * libssh is quite hacky right now.
   *
   * https://red.libssh.org/issues/155
   */
  rc = ssh_event_dopoll (self->event, 0);
  switch (rc)
    {
    case SSH_OK:
    case SSH_AGAIN:
      break;
    case SSH_ERROR:
      msg = ssh_get_error (self->data->session);

      /*
       * HACK: There doesn't seem to be a way to get at the original socket errno
       * here. So we have to screen scrape.
       *
       * https://red.libssh.org/issues/158
       */
      if (msg && (strstr (msg, "disconnected") ||
                  strstr (msg, "SSH_MSG_DISCONNECT") ||
                  strstr (msg, "Socket error: Success")))
        {
          g_debug ("%s: failed to process channel: %s", self->logname, msg);
          close_immediately (self, "terminated");
        }
      else
        {
          g_message ("%s: failed to process channel: %s", self->logname, msg);
          close_immediately (self, "internal-error");
        }
      return TRUE;
    default:
      g_critical ("%s: ssh_event_dopoll() returned %d", self->logname, rc);
      return FALSE;
    }

  if (cond & G_IO_ERR)
    {
      g_message ("%s: error reading from ssh", self->logname);
      close_immediately (self, "disconnected");
      return TRUE;
    }

  if (self->drain_buffer)
    {
      self->drain_buffer = 0;
      drain_buffer (self);
    }

  if (cond & G_IO_OUT)
    {
      if (!dispatch_queue (self) && self->closing && !self->sent_eof)
        dispatch_eof (self);
      if (self->received_eof && self->sent_eof && !self->sent_close)
        dispatch_close (self);
      if (self->received_close && !self->sent_close)
        dispatch_close (self);
    }

  return TRUE;
}

static void
cockpit_ssh_transport_constructed (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);
  CockpitSshData *data;

  static GSourceFuncs source_funcs = {
    cockpit_ssh_source_prepare,
    cockpit_ssh_source_check,
    cockpit_ssh_source_dispatch,
    NULL,
  };

  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->constructed (object);

  g_return_if_fail (self->data->creds != NULL);
  g_warn_if_fail (ssh_options_set (self->data->session, SSH_OPTIONS_USER,
                                   cockpit_creds_get_user (self->data->creds)) == 0);

  self->io = g_source_new (&source_funcs, sizeof (CockpitSshSource));
  ((CockpitSshSource *)self->io)->transport = self;
  g_source_attach (self->io, self->data->context);

  /* Setup for connect thread */
  self->connect_fd = ssh_get_fd (self->data->session);
  g_atomic_int_set (&self->connecting, 1);
  self->data->connecting = &self->connecting;
  data = self->data;
  self->data = NULL;

  self->connect_thread = g_thread_new ("ssh-transport-connect",
                                       cockpit_ssh_connect_thread, data);

  g_debug ("%s: constructed", self->logname);
}

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
        string = PACKAGE_LIBEXEC_DIR "/cockpit-agent";
      self->data->command = g_strdup (string);
      break;
    case PROP_HOST_KEY:
      self->data->expect_key = g_value_dup_string (value);
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

static void
cockpit_ssh_transport_finalize (GObject *object)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (object);

  /* libssh channels like to hang around even after they're freed */
  memset (&self->channel_cbs, 0, sizeof (self->channel_cbs));
  ssh_event_free (self->event);

  cockpit_ssh_data_free (self->data);
  g_free (self->logname);

  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);
  g_byte_array_free (self->buffer, TRUE);

  g_assert (self->io == NULL);

  G_OBJECT_CLASS (cockpit_ssh_transport_parent_class)->finalize (object);
}

static void
cockpit_ssh_transport_send (CockpitTransport *transport,
                            const gchar *channel,
                            GBytes *payload)
{
  CockpitSshTransport *self = COCKPIT_SSH_TRANSPORT (transport);
  gchar *prefix;
  gsize length;
  guint32 size;

  g_return_if_fail (!self->closing);

  prefix = g_strdup_printf ("xxxx%s\n", channel ? channel : "");
  length = strlen (prefix);

  /* See doc/protocol.md */
  size = GUINT32_TO_BE (g_bytes_get_size (payload) + length - 4);
  memcpy (prefix, &size, 4);

  g_queue_push_tail (self->queue, g_bytes_new_take (prefix, length));
  g_queue_push_tail (self->queue, g_bytes_ref (payload));

  g_debug ("%s: queued %d byte payload", self->logname, (int)g_bytes_get_size (payload));
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

  g_object_class_install_property (object_class, PROP_CREDS,
         g_param_spec_boxed ("creds", NULL, NULL, COCKPIT_TYPE_CREDS,
                             G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

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
