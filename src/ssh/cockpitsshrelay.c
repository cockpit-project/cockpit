/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpitlog.h"
#include "common/cockpittest.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitknownhosts.h"

#include "ws/cockpitauthoptions.h"

#include "cockpitsshrelay.h"

#include <libssh/libssh.h>
#include <libssh/callbacks.h>

#include <krb5/krb5.h>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_krb5.h>
#include <gssapi/gssapi_ext.h>

#include <glib/gstdio.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>


#define AUTH_FD 3

/* we had a private one before moving to /etc/ssh/ssh_known_hosts */
#define LEGACY_KNOWN_HOSTS PACKAGE_LOCALSTATE_DIR "/known_hosts"

typedef struct {
  const gchar *logname;
  gchar *initial_auth_data;
  gchar **env;
  CockpitSshOptions *ssh_options;
  CockpitAuthOptions *auth_options;

  gchar *username;
  gboolean in_bridge;

  ssh_session session;

  gint auth_fd;

  gchar *host_key;
  gchar *host_fingerprint;
  const gchar *host_key_type;
  GHashTable *auth_results;
  gchar *user_known_hosts;

} CockpitSshData;

static gchar *tmp_knownhost_file;

static const gchar*
exit_code_problem (int exit_code)
{
  switch (exit_code)
    {
      case 0:
        return NULL;
      case AUTHENTICATION_FAILED:
        return "authentication-failed";
      case DISCONNECTED:
        return "disconnected";
      case TERMINATED:
        return "terminated";
      case NO_COCKPIT:
        return "no-cockpit";
      default:
        return "internal-error";
    }
}

static const gchar *
auth_method_description (int method)
{
  if (method == SSH_AUTH_METHOD_NONE)
    return "none";
  else if (method == SSH_AUTH_METHOD_PASSWORD || method == SSH_AUTH_METHOD_INTERACTIVE)
    return "password";
  else if (method == SSH_AUTH_METHOD_PUBLICKEY)
    return "public-key";
  else if (method == SSH_AUTH_METHOD_HOSTBASED)
    return "host-based";
  else if (method == SSH_AUTH_METHOD_GSSAPI_MIC)
    return "gssapi-mic";
  else
    return "unknown";
}

static gchar *
auth_methods_line (int methods)
{
  GString *string;
  int i = 0;
  int check[6] = {
    SSH_AUTH_METHOD_NONE,
    SSH_AUTH_METHOD_INTERACTIVE,
    SSH_AUTH_METHOD_PASSWORD,
    SSH_AUTH_METHOD_PUBLICKEY,
    SSH_AUTH_METHOD_HOSTBASED,
    SSH_AUTH_METHOD_GSSAPI_MIC
  };

  string = g_string_new ("");
  if (methods == 0)
    g_string_append (string, auth_method_description (methods));

  for (i = 0; i < G_N_ELEMENTS (check); i++)
    {
      if (methods & check[i])
        {
          g_string_append (string, auth_method_description (check[i]));
          g_string_append (string, " ");
        }
    }

  return g_string_free (string, FALSE);
}

static gboolean
ssh_msg_is_disconnected (const gchar *msg)
{
      return msg && (strstr (msg, "disconnected") ||
                     strstr (msg, "SSH_MSG_DISCONNECT") ||
                     strstr (msg, "Socket error: Success") ||
                     strstr (msg, "Socket error: Connection reset by peer"));
}

static gboolean
write_to_auth_fd (CockpitSshData *data,
                  GBytes *bytes)
{
  int r = 0;
  gsize len = 0;
  gchar *buf;

  buf = (gchar *)g_bytes_get_data (bytes, &len);
  for (;;)
    {
      r = write (data->auth_fd, buf, len);
      if (r < 0)
        {
          if (errno != EAGAIN && errno != EINTR)
            {
              g_message ("%s: failed to write prompt to auth pipe: %s",
                         data->logname, g_strerror (errno));
              break;
            }
        }
      else
        {
          if (r != len)
            g_message ("%s: failed to write prompt to auth pipe", data->logname);
          break;
        }
    }

  return r >= len;
}

static gboolean
prompt_on_auth_fd (CockpitSshData *data,
                   const gchar *prompt,
                   const gchar *msg,
                   const gchar *default_value,
                   const gchar echo)
{
  JsonObject *response = NULL;
  GBytes *payload = NULL;
  gboolean ret = FALSE;

  if (data->auth_fd < 1)
    goto out;

  response = json_object_new ();
  json_object_set_string_member (response, "prompt", prompt);
  if (msg)
    json_object_set_string_member (response, "message", msg);
  if (default_value)
    json_object_set_string_member (response, "default", default_value);

  json_object_set_boolean_member (response, "echo", echo ? TRUE : FALSE);
  payload = cockpit_json_write_bytes (response);
  ret = write_to_auth_fd (data, payload);

out:
  g_bytes_unref (payload);
  json_object_unref (response);

  return ret;
}

static gchar *
wait_for_auth_fd_reply (CockpitSshData *data)
{
  struct iovec vec = { .iov_len = MAX_PACKET_SIZE, };
  struct msghdr msg;
  int r;

  vec.iov_base = g_malloc (vec.iov_len + 1);

  for (;;)
    {
      memset (&msg, 0, sizeof (msg));
      msg.msg_iov = &vec;
      msg.msg_iovlen = 1;
      r = recvmsg (data->auth_fd, &msg, 0);
      if (r < 0)
        {
          if (errno == EAGAIN)
            continue;
          g_error ("%s: Couldn't recv packet: %s", data->logname, g_strerror (errno));
          break;
        }
      else
        {
          break;
        }
    }

  ((char *)vec.iov_base)[r] = '\0';
  return vec.iov_base;
}

/*
 * HACK: SELinux prevents us from writing to the directories we want to
 * write to, so we have to try multiple locations.
 *
 * https://bugzilla.redhat.com/show_bug.cgi?id=1279430
 */
static gchar *
create_knownhosts_temp (void)
{
  const gchar *directories[] = {
      "/tmp",
      PACKAGE_LOCALSTATE_DIR,
      NULL,
  };

  gchar *name;
  int i, fd, err;

  for (i = 0; directories[i] != NULL; i++)
    {
      name = g_build_filename (directories[i], "known-hosts.XXXXXX", NULL);
      fd = g_mkstemp (name);
      err = errno;

      if (fd >= 0)
        {
          close (fd);
          return name;
        }
      g_free (name);

      if ((err == ENOENT || err == EPERM || err == EACCES) && directories[i + 1] != NULL)
        continue;

      g_warning ("couldn't make temporary file for knownhosts line in %s: %m", directories[i]);
      break;
    }

  return NULL;
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

  gchar *name = NULL;
  GError *error = NULL;
  gchar *line = NULL;

  name = create_knownhosts_temp ();
  if (!name)
    goto out;

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
  if (name)
    {
      g_unlink (name);
      g_free (name);
    }

  return line;
}

static const gchar *
prompt_for_host_key (CockpitSshData *data)
{
  const gchar *ret;
  gchar *answer = NULL;
  gchar *host = NULL;
  guint port = 22;
  gchar *message = NULL;
  gchar *prompt = NULL;

  if (ssh_options_get (data->session, SSH_OPTIONS_HOST, &host) < 0)
    {
      g_warning ("Failed to get host");
      goto out;
    }

  if (ssh_options_get_port (data->session, &port) < 0)
    {
      g_warning ("Failed to get port");
      goto out;
    }

  message = g_strdup_printf ("The authenticity of host '%s:%d' can't be established. Do you want to proceed this time?",
                             host, port);
  prompt = g_strdup_printf ("MD5 Fingerprint (%s):", data->host_key_type);
  if (prompt_on_auth_fd (data, prompt, message, data->host_fingerprint, 1))
    answer = wait_for_auth_fd_reply (data);

out:
  if (answer && g_strcmp0 (answer, data->host_fingerprint) == 0)
    ret = NULL;
  else
    ret = "unknown-hostkey";

  g_free (message);
  g_free (prompt);
  g_free (answer);
  g_free (host);
  return ret;
}

static void cleanup_knownhosts_file (void)
{
  if (tmp_knownhost_file)
    {
      g_unlink (tmp_knownhost_file);
      g_free (tmp_knownhost_file);
    }
}

/**
 * set_knownhosts_file:
 *
 * Check the various ssh known hosts locations and set the appropriate one into
 * SSH_OPTIONS_KNOWNHOSTS.
 *
 * Returns: error string or %NULL on success.
 */
static const gchar *
set_knownhosts_file (CockpitSshData *data,
                     const gchar* host,
                     const guint port)
{
  gboolean host_known;

  /* $COCKPIT_SSH_KNOWN_HOSTS_DATA has highest priority */
  if (data->ssh_options->knownhosts_data)
    {
      FILE *fp = NULL;
      tmp_knownhost_file = create_knownhosts_temp ();
      if (!tmp_knownhost_file)
          return "internal-error";
      atexit (cleanup_knownhosts_file);

      fp = fopen (tmp_knownhost_file, "a");
      if (fp == NULL)
        {
          g_warning ("%s: couldn't open temporary known host file for data: %s",
                     data->logname, tmp_knownhost_file);
          return "internal-error";
        }

      if (fputs (data->ssh_options->knownhosts_data, fp) < 0)
        {
          g_warning ("%s: couldn't write to data to temporary known host file: %s",
                     data->logname, g_strerror (errno));
          fclose (fp);
          return "internal-error";
        }

      fclose (fp);
      data->ssh_options->knownhosts_file = tmp_knownhost_file;
    }

  /* now check the default global ssh file */
  host_known = cockpit_is_host_known (data->ssh_options->knownhosts_file, host, port);

  /* if we check the default system known hosts file (i. e. not during the test suite), also check
   * the legacy file in /var/lib/cockpit and the user's ssh; we need to do that even with
   * allow_unknown_hosts as subsequent code relies on knownhosts_file */
  if (!host_known && strcmp (data->ssh_options->knownhosts_file, cockpit_get_default_knownhosts ()) == 0)
    {
      host_known = cockpit_is_host_known (LEGACY_KNOWN_HOSTS, host, port);
      if (host_known)
        {
          g_debug ("%s: not known in %s but in legacy file %s",
                   data->logname,
                   data->ssh_options->knownhosts_file,
                   LEGACY_KNOWN_HOSTS);
          data->ssh_options->knownhosts_file = LEGACY_KNOWN_HOSTS;
        }

      /* check ~/.ssh/known_hosts, unless we are running as a system user ($HOME == "/"); this is not
       * a security check (if one can write /.ssh/known_hosts then we have to trust them), just caution */
      if (!host_known && g_strcmp0 (g_get_home_dir (), "/") != 0)
        {
          host_known = cockpit_is_host_known (data->user_known_hosts, host, port);
          if (host_known)
            data->ssh_options->knownhosts_file = data->user_known_hosts;
        }
    }

  g_debug ("%s: using known hosts file %s", data->logname, data->ssh_options->knownhosts_file);
  if (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS,
                       data->ssh_options->knownhosts_file) != SSH_OK)
    {
      g_warning ("Couldn't set knownhosts file location");
      return "internal-error";
    }

  if (!data->ssh_options->allow_unknown_hosts && !host_known)
    {
      g_message ("%s: refusing to connect to unknown host: %s:%d",
                 data->logname, host, port);
      return "unknown-host";
    }

  return NULL;
}

static const gchar *
verify_knownhost (CockpitSshData *data,
                  const gchar* host,
                  const guint port)
{
  const gchar *ret = "invalid-hostkey";
  const gchar *r;
  ssh_key key = NULL;
  unsigned char *hash = NULL;
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

  data->host_key_type = ssh_key_type_to_char (ssh_key_type (key));
  if (data->host_key_type == NULL)
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

  r = set_knownhosts_file (data, host, port);
  if (r != NULL)
    {
      ret = r;
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
                 data->logname, data->host_key_type, data->host_fingerprint);
      break;
    case SSH_SERVER_FOUND_OTHER:
      g_message ("%s: host key for this server changed key type: %s",
                 data->logname, data->host_key_type);
      break;
    case SSH_SERVER_FILE_NOT_FOUND:
      g_debug ("Couldn't find the known hosts file");
      /* fall through */
    case SSH_SERVER_NOT_KNOWN:
      if (data->ssh_options->supports_hostkey_prompt)
        ret = prompt_for_host_key (data);
      else
        ret = "unknown-hostkey";

      if (ret)
        {
          g_message ("%s: %s host key for server is not known: %s",
                     data->logname, data->host_key_type, data->host_fingerprint);
        }
      break;
    }

done:
  if (key)
    ssh_key_free (key);
  return ret;
}

static const gchar *
auth_result_string (int rc)
{
  switch (rc)
    {
    case SSH_AUTH_SUCCESS:
      return "succeeded";
    case SSH_AUTH_DENIED:
      return "denied";
    case SSH_AUTH_PARTIAL:
      return "partial";
      break;
    case SSH_AUTH_AGAIN:
      return "again";
    default:
      return "error";
    }
}

static const gchar *
parse_auth_password (const gchar *auth_type,
                     const gchar *auth_data)
{
  const gchar *password;

  g_assert (auth_data != NULL);
  g_assert (auth_type != NULL);

  if (g_strcmp0 (auth_type, "basic") != 0)
    return auth_data;

  /* password is null terminated, see below */
  password = strchr (auth_data, ':');
  if (password != NULL)
    password++;
  else
    password = "";

  return password;
}

static gchar *
ssh_askpass (CockpitSshData *data,
             const gchar *message)
{
  GError *error = NULL;
  gchar *password = NULL;
  gint status = 0;

  const gchar *argv[] = { NULL, message, NULL };
  argv[0] = g_getenv ("SSH_ASKPASS");

  if (!argv[0])
    {
      g_debug ("%s: no SSH_ASKPASS available to get password", data->logname);
    }
  else if (!g_spawn_sync (NULL, (gchar **)argv, NULL, G_SPAWN_CHILD_INHERITS_STDIN,
                          NULL, NULL, &password, NULL, &status, &error))
    {
      g_message ("%s: could not launch %s command to get password: %s", data->logname, argv[0], error->message);
      g_error_free (error);
    }
  else if (!g_spawn_check_exit_status (status, &error))
    {
      g_message ("%s: the %s command failed: %s", data->logname, argv[0], error->message);
      g_error_free (error);
      cockpit_memory_clear (password, -1);
      g_free (password);
      password = NULL;
    }

  if (password)
    password[strcspn(password, "\r\n")] = '\0';
  else
    password = g_strdup ("");
  return password;
}

static int
do_interactive_auth (CockpitSshData *data)
{
  int rc;
  gboolean sent_pw = FALSE;
  const gchar *password;

  if (data->in_bridge && !data->initial_auth_data)
    data->initial_auth_data = ssh_askpass (data, "ssh");

  password = parse_auth_password (data->auth_options->auth_type,
                                  data->initial_auth_data);
  rc = ssh_userauth_kbdint (data->session, NULL, NULL);
  while (rc == SSH_AUTH_INFO)
    {
      const gchar *msg;
      int n, i;

      msg = ssh_userauth_kbdint_getinstruction (data->session);
      n = ssh_userauth_kbdint_getnprompts (data->session);

      for (i = 0; i < n && rc == SSH_AUTH_INFO; i++)
        {
          const char *prompt;
          char *answer = NULL;
          char echo = '\0';
          int status = 0;
          prompt = ssh_userauth_kbdint_getprompt (data->session, i, &echo);
          g_debug ("%s: Got prompt %s prompt", data->logname, prompt);
          if (!sent_pw)
            {
              status = ssh_userauth_kbdint_setanswer (data->session, i, password);
              sent_pw = TRUE;
            }
          else
            {
              if (prompt_on_auth_fd (data, prompt, msg, NULL, echo))
                answer = wait_for_auth_fd_reply (data);

              if (answer)
                  status = ssh_userauth_kbdint_setanswer (data->session, i, answer);
              else
                  rc = SSH_AUTH_ERROR;

              g_free (answer);
            }

          if (status < 0)
            {
              g_warning ("%s: failed to set answer for %s", data->logname, prompt);
              rc = SSH_AUTH_ERROR;
            }
        }

      if (rc == SSH_AUTH_INFO)
        rc = ssh_userauth_kbdint (data->session, NULL, NULL);
    }

  return rc;
}

static int
do_password_auth (CockpitSshData *data)
{
  const gchar *msg;
  int rc;
  const gchar *password;

  if (data->in_bridge && !data->initial_auth_data)
    data->initial_auth_data = ssh_askpass (data, "ssh");

  password = parse_auth_password (data->auth_options->auth_type,
                                  data->initial_auth_data);

  rc = ssh_userauth_password (data->session, NULL, password);
  switch (rc)
    {
    case SSH_AUTH_SUCCESS:
      g_debug ("%s: password auth succeeded", data->logname);
      break;
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
      g_message ("%s: couldn't authenticate: %s", data->logname, msg);
    }

  return rc;
}

static int
do_key_auth (CockpitSshData *data)
{
  int rc;
  const gchar *msg;
  ssh_key key;

  g_assert (data->initial_auth_data != NULL);

  rc = ssh_pki_import_privkey_base64 (data->initial_auth_data, NULL, NULL, NULL, &key);
  if (rc != SSH_OK)
    {
      g_message ("%s: Got invalid key data, %s", data->logname, data->initial_auth_data);
      return rc;
    }

  rc = ssh_userauth_publickey (data->session, NULL, key);
  switch (rc)
    {
    case SSH_AUTH_SUCCESS:
      g_debug ("%s: key auth succeeded", data->logname);
      break;
    case SSH_AUTH_DENIED:
      g_debug ("%s: key auth failed", data->logname);
      break;
    case SSH_AUTH_PARTIAL:
      g_message ("%s: key auth worked, but server wants more authentication",
                 data->logname);
      break;
    case SSH_AUTH_AGAIN:
      g_message ("%s: key auth failed: server asked for retry",
                 data->logname);
      break;
    default:
      msg = ssh_get_error (data->session);
      g_message ("%s: couldn't key authenticate: %s", data->logname, msg);
    }

  ssh_key_free (key);
  return rc;
}

static int
do_agent_auth (CockpitSshData *data)
{
  int rc;
  const gchar *msg;

  rc = ssh_userauth_agent (data->session, NULL);
  switch (rc)
    {
    case SSH_AUTH_SUCCESS:
      g_debug ("%s: agent auth succeeded", data->logname);
      break;
    case SSH_AUTH_DENIED:
      g_debug ("%s: agent auth failed", data->logname);
      break;
    case SSH_AUTH_PARTIAL:
      g_message ("%s: agent auth worked, but server wants more authentication",
                 data->logname);
      break;
    case SSH_AUTH_AGAIN:
      g_message ("%s: agent auth failed: server asked for retry",
                 data->logname);
      break;
    default:
      msg = ssh_get_error (data->session);
      /*
        HACK: https://red.libssh.org/issues/201
        libssh returns error instead of denied
        when agent has no keys. For now treat as
        denied.
       */
      if (strstr (msg, "Access denied"))
        rc = SSH_AUTH_DENIED;
      else
        g_message ("%s: couldn't agent authenticate: %s", data->logname, msg);
    }

  return rc;
}

static int
do_gss_auth (CockpitSshData *data)
{
  int rc;
  const gchar *msg;

  rc = ssh_userauth_gssapi (data->session);

  switch (rc)
    {
    case SSH_AUTH_SUCCESS:
      g_debug ("%s: gssapi auth succeeded", data->logname);
      break;
    case SSH_AUTH_DENIED:
      g_debug ("%s: gssapi auth failed", data->logname);
      break;
    case SSH_AUTH_PARTIAL:
      g_message ("%s: gssapi auth worked, but server wants more authentication",
                 data->logname);
      break;
    default:
      msg = ssh_get_error (data->session);
      g_message ("%s: couldn't authenticate: %s", data->logname, msg);
    }

  return rc;
}

static const gchar *
cockpit_ssh_authenticate (CockpitSshData *data)
{
  const gchar *problem;
  gboolean have_final_result = FALSE;
  gchar *description;
  const gchar *msg;
  int rc;
  int methods_server;
  int methods_tried = 0;
  int methods_to_try = SSH_AUTH_METHOD_INTERACTIVE |
                       SSH_AUTH_METHOD_GSSAPI_MIC |
                       SSH_AUTH_METHOD_PUBLICKEY;

  problem = "authentication-failed";

  rc = ssh_userauth_none (data->session, NULL);
  if (rc == SSH_AUTH_ERROR)
    {
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

  methods_server = ssh_userauth_list (data->session, NULL);

  /* If interactive isn't supported try password instead */
  if (!(methods_server & SSH_AUTH_METHOD_INTERACTIVE))
    {
      methods_to_try = methods_to_try | SSH_AUTH_METHOD_PASSWORD;
      methods_to_try = methods_to_try & ~SSH_AUTH_METHOD_INTERACTIVE;
    }

  while (methods_to_try != 0)
    {
      int (*auth_func)(CockpitSshData *data);
      const gchar *result_string;
      int method;
      gboolean has_creds = FALSE;

      if (methods_to_try & SSH_AUTH_METHOD_PUBLICKEY)
        {
          method = SSH_AUTH_METHOD_PUBLICKEY;
          if (g_strcmp0 (data->auth_options->auth_type, "private-key") == 0)
            {
              auth_func = do_key_auth;
              has_creds = data->initial_auth_data != NULL;
            }
          else
            {
              auth_func = do_agent_auth;
              has_creds = TRUE;
            }
        }
      else if (methods_to_try & SSH_AUTH_METHOD_INTERACTIVE)
        {
          auth_func = do_interactive_auth;
          method = SSH_AUTH_METHOD_INTERACTIVE;
          has_creds = data->in_bridge ||
                      (data->initial_auth_data != NULL && \
                       (g_strcmp0 (data->auth_options->auth_type, "basic") == 0 ||
                        g_strcmp0 (data->auth_options->auth_type,
                                  auth_method_description (method)) == 0));
        }
      else if (methods_to_try & SSH_AUTH_METHOD_PASSWORD)
        {
          auth_func = do_password_auth;
          method = SSH_AUTH_METHOD_PASSWORD;
          has_creds = data->in_bridge||
                      (data->initial_auth_data != NULL && \
                       (g_strcmp0 (data->auth_options->auth_type, "basic") == 0 ||
                        g_strcmp0 (data->auth_options->auth_type,
                                  auth_method_description (method)) == 0));
        }
      else
        {
          auth_func = do_gss_auth;
          method = SSH_AUTH_METHOD_GSSAPI_MIC;
          has_creds = TRUE;
        }

      methods_to_try = methods_to_try & ~method;

      if (!(methods_server & method))
        {
          result_string = "no-server-support";
        }
      else if (!has_creds)
        {
          result_string = "not-provided";
          methods_tried = methods_tried | method;
        }
      else
        {
          methods_tried = methods_tried | method;
          if (!have_final_result)
            {
              rc = auth_func (data);
              result_string = auth_result_string (rc);

              if (rc == SSH_AUTH_SUCCESS)
                {
                  have_final_result = TRUE;
                  problem = NULL;
                }
              else if (rc == SSH_AUTH_ERROR)
                {
                  have_final_result = TRUE;
                  msg = ssh_get_error (data->session);
                  g_message ("%s: couldn't authenticate: %s", data->logname, msg);

                  if (ssh_msg_is_disconnected (msg))
                    problem = "terminated";
                  else
                    problem = "internal-error";
                }
            }
          else
            {
              result_string = "not-tried";
            }
        }

        g_hash_table_insert (data->auth_results,
                             g_strdup (auth_method_description (method)),
                             g_strdup (result_string));
    }

  if (have_final_result)
    goto out;

  if (methods_tried == 0)
    {
      description = auth_methods_line (methods_server);
      g_message ("%s: server offered unsupported authentication methods: %s",
                 data->logname, description);
      g_free (description);
    }

out:
  return problem;
}

static gboolean
send_auth_reply (CockpitSshData *data,
                 const gchar *username,
                 const gchar *problem)
{
  GHashTableIter auth_iter;
  JsonObject *auth_json = NULL; // consumed by object
  JsonObject *object = NULL;
  GBytes *message = NULL;
  gboolean ret;
  gpointer hkey;
  gpointer hvalue;
  object = json_object_new ();
  auth_json = json_object_new ();

  if (data->host_key)
    json_object_set_string_member (object, "host-key", data->host_key);
  if (data->host_fingerprint)
    json_object_set_string_member (object, "host-fingerprint", data->host_fingerprint);

  if (problem)
    json_object_set_string_member (object, "error", problem);
  else
    json_object_set_string_member (object, "user", username);

  if (data->auth_results)
    {
      g_hash_table_iter_init (&auth_iter, data->auth_results);
      while (g_hash_table_iter_next (&auth_iter, &hkey, &hvalue))
        json_object_set_string_member (auth_json, hkey, hvalue);
    }

  json_object_set_object_member (object,
                                 "auth-method-results",
                                 auth_json);

  message = cockpit_json_write_bytes (object);
  ret = write_to_auth_fd (data, message);
  g_bytes_unref (message);
  json_object_unref (object);

  if (!ret)
    g_warning ("%s: Error sending authentication reply", data->logname);

  return ret;
}

static void
parse_host (const gchar *host,
            gchar **hostname,
            gchar **username,
            guint *port)
{
  gchar *user_arg = NULL;
  gchar *host_arg = NULL;
  gchar *tmp = NULL;
  gchar *end = NULL;

  guint64 tmp_num;

  gsize host_offset = 0;
  gsize host_length = strlen (host);

  tmp = strrchr (host, '@');
  if (tmp)
    {
      if (tmp[0] != host[0])
      {
        user_arg = g_strndup (host, tmp - host);
        host_offset = strlen (user_arg) + 1;
        host_length = host_length - host_offset;
      }
      else
        {
          g_message ("ignoring blank user in %s", host);
        }
    }

  tmp = strrchr (host, ':');
  if (tmp)
    {
      tmp_num = g_ascii_strtoull (tmp + 1, &end, 10);
      if (end[0] == '\0' && tmp_num > 0 && tmp_num < G_MAXUSHORT)
        {
          *port = (guint) tmp_num;
          host_length = host_length - strlen (tmp);
        }
      else
        {
          g_message ("ignoring invalid port in %s", host);
        }
    }

  host_arg = g_strndup (host + host_offset, host_length);
  *hostname = g_strdup (host_arg);
  *username = g_strdup (user_arg);

  g_free (host_arg);
  g_free (user_arg);
}

static gchar *
username_from_basic (const gchar *basic_data)
{
  gchar *tmp = strchr (basic_data, ':');
  if (tmp != NULL)
    return g_strndup (basic_data, tmp - basic_data);
  else
    return g_strdup (basic_data);
}

static const gchar*
cockpit_ssh_connect (CockpitSshData *data,
                     const gchar *host_arg,
                     ssh_channel *out_channel)
{
  const gchar *problem;

  guint port = 22;
  gchar *host;

  ssh_channel channel;
  int rc;

  parse_host (host_arg, &host, &data->username, &port);

  /* Username always comes from auth message when using basic */
  if (g_strcmp0 (data->auth_options->auth_type, "basic") == 0)
    {
      g_free (data->username);
      data->username = username_from_basic (data->initial_auth_data);
    }

  if (!data->username || *data->username == '\0')
    {
      g_message ("%s: No username provided", data->logname);
      problem = "authentication-failed";
      goto out;
    }

  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_USER, data->username) == 0);
  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_PORT, &port) == 0);

  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_HOST, host) == 0);;

  rc = ssh_connect (data->session);
  if (rc != SSH_OK)
    {
      g_message ("%s: %d couldn't connect: %s '%s' '%d'", data->logname, rc,
                 ssh_get_error (data->session), host, port);
      problem = "no-host";
      goto out;
    }

  g_debug ("%s: connected", data->logname);

  if (!data->ssh_options->ignore_hostkey)
    {
      problem = verify_knownhost (data, host, port);
      if (problem != NULL)
        goto out;
    }

  /* The problem returned when auth failure */
  problem = cockpit_ssh_authenticate (data);
  if (problem != NULL)
    goto out;

  channel = ssh_channel_new (data->session);
  rc = ssh_channel_open_session (channel);
  if (rc != SSH_OK)
    {
      g_message ("%s: couldn't open session: %s", data->logname,
                 ssh_get_error (data->session));
      problem = "internal-error";
      goto out;
    }

  rc = ssh_channel_request_exec (channel, data->ssh_options->command);
  if (rc != SSH_OK)
    {
      g_message ("%s: couldn't execute command: %s: %s", data->logname,
                 data->ssh_options->command,
                 ssh_get_error (data->session));
      problem = "internal-error";
      goto out;
    }

  g_debug ("%s: opened channel", data->logname);

  *out_channel = channel;
out:
  g_free (host);
  return problem;
}

static void
cockpit_ssh_data_free (CockpitSshData *data)
{
  if (data->initial_auth_data)
    {
      memset (data->initial_auth_data, 0, strlen (data->initial_auth_data));
      free (data->initial_auth_data);
    }

  g_free (data->host_key);
  if (data->host_fingerprint)
    ssh_string_free_char (data->host_fingerprint);

  if (data->auth_results)
    g_hash_table_destroy (data->auth_results);

  if (data->auth_fd > 0)
    close (data->auth_fd);
  data->auth_fd = 0;

  g_free (data->username);
  g_free (data->ssh_options);
  g_free (data->auth_options);
  g_free (data->user_known_hosts);
  g_strfreev (data->env);
  g_free (data);
}


#define COCKPIT_SSH_RELAY(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_SSH_RELAY, CockpitSshRelay))

struct  _CockpitSshRelay {
  GObject parent_instance;

  CockpitSshData *ssh_data;

  gboolean sent_disconnect;
  gboolean received_eof;
  gboolean received_frame;
  gboolean received_close;
  gboolean received_exit;

  gboolean sent_close;
  gboolean sent_eof;

  guint exit_code;
  guint sig_read;
  guint sig_close;
  gboolean pipe_closed;
  CockpitPipe *pipe;

  GQueue *queue;
  gsize partial;

  gchar *logname;
  gchar *connection_string;

  ssh_session session;
  ssh_channel channel;
  ssh_event event;

  GSource *io;

  struct ssh_channel_callbacks_struct channel_cbs;
};

struct _CockpitSshRelayClass {
  GObjectClass parent_class;
};

static guint sig_disconnect = 0;

enum {
  PROP_0,
  PROP_CONNECTION_STRING
};

G_DEFINE_TYPE (CockpitSshRelay, cockpit_ssh_relay, G_TYPE_OBJECT);

static void
cockpit_ssh_relay_dispose (GObject *object)
{
  CockpitSshRelay *self = COCKPIT_SSH_RELAY (object);

  g_assert (self->ssh_data == NULL);

  if (self->sig_read > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_read);
  self->sig_read = 0;

  if (self->sig_close > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_close);
  self->sig_close = 0;

  if (self->io)
    g_source_destroy (self->io);

  G_OBJECT_CLASS (cockpit_ssh_relay_parent_class)->dispose (object);
}

static void
cockpit_ssh_relay_finalize (GObject *object)
{
  CockpitSshRelay *self = COCKPIT_SSH_RELAY (object);

  if (self->pipe)
    g_object_unref (self->pipe);

  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);

  if (self->event)
    ssh_event_free (self->event);

  /* libssh channels like to hang around even after they're freed */
  if (self->channel)
    memset (&self->channel_cbs, 0, sizeof (self->channel_cbs));

  g_free (self->logname);
  g_free (self->connection_string);

  if (self->io)
    g_source_unref (self->io);

  ssh_disconnect (self->session);
  ssh_free (self->session);

  G_OBJECT_CLASS (cockpit_ssh_relay_parent_class)->finalize (object);
}

static gboolean
emit_disconnect (gpointer user_data)
{
  CockpitSshRelay *self = user_data;

  if (!self->sent_disconnect)
    {
      self->sent_disconnect = TRUE;
      g_signal_emit (self, sig_disconnect, 0);
    }

  return FALSE;
}

static void
cockpit_relay_disconnect (CockpitSshRelay *self,
                          const gchar *problem)
{
  if (self->ssh_data)
    {
      send_auth_reply (self->ssh_data, NULL,
                       problem ? problem : exit_code_problem (self->exit_code));
      cockpit_ssh_data_free (self->ssh_data);
      self->ssh_data = NULL;
    }

  /* libssh channels like to hang around even after they're freed */
  if (self->channel)
      memset (&self->channel_cbs, 0, sizeof (self->channel_cbs));
  self->channel = NULL;

  if (self->io)
    g_source_destroy (self->io);

  g_timeout_add (0, emit_disconnect, self);
}

static int
on_channel_data (ssh_session session,
                 ssh_channel channel,
                 void *data,
                 uint32_t len,
                 int is_stderr,
                 void *userdata)
{
  CockpitSshRelay *self = userdata;
  guint32 size, i;
  gint ret = 0;
  GBytes *bytes = NULL;
  guint8 *bdata = data;

  if (!self->received_frame && !is_stderr)
    {
      size = 0;
      for (i = 0; i < len; i++)
        {
          /* Check invalid characters, prevent integer overflow, limit max length */
          if (i > 7 || bdata[i] < '0' || bdata[i] > '9')
            break;
          size *= 10;
          size += bdata[i] - '0';
        }

      /* If we don't have enough data return 0 bytes processed
       * so that this data will be included in the next callback
       */
      if (i == len)
          goto out;

      /*
       * So we may be talking to a process that's not cockpit-bridge. How does
       * that happen? ssh always executes commands inside of a shell ... and
       * bash prints its 'cockpit-bridge: not found' message on stdout (!)
       *
       * So we degrade gracefully in this case, and start to treat output as
       * error output.
       */
      if (bdata[i] != '\n')
        {
          self->exit_code = NO_COCKPIT;
        }
      else
        {
          self->received_frame = TRUE;
          send_auth_reply (self->ssh_data, self->ssh_data->username, NULL);
          cockpit_ssh_data_free (self->ssh_data);
          self->ssh_data = NULL;
        }
    }

  if (is_stderr || self->exit_code == NO_COCKPIT)
    {
      g_printerr ("%s", bdata);
      ret = len;
    }
  else if (self->received_frame)
    {
      if (!self->pipe_closed)
        {
          bytes = g_bytes_new (bdata, len);
          cockpit_pipe_write (self->pipe, bytes);
          g_bytes_unref (bytes);
          ret = len;
        }
      else
        {
          g_debug ("%s: dropping %d incoming bytes, pipe is closed", self->logname, len);
          ret = len;
        }
    }
out:
  return ret;
}

static void
on_channel_eof (ssh_session session,
                ssh_channel channel,
                void *userdata)
{
  CockpitSshRelay *self = userdata;
  g_debug ("%s: received eof", self->logname);
  self->received_eof = TRUE;
}

static void
on_channel_close (ssh_session session,
                  ssh_channel channel,
                  void *userdata)
{
  CockpitSshRelay *self = userdata;
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
  CockpitSshRelay *self = userdata;
  guint exit_code;
  g_return_if_fail (signal != NULL);
  self->received_exit = TRUE;

  if (g_ascii_strcasecmp (signal, "TERM") == 0 ||
      g_ascii_strcasecmp (signal, "Terminated") == 0)
    {
      g_debug ("%s: received TERM signal", self->logname);
      exit_code = TERMINATED;
    }
  else
    {
      g_warning ("%s: bridge killed%s%s%s%s", self->logname,
                 signal ? " by signal " : "", signal ? signal : "",
                 errmsg && errmsg[0] ? ": " : "", errmsg ? errmsg : "");
      exit_code = INTERNAL_ERROR;
    }

  if (!self->exit_code)
    self->exit_code = exit_code;

  cockpit_relay_disconnect (self, NULL);
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
  CockpitSshRelay *self = userdata;
  guint exit_code = 0;

  self->received_exit = TRUE;
  if (exit_status == 127)
    {
      g_debug ("%s: received exit status %d", self->logname, exit_status);
      exit_code = NO_COCKPIT;        /* cockpit-bridge not installed */
    }
  else if (!self->received_frame)
    {
      g_message ("%s: spawning remote bridge failed with %d status", self->logname, exit_status);
      exit_code = NO_COCKPIT;
    }
  else if (exit_status)
    {
      g_message ("%s: remote bridge exited with %d status", self->logname, exit_status);
      exit_code = INTERNAL_ERROR;
    }
  if (!self->exit_code && exit_code)
    self->exit_code = exit_code;

  cockpit_relay_disconnect (self, NULL);
}

static gboolean
dispatch_queue (CockpitSshRelay *self)
{
  GBytes *block;
  const guchar *data;
  const gchar *msg;
  gsize length;
  gsize want;
  int rc;

  if (self->sent_eof)
    return FALSE;
  if (self->received_close)
    return FALSE;

  for (;;)
    {
      block = g_queue_peek_head (self->queue);
      if (!block)
        return FALSE;

      data = g_bytes_get_data (block, &length);
      g_assert (self->partial <= length);

      want = length - self->partial;
      rc = ssh_channel_write (self->channel, data + self->partial, want);
      if (rc < 0)
        {
          msg = ssh_get_error (self->session);
          if (ssh_get_error_code (self->session) == SSH_REQUEST_DENIED)
            {
              g_debug ("%s: couldn't write: %s", self->logname, msg);
              return FALSE;
            }
          else if (ssh_msg_is_disconnected (msg))
            {
              g_message ("%s: couldn't write: %s", self->logname, msg);
              self->received_close = TRUE;
              self->received_eof = TRUE;
              return FALSE;
            }
          else
            {
              g_warning ("%s: couldn't write: %s", self->logname, msg);
              return FALSE;
            }
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

static void
dispatch_close (CockpitSshRelay *self)
{
  g_assert (!self->sent_close);

  switch (ssh_channel_close (self->channel))
    {
    case SSH_AGAIN:
      g_debug ("%s: will send close later", self->logname);
      break;
    case SSH_OK:
      g_debug ("%s: sent close", self->logname);
      self->sent_close = TRUE;
      break;
    default:
      if (ssh_get_error_code (self->session) == SSH_REQUEST_DENIED)
        {
          g_debug ("%s: couldn't send close: %s", self->logname,
                   ssh_get_error (self->session));
          self->sent_close = TRUE; /* channel is already closed */
        }
      else
        {
          g_warning ("%s: couldn't send close: %s", self->logname,
                     ssh_get_error (self->session));
          self->received_exit = TRUE;
          if (!self->exit_code)
            self->exit_code = INTERNAL_ERROR;
          cockpit_relay_disconnect (self, NULL);
        }
      break;
    }
}

static void
dispatch_eof (CockpitSshRelay *self)
{
  g_assert (!self->sent_eof);

  switch (ssh_channel_send_eof (self->channel))
    {
    case SSH_AGAIN:
      g_debug ("%s: will send eof later", self->logname);
      break;
    case SSH_OK:
      g_debug ("%s: sent eof", self->logname);
      self->sent_eof = TRUE;
      break;
    default:
      if (ssh_get_error_code (self->session) == SSH_REQUEST_DENIED)
        {
          g_debug ("%s: couldn't send eof: %s", self->logname,
                   ssh_get_error (self->session));
          self->sent_eof = TRUE; /* channel is already closed */
        }
      else
        {
          g_warning ("%s: couldn't send eof: %s", self->logname,
                     ssh_get_error (self->session));
          self->received_exit = TRUE;
          if (!self->exit_code)
            self->exit_code = INTERNAL_ERROR;
          cockpit_relay_disconnect (self, NULL);
        }
      break;
    }
}

static void
on_pipe_read (CockpitPipe *pipe,
              GByteArray *input,
              gboolean end_of_data,
              gpointer user_data)
{
  CockpitSshRelay *self = user_data;
  GByteArray *buf = NULL;

  buf = cockpit_pipe_get_buffer (pipe);
  g_byte_array_ref (buf);

  if (!self->sent_eof && !self->received_close && buf->len > 0)
    {
      g_debug ("%s: queued %d bytes", self->logname, buf->len);
      g_queue_push_tail (self->queue, g_byte_array_free_to_bytes (buf));
    }
  else
    {
      g_debug ("%s: dropping %d bytes", self->logname, buf->len);
      g_byte_array_free (buf, TRUE);
    }
}

static void
on_pipe_close (CockpitPipe *pipe,
               const gchar *problem,
               gpointer user_data)
{
  CockpitSshRelay *self = user_data;

  self->pipe_closed = TRUE;
  // Pipe closing before data was received doesn't mean no-cockpit
  self->received_frame = TRUE;

  if (!self->received_eof)
    dispatch_eof (self);
}

typedef struct {
  GSource source;
  GPollFD pfd;
  CockpitSshRelay *relay;
} CockpitSshSource;

static gboolean
cockpit_ssh_source_check (GSource *source)
{
  CockpitSshSource *cs = (CockpitSshSource *)source;
  return (cs->pfd.events & cs->pfd.revents) != 0;
}

static gboolean
cockpit_ssh_source_prepare (GSource *source,
                            gint *timeout)
{
  CockpitSshSource *cs = (CockpitSshSource *)source;
  CockpitSshRelay *self = cs->relay;
  gint status;

  *timeout = 1;

  status = ssh_get_status (self->session);

  cs->pfd.revents = 0;
  cs->pfd.events = G_IO_IN | G_IO_ERR | G_IO_NVAL | G_IO_HUP;

  /* libssh has something in its buffer: want to write */
  if (status & SSH_WRITE_PENDING)
    cs->pfd.events |= G_IO_OUT;

  /* We have something in our queue: want to write */
  else if (!g_queue_is_empty (self->queue))
    cs->pfd.events |= G_IO_OUT;

  /* We are closing and need to send eof: want to write */
  else if (self->pipe_closed && !self->sent_eof)
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
  int rc;
  const gchar *msg;
  gboolean ret = TRUE;
  CockpitSshRelay *self = cs->relay;
  GIOCondition cond = cs->pfd.revents;

  if (cond & (G_IO_HUP | G_IO_ERR))
    {
      if (self->sent_close || self->sent_eof)
        {
          self->received_eof = TRUE;
          self->received_close = TRUE;
        }
    }

  if (self->received_exit)
    return FALSE;

  g_return_val_if_fail ((cond & G_IO_NVAL) == 0, FALSE);

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
      msg = ssh_get_error (self->session);

      /*
       * HACK: There doesn't seem to be a way to get at the original socket errno
       * here. So we have to screen scrape.
       *
       * https://red.libssh.org/issues/158
       */
      if (ssh_msg_is_disconnected (msg))
        {
          g_debug ("%s: failed to process channel: %s", self->logname, msg);
          self->received_exit = TRUE;
          if (!self->exit_code)
            self->exit_code = TERMINATED;
        }
      else
        {
          g_message ("%s: failed to process channel: %s", self->logname, msg);
          self->received_exit = TRUE;
          if (!self->exit_code)
            self->exit_code = INTERNAL_ERROR;
        }
      ret = FALSE;
      break;
    default:
      self->received_exit = TRUE;
      if (!self->exit_code)
        self->exit_code = INTERNAL_ERROR;
      g_critical ("%s: ssh_event_dopoll() returned %d", self->logname, rc);
      ret = FALSE;
    }

  if (!ret)
    goto out;

  if (cond & G_IO_ERR)
    {
      g_message ("%s: error reading from ssh", self->logname);
      ret = FALSE;
      self->received_exit = TRUE;
      if (!self->exit_code)
        self->exit_code = DISCONNECTED;
      goto out;
    }

  if (cond & G_IO_OUT)
    {
      if (!dispatch_queue (self) && self->pipe_closed && !self->sent_eof)
        dispatch_eof (self);
      if (self->received_eof && self->sent_eof && !self->sent_close)
        dispatch_close (self);
      if (self->received_eof && !self->received_close && !self->sent_close)
        dispatch_close (self);
    }

out:
  if (self->received_exit)
    cockpit_relay_disconnect (self, NULL);
  return ret;
}

static GSource *
cockpit_ssh_relay_start_source (CockpitSshRelay *self) {
  static GSourceFuncs source_funcs = {
    cockpit_ssh_source_prepare,
    cockpit_ssh_source_check,
    cockpit_ssh_source_dispatch,
    NULL,
  };
  GSource *source = g_source_new (&source_funcs, sizeof (CockpitSshSource));
  CockpitSshSource *cs = (CockpitSshSource *)source;
  cs->relay = self;
  cs->pfd.fd = ssh_get_fd (self->session);
  g_source_add_poll (source, &cs->pfd);
  g_source_attach (source, g_main_context_default ());

  return source;
}

static void
cockpit_ssh_relay_start (CockpitSshRelay *self,
                         gint outfd)
{
  const gchar *problem;

  static struct ssh_channel_callbacks_struct channel_cbs = {
    .channel_data_function = on_channel_data,
    .channel_eof_function = on_channel_eof,
    .channel_close_function = on_channel_close,
    .channel_signal_function = on_channel_signal,
    .channel_exit_signal_function = on_channel_exit_signal,
    .channel_exit_status_function = on_channel_exit_status,
  };

  self->ssh_data->in_bridge = g_strcmp0 (self->ssh_data->auth_options->auth_type, "bridge") == 0;
  if (g_strcmp0 (self->ssh_data->auth_options->auth_type, "none") != 0 && !self->ssh_data->in_bridge)
    self->ssh_data->initial_auth_data = wait_for_auth_fd_reply (self->ssh_data);

  problem = cockpit_ssh_connect (self->ssh_data, self->connection_string, &self->channel);
  if (problem)
    {
      self->exit_code = AUTHENTICATION_FAILED;
      cockpit_relay_disconnect (self, problem);
      close (outfd);
      return;
    }

  self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                             "in-fd", 0,
                             "out-fd", outfd,
                             "name", self->logname,
                             NULL);
  self->sig_read = g_signal_connect (self->pipe,
                                      "read",
                                      G_CALLBACK (on_pipe_read),
                                      self);
  self->sig_close = g_signal_connect (self->pipe,
                                      "close",
                                      G_CALLBACK (on_pipe_close),
                                      self);

  self->event = ssh_event_new ();
  memcpy (&self->channel_cbs, &channel_cbs, sizeof (channel_cbs));
  self->channel_cbs.userdata = self;
  ssh_callbacks_init (&self->channel_cbs);
  ssh_set_channel_callbacks (self->channel, &self->channel_cbs);
  ssh_set_blocking (self->session, 0);
  ssh_event_add_session (self->event, self->session);

  self->io = cockpit_ssh_relay_start_source (self);
}

static void
cockpit_ssh_relay_init (CockpitSshRelay *self)
{
  const gchar *debug;

  ssh_init ();

  self->queue = g_queue_new ();
  debug = g_getenv ("G_MESSAGES_DEBUG");

  if (debug && (strstr (debug, "libssh") || g_strcmp0 (debug, "all") == 0))
    ssh_set_log_level (SSH_LOG_FUNCTIONS);
}

static void
cockpit_ssh_relay_set_property (GObject *obj,
                                guint prop_id,
                                const GValue *value,
                                GParamSpec *pspec)
{
  CockpitSshRelay *self = COCKPIT_SSH_RELAY (obj);

  switch (prop_id)
    {
    case PROP_CONNECTION_STRING:
      self->connection_string = g_value_dup_string (value);
      self->logname = g_strdup_printf ("cockpit-ssh %s", self->connection_string);
      break;
    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (obj, prop_id, pspec);
      break;
    }
}

static void
cockpit_ssh_relay_constructed (GObject *object)
{
  CockpitSshRelay *self = COCKPIT_SSH_RELAY (object);

  G_OBJECT_CLASS (cockpit_ssh_relay_parent_class)->constructed (object);

  self->session = ssh_new ();
  self->ssh_data = g_new0 (CockpitSshData, 1);
  self->ssh_data->env = g_get_environ ();
  self->ssh_data->session = self->session;
  self->ssh_data->logname = self->logname;
  self->ssh_data->auth_results = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  self->ssh_data->auth_fd = AUTH_FD;
  self->ssh_data->auth_options = cockpit_auth_options_from_env (self->ssh_data->env);
  self->ssh_data->ssh_options = cockpit_ssh_options_from_env (self->ssh_data->env);
  self->ssh_data->user_known_hosts = g_build_filename (g_get_home_dir (), ".ssh/known_hosts", NULL);
}

static void
cockpit_ssh_relay_class_init (CockpitSshRelayClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  object_class->dispose = cockpit_ssh_relay_dispose;
  object_class->finalize = cockpit_ssh_relay_finalize;
  object_class->constructed = cockpit_ssh_relay_constructed;
  object_class->set_property = cockpit_ssh_relay_set_property;

  g_object_class_install_property (object_class, PROP_CONNECTION_STRING,
         g_param_spec_string ("connection-string", NULL, NULL, "localhost",
                              G_PARAM_WRITABLE | G_PARAM_CONSTRUCT_ONLY | G_PARAM_STATIC_STRINGS));

  sig_disconnect = g_signal_new ("disconnect", COCKPIT_TYPE_SSH_RELAY,
                                 G_SIGNAL_RUN_LAST, 0, NULL, NULL, NULL,
                                 G_TYPE_NONE, 0);
}

CockpitSshRelay *
cockpit_ssh_relay_new (const gchar *connection_string,
                       gint outfd)
{

  CockpitSshRelay *self = g_object_new (COCKPIT_TYPE_SSH_RELAY,
                                        "connection-string", connection_string,
                                        NULL);
  cockpit_ssh_relay_start (self, outfd);
  return self;
}

gint
cockpit_ssh_relay_result (CockpitSshRelay* self)
{
  return self->exit_code;
}
