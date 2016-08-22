#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <security/pam_appl.h>
#include <security/pam_modules.h>


/* this function is ripped from pam_unix/support.c, it lets us do IO via PAM */
static int
converse (pam_handle_t *pamh,
          int nargs,
          struct pam_message **message,
          struct pam_response **response)
{
  int res;
  struct pam_conv *conv;

  res = pam_get_item (pamh, PAM_CONV, (const void **) &conv);
  if (res == PAM_SUCCESS)
    {
      res = conv->conv (nargs, (const struct pam_message **) message,
                        response, conv->appdata_ptr);
    }

  return res;
}


PAM_EXTERN int
pam_sm_authenticate (pam_handle_t *pamh,
                     int unused,
                     int argc,
                     const char **argv)
{
  int res;

  struct pam_message msg[1], *pmsg[1];
  struct pam_response *resp = NULL;
  const char *user;

  /* Lookup the user */
  res = pam_get_user (pamh, &user, NULL);
  if (res != PAM_SUCCESS)
    {
      syslog (LOG_WARNING, "couldn't get pam user: %s", pam_strerror (pamh, res));
      goto out;
    }

  /* Send message */
  pmsg[0] = &msg[0];
  msg[0].msg_style = PAM_PROMPT_ECHO_ON;
  msg[0].msg = "The answer to life the universe and everything: ";

  res = converse (pamh, 1 , pmsg, &resp);
  if (res != PAM_SUCCESS)
    {
      syslog (LOG_WARNING, "couldn't send prompt: %s", pam_strerror (pamh, res));
      goto out;
    }

  if (!resp)
    {
      syslog (LOG_WARNING, "missing response");
      res = PAM_CONV_ERR;
      goto out;
    }
  else if (resp[0].resp == NULL )
    {
      syslog (LOG_WARNING, "got null resp");
      res = PAM_AUTH_ERR;
      goto out;
    }

  if (strcmp (resp[0].resp, "42") == 0)
    res = PAM_SUCCESS;
  else
    res = PAM_AUTH_ERR;

out:
  if (resp)
    free (resp);
  return res;
}

PAM_EXTERN int
pam_sm_setcred (pam_handle_t *pamh,
                int flags,
                int argc,
                const char *argv[])
{
  return PAM_SUCCESS;
}
