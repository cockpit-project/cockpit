/*
 * This file fis part of Cockpit
 *
 * Copyright (C) 2008, 2010 Red Hat, Inc.
 * Copyright (C) 2014 Red Hat Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 *
 * Author: David Zeuthen <davidz@redhat.com>
 *         Cockpit Developers
 */

#include "config.h"

#include "reauthorize/reauthorize.h"

#include <polkit/polkit.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <err.h>
#include <errno.h>
#include <pwd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static gboolean
send_dbus_message (const char *cookie,
                   uid_t uid)
{
  PolkitAuthority *authority = NULL;
  PolkitIdentity *identity = NULL;
  GError *error = NULL;
  gboolean ret;

  ret = FALSE;

  g_type_init ();

  authority = polkit_authority_get_sync (NULL, &error);
  if (!authority)
    {
      warnx ("couldn't contact polkit authority: %s", error->message);
      goto out;
    }

  identity = polkit_unix_user_new (uid);
  if (!polkit_authority_authentication_agent_response_sync (authority, cookie,
                                                            identity, NULL, &error))
    {
      warnx ("couldn't respond to polkit daemon: %s", error->message);
      goto out;
    }

  ret = TRUE;

out:
  g_clear_error (&error);
  if (authority)
    g_object_unref (authority);
  if (identity)
    g_object_unref (identity);
  return ret;
}

static void
on_reauthorize_log (const char *message)
{
  warnx ("%s", message);
}

int
main (int argc, char *argv[])
{
  struct passwd *pwd;
  const char *cookie;
  const char *response;
  size_t maxlen = 8192;
  char *buffer;
  char *challenge;
  size_t len;
  uid_t uid;
  int res;
  int errn;

  signal (SIGPIPE, SIG_IGN);

  if (clearenv () != 0)
    errx (1, "couldn't clear environment");

  /* set a minimal environment */
  setenv ("PATH", "/usr/sbin:/usr/bin:/sbin:/bin", 1);

  /* Cleanup the umask */
  umask (077);

  /* Line buffering for stderr */
  setvbuf(stderr, NULL, _IOLBF, 0);

  /* check that we are setuid root */
  if (geteuid () != 0)
    errx (2, "needs to be setuid root");

  uid = getuid ();
  if (uid == 0)
    errx (2, "refusing to reauthorize root");

  /* check for correct invocation */
  if (argc != 2)
    errx (2, "bad arguments");

  cookie = argv[1];

  buffer = malloc (maxlen);
  if (buffer == NULL)
    errx (1, "cannot allocate memory for buffer");

  pwd = getpwuid (uid);
  if (pwd == NULL)
    err (1, "couldn't lookup user");
  if (pwd->pw_uid != uid)
    errx (1, "invalid user returned from lookup");

  reauthorize_logger (on_reauthorize_log, 0);

  response = NULL;
  for (;;)
    {
      challenge = NULL;
      res = reauthorize_perform (pwd->pw_name, response, &challenge);
      response = NULL;

      if (res != REAUTHORIZE_CONTINUE)
        break;

      fputs (challenge, stdout);
      errn = errno;
      free (challenge);

      if (!ferror (stdout))
        {
          fputc ('\n', stdout);
          errn = errno;

          if (!ferror (stdout))
            {
              fflush (stdout);
              errn = errno;
            }
        }

      if (ferror (stdout))
        {
          if (errn != EPIPE)
            warnx ("couldn't write to stdout: %s", strerror (errn));
          res = -1;
          break;
        }

      if (!fgets (buffer, maxlen, stdin))
        buffer[0] = '\0';

      /* Remove trailing new line */
      len = strlen (buffer);
      if (len > 0 && buffer[len - 1] == '\n')
        buffer[len - 1] = '\0';

      response = buffer;
    }

  free (buffer);

  if (res == REAUTHORIZE_YES)
    {
      if (!send_dbus_message (cookie, uid))
        return 1;
    }

  return 0;
}
