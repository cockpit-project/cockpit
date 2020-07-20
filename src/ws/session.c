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

#include "session-utils.h"

#include <gssapi/gssapi.h>
#include <gssapi/gssapi_generic.h>
#include <gssapi/gssapi_krb5.h>
#include <krb5/krb5.h>
#include <fcntl.h>

static char *last_txt_msg = NULL;
static char *conversation = NULL;

/* This program opens a session for a given user and runs the bridge in
 * it.  It is used to manage localhost; for remote hosts sshd does
 * this job.
 */

#define COCKPIT_KTAB PACKAGE_SYSCONF_DIR "/cockpit/krb5.keytab"

static gss_cred_id_t creds = GSS_C_NO_CREDENTIAL;

static char *
dup_string (const char *str,
            size_t len)
{
  char *buf = malloc (len + 1);
  if (!buf)
    err (EX, "couldn't allocate memory for string");
  memcpy (buf, str, len);
  buf[len] = '\0';
  return buf;
}

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
  int ar;

  struct pam_response *resp;
  char *prompt = NULL;
  int success = 1;
  int i;

  /* Any messages from the last conversation pass? */
  txt_msg = last_txt_msg;
  last_txt_msg = NULL;
  err_msg = last_err_msg;
  last_err_msg = NULL;

  resp = calloc (sizeof (struct pam_response), num_msg);
  if (resp == NULL)
    {
      warnx ("couldn't allocate memory for pam response");
      return PAM_BUF_ERR;
    }

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
              ar = asprintf (msgp, "%s\n%s", buf, msg[i]->msg);
              free (buf);
            }
          else
            {
              ar = asprintf (msgp, "%s", msg[i]->msg);
            }

          if (ar < 0)
            errx (EX, "couldn't allocate memory for message variable");
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

static pam_handle_t *
perform_basic (const char *authorization)
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
  /* DON'T pass COCKPIT_REMOTE_PEER as PAM_RHOST here; we use that for logging,
   * but it's completely unreliable and untrustworthy (proxies, cockpit-tls,
   * containers, NAT, VPNs, etc. all destroy the original IP) */

  debug ("authenticating");

  res = pam_authenticate (pamh, 0);
  if (res == PAM_SUCCESS)
    res = open_session (pamh);
  else
    btmp_log (user, "");

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
      str = dup_string (local.value, local.length);
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
              str = dup_string (display.value, display.length);
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


static pam_handle_t *
perform_gssapi (const char *authorization)
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
  /* custom credential store with our cockpit keytab */
  static gss_key_value_element_desc store_elements[] = { { .key = "keytab", .value = COCKPIT_KTAB } };
  static const gss_key_value_set_desc cockpit_ktab_store = { .count = 1, .elements = store_elements };
  pam_handle_t *pamh = NULL;
  char *response = NULL;
  char *challenge;
  OM_uint32 flags = 0;
  const char *msg;
  char *str = NULL;
  OM_uint32 caps = 0;
  int res;

  res = PAM_AUTH_ERR;

  debug ("reading kerberos auth from cockpit-ws");
  input.value = cockpit_authorize_parse_negotiate (authorization, &input.length);

  debug ("acquiring server credentials");
  major = gss_acquire_cred_from (&minor, GSS_C_NO_NAME, GSS_C_INDEFINITE, GSS_C_NO_OID_SET, GSS_C_ACCEPT,
          (!getenv ("COCKPIT_TEST_KEEP_KTAB") && access (COCKPIT_KTAB, F_OK) == 0) ? &cockpit_ktab_store : NULL,
          &server, NULL, NULL);

  if (GSS_ERROR (major))
    {
      /* This is a routine error message, don't litter */
      msg = gssapi_strerror (mech_type, major, minor);
      if (input.length == 0 && !strstr (msg, "nonexistent or empty"))
        warnx ("couldn't acquire server credentials: %s", msg);
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

  res = open_session (pamh);
  if (res != PAM_SUCCESS)
    {
      btmp_log (str, "");
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

static pam_handle_t *
perform_tlscert (void)
{
  struct pam_conv conv = { pam_conv_func_dummy, };
  pam_handle_t *pamh;
  int res;

  debug ("start tls-cert authentication for cockpit-ws %u", getppid ());

  /* pam_cockpit_cert sets the user name from the certificate */
  res = pam_start ("cockpit", NULL, &conv, &pamh);
  if (res != PAM_SUCCESS)
    errx (EX, "couldn't start pam: %s", pam_strerror (NULL, res));

  res = pam_authenticate (pamh, 0);
  if (res == PAM_SUCCESS)
    res = open_session (pamh);

  /* Our exit code is a PAM code */
  if (res != PAM_SUCCESS)
    exit_init_problem (res);

  return pamh;
}


static void
store_krb_credentials (gss_cred_id_t creds, uid_t uid, gid_t gid)
{
  assert (creds != GSS_C_NO_CREDENTIAL);

  bool was_root = getuid() == 0;

  /* We want to do this before the fork(), so we need to temporarily
   * change our euid/egid
   */
  if (setresgid (gid, gid, -1) != 0 || setresuid (uid, uid, -1) != 0)
    err (127, "Unable to temporarily drop permissions to store gss credentials");

  assert (geteuid () == uid && getegid() == gid);

  krb5_context k5;
  int res = krb5_init_context (&k5);
  if (res == 0)
    {
      gss_key_value_set_desc store;
      struct gss_key_value_element_struct element;
      OM_uint32 major, minor;

      store.count = 1;
      store.elements = &element;
      element.key = "ccache";
      element.value = krb5_cc_default_name (k5);

      debug ("storing kerberos credentials in session: %s", element.value);

      major = gss_store_cred_into (&minor, creds, GSS_C_INITIATE, GSS_C_NULL_OID, 1, 1, &store, NULL, NULL);
      if (GSS_ERROR (major))
        warnx ("couldn't store gssapi credentials: %s", gssapi_strerror (GSS_C_NO_OID, major, minor));

      krb5_free_context (k5);
    }
  else
    {
      warnx ("couldn't initialize kerberos context: %s", krb5_get_error_message (NULL, res));
    }


  if (was_root && (setresuid (0, 0, 0) != 0 || setresgid (0, 0, 0) != 0))
    err (127, "Unable to restore permissions after storing gss credentials");
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
  int status;
  int res;
  int i;

  program_name = basename (argv[0]);

  if (isatty (0))
    errx (2, "this command is not meant to be run from the console");

  /* COMPAT: argv[1] used ot be used, but is now ignored */
  if (argc != 1 && argc != 2)
    errx (2, "invalid arguments to cockpit-session");

  /* Cleanup the umask */
  umask (077);

  rhost = getenv ("COCKPIT_REMOTE_PEER") ?: "";

  save_environment ();

  /* When setuid root, make sure our group is also root */
  if (geteuid () == 0)
    {
      /* Always clear the environment */
      if (clearenv () != 0)
        err (1, "couldn't clear environment");

      /* set a minimal environment */
      setenv ("PATH", DEFAULT_PATH, 1);

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
    pamh = perform_basic (authorization);
  else if (strcmp (type, "negotiate") == 0)
    pamh = perform_gssapi (authorization);
  else if (strcmp (type, "tls-cert") == 0)
    pamh = perform_tlscert ();

  cockpit_memory_clear (authorization, -1);
  free (authorization);

  if (!pamh)
    errx (2, "unrecognized authentication method: %s", type);

  free (type);

  for (i = 0; env_saved[i] != NULL; i++)
    pam_putenv (pamh, env_saved[i]);

  if (want_session) /* no session → no login messages → no memfd */
    {
      if (pam_putenv (pamh, "COCKPIT_LOGIN_MESSAGES_MEMFD=4") != PAM_SUCCESS)
        errx (EX, "Failed to set COCKPIT_LOGIN_MESSAGES_MEMFD=4 in PAM environment");
    }

  env = (const char **) pam_getenvlist (pamh);
  if (env == NULL)
    errx (EX, "get pam environment failed");

  const char *bridge_argv[] = { pwd->pw_shell, "-c", "exec cockpit-bridge >&3", NULL };

  if (want_session)
    {
      assert (pwd != NULL);

      if (initgroups (pwd->pw_name, pwd->pw_gid) < 0)
        err (EX, "%s: can't init groups", pwd->pw_name);

      signal (SIGTERM, pass_to_child);
      signal (SIGINT, pass_to_child);
      signal (SIGQUIT, pass_to_child);

      FILE *login_messages = open_memfd ("cockpit login messages");

      fprintf (login_messages, "{\"version\": 1");

      utmp_log (1, rhost, login_messages);

      fprintf (login_messages, "}");

      int login_messages_fd = seal_memfd (&login_messages);

      if (creds != GSS_C_NO_CREDENTIAL)
        store_krb_credentials (creds, pwd->pw_uid, pwd->pw_gid);

      /* connect our and cockpit-bridge's stdout via fd 3, to avoid stdout output
       * from ~/.profile and friends to interfere with the protocol; route shell's
       * stdout to its stderr, so that we can still see it in the logs */
      const int remap_fds[] = { -1, 2, -1, 1, login_messages_fd };
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
