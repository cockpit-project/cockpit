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

#include "common/cockpitauthorize.h"
#include "common/cockpitconf.h"
#include "common/cockpithex.h"
#include "common/cockpitframe.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpitlog.h"
#include "common/cockpittest.h"
#include "common/cockpittransport.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitknownhosts.h"

#include "cockpitsshrelay.h"
#include "cockpitsshoptions.h"

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
#include <time.h>

/* we had a private one before moving to /etc/ssh/ssh_known_hosts */
#define LEGACY_KNOWN_HOSTS PACKAGE_LOCALSTATE_DIR "/known_hosts"

typedef struct {
  const gchar *logname;
  gchar *initial_auth_data;
  gchar *auth_type;

  gchar **env;
  CockpitSshOptions *ssh_options;

  gchar *username;
  gboolean in_bridge;

  ssh_session session;

  gchar *conversation;

  gchar *host_key;
  gchar *host_fingerprint;
  const gchar *host_key_type;
  GHashTable *auth_results;
  gchar *user_known_hosts;
  gint outfd;

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
write_control_message (int fd,
                       JsonObject *options)
{
  gboolean ret = TRUE;
  gchar *payload;
  gchar *prefixed;
  gsize length;

  payload = cockpit_json_write_object (options, &length);
  prefixed = g_strdup_printf ("\n%s", payload);
  if (cockpit_frame_write (fd, (unsigned char *)prefixed, length + 1) < 0)
    {
      g_message ("couldn't write control message: %s", g_strerror (errno));
      ret = FALSE;
    }
  g_free (prefixed);
  g_free (payload);

  return ret;
}

static void
byte_array_clear_and_free (gpointer data)
{
  GByteArray *buffer = data;
  cockpit_memory_clear (buffer->data, buffer->len);
  g_byte_array_free (buffer, TRUE);
}

static JsonObject *
read_control_message (int fd)
{
  JsonObject *options = NULL;
  GBytes *payload = NULL;
  GBytes *bytes = NULL;
  gchar *channel = NULL;
  guchar *data = NULL;
  gssize length = 0;

  length = cockpit_frame_read (fd, &data);
  if (length < 0)
    {
      g_message ("couldn't read control message: %s", g_strerror (errno));
      length = 0;
    }
  else if (length > 0)
    {
      /* This could have a password, so clear it when freeing */
      bytes = g_bytes_new_with_free_func (data, length, byte_array_clear_and_free,
                                          g_byte_array_new_take (data, length));
      payload = cockpit_transport_parse_frame (bytes, &channel);
      data = NULL;
    }

  if (payload == NULL)
    {
      if (length > 0)
        g_message ("cockpit-ssh did not receive valid message");
    }
  else if (channel != NULL)
    {
      g_message ("cockpit-ssh did not receive a control message");
    }
  else if (!cockpit_transport_parse_command (payload, NULL, NULL, &options))
    {
      g_message ("cockpit-ssh did not receive a valid control message");
    }

  g_free (channel);

  if (bytes)
    g_bytes_unref (bytes);
  if (payload)
    g_bytes_unref (payload);
  free (data);
  return options;
}

static void
send_authorize_challenge (const gchar *challenge,
                          gint outfd)
{
  gchar *cookie = NULL;
  JsonObject *object = json_object_new ();

  cookie = g_strdup_printf ("session%u%u",
                            (unsigned int)getpid(),
                            (unsigned int)time (NULL));
  json_object_set_string_member (object, "command", "authorize");
  json_object_set_string_member (object, "challenge", challenge);
  json_object_set_string_member (object, "cookie", cookie);

  write_control_message (outfd, object);

  g_free (cookie);
  json_object_unref (object);
}

static gchar *
challenge_for_auth_data (const gchar *challenge,
                         gint outfd,
                         gchar **ret_type)
{
  const gchar *response = NULL;
  const gchar *command;
  gchar *ptr = NULL;
  gchar *type = NULL;
  JsonObject *reply;

  send_authorize_challenge (challenge ? challenge : "*", outfd);
  reply = read_control_message (STDIN_FILENO);
  if (!reply)
    goto out;

  if (!cockpit_json_get_string (reply, "command", "", &command) ||
      !g_str_equal (command, "authorize"))
    {
      g_message ("received \"%s\" control message instead of \"authorize\"", command);
    }
  else if (!cockpit_json_get_string (reply, "response", NULL, &response))
    {
      g_message ("received unexpected \"authorize\" control message: %s", response);
    }

  if (response)
    cockpit_authorize_type (response, &type);

out:
  if (ret_type)
    *ret_type = type;
  else
    g_free (type);

  if (response && !g_str_equal (response, ""))
    ptr = g_strdup (response);

  if (reply)
    json_object_unref (reply);
  return ptr;
}

static gchar *
challenge_for_knownhosts_data (CockpitSshData *data)
{
  const gchar *value = NULL;
  gchar *ret = NULL;
  gchar *response = NULL;

  response = challenge_for_auth_data ("x-host-key", data->outfd, NULL);
  if (response)
    {
      value = cockpit_authorize_type (response, NULL);
      /* Legacy blank string means force fail */
      if (value && value[0] == '\0')
        ret = g_strdup ("* invalid key");
      else
        ret = g_strdup (value);
    }


  g_free (response);
  return ret;
}

static gchar *
prompt_with_authorize (CockpitSshData *data,
                       const gchar *prompt,
                       const gchar *msg,
                       const gchar *default_value,
                       const gchar *host_key,
                       gboolean echo)
{
  JsonObject *request = NULL;
  JsonObject *reply = NULL;
  const gchar *command = NULL;
  const char *response = NULL;
  char *challenge = NULL;
  gchar *result = NULL;
  gboolean ret;

  challenge = cockpit_authorize_build_x_conversation (prompt, &data->conversation);
  if (!challenge)
    return NULL;

  request = json_object_new ();
  json_object_set_string_member (request, "command", "authorize");
  json_object_set_string_member (request, "cookie", data->conversation);
  json_object_set_string_member (request, "challenge", challenge);
  cockpit_memory_clear (challenge, -1);
  free (challenge);

  if (msg)
    json_object_set_string_member (request, "message", msg);
  if (default_value)
    json_object_set_string_member (request, "default", default_value);
  if (host_key)
    json_object_set_string_member (request, "host-key", host_key);

  json_object_set_boolean_member (request, "echo", echo);

  ret = write_control_message (data->outfd, request);
  json_object_unref (request);

  if (!ret)
    return NULL;

  reply = read_control_message (STDIN_FILENO);
  if (!reply)
    return NULL;

  if (!cockpit_json_get_string (reply, "command", "", &command) ||
      !g_str_equal (command, "authorize"))
    {
      g_message ("received \"%s\" control message instead of \"authorize\"", command);
    }
  else if (!cockpit_json_get_string (reply, "response", "", &response))
    {
      g_message ("received unexpected \"authorize\" control message");
    }
  else if (!g_str_equal (response, ""))
    {
      result = cockpit_authorize_parse_x_conversation (response, NULL);
      if (!result)
        g_message ("received unexpected \"authorize\" control message \"response\"");
    }

  json_object_unref (reply);
  return result;
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
  gchar *host = NULL;
  guint port = 22;
  gchar *message = NULL;
  gchar *prompt = NULL;
  gchar *reply = NULL;

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

  reply = prompt_with_authorize (data, prompt, message, data->host_fingerprint, data->host_key, TRUE);

out:
  if (g_strcmp0 (reply, data->host_fingerprint) == 0 || g_strcmp0 (reply, data->host_key) == 0)
    ret = NULL;
  else
    ret = "unknown-hostkey";

  g_free (reply);
  g_free (message);
  g_free (prompt);
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

static gboolean
write_tmp_knownhosts_file (CockpitSshData *data,
                           const gchar *content,
                           const gchar **problem)
{
  FILE *fp = NULL;

  tmp_knownhost_file = create_knownhosts_temp ();
  if (!tmp_knownhost_file)
    {
      *problem = "internal-error";
      return FALSE;
    }
  atexit (cleanup_knownhosts_file);

  fp = fopen (tmp_knownhost_file, "a");
  if (fp == NULL)
    {
      g_warning ("%s: couldn't open temporary known host file for data: %s",
                 data->logname, tmp_knownhost_file);
      *problem = "internal-error";
      return FALSE;
    }

  if (fputs (content, fp) < 0)
    {
      g_warning ("%s: couldn't write data to temporary known host file: %s",
                 data->logname, g_strerror (errno));
      fclose (fp);
      *problem = "internal-error";
      return FALSE;
    }

  fclose (fp);
  return TRUE;
}

/**
 * prepend_host_port:
 *
 * Transform lines of keys to an ssh known_hosts format with lines of
 * "[host]:port key".
 */
static gchar *
prepend_host_port (const gchar *host,
                   guint port,
                   const gchar *keys)
{
  gchar **lines = g_strsplit (keys, "\n", 0);
  gchar **line;
  GString *result = g_string_new (NULL);

  for (line = lines; *line; ++line)
    g_string_append_printf (result, "[%s]:%d %s\n", host, port, *line);

  g_strfreev (lines);
  return g_string_free (result, FALSE);

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
  const gchar *knownhosts_data;
  const gchar *problem = NULL;
  gchar *sout = NULL;
  gchar *serr = NULL;

  gchar *authorize_knownhosts_data = NULL;

  if (data->ssh_options->knownhosts_authorize)
    {
      authorize_knownhosts_data = challenge_for_knownhosts_data (data);
      knownhosts_data = authorize_knownhosts_data;
    }
  else
    {
      knownhosts_data = data->ssh_options->knownhosts_data;
    }

  /* $COCKPIT_SSH_KNOWN_HOSTS_DATA has highest priority */
  if (knownhosts_data)
    {
      if (write_tmp_knownhosts_file (data, knownhosts_data, &problem))
        data->ssh_options->knownhosts_file = tmp_knownhost_file;
      else
        goto out;
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

  /* last (most expensive) fallback is to ask sssd's ssh known_hosts proxy */
  if (!host_known && tmp_knownhost_file == NULL)
    {
      char port_str[10];
      const gchar *argv [] = {
          "sss_ssh_knownhostsproxy",
          "--pubkey",
          "--port", port_str,
          host,
          NULL
      };
      GError *error = NULL;
      gint exit;

      g_debug ("%s: host not known in any local file, asking sssd", data->logname);

      snprintf (port_str, sizeof (port_str), "%u", port);

      if (g_spawn_sync (NULL, (gchar **) argv, NULL, G_SPAWN_SEARCH_PATH, NULL,
                        NULL, &sout, &serr, &exit, &error))
        {
          sout = g_strstrip (sout);
          if (exit == 0 && strlen (sout) > 0)
            {
              gchar *known_hosts = prepend_host_port (host, port, sout);
              gboolean res = write_tmp_knownhosts_file (data, known_hosts, &problem);
              g_free (known_hosts);
              if (!res)
                goto out;

              /* this should always be known now, but let's make double-sure */
              host_known = cockpit_is_host_known (tmp_knownhost_file, host, port);
              if (host_known)
                data->ssh_options->knownhosts_file = tmp_knownhost_file;
              else
                g_warning ("sss_ssh_knownhostsproxy reported key for %s:%u which is not known to cockpit_is_host_known()", host, port);
            } else {
              /* the --pubkey option is not yet known by many older distributions; don't show the error in the log */
              g_debug ("%s: sss_ssh_knownhostsproxy failed: exit code %i, output '%s', error '%s'", data->logname, exit, sout, serr);
            }
        } else {
          g_debug ("%s: Failed to run sss_ssh_knownhostsproxy: %s", data->logname, error->message);
          g_clear_error (&error);
        }
    }

  g_debug ("%s: using known hosts file %s", data->logname, data->ssh_options->knownhosts_file);
  if (!data->ssh_options->allow_unknown_hosts && !host_known)
    {
      g_message ("%s: refusing to connect to unknown host: %s:%d",
                 data->logname, host, port);
      problem = "unknown-host";
      goto out;
    }

  problem = NULL;
out:
  g_free (authorize_knownhosts_data);
  g_free (sout);
  g_free (serr);
  return problem;
}

static const gchar *
verify_knownhost (CockpitSshData *data,
                  const gchar* host,
                  const guint port)
{
  const gchar *ret = "invalid-hostkey";
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

#ifdef HAVE_SSH_GET_SERVER_PUBLICKEY
  if (ssh_get_server_publickey (data->session, &key) != SSH_OK)
#else
  if (ssh_get_publickey (data->session, &key) != SSH_OK)
#endif
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

  if (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS,
                       data->ssh_options->knownhosts_file) != SSH_OK)
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
      g_debug ("%s: Couldn't find the known hosts file", data->logname);
      /* fall through */
    case SSH_SERVER_NOT_KNOWN:
      ret = prompt_for_host_key (data);
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

static gchar *
parse_auth_password (const gchar *auth_type,
                     const gchar *auth_data)
{
  gchar *password = NULL;

  g_assert (auth_data != NULL);
  g_assert (auth_type != NULL);

  if (g_strcmp0 (auth_type, "basic") == 0)
    password = cockpit_authorize_parse_basic (auth_data, NULL);
  else
    password = g_strdup (cockpit_authorize_type (auth_data, NULL));

  if (password == NULL)
    password = g_strdup ("");

  return password;
}

static int
do_interactive_auth (CockpitSshData *data)
{
  int rc;
  gboolean sent_pw = FALSE;
  gchar *password = NULL;

  password = parse_auth_password (data->auth_type,
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
              answer = prompt_with_authorize (data, prompt, msg, NULL, NULL, echo != '\0');
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

  cockpit_memory_clear (password, strlen (password));
  g_free (password);
  return rc;
}

static int
do_password_auth (CockpitSshData *data)
{
  gchar *password = NULL;
  const gchar *msg;
  int rc;

  password = parse_auth_password (data->auth_type,
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

  cockpit_memory_clear (password, strlen (password));
  g_free (password);
  return rc;
}

static int
do_key_auth (CockpitSshData *data)
{
  int rc;
  const gchar *msg;
  const gchar *key_data;
  ssh_key key;

  g_assert (data->initial_auth_data != NULL);

  key_data = cockpit_authorize_type (data->initial_auth_data, NULL);
  if (!key_data)
    {
      g_message ("%s: Got invalid private-key data, %s", data->logname, data->initial_auth_data);
      return SSH_AUTH_DENIED;
    }

  rc = ssh_pki_import_privkey_base64 (key_data, NULL, NULL, NULL, &key);
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

static gboolean
has_password (CockpitSshData *data)
{
  if (data->auth_type == NULL &&
      data->initial_auth_data == NULL)
    {
      data->initial_auth_data = challenge_for_auth_data ("basic",
                                                         data->outfd,
                                                         &data->auth_type);
    }

  return (data->initial_auth_data != NULL &&
          (g_strcmp0 (data->auth_type, "basic") == 0 ||
           g_strcmp0 (data->auth_type, "password") == 0));
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
          if (g_strcmp0 (data->auth_type, "private-key") == 0)
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
          has_creds = has_password(data);
        }
      else if (methods_to_try & SSH_AUTH_METHOD_PASSWORD)
        {
          auth_func = do_password_auth;
          method = SSH_AUTH_METHOD_PASSWORD;
          has_creds = has_password(data);
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
      if (methods_server == 0)
        {
          g_message ("%s: server offered no authentication methods", data->logname);
        }
      else
        {
          description = auth_methods_line (methods_server);
          g_message ("%s: server offered unsupported authentication methods: %s",
                     data->logname, description);
          g_free (description);
        }
    }

out:
  return problem;
}

static gboolean
send_auth_reply (CockpitSshData *data,
                 const gchar *problem)
{
  GHashTableIter auth_iter;
  JsonObject *auth_json = NULL; // consumed by object
  JsonObject *object = NULL;
  gboolean ret;
  gpointer hkey;
  gpointer hvalue;
  object = json_object_new ();
  auth_json = json_object_new ();

  g_assert (problem != NULL);

  json_object_set_string_member (object, "command", "init");
  if (data->host_key)
    json_object_set_string_member (object, "host-key", data->host_key);
  if (data->host_fingerprint)
    json_object_set_string_member (object, "host-fingerprint", data->host_fingerprint);

  if (g_strcmp0 (problem, "invalid-hostkey") == 0 &&
      tmp_knownhost_file == NULL)
    {
      json_object_set_string_member (object, "invalid-hostkey-file",
                                     data->ssh_options->knownhosts_file);
    }

  json_object_set_string_member (object, "problem", problem);
  json_object_set_string_member (object, "error", problem);

  if (data->auth_results)
    {
      g_hash_table_iter_init (&auth_iter, data->auth_results);
      while (g_hash_table_iter_next (&auth_iter, &hkey, &hvalue))
        json_object_set_string_member (auth_json, hkey, hvalue);
    }

  json_object_set_object_member (object, "auth-method-results", auth_json);
  ret = write_control_message (data->outfd, object);
  json_object_unref (object);

  if (!ret)
    g_message ("couldn't write authorize message: %s", g_strerror (errno));

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

  if (!user_arg || user_arg[0] == '\0')
    user_arg = (gchar *) g_get_user_name ();

  host_arg = g_strndup (host + host_offset, host_length);
  *hostname = g_strdup (host_arg);
  *username = g_strdup (user_arg);

  g_free (host_arg);
  g_free (user_arg);
}

static gchar *
username_from_basic (const gchar *basic_data)
{
  gchar *user = NULL;
  gchar *password;

  password = cockpit_authorize_parse_basic (basic_data, &user);
  if (password)
    {
      cockpit_memory_clear (password, -1);
      free (password);
    }
  return user;
}

static const gchar*
cockpit_ssh_connect (CockpitSshData *data,
                     const gchar *host_arg,
                     ssh_channel *out_channel)
{
  const gchar *ignore_hostkey;
  const gchar *problem;
  const gchar *knownhosts;

  guint port = 22;
  gchar *host;

  ssh_channel channel;
  int rc;

  parse_host (host_arg, &host, &data->username, &port);

  /* Username always comes from auth message when using basic */
  if (g_strcmp0 (data->auth_type, "basic") == 0)
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

  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_HOST, host) == 0);

  if (!data->ssh_options->ignore_hostkey)
    {
      /* This is a single host, for which we have been told to ignore the host key */
      ignore_hostkey = cockpit_conf_string (COCKPIT_CONF_SSH_SECTION, "host");
      if (!ignore_hostkey)
        ignore_hostkey = "127.0.0.1";

      data->ssh_options->ignore_hostkey = g_str_equal (ignore_hostkey, host);
    }

  if (!data->ssh_options->ignore_hostkey)
    {
      problem = set_knownhosts_file (data, host, port);
      if (problem != NULL)
        goto out;
      knownhosts = data->ssh_options->knownhosts_file;
    }
  else
    {
      knownhosts = "/dev/null";
    }

  // Set knownhosts before trying to connect to ensure key exchange uses the right file
  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS, knownhosts) == 0);

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

  if (data->ssh_options->remote_peer)
    {
      /* Try to set the remote peer env var, this will
       * often fail as ssh servers have to be configured
       * to allow it.
       */
      rc = ssh_channel_request_env (channel, "COCKPIT_REMOTE_PEER",
                                    data->ssh_options->remote_peer);
      if (rc != SSH_OK)
        {
          g_debug ("%s: Couldn't set COCKPIT_REMOTE_PEER: %s",
                   data->logname,
                   ssh_get_error (data->session));
        }
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

  g_free (data->conversation);
  g_free (data->username);
  g_free (data->ssh_options);
  g_free (data->user_known_hosts);
  g_free (data->auth_type);
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
      send_auth_reply (self->ssh_data, problem ? problem : exit_code_problem (self->exit_code));
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

  if (end_of_data)
    cockpit_pipe_close (pipe, NULL);
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
  int in;
  int rc;

  static struct ssh_channel_callbacks_struct channel_cbs = {
    .channel_data_function = on_channel_data,
    .channel_eof_function = on_channel_eof,
    .channel_close_function = on_channel_close,
    .channel_signal_function = on_channel_signal,
    .channel_exit_signal_function = on_channel_exit_signal,
    .channel_exit_status_function = on_channel_exit_status,
  };

  self->ssh_data->outfd = outfd;
  self->ssh_data->initial_auth_data = challenge_for_auth_data ("*", outfd,
                                                               &self->ssh_data->auth_type);

  problem = cockpit_ssh_connect (self->ssh_data, self->connection_string, &self->channel);
  if (problem)
    goto out;

  self->event = ssh_event_new ();
  memcpy (&self->channel_cbs, &channel_cbs, sizeof (channel_cbs));
  self->channel_cbs.userdata = self;
  ssh_callbacks_init (&self->channel_cbs);
  ssh_set_channel_callbacks (self->channel, &self->channel_cbs);
  ssh_set_blocking (self->session, 0);
  ssh_event_add_session (self->event, self->session);

  in = dup (0);
  g_assert (in >= 0);

  self->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                             "in-fd", in,
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

  for (rc = SSH_AGAIN; rc == SSH_AGAIN; )
    rc = ssh_channel_request_exec (self->channel, self->ssh_data->ssh_options->command);

  if (rc != SSH_OK)
    {
      g_message ("%s: couldn't execute command: %s: %s", self->logname,
                 self->ssh_data->ssh_options->command,
                 ssh_get_error (self->session));
      problem = "internal-error";
      goto out;
    }

  self->io = cockpit_ssh_relay_start_source (self);

out:
  if (problem)
    {
      self->exit_code = AUTHENTICATION_FAILED;
      cockpit_relay_disconnect (self, problem);
      close (outfd);
    }
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
  self->ssh_data->ssh_options = cockpit_ssh_options_from_env (self->ssh_data->env);
  self->ssh_data->user_known_hosts = g_build_filename (g_get_home_dir (), ".ssh/known_hosts", NULL);
}

static void
authorize_logger (const char *data)
{
  g_message ("%s", data);
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

  cockpit_authorize_logger (authorize_logger, 0);
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
