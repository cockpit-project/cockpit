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

#include "common/cockpitjson.h"
#include "common/cockpitpipe.h"
#include "common/cockpitlog.h"
#include "common/cockpittest.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitknownhosts.h"

#include "cockpitauthoptions.h"

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

/* EXIT CODE CONSTANTS */
#define INTERNAL_ERROR 1
#define AUTHENTICATION_FAILED 2
#define DISCONNECTED 254
#define TERMINATED 255
#define NO_COCKPIT 127

typedef struct {
  const gchar *logname;
  gchar *initial_auth_data;

  CockpitSshOptions *ssh_options;
  CockpitAuthOptions *auth_options;

  gchar *username;

  ssh_session session;

  gint auth_fd;

  gchar *host_key;
  gchar *host_fingerprint;
  const gchar *host_key_type;
  GHashTable *auth_results;

} CockpitSshData;

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

static gpointer
hex_decode (const gchar *hex,
            gsize *data_len)
{
  static const char HEX[] = "0123456789abcdef";
  const gchar *hpos;
  const gchar *lpos;
  gsize len;
  gchar *out;
  gint i;

  len = strlen (hex);
  if (len % 2 != 0)
    return NULL;

  out = g_malloc (len * 2 + 1);
  for (i = 0; i < len / 2; i++)
    {
      hpos = strchr (HEX, hex[i * 2]);
      lpos = strchr (HEX, hex[i * 2 + 1]);
      if (hpos == NULL || lpos == NULL)
        {
          g_free (out);
          return NULL;
        }
      out[i] = ((hpos - HEX) << 4) | ((lpos - HEX) & 0xf);
    }

  /* A convenience null termination */
  out[i] = '\0';

  *data_len = i;
  return out;
}

static gss_cred_id_t
gssapi_push_creds (CockpitSshData *data)
{
  gss_cred_id_t cred = GSS_C_NO_CREDENTIAL;
  gss_buffer_desc buf = GSS_C_EMPTY_BUFFER;
  OM_uint32 minor;
  OM_uint32 major;
  const gchar *cache_name = data->ssh_options->krb5_ccache_name;

  if (!cache_name || !data->initial_auth_data)
    goto out;

  buf.value = hex_decode (data->initial_auth_data, &buf.length);
  if (buf.value == NULL)
    {
      g_critical ("invalid gssapi credentials returned from session");
      goto out;
    }

  major = gss_krb5_ccache_name (&minor, cache_name, NULL);
  if (GSS_ERROR (major))
    {
      g_critical ("couldn't setup kerberos ccache (%u.%u)", major, minor);
      goto out;
    }

#ifdef HAVE_GSS_IMPORT_CRED
    major = gss_import_cred (&minor, &buf, &cred);
    if (GSS_ERROR (major))
      {
        g_critical ("couldn't parse gssapi credentials (%u.%u)", major, minor);
        cred = GSS_C_NO_CREDENTIAL;
        goto out;
      }

    g_debug ("setup kerberos credentials in ccache: %s", cache_name);

#else /* !HAVE_GSS_IMPORT_CRED */

  g_message ("unable to forward delegated gssapi kerberos credentials because the "
             "version of krb5 on this system does not support it.");
  goto out;

#endif

out:
  g_free (buf.value);
  return cred;
}

static gboolean
gssapi_pop_creds (gss_cred_id_t gss_creds)
{
  OM_uint32 major;
  OM_uint32 minor;

  if (gss_creds != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &gss_creds);

  major = gss_krb5_ccache_name (&minor, NULL, NULL);
  if (GSS_ERROR (major))
    {
      g_critical ("couldn't clear kerberos ccache (%u.%u)", major, minor);
      return FALSE;
    }

  g_debug ("cleared kerberos credentials");
  return TRUE;
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
              g_warning ("%s: failed to write prompt to auth pipe: %s",
                         data->logname, g_strerror (errno));
              break;
            }
        }
      else
        {
          if (r != len)
            g_warning ("%s: failed to write prompt to auth pipe", data->logname);
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
      PACKAGE_LOCALSTATE_DIR,
      "/tmp",
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

static const gchar *
verify_knownhost (CockpitSshData *data)
{
  FILE *fp = NULL;
  const gchar *knownhosts_file;
  gchar *tmp_knownhost_file = NULL;
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

  if (data->ssh_options->knownhosts_data)
    {
      tmp_knownhost_file = create_knownhosts_temp ();
      if (!tmp_knownhost_file)
        {
          ret = "internal-error";
          goto done;
        }

      fp = fopen (tmp_knownhost_file, "a");
      if (fp == NULL)
        {
          g_warning ("%s: couldn't open temporary known host file for data: %s",
                     data->logname, tmp_knownhost_file);
          ret = "internal-error";
          goto done;
        }

      if (fputs (data->ssh_options->knownhosts_data, fp) < 0)
        {
          g_warning ("%s: couldn't write to data to temporary known host file: %s",
                     data->logname, g_strerror (errno));
          ret = "internal-error";
          fclose (fp);
          goto done;
        }

      fclose (fp);
      knownhosts_file = tmp_knownhost_file;
    }
  else
    {
      knownhosts_file = data->ssh_options->knownhosts_file;
    }

  if (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS,
                       knownhosts_file) != SSH_OK)
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
  if (tmp_knownhost_file)
    {
      g_unlink (tmp_knownhost_file);
      g_free (tmp_knownhost_file);
    }

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

static int
do_interactive_auth (CockpitSshData *data)
{
  int rc;
  gboolean sent_pw = FALSE;
  const gchar *password;

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

  if (data->ssh_options->agent_fd)
    {
#ifdef HAVE_SSH_SET_AGENT_SOCKET
      ssh_set_agent_socket (data->session, data->ssh_options->agent_fd);
#else
      g_message ("%s: Skipping key auth because it is not supported by this version of libssh",
                 data->logname);
      return SSH_AUTH_DENIED;
#endif
    }

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
  gss_cred_id_t gsscreds = GSS_C_NO_CREDENTIAL;

  gsscreds = gssapi_push_creds (data);
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
    }
  else
    {
      rc = SSH_AUTH_DENIED;
    }

  gssapi_pop_creds (gsscreds);
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
                       SSH_AUTH_METHOD_GSSAPI_MIC;

#ifdef HAVE_SSH_SET_AGENT_SOCKET
  methods_to_try = methods_to_try | SSH_AUTH_METHOD_PUBLICKEY;
#else
  if (g_strcmp0 (data->auth_options->auth_type, "private-key") == 0)
    methods_to_try = methods_to_try | SSH_AUTH_METHOD_PUBLICKEY;
#endif

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
          has_creds = data->initial_auth_data != NULL && \
                      (g_strcmp0 (data->auth_options->auth_type, "basic") == 0 ||
                       g_strcmp0 (data->auth_options->auth_type,
                                 auth_method_description (method)) == 0);
        }
      else if (methods_to_try & SSH_AUTH_METHOD_PASSWORD)
        {
          auth_func = do_password_auth;
          method = SSH_AUTH_METHOD_PASSWORD;
          has_creds = data->initial_auth_data != NULL && \
                      (g_strcmp0 (data->auth_options->auth_type, "basic") == 0 ||
                       g_strcmp0 (data->auth_options->auth_type,
                                 auth_method_description (method)) == 0);
        }
      else
        {
          auth_func = do_gss_auth;
          method = SSH_AUTH_METHOD_GSSAPI_MIC;
          has_creds = data->initial_auth_data != NULL && \
                      g_strcmp0 (data->auth_options->auth_type,
                                 auth_method_description (method)) == 0;
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

  if (!data->username)
    {
      g_message ("%s: No username provided", data->logname);
      problem = "authentication-failed";
      goto out;
    }

  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_USER, data->username) == 0);
  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_PORT, &port) == 0);

  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_HOST, host) == 0);;
  g_warn_if_fail (ssh_options_set (data->session, SSH_OPTIONS_KNOWNHOSTS,
                                   data->ssh_options->knownhosts_file) == 0);

  if (!data->ssh_options->allow_unknown_hosts)
    {
      if (!cockpit_is_host_known (data->ssh_options->knownhosts_file,
                                  host, port))
        {
          g_message ("%s: refusing to connect to unknown host: %s:%d",
                     data->logname, host, port);
          problem = "unknown-host";
          goto out;
        }
    }

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
      problem = verify_knownhost (data);
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
  g_free (data);
}

typedef struct {
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

  const gchar *logname;
  ssh_session session;
  ssh_channel channel;
  ssh_event event;
  struct ssh_channel_callbacks_struct channel_cbs;

} CockpitSshRelay;

static void
cockpit_ssh_relay_free (CockpitSshRelay *self)
{
  if (self->sig_read > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_read);
  self->sig_read = 0;

  if (self->sig_close > 0)
    g_signal_handler_disconnect (self->pipe, self->sig_close);
  self->sig_close = 0;

  g_object_unref (self->pipe);

  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);

  ssh_event_free (self->event);
  /* libssh channels like to hang around even after they're freed */
  memset (&self->channel_cbs, 0, sizeof (self->channel_cbs));

  g_free (self);
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
        self->exit_code = NO_COCKPIT;
      else
        self->received_frame = TRUE;
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

  g_return_val_if_fail ((cond & G_IO_NVAL) == 0, FALSE);

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
  return ret;
}

static CockpitSshRelay *
cockpit_ssh_relay_new (ssh_session session,
                       ssh_channel channel,
                       guint outfd,
                       const gchar *logname)
{
  static struct ssh_channel_callbacks_struct channel_cbs = {
    .channel_data_function = on_channel_data,
    .channel_eof_function = on_channel_eof,
    .channel_close_function = on_channel_close,
    .channel_signal_function = on_channel_signal,
    .channel_exit_signal_function = on_channel_exit_signal,
    .channel_exit_status_function = on_channel_exit_status,
  };

  CockpitSshRelay *relay = g_new0 (CockpitSshRelay, 1);
  relay->channel_cbs = channel_cbs;
  relay->channel_cbs.userdata = relay;
  relay->session = session;
  relay->channel = channel;
  relay->logname = logname;
  relay->event = ssh_event_new ();
  relay->queue = g_queue_new ();

  relay->pipe = g_object_new (COCKPIT_TYPE_PIPE,
                              "in-fd", 0,
                              "out-fd", outfd,
                              "name", logname,
                              NULL);
  relay->sig_read = g_signal_connect (relay->pipe,
                                      "read",
                                      G_CALLBACK (on_pipe_read),
                                      relay);
  relay->sig_close = g_signal_connect (relay->pipe,
                                       "close",
                                       G_CALLBACK (on_pipe_close),
                                       relay);

  ssh_callbacks_init (&relay->channel_cbs);
  ssh_set_channel_callbacks (channel, &relay->channel_cbs);
  ssh_set_blocking (session, 0);
  ssh_event_add_session (relay->event, session);

  return relay;
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

int
main (int argc,
      char *argv[])
{
  gint ret = 1;
  gint outfd;
  GOptionContext *context;
  GError *error = NULL;
  ssh_session session;
  ssh_channel channel = NULL;
  CockpitSshData *data = NULL;
  CockpitSshRelay *relay = NULL;
  gchar **env = g_get_environ ();
  GSource *io = NULL;

  const gchar *debug;
  const gchar *problem;

  gchar *logname = NULL;

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  ssh_init ();
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  g_type_init ();

  debug = g_getenv ("G_MESSAGES_DEBUG");
  if (debug && (strstr (debug, "libssh") || g_strcmp0 (debug, "all") == 0))
    ssh_set_log_level (SSH_LOG_FUNCTIONS);

  session = ssh_new ();

  context = g_option_context_new ("- cockpit-ssh [user@]host[:port]");

  if (!g_option_context_parse (context, &argc, &argv, &error))
    {
      ret = INTERNAL_ERROR;
      goto out;
    }

  if (argc != 2)
    {
      g_printerr ("cockpit-ssh: missing required argument\n");
      ret = INTERNAL_ERROR;
      goto out;
    }

  logname = g_strdup_printf ("cockpit-ssh %s", argv[1]);

  cockpit_set_journal_logging (NULL, !isatty (2));

  data = g_new0 (CockpitSshData, 1);
  data->session = session;
  data->logname = logname;
  data->auth_results = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);
  data->auth_fd = AUTH_FD;
  data->auth_options = cockpit_auth_options_from_env (env);
  data->ssh_options = cockpit_ssh_options_from_env (env);

  /*
   * This process talks on stdin/stdout. However lots of stuff wants to write
   * to stdout, such as g_debug, and uses fd 1 to do that. Reroute fd 1 so that
   * it goes to stderr, and use another fd for stdout.
   */
  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      outfd = 1;
    }

  if (g_strcmp0 (data->auth_options->auth_type, "none") != 0)
      data->initial_auth_data = wait_for_auth_fd_reply (data);

  problem = cockpit_ssh_connect (data, argv[1], &channel);
  if (problem)
    {
      send_auth_reply (data, NULL, problem);
      cockpit_ssh_data_free (data);
      ret = AUTHENTICATION_FAILED;
      goto out;
    }

  relay = cockpit_ssh_relay_new (session, channel, outfd, logname);
  io = cockpit_ssh_relay_start_source (relay);
  while (!relay->received_exit && !relay->received_frame)
    g_main_context_iteration (NULL, TRUE);

  problem = exit_code_problem (relay->exit_code);
  if (problem)
    send_auth_reply (data, NULL, problem);
  else
    send_auth_reply (data, data->username, NULL);
  cockpit_ssh_data_free (data);

  while (!relay->received_exit)
    g_main_context_iteration (NULL, TRUE);

  ssh_disconnect (relay->session);

  ret = relay->exit_code;

  g_source_destroy (io);
  g_source_unref (io);
  cockpit_ssh_relay_free (relay);

out:
  ssh_free (session);
  g_free (logname);
  g_strfreev (env);

  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-ssh: %s\n", error->message);
      g_error_free (error);
    }
  return ret;
}
