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

#include "cockpitbridge.h"

#include "cockpitchannel.h"
#include "cockpitdbusinternal.h"
#include "cockpitdbusjson.h"
#include "cockpitechochannel.h"
#include "cockpitfslist.h"
#include "cockpitfsread.h"
#include "cockpitfswatch.h"
#include "cockpitfsreplace.h"
#include "cockpithttpstream.h"
#include "cockpitinteracttransport.h"
#include "cockpitnullchannel.h"
#include "cockpitpackages.h"
#include "cockpitpipechannel.h"
#include "cockpitinternalmetrics.h"
#include "cockpitpolkitagent.h"
#include "cockpitportal.h"
#include "cockpitwebsocketstream.h"

#include "common/cockpitassets.h"
#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitsystem.h"
#include "common/cockpittest.h"
#include "common/cockpitunixfd.h"
#include "common/cockpitwebresponse.h"

#include <sys/prctl.h>

#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pwd.h>

#include <glib-unix.h>
#include <glib/gstdio.h>
#include <gio/gunixsocketaddress.h>


/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

static CockpitPackages *packages;

static CockpitPayloadType payload_types[] = {
  { "dbus-json3", cockpit_dbus_json_get_type },
  { "http-stream1", cockpit_http_stream_get_type },
  { "http-stream2", cockpit_http_stream_get_type },
  { "stream", cockpit_pipe_channel_get_type },
  { "fsread1", cockpit_fsread_get_type },
  { "fsreplace1", cockpit_fsreplace_get_type },
  { "fswatch1", cockpit_fswatch_get_type },
  { "fslist1", cockpit_fslist_get_type },
  { "null", cockpit_null_channel_get_type },
  { "echo", cockpit_echo_channel_get_type },
  { "metrics1", cockpit_internal_metrics_get_type },
  { "websocket-stream1", cockpit_web_socket_stream_get_type },
  { NULL },
};

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

static void
send_init_command (CockpitTransport *transport)
{
  const gchar *checksum;
  JsonObject *object;
  JsonObject *block;
  GHashTable *os_release;
  gchar **names;
  GBytes *bytes;
  gint i;

  object = json_object_new ();
  json_object_set_string_member (object, "command", "init");
  json_object_set_int_member (object, "version", 1);

  checksum = cockpit_packages_get_checksum (packages);
  if (checksum)
    json_object_set_string_member (object, "checksum", checksum);

  /* This is encoded as an object to allow for future expansion */
  block = json_object_new ();
  names = cockpit_packages_get_names (packages);
  for (i = 0; names && names[i] != NULL; i++)
    json_object_set_null_member (block, names[i]);
  json_object_set_object_member (object, "packages", block);
  g_free (names);

  os_release = cockpit_system_load_os_release ();
  block = cockpit_json_from_hash_table (os_release,
                                        cockpit_system_os_release_fields ());
  if (block)
    json_object_set_object_member (object, "os-release", block);
  g_hash_table_unref (os_release);

  bytes = cockpit_json_write_bytes (object);
  json_object_unref (object);

  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
setup_dbus_daemon (gpointer addrfd)
{
  g_unsetenv ("G_DEBUG");
  cockpit_unix_fd_close_all (3, GPOINTER_TO_INT (addrfd));
}

static GPid
start_dbus_daemon (void)
{
  GError *error = NULL;
  GString *address = NULL;
  gchar *line;
  gsize len;
  gssize ret;
  GPid pid = 0;
  gchar *print_address = NULL;
  int addrfd[2] = { -1, -1 };
  GSpawnFlags flags;

  gchar *dbus_argv[] = {
      "dbus-daemon",
      "--print-address=X",
      "--session",
      NULL
  };

  if (pipe (addrfd))
    {
      g_warning ("pipe failed to allocate fds: %m");
      goto out;
    }

  print_address = g_strdup_printf ("--print-address=%d", addrfd[1]);
  dbus_argv[1] = print_address;

  /* The DBus daemon produces useless messages on stderr mixed in */
  flags = G_SPAWN_LEAVE_DESCRIPTORS_OPEN | G_SPAWN_SEARCH_PATH |
          G_SPAWN_STDERR_TO_DEV_NULL | G_SPAWN_STDOUT_TO_DEV_NULL;

  g_spawn_async_with_pipes (NULL, dbus_argv, NULL, flags,
                            setup_dbus_daemon, GINT_TO_POINTER (addrfd[1]),
                            &pid, NULL, NULL, NULL, &error);

  close (addrfd[1]);

  if (error != NULL)
    {
      g_warning ("couldn't start %s: %s", dbus_argv[0], error->message);
      g_error_free (error);
      pid = 0;
      goto out;
    }

  g_debug ("launched %s", dbus_argv[0]);

  address = g_string_new ("");
  for (;;)
    {
      len = address->len;
      g_string_set_size (address, len + 256);
      ret = read (addrfd[0], address->str + len, 256);
      if (ret < 0)
        {
          g_string_set_size (address, len);
          if (errno != EAGAIN && errno != EINTR)
            {
              g_warning ("couldn't read address from dbus-daemon: %s", g_strerror (errno));
              goto out;
            }
        }
      else if (ret == 0)
        {
          g_string_set_size (address, len);
          break;
        }
      else
        {
          g_string_set_size (address, len + ret);
          line = strchr (address->str, '\n');
          if (line != NULL)
            {
              *line = '\0';
              break;
            }
        }
    }

  if (address->str[0] == '\0')
    {
      g_warning ("dbus-daemon didn't send us a dbus address");
    }
  else
    {
      g_setenv ("DBUS_SESSION_BUS_ADDRESS", address->str, TRUE);
      g_debug ("session bus address: %s", address->str);
    }

out:
  if (addrfd[0] >= 0)
    close (addrfd[0]);
  if (address)
    g_string_free (address, TRUE);
  g_free (print_address);
  return pid;
}

static void
setup_ssh_agent (gpointer addrfd)
{
  g_unsetenv ("G_DEBUG");
  prctl (PR_SET_PDEATHSIG, SIGTERM);
  cockpit_unix_fd_close_all (3, GPOINTER_TO_INT (addrfd));
}

static GPid
start_ssh_agent (void)
{
  GError *error = NULL;
  GPid pid = 0;
  gint fd = -1;
  gint status = -1;

  gchar *pid_line = NULL;
  gchar *agent_output = NULL;
  gchar *agent_error = NULL;
  gchar *bind_address = g_strdup_printf ("%s/ssh-agent.XXXXXX", g_get_user_runtime_dir ());

  gchar *agent_argv[] = {
      "ssh-agent",
      "-a",
      bind_address,
      NULL
  };

  fd = g_mkstemp (bind_address);
  if (fd < 0)
    {
      g_warning ("couldn't create temporary socket file: %s", g_strerror (errno));
      goto out;
    }
  if (g_unlink (bind_address) < 0)
    {
      g_warning ("couldn't remove temporary socket file: %s", g_strerror (errno));
      goto out;
    }

  if (!g_spawn_sync (NULL, agent_argv, NULL,
                     G_SPAWN_SEARCH_PATH, setup_ssh_agent,
                     GINT_TO_POINTER (-1),
                     &agent_output, &agent_error,
                     &status, &error))
    {
      if (g_error_matches (error, G_SPAWN_ERROR, G_SPAWN_ERROR_NOENT))
        g_debug ("couldn't start %s: %s", agent_argv[0], error->message);
      else
        g_warning ("couldn't start %s: %s", agent_argv[0], error->message);
      goto out;
    }

  if (!g_spawn_check_exit_status (status, &error))
    {
      g_warning ("couldn't start %s: %s: %s", agent_argv[0],
                 error->message, agent_error);
      goto out;
    }

  pid_line = strstr (agent_output, "SSH_AGENT_PID=");
  if (pid_line)
    {
      if (sscanf (pid_line, "SSH_AGENT_PID=%d;", &pid) != 1)
        {
            g_warning ("couldn't find pid in %s", pid_line);
            goto out;
        }
    }

  if (pid < 1)
    {
      g_warning ("couldn't get agent pid from ssh-agent output: %s", agent_output);
      goto out;
    }

  g_debug ("launched %s", agent_argv[0]);
  g_setenv ("SSH_AUTH_SOCK", bind_address, TRUE);

out:
  g_clear_error (&error);
  if (fd >= 0)
    close (fd);
  g_free (bind_address);
  g_free (agent_error);
  g_free (agent_output);
  return pid;
}

static gboolean
have_env (const gchar *name)
{
  const gchar *env = g_getenv (name);
  return env && env[0];
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean *closed = data;
  *closed = TRUE;
  return TRUE;
}

static struct passwd *
getpwuid_a (uid_t uid)
{
  int err;
  long bufsize = sysconf (_SC_GETPW_R_SIZE_MAX);
  struct passwd *ret = NULL;
  struct passwd *buf;

  if (bufsize <= 0)
    bufsize = 8192;

  buf = g_malloc (sizeof(struct passwd) + bufsize);
  err = getpwuid_r (uid, buf, (char *)(buf + 1), bufsize, &ret);

  if (ret == NULL)
    {
      free (buf);
      if (err == 0)
        err = ENOENT;
      errno = err;
    }

  return ret;
}

static int
run_bridge (const gchar *interactive,
            gboolean privileged_slave)
{
  CockpitTransport *transport;
  CockpitBridge *bridge;
  gboolean terminated = FALSE;
  gboolean interupted = FALSE;
  gboolean closed = FALSE;
  const gchar *init_host = NULL;
  CockpitPortal *super = NULL;
  CockpitPortal *pcp = NULL;
  gpointer polkit_agent = NULL;
  const gchar *directory;
  struct passwd *pwd;
  GPid daemon_pid = 0;
  GPid agent_pid = 0;
  guint sig_term;
  guint sig_int;
  int outfd;
  uid_t uid;

  cockpit_set_journal_logging (G_LOG_DOMAIN, !isatty (2));

  /*
   * The bridge always runs from within $XDG_RUNTIME_DIR
   * This makes it easy to create user sockets and/or files.
   */
  if (!privileged_slave)
    {
      directory = g_get_user_runtime_dir ();
      if (g_mkdir_with_parents (directory, 0700) < 0)
        g_warning ("couldn't create runtime dir: %s: %s", directory, g_strerror (errno));
      else if (g_chdir (directory) < 0)
        g_warning ("couldn't change to runtime dir: %s: %s", directory, g_strerror (errno));
    }

  /* Always set environment variables early */
  uid = geteuid();
  pwd = getpwuid_a (uid);
  if (pwd == NULL)
    {
      g_message ("couldn't get user info: %s", g_strerror (errno));
    }
  else
    {
      g_setenv ("USER", pwd->pw_name, TRUE);
      g_setenv ("HOME", pwd->pw_dir, TRUE);
      g_setenv ("SHELL", pwd->pw_shell, TRUE);
    }

  /* Reset the umask, typically this is done in .bashrc for a login shell */
  umask (022);

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

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, &terminated);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, &interupted);

  g_type_init ();

  /* Start daemons if necessary */
  if (!interactive && !privileged_slave)
    {
      if (!have_env ("DBUS_SESSION_BUS_ADDRESS"))
        daemon_pid = start_dbus_daemon ();
      if (!have_env ("SSH_AUTH_SOCK"))
        agent_pid = start_ssh_agent ();
    }

  packages = cockpit_packages_new ();
  cockpit_dbus_internal_startup (interactive != NULL);

  if (interactive)
    {
      /* Allow skipping the init message when interactive */
      init_host = "localhost";
      transport = cockpit_interact_transport_new (0, outfd, interactive);
    }
  else
    {
      transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);
    }

  if (uid != 0)
    {
      if (!interactive)
        polkit_agent = cockpit_polkit_agent_register (transport, NULL);
      super = cockpit_portal_new_superuser (transport);
    }

  g_resources_register (cockpitassets_get_resource ());
  cockpit_web_failure_resource = "/org/cockpit-project/Cockpit/fail.html";

  pcp = cockpit_portal_new_pcp (transport);

  bridge = cockpit_bridge_new (transport, payload_types, init_host);
  cockpit_dbus_user_startup (pwd);
  cockpit_dbus_setup_startup ();
  cockpit_dbus_process_startup ();

  g_free (pwd);
  pwd = NULL;

  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  send_init_command (transport);

  while (!terminated && !closed && !interupted)
    g_main_context_iteration (NULL, TRUE);

  if (polkit_agent)
    cockpit_polkit_agent_unregister (polkit_agent);
  if (super)
    g_object_unref (super);

  g_object_unref (pcp);
  g_object_unref (bridge);
  g_object_unref (transport);

  cockpit_dbus_internal_cleanup ();
  cockpit_packages_free (packages);
  packages = NULL;

  if (daemon_pid)
    kill (daemon_pid, SIGTERM);
  if (agent_pid)
    kill (agent_pid, SIGTERM);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  /* So the caller gets the right signal */
  if (terminated)
    raise (SIGTERM);

  return 0;
}

static void
print_version (void)
{
  gint i, offset, len;

  g_print ("Version: %s\n", PACKAGE_VERSION);
  g_print ("Protocol: 1\n");

  g_print ("Payloads: ");
  offset = 10;
  for (i = 0; payload_types[i].name != NULL; i++)
    {
      len = strlen (payload_types[i].name);
      if (offset + len > 70)
        {
          g_print ("\n");
          offset = 0;
        }

      if (offset == 0)
        {
          g_print ("    ");
          offset = 4;
        };

      g_print ("%s ", payload_types[i].name);
      offset += len + 1;
    }
  g_print ("\n");

  g_print ("Authorization: crypt1\n");
}

int
main (int argc,
      char **argv)
{
  GOptionContext *context;
  GError *error = NULL;
  int ret;

  static gboolean opt_packages = FALSE;
  static gboolean opt_privileged = FALSE;
  static gboolean opt_version = FALSE;
  static gchar *opt_interactive = NULL;

  static GOptionEntry entries[] = {
    { "interact", 0, 0, G_OPTION_ARG_STRING, &opt_interactive, "Interact with the raw protocol", "boundary" },
    { "privileged", 0, 0, G_OPTION_ARG_NONE, &opt_privileged, "Privileged copy of bridge", NULL },
    { "packages", 0, 0, G_OPTION_ARG_NONE, &opt_packages, "Show Cockpit package information", NULL },
    { "version", 0, 0, G_OPTION_ARG_NONE, &opt_version, "Show Cockpit version information", NULL },
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);

  /* Debugging issues during testing */
#if WITH_DEBUG
  signal (SIGABRT, cockpit_test_signal_backtrace);
  signal (SIGSEGV, cockpit_test_signal_backtrace);
#endif

  /*
   * We have to tell GLib about an alternate default location for XDG_DATA_DIRS
   * if we've been compiled with a different prefix. GLib caches that, so need
   * to do this very early.
   */
  if (!g_getenv ("XDG_DATA_DIRS") && !g_str_equal (DATADIR, "/usr/share"))
    g_setenv ("XDG_DATA_DIRS", DATADIR, TRUE);

  g_setenv ("LANG", "en_US.UTF-8", FALSE);
  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_description (context,
                                    "cockpit-bridge is run automatically inside of a Cockpit session. When\n"
                                    "run from the command line one of the options above must be specified.\n");

  g_option_context_parse (context, &argc, &argv, &error);
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-bridge: %s\n", error->message);
      g_error_free (error);
      return 1;
    }

  if (opt_packages)
    {
      cockpit_packages_dump ();
      return 0;
    }
  else if (opt_version)
    {
      print_version ();
      return 0;
    }

  if (!opt_interactive && isatty (1))
    {
      g_printerr ("cockpit-bridge: no option specified\n");
      return 2;
    }

  ret = run_bridge (opt_interactive, opt_privileged);

  g_free (opt_interactive);
  return ret;
}
