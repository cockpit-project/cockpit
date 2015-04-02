/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include "util.h"
#include "udisksclient.h"

#include <sys/ioctl.h>
#include <sys/wait.h>
#include <linux/fs.h>

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

/*
 * safe_append_to_object_path:
 * @str: A #GString to append to.
 * @s: A UTF-8 string.
 *
 * Appends @s to @str in a way such that only characters that can be
 * used in a D-Bus object path will be used. E.g. a character not in
 * <literal>[A-Z][a-z][0-9]_</literal> will be escaped as _HEX where
 * HEX is a two-digit hexadecimal number.
 *
 * Note that his mapping is not bijective - e.g. you cannot go back
 * to the original string.
 */
static void
safe_append_to_object_path (GString *str,
                            const gchar *s)
{
  guint n;
  for (n = 0; s[n] != '\0'; n++)
    {
      gint c = s[n];
      /* D-Bus spec sez:
       *
       * Each element must only contain the ASCII characters "[A-Z][a-z][0-9]_"
       */
      if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_')
        {
          g_string_append_c (str, c);
        }
      else
        {
          /* Escape bytes not in [A-Z][a-z][0-9] as _<hex-with-two-digits> */
          g_string_append_printf (str, "_%02x", c);
        }
    }
}

gchar *
storage_util_build_object_path (const gchar *base,
                                const gchar *part,
                                ...)
{
  GString *path;
  va_list va;

  g_return_val_if_fail (base != NULL, NULL);
  g_return_val_if_fail (!g_str_has_suffix (base, "/"), NULL);

  path = g_string_new (base);

  va_start (va, part);
  while (part != NULL)
    {
      g_string_append_c (path, '/');
      safe_append_to_object_path (path, part);
      part = va_arg (va, const gchar *);
    }
  va_end (va);

  return g_string_free (path, FALSE);
}

gboolean
storage_util_lvm_name_is_reserved (const gchar *name)
{
  /* XXX - get this from lvm2app */

  return (strstr (name, "_mlog")
          || strstr (name, "_mimage")
          || strstr (name, "_rimage")
          || strstr (name, "_rmeta")
          || strstr (name, "_tdata")
          || strstr (name, "_tmeta")
          || strstr (name, "_pmspare")
          || g_str_has_prefix (name, "pvmove")
          || g_str_has_prefix (name, "snapshot"));
}

gboolean
storage_util_wipe_block (const gchar *device_file,
                         GError **error)
{
  int fd = -1;
  gchar zeroes[512];
  gchar *standard_output;
  gchar *standard_error;
  gint exit_status;
  GError *local_error = NULL;

  const gchar *wipe_argv[] = { "wipefs", "-a", device_file, NULL };
  const gchar *pvscan_argv[] = { "pvscan", "--cache", device_file, NULL };

  /* Remove partition table */
  memset (zeroes, 0, 512);
  fd = open (device_file, O_RDWR | O_EXCL);
  if (fd < 0)
    {
      g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                   "Error opening device %s: %m", device_file);
      return FALSE;
    }

  if (write (fd, zeroes, 512) != 512)
    {
      g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                   "Error erasing device %s: %m", device_file);
      close (fd);
      return FALSE;
    }

  if (ioctl (fd, BLKRRPART, NULL) < 0)
    {
      /* EINVAL returned if not partitioned */
      if (errno != EINVAL)
        {
          g_set_error (error, UDISKS_ERROR, UDISKS_ERROR_FAILED,
                       "Error removing partition devices of %s: %m", device_file);
          close (fd);
          return FALSE;
        }
    }

  close (fd);

  /* wipe other labels */
  if (!g_spawn_sync (NULL,
                     (gchar **)wipe_argv,
                     NULL,
                     G_SPAWN_SEARCH_PATH,
                     NULL,
                     NULL,
                     &standard_output,
                     &standard_error,
                     &exit_status,
                     error))
    return FALSE;

  if (!g_spawn_check_exit_status (exit_status, error))
    {
      g_prefix_error (error, "stdout: '%s', stderr: '%s', ", standard_output, standard_error);
      g_free (standard_output);
      g_free (standard_error);
      return FALSE;
    }

  g_free (standard_output);
  g_free (standard_error);

  standard_output = NULL;
  standard_error = NULL;

  /* Make sure lvmetad knows about all this.
   *
   * XXX - We need to do this because of a bug in the LVM udev rules
   * which often fail to run pvscan on "change" events.
   *
   * https://bugzilla.redhat.com/show_bug.cgi?id=1063813
   */

  if (!g_spawn_sync (NULL,
                     (gchar **)pvscan_argv,
                     NULL,
                     G_SPAWN_SEARCH_PATH,
                     NULL,
                     NULL,
                     &standard_output,
                     &standard_error,
                     &exit_status,
                     &local_error)
      || !g_spawn_check_exit_status (exit_status, &local_error))
    {
      g_warning ("%s", local_error->message);
      g_warning ("stdout: '%s', stderr: '%s', ", standard_output, standard_error);
      g_clear_error (&local_error);
    }

  g_free (standard_output);
  g_free (standard_error);

  return TRUE;
}


static const gchar *
get_signal_name (gint signal_number)
{
  switch (signal_number)
    {
#define _HANDLE_SIG(sig) case sig: return #sig;
    _HANDLE_SIG (SIGHUP);
    _HANDLE_SIG (SIGINT);
    _HANDLE_SIG (SIGQUIT);
    _HANDLE_SIG (SIGILL);
    _HANDLE_SIG (SIGABRT);
    _HANDLE_SIG (SIGFPE);
    _HANDLE_SIG (SIGKILL);
    _HANDLE_SIG (SIGSEGV);
    _HANDLE_SIG (SIGPIPE);
    _HANDLE_SIG (SIGALRM);
    _HANDLE_SIG (SIGTERM);
    _HANDLE_SIG (SIGUSR1);
    _HANDLE_SIG (SIGUSR2);
    _HANDLE_SIG (SIGCHLD);
    _HANDLE_SIG (SIGCONT);
    _HANDLE_SIG (SIGSTOP);
    _HANDLE_SIG (SIGTSTP);
    _HANDLE_SIG (SIGTTIN);
    _HANDLE_SIG (SIGTTOU);
    _HANDLE_SIG (SIGBUS);
    _HANDLE_SIG (SIGPOLL);
    _HANDLE_SIG (SIGPROF);
    _HANDLE_SIG (SIGSYS);
    _HANDLE_SIG (SIGTRAP);
    _HANDLE_SIG (SIGURG);
    _HANDLE_SIG (SIGVTALRM);
    _HANDLE_SIG (SIGXCPU);
    _HANDLE_SIG (SIGXFSZ);
#undef _HANDLE_SIG
    default:
      break;
    }
  return "UNKNOWN_SIGNAL";
}

gboolean
storage_util_check_status_and_output (const gchar *cmd,
                                      gint status,
                                      const gchar *standard_out,
                                      const gchar *standard_error,
                                      GError **error)
{
  GString *message;

  if (WIFEXITED (status) && WEXITSTATUS (status) == 0)
    return TRUE;

  message = g_string_new (NULL);
  if (WIFEXITED (status))
    {
          g_string_append_printf (message,
                                  "%s exited with non-zero exit status %d",
                                  cmd, WEXITSTATUS (status));
    }
  else if (WIFSIGNALED (status))
    {
      g_string_append_printf (message,
                              "%s was signaled with signal %s (%d)",
                              cmd, get_signal_name (WTERMSIG (status)),
                              WTERMSIG (status));
    }
  if (standard_out && standard_out[0] &&
      standard_error && standard_error[0])
    {
      g_string_append_printf (message,
                              "\n"
                              "stdout: '%s'\n"
                              "stderr: '%s'",
                              standard_out,
                              standard_error);
    }
  else if (standard_out && standard_out[0])
    {
      g_string_append_printf (message, ": %s", standard_out);
    }
  else if (standard_error && standard_error[0])
    {
      g_string_append_printf (message, ": %s", standard_error);
    }

  g_set_error_literal (error, UDISKS_ERROR, UDISKS_ERROR_FAILED, message->str);
  g_string_free (message, TRUE);
  return FALSE;
}

void
storage_util_trigger_udev (const gchar *device_file)
{
  int fd = open (device_file, O_RDWR);
  if (fd >= 0)
    close (fd);
}
