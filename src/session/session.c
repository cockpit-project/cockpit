/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "common/cockpitframe.h"
#include "common/cockpitjsonprint.h"
#include "common/cockpitmemory.h"

#include "client-certificate.h"
#include "session-utils.h"

#include <security/pam_appl.h>
#include <gssapi/gssapi.h>
#include <gssapi/gssapi_generic.h>
#include <gssapi/gssapi_krb5.h>
#include <fcntl.h>

static char *last_txt_msg = NULL;
static char *conversation = NULL;

/* This program opens a session for a given user and runs the bridge in
 * it.  It is used to manage localhost; for remote hosts sshd does
 * this job.
 */

#define COCKPIT_KTAB PACKAGE_SYSCONF_DIR "/cockpit/krb5.keytab"

static gss_cred_id_t creds = GSS_C_NO_CREDENTIAL;

/* Environment variables to transfer */
static const char *env_names[] = {
  "G_DEBUG",
  "G_MESSAGES_DEBUG",
  "G_SLICE",
  "PATH",
  "COCKPIT_REMOTE_PEER",
  NULL
};

/* Holds environment values to set in pam context */
static char *env_saved[sizeof (env_names) / sizeof (env_names)[0]] = { NULL, };

static const char *
gssapi_strerror (gss_OID mech_type,
                 OM_uint32 major_status,
                 OM_uint32 minor_status)
{
  static char buffer[1024];
  OM_uint32 major, minor;
  OM_uint32 ctx;
  gss_buffer_desc status;
  char *buf;
  size_t len;
  int had_major;
  int had_minor;

  debug ("gssapi: major_status: %8.8x, minor_status: %8.8x",
         major_status, minor_status);

  buf = buffer;
  len = sizeof (buffer);
  buf[0] = '\0';
  had_major = 0;
  ctx = 0;

  if (major_status != GSS_S_FAILURE || minor_status == 0)
    {
      for (;;)
        {
          major = gss_display_status (&minor, major_status, GSS_C_GSS_CODE,
                                      GSS_C_NO_OID, &ctx, &status);
          if (GSS_ERROR (major))
            break;

          if (had_major)
            build_string (&buf, &len, ": ", 2);
          had_major = 1;

          build_string (&buf, &len, status.value, status.length);
          gss_release_buffer (&minor, &status);

          if (!ctx)
            break;
        }
    }

   ctx = 0;
   had_minor = 0;
   for (;;)
     {
       major = gss_display_status (&minor, minor_status, GSS_C_MECH_CODE,
                                   mech_type, &ctx, &status);
       if (GSS_ERROR (major))
         break;

       if (had_minor)
         build_string (&buf, &len, ", ", 2);
       else if (had_major)
         build_string (&buf, &len, " (", 2);
       had_minor = 1;
       build_string (&buf, &len, status.value, status.length);

       gss_release_buffer (&minor, &status);

       if (!ctx)
         break;
     }

   if (had_major && had_minor)
     build_string (&buf, &len, ")", 1);

   return buffer;
}

static int
pam_conv_func (int num_msg,
               const struct pam_message **msg,
               struct pam_response **ret_resp,
               void *appdata_ptr)
{
  char **password = (char **)appdata_ptr;
  char *authorization = NULL;
  char *prompt_resp = NULL;

  /* For keeping track of messages returned by PAM */
  char *err_msg = NULL;
  char *txt_msg = NULL;
  char *buf, **msgp;

  struct pam_response *resp;
  char *prompt = NULL;
  int success = 1;
  int i;

  /* Any messages from the last conversation pass? */
  txt_msg = last_txt_msg;
  last_txt_msg = NULL;
  err_msg = last_err_msg;
  last_err_msg = NULL;

  resp = callocx (sizeof (struct pam_response), num_msg);

  for (i = 0; i < num_msg; i++)
    {
      if (msg[i]->msg_style == PAM_PROMPT_ECHO_OFF &&
          *password != NULL)
        {
            debug ("answered pam password prompt");
            resp[i].resp = *password;
            resp[i].resp_retcode = 0;
            *password = NULL;
        }
      else if (msg[i]->msg_style == PAM_ERROR_MSG || msg[i]->msg_style == PAM_TEXT_INFO)
        {
          if (msg[i]->msg_style == PAM_ERROR_MSG)
            msgp = &err_msg;
          else
            msgp = &txt_msg;

          if (*msgp)
            {
              buf = *msgp;
              asprintfx (msgp, "%s\n%s", buf, msg[i]->msg);
              free (buf);
            }
          else
            {
              asprintfx (msgp, "%s", msg[i]->msg);
            }
          warnx ("pam: %s", msg[i]->msg);
        }
      else
        {
          debug ("prompt for more data");
          write_authorize_begin ();
          prompt = cockpit_authorize_build_x_conversation (msg[i]->msg, &conversation);
          if (!prompt)
            err (EX, "couldn't generate prompt");

          write_control_string ("challenge", prompt);
          free (prompt);

          if (txt_msg)
            write_control_string ("message", txt_msg);
          if (err_msg)
            write_control_string ("error", err_msg);
          write_control_bool ("echo", msg[i]->msg_style != PAM_PROMPT_ECHO_OFF);
          write_control_end ();

          if (err_msg)
            {
              free (err_msg);
              err_msg = NULL;
            }

          if (txt_msg)
            {
              free (txt_msg);
              txt_msg = NULL;
            }

          authorization = read_authorize_response (msg[i]->msg);
          prompt_resp = cockpit_authorize_parse_x_conversation (authorization, NULL);

          debug ("got prompt response");
          if (prompt_resp)
            {
              resp[i].resp = prompt_resp;
              resp[i].resp_retcode = 0;
              prompt_resp = NULL;
            }
          else
            {
              success = 0;
            }

          if (authorization)
            cockpit_memory_clear (authorization, -1);
          free (authorization);
        }
    }

  if (!success)
    {
      for (i = 0; i < num_msg; i++)
        free (resp[i].resp);
      free (resp);
      return PAM_CONV_ERR;
    }

  if (err_msg)
    last_err_msg = err_msg;
  if (txt_msg)
    last_txt_msg = txt_msg;

  *ret_resp = resp;
  return PAM_SUCCESS;
}

static int
open_session (pam_handle_t *pamh)
{
  const char *name;
  int res;
  static struct passwd pwd_buf;
  static char pwd_string_buf[8192];
  static char home_env_buf[8192];
  int i;

  name = NULL;
  pwd = NULL;

  res = pam_get_item (pamh, PAM_USER, (const void **)&name);
  if (res != PAM_SUCCESS)
    {
      warnx ("couldn't load user from pam");
      return res;
    }

  res = getpwnam_r (name, &pwd_buf, pwd_string_buf, sizeof (pwd_string_buf), &pwd);
  if (pwd == NULL)
    {
      warnx ("couldn't load user info for: %s: %s", name,
             res == 0 ? "not found" : strerror (res));
      return PAM_SYSTEM_ERR;
    }

  if (pwd->pw_shell == NULL)
    {
      warnx ("user %s has no shell", name);
      return PAM_SYSTEM_ERR;
    }

  /*
   * If we're already running as the right user, and have authenticated
   * then skip starting a new session. This is used when testing, or
   * running as your own user.
   */

  want_session = !(geteuid () != 0 &&
                   geteuid () == pwd->pw_uid &&
                   getuid () == pwd->pw_uid &&
                   getegid () == pwd->pw_gid &&
                   getgid () == pwd->pw_gid);

  if (want_session)
    {
      debug ("checking access for %s", name);
      res = pam_acct_mgmt (pamh, 0);
      if (res == PAM_NEW_AUTHTOK_REQD)
        {
          warnx ("user account or password has expired: %s: %s", name, pam_strerror (pamh, res));

          /*
           * Certain PAM implementations return PAM_AUTHTOK_ERR if the users input does not
           * match criteria. Let the conversation happen three times in that case.
           */
          for (i = 0; i < 3; i++) {
              res = pam_chauthtok (pamh, PAM_CHANGE_EXPIRED_AUTHTOK);
              if (res != PAM_SUCCESS)
                warnx ("unable to change expired account or password: %s: %s", name, pam_strerror (pamh, res));
              if (res != PAM_AUTHTOK_ERR)
                break;
          }
        }
      else if (res != PAM_SUCCESS)
        {
          warnx ("user account access failed: %d %s: %s", res, name, pam_strerror (pamh, res));
        }

      if (res != PAM_SUCCESS)
        {
          /* We change PAM_AUTH_ERR to PAM_PERM_DENIED so that we can
           * distinguish between failures here and in *
           * pam_authenticate.
           */
          if (res == PAM_AUTH_ERR)
            res = PAM_PERM_DENIED;

          return res;
        }

      debug ("opening pam session for %s", name);

      res = snprintf (home_env_buf, sizeof (home_env_buf), "HOME=%s", pwd->pw_dir);
      /* this really can't fail, as the buffer for the entire pwd is not larger, but make double sure */
      assert (res < sizeof (home_env_buf));

      pam_putenv (pamh, "XDG_SESSION_CLASS=user");
      pam_putenv (pamh, "XDG_SESSION_TYPE=web");
      pam_putenv (pamh, home_env_buf);

      res = pam_setcred (pamh, PAM_ESTABLISH_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("establishing credentials failed: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }

      res = pam_open_session (pamh, 0);
      if (res != PAM_SUCCESS)
        {
          warnx ("couldn't open session: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }

      res = pam_setcred (pamh, PAM_REINITIALIZE_CRED);
      if (res != PAM_SUCCESS)
        {
          warnx ("reinitializing credentials failed: %s: %s", name, pam_strerror (pamh, res));
          return res;
        }
    }

  return PAM_SUCCESS;
}

__attribute__((__noreturn__)) static void
exit_init_problem (int result_code)
{
  const char *problem = NULL;
  const char *message = NULL;
  char *payload = NULL;

  assert (result_code != PAM_SUCCESS);

  debug ("writing init problem %d", result_code);

  if (result_code == PAM_AUTH_ERR || result_code == PAM_USER_UNKNOWN)
    problem = "authentication-failed";
  else if (result_code == PAM_PERM_DENIED)
    problem = "access-denied";
  else if (result_code == PAM_AUTHINFO_UNAVAIL)
    problem = "authentication-unavailable";
  else
    problem = "internal-error";

  if (last_err_msg)
    message = last_err_msg;
  else
    message = pam_strerror (NULL, result_code);

  if (asprintf (&payload, "\n{\"command\":\"init\",\"version\":1,\"problem\":\"%s\",\"message\":\"%s\"}",
                problem, message) < 0)
    errx (EX, "couldn't allocate memory for message");

  if (cockpit_frame_write (STDOUT_FILENO, (unsigned char *)payload, strlen (payload)) < 0)
    err (EX, "couldn't write init message");

  free (payload);
  exit (5);
}

static pam_handle_t *
perform_basic (const char *rhost,
               const char *authorization)
{
  struct pam_conv conv = { pam_conv_func, };
  pam_handle_t *pamh;
  char *password = NULL;
  char *user = NULL;
  int res;


  debug ("basic authentication");

  /* The input should be a user:password */
  password = cockpit_authorize_parse_basic (authorization, &user);
  if (password == NULL)
    {
      debug ("bad basic auth input");
      exit_init_problem (PAM_BUF_ERR);
    }

  conv.appdata_ptr = &password;

  res = pam_start ("cockpit", user, &conv, &pamh);
  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));

  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam");

  debug ("authenticating");

  res = pam_authenticate (pamh, 0);
  if (res == PAM_SUCCESS)
    res = open_session (pamh);
  else
    btmp_log (user, rhost);

  free (user);
  if (password)
    {
      cockpit_memory_clear (password, strlen (password));
      free (password);
    }

  /* Our exit code is a PAM code */
  if (res != PAM_SUCCESS)
    exit_init_problem (res);

  return pamh;
}

static char *
map_gssapi_to_local (gss_name_t name,
                     gss_OID mech_type)
{
  gss_buffer_desc local = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc display = GSS_C_EMPTY_BUFFER;
  OM_uint32 major, minor;
  char *str = NULL;

  major = gss_localname (&minor, name, mech_type, &local);
  if (major == GSS_S_COMPLETE)
    {
      minor = 0;
      str = strndupx (local.value, local.length); /* user names are not allowed to contain \0 */
      if (getpwnam (str))
        {
          debug ("mapped gssapi name to local user '%s'", str);
        }
      else
        {
          debug ("ignoring non-existent gssapi local user '%s'", str);

          /* If the local user doesn't exist, pretend gss_localname() failed */
          free (str);
          str = NULL;
          major = GSS_S_FAILURE;
          minor = KRB5_NO_LOCALNAME;
        }
    }

  /* Try a more pragmatic approach */
  if (!str)
    {
      if (minor == (OM_uint32)KRB5_NO_LOCALNAME ||
          minor == (OM_uint32)KRB5_LNAME_NOTRANS ||
          minor == (OM_uint32)ENOENT)
        {
          major = gss_display_name (&minor, name, &display, NULL);
          if (GSS_ERROR (major))
            {
              warnx ("couldn't get gssapi display name: %s", gssapi_strerror (mech_type, major, minor));
            }
          else
            {
              assert (display.value != NULL);
              str = strndupx (display.value, display.length); /* display names are not allowed to contain \0 */
              if (getpwnam (str))
                {
                  debug ("no local user mapping for gssapi name '%s'", str);
                }
              else
                {
                  warnx ("non-existent local user '%s'", str);
                  free (str);
                  str = NULL;
                }
            }
        }
      else
        {
          warnx ("couldn't map gssapi name to local user: %s", gssapi_strerror (mech_type, major, minor));
        }
    }

  if (display.value)
    gss_release_buffer (&minor, &display);
  if (local.value)
    gss_release_buffer (&minor, &local);

  return str;
}

static bool
acquire_service_credentials (gss_OID mech_type, gss_cred_usage_t usage, gss_cred_id_t *cred)
{
  /* custom credential store with our cockpit keytab */
  gss_key_value_element_desc store_elements[] = {
      { .key = (usage == GSS_C_INITIATE) ? "client_keytab" : "keytab", .value = COCKPIT_KTAB, },
      { .key = "ccache", .value = "MEMORY:", }
  };
  const gss_key_value_set_desc cockpit_ktab_store = { .count = 2, .elements = store_elements };
  OM_uint32 major, minor;

  debug ("acquiring cockpit service credentials");
  major = gss_acquire_cred_from (&minor, GSS_C_NO_NAME, GSS_C_INDEFINITE, GSS_C_NO_OID_SET, usage,
          (!getenv ("COCKPIT_TEST_KEEP_KTAB") && access (COCKPIT_KTAB, F_OK) == 0) ? &cockpit_ktab_store : NULL,
          cred, NULL, NULL);

  if (GSS_ERROR (major))
    {
      const char *msg = gssapi_strerror (mech_type, major, minor);
      /* don't litter journal with error message if keytab was not set up, as that's expected */
      /* older krb versions hide the interesting bits behind the generic GSS_S_FAILURE and an uncomparable
       * minor code, so do string comparison for these */
      if (major != GSS_S_NO_CRED && !strstr (msg, "nonexistent or empty") && !strstr (msg, "No Kerberos credentials available"))
        warnx ("couldn't acquire server credentials: %o %s", major, msg);
      return false;
    }

  return true;
}

static pam_handle_t *
perform_gssapi (const char *rhost,
                const char *authorization)
{
  struct pam_conv conv = { pam_conv_func, };
  OM_uint32 major, minor;
  gss_cred_id_t client = GSS_C_NO_CREDENTIAL;
  gss_cred_id_t server = GSS_C_NO_CREDENTIAL;
  gss_buffer_desc input = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc output = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc export = GSS_C_EMPTY_BUFFER;
  gss_name_t name = GSS_C_NO_NAME;
  gss_ctx_id_t context = GSS_C_NO_CONTEXT;
  gss_OID mech_type = GSS_C_NO_OID;
  pam_handle_t *pamh = NULL;
  char *response = NULL;
  char *challenge;
  OM_uint32 flags = 0;
  char *str = NULL;
  OM_uint32 caps = 0;
  int res;

  res = PAM_AUTH_ERR;

  debug ("reading kerberos auth from cockpit-ws");
  input.value = cockpit_authorize_parse_negotiate (authorization, &input.length);

  if (!acquire_service_credentials (mech_type, GSS_C_ACCEPT, &server))
    {
      res = PAM_AUTHINFO_UNAVAIL;
      goto out;
    }

  for (;;)
    {
      debug ("gssapi negotiation");

      if (client != GSS_C_NO_CREDENTIAL)
        gss_release_cred (&minor, &client);
      if (name != GSS_C_NO_NAME)
        gss_release_name (&minor, &name);
      if (output.value)
        gss_release_buffer (&minor, &output);

      if (input.length > 0)
        {
          major = gss_accept_sec_context (&minor, &context, server, &input,
                                          GSS_C_NO_CHANNEL_BINDINGS, &name, &mech_type,
                                          &output, &flags, &caps, &client);
        }
      else
        {
          debug ("initial gssapi negotiate output");
          major = GSS_S_CONTINUE_NEEDED;
        }

      /* Our exit code is a PAM result code */
      if (GSS_ERROR (major))
        {
          res = PAM_AUTH_ERR;
          warnx ("gssapi auth failed: %s", gssapi_strerror (mech_type, major, minor));
          goto out;
        }

      if ((major & GSS_S_CONTINUE_NEEDED) == 0)
        break;

      challenge = cockpit_authorize_build_negotiate (output.value, output.length);
      if (!challenge)
        errx (EX, "couldn't encode negotiate challenge");
      write_authorize_begin ();
      write_control_string ("challenge", challenge);
      write_control_end ();
      cockpit_memory_clear (challenge, -1);
      free (challenge);

      /*
       * The GSSAPI mechanism can require multiple challenge response
       * iterations ... so do that here.
       */
      free (input.value);
      input.length = 0;

      debug ("need to continue gssapi negotiation");
      response = read_authorize_response ("negotiate");
      input.value = cockpit_authorize_parse_negotiate (response, &input.length);
      if (response)
        cockpit_memory_clear (response, -1);
      free (response);
    }

  str = map_gssapi_to_local (name, mech_type);
  if (!str)
    goto out;

  res = pam_start ("cockpit", str, &conv, &pamh);

  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));
  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam");

  res = open_session (pamh);
  if (res != PAM_SUCCESS)
    {
      btmp_log (str, rhost);
      goto out;
    }

  /* The creds are used and cleaned up later */
  creds = client;

out:
  if (output.value)
    gss_release_buffer (&minor, &output);
  if (export.value)
    gss_release_buffer (&minor, &export);
  if (server != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &server);
  if (name != GSS_C_NO_NAME)
     gss_release_name (&minor, &name);
  if (context != GSS_C_NO_CONTEXT)
     gss_delete_sec_context (&minor, &context, GSS_C_NO_BUFFER);
  free (input.value);
  free (str);

  if (res != PAM_SUCCESS)
    exit_init_problem (res);

  return pamh;
}

static int
pam_conv_func_dummy (int num_msg,
                     const struct pam_message **msg,
                     struct pam_response **ret_resp,
                     void *appdata_ptr)
{
  /* we don't expect (nor can handle) any actual auth conversation here, but
   * PAM sometimes sends messages like "Creating home directory for USER" */
  for (int i = 0; i < num_msg; ++i)
      debug ("got PAM conversation message, ignoring: %s", msg[i]->msg);
  return PAM_CONV_ERR;
}

static void
create_s4u_ticket (const char *username)
{
  OM_uint32 major, minor;
  gss_cred_id_t server_cred = GSS_C_NO_CREDENTIAL;
  gss_name_t impersonee = GSS_C_NO_NAME;

  debug ("Attempting to create an S4U ticket for user %s", username);

  if (!acquire_service_credentials (GSS_C_NO_OID, GSS_C_INITIATE, &server_cred))
    goto out;

  gss_buffer_desc user_buf = { .length = strlen (username), .value = (char *) username };
  major = gss_import_name (&minor, &user_buf, GSS_KRB5_NT_PRINCIPAL_NAME, &impersonee);
  if (GSS_ERROR (major))
    {
      warnx ("Failed to import user name %s: %s", username, gssapi_strerror (GSS_C_NO_OID, major, minor));
      goto out;
    }

  /* store credentials into global creds; they will be put into the session and cleaned up in main() */
  major = gss_acquire_cred_impersonate_name (&minor, server_cred, impersonee,
                                             GSS_C_INDEFINITE, GSS_C_NO_OID_SET, GSS_C_INITIATE,
                                             &creds, NULL, NULL);
  if (GSS_ERROR (major))
    {
      warnx ("Failed to impersonate %s: %s", username, gssapi_strerror (GSS_C_NO_OID, major, minor));
      goto out;
    }

  debug ("S4U ticket for user %s created successfully", username);

out:
  if (server_cred != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &server_cred);
  if (impersonee != GSS_C_NO_NAME)
    gss_release_name(&minor, &impersonee);
}

static pam_handle_t *
perform_tlscert (const char *rhost,
                 const char *authorization)
{
  struct pam_conv conv = { pam_conv_func_dummy, };
  pam_handle_t *pamh;
  int res;

  debug ("start tls-cert authentication for cockpit-ws %u", getppid ());

  /* True, otherwise we wouldn't be here. */
  assert (strncmp (authorization, "tls-cert ", 9) == 0);
  const char *client_certificate_filename = authorization + 9;

  char *username = cockpit_session_client_certificate_map_user (client_certificate_filename);
  if (username == NULL)
    exit_init_problem (PAM_AUTH_ERR);

  res = pam_start ("cockpit", username, &conv, &pamh);
  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));

  if (pam_set_item (pamh, PAM_RHOST, rhost) != PAM_SUCCESS)
    errx (EX, "couldn't setup pam rhost");

  res = open_session (pamh);

  create_s4u_ticket (username);

  free (username);

  /* Our exit code is a PAM code */
  if (res != PAM_SUCCESS)
    exit_init_problem (res);

  return pamh;
}


/* Return path of ccache file (including FILE: prefix), clean this up at session end */
static char *
store_krb_credentials (gss_cred_id_t creds, uid_t uid, gid_t gid)
{
  gss_key_value_set_desc store;
  struct gss_key_value_element_struct element;
  OM_uint32 major, minor;
  char *ccache;

  assert (creds != GSS_C_NO_CREDENTIAL);

  bool was_root = getuid() == 0;

  /* We want to do this before the fork(), so we need to temporarily
   * change our euid/egid
   */
  if (setresgid (gid, gid, -1) != 0 || setresuid (uid, uid, -1) != 0)
    err (127, "Unable to temporarily drop permissions to store gss credentials");

  assert (geteuid () == uid && getegid() == gid);

  /* The ccache path needs to be unique per cockpit session; as cockpit-session runs throughout the
   * lifetime of sessions, our pid is unique. We expect the cache to be cleaned up at the end, but
   * if not, and the PID gets recycled, this just overwrites the old obsolete one, which is good. */
  asprintfx (&ccache, "FILE:/run/user/%u/cockpit-session-%u.ccache", uid, getpid ());
  debug ("storing kerberos credentials in session: %s", ccache);

  store.count = 1;
  store.elements = &element;
  element.key = "ccache";
  element.value = ccache;

  major = gss_store_cred_into (&minor, creds, GSS_C_INITIATE, GSS_C_NULL_OID, 1, 1, &store, NULL, NULL);
  if (GSS_ERROR (major))
    warnx ("couldn't store gssapi credentials: %s", gssapi_strerror (GSS_C_NO_OID, major, minor));

  if (was_root && (setresuid (0, 0, 0) != 0 || setresgid (0, 0, 0) != 0))
    err (127, "Unable to restore permissions after storing gss credentials");

  return ccache;
}

static void
release_krb_credentials (char *ccache)
{
  /* strip off FILE: prefix for deleting */
  assert (strncmp (ccache, "FILE:", 5) == 0);
  if (unlink (ccache + 5) != 0)
    warn ("couldn't clean up kerberos ticket cache %s", ccache);
  free (ccache);
}

static bool
user_has_valid_login_shell (const char **envp)
{
  /* <lis> >>> random.randint(0,127)
   * <lis> 71
   * <pitti> https://xkcd.com/221/
   */
  const char *argv[] = { pwd->pw_shell, "-c", "exit 71;", NULL };
  assert (argv[0] != NULL);

  int devnull = open ("/dev/null", O_RDONLY);
  if (devnull < 0)
      err (EX, "couldn't open /dev/null");

  const int remap_fds[] = { devnull, 2, -1 }; /* send stdout to stderr */
  int wstatus;

  wstatus = spawn_and_wait (argv, envp, remap_fds, 3, pwd->pw_uid, pwd->pw_gid);
  debug ("user_has_valid_login_shell: exited with status %x", wstatus);
  close (devnull);
  return WIFEXITED(wstatus) && WEXITSTATUS(wstatus) == 71;
}

static void
save_environment (void)
{
  const char *value;
  int i, j;

  /* Force save our default path */
  if (!getenv ("COCKPIT_TEST_KEEP_PATH"))
    setenv ("PATH", DEFAULT_SESSION_PATH, 1);

  for (i = 0, j = 0; env_names[i] != NULL; i++)
    {
      value = getenv (env_names[i]);
      if (value)
        {
          if (asprintf (env_saved + (j++), "%s=%s", env_names[i], value) < 0)
            errx (42, "couldn't allocate environment");
        }
    }

  env_saved[j] = NULL;
}

static void
pass_to_child (int signo)
{
  if (child > 0)
    kill (child, signo);
}

int
main (int argc,
      char **argv)
{
  pam_handle_t *pamh = NULL;
  OM_uint32 minor;
  const char *rhost;
  char *authorization;
  char *type = NULL;
  const char **env;
  char *ccache = NULL;
  int status;
  int res;
  int i;

  if (isatty (0))
    errx (2, "this command is not meant to be run from the console");

  /* COMPAT: argv[1] used ot be used, but is now ignored */
  if (argc != 1 && argc != 2)
    errx (2, "invalid arguments to cockpit-session");

  program_name = basename (argv[0]);

  rhost = getenv ("COCKPIT_REMOTE_PEER") ?: "";

  save_environment ();

  /* When setuid root, make sure our group is also root */
  if (geteuid () == 0)
    {
      /* Always clear the environment */
      if (clearenv () != 0)
        err (1, "couldn't clear environment");

      /* set a minimal environment */
      setenv ("PATH", DEFAULT_SESSION_PATH, 1);

      if (setgid (0) != 0 || setuid (0) != 0)
        err (1, "couldn't switch permissions correctly");
    }

  signal (SIGALRM, SIG_DFL);
  signal (SIGQUIT, SIG_DFL);
  signal (SIGTSTP, SIG_IGN);
  signal (SIGHUP, SIG_IGN);
  signal (SIGPIPE, SIG_IGN);

  cockpit_authorize_logger (authorize_logger, DEBUG_SESSION);

  /* Request authorization header */
  write_authorize_begin ();
  write_control_string ("challenge", "*");
  write_control_end ();

  /* And get back the authorization header */
  authorization = read_authorize_response ("authorization");
  if (!cockpit_authorize_type (authorization, &type))
    errx (EX, "invalid authorization header received");

  if (strcmp (type, "basic") == 0)
    pamh = perform_basic (rhost, authorization);
  else if (strcmp (type, "negotiate") == 0)
    pamh = perform_gssapi (rhost, authorization);
  else if (strcmp (type, "tls-cert") == 0)
    pamh = perform_tlscert (rhost, authorization);

  cockpit_memory_clear (authorization, -1);
  free (authorization);

  if (!pamh)
    errx (2, "unrecognized authentication method: %s", type);

  free (type);

  for (i = 0; env_saved[i] != NULL; i++)
    pam_putenv (pamh, env_saved[i]);

  if (want_session) /* no session → no login messages or XDG_RUNTIME_DIR → no memfd or session ccache */
    {
      if (pam_putenv (pamh, "COCKPIT_LOGIN_MESSAGES_MEMFD=3") != PAM_SUCCESS)
        errx (EX, "Failed to set COCKPIT_LOGIN_MESSAGES_MEMFD=3 in PAM environment");

      if (creds != GSS_C_NO_CREDENTIAL)
        {
          ccache = store_krb_credentials (creds, pwd->pw_uid, pwd->pw_gid);
          char *ccache_env = NULL;
          asprintfx (&ccache_env, "KRB5CCNAME=%s", ccache);

          if (pam_putenv (pamh, ccache_env) != PAM_SUCCESS)
            errx (EX, "Failed to set KRB5CCNAME in PAM environment");
          free (ccache_env);
        }
    }

  env = (const char **) pam_getenvlist (pamh);
  if (env == NULL)
    errx (EX, "get pam environment failed");

  const char *bridge_argv[] = { "cockpit-bridge", NULL };

  if (want_session)
    {
      assert (pwd != NULL);

      if (initgroups (pwd->pw_name, pwd->pw_gid) < 0)
        err (EX, "%s: can't init groups", pwd->pw_name);

      if (!user_has_valid_login_shell (env))
        exit_init_problem (PAM_PERM_DENIED);

      signal (SIGTERM, pass_to_child);
      signal (SIGINT, pass_to_child);
      signal (SIGQUIT, pass_to_child);

      FILE *login_messages = cockpit_json_print_open_memfd ("cockpit login messages", 1);

      utmp_log (1, rhost, login_messages);

      int login_messages_fd = cockpit_json_print_finish_memfd (&login_messages);

      const int remap_fds[] = { -1, -1, -1, login_messages_fd };
      status = spawn_and_wait (bridge_argv, env, remap_fds, 4, pwd->pw_uid, pwd->pw_gid);

      utmp_log (0, rhost, NULL);

      signal (SIGTERM, SIG_DFL);
      signal (SIGINT, SIG_DFL);
      signal (SIGQUIT, SIG_DFL);

      close (login_messages_fd);

      res = pam_setcred (pamh, PAM_DELETE_CRED);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't delete creds: %s", pwd->pw_name, pam_strerror (pamh, res));
      res = pam_close_session (pamh, 0);
      if (res != PAM_SUCCESS)
        err (EX, "%s: couldn't close session: %s", pwd->pw_name, pam_strerror (pamh, res));
      if (ccache)
        release_krb_credentials (ccache);
    }
  else
    {
      status = spawn_and_wait (bridge_argv, env, NULL, -1, pwd->pw_uid, pwd->pw_gid);
    }

  pam_end (pamh, PAM_SUCCESS);

  free (last_err_msg);
  last_err_msg = NULL;
  free (last_txt_msg);
  last_txt_msg = NULL;
  free (conversation);
  conversation = NULL;

  if (creds != GSS_C_NO_CREDENTIAL)
    gss_release_cred (&minor, &creds);

  if (WIFEXITED(status))
    exit (WEXITSTATUS(status));
  else if (WIFSIGNALED(status))
    raise (WTERMSIG(status));
  else
    exit (EX);
}
