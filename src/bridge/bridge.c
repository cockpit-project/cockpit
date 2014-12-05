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

#include "cockpitchannel.h"
#include "cockpitpackage.h"
#include "cockpitpolkitagent.h"
#include "cockpitsuperchannels.h"

#include "deprecated/manager.h"
#include "deprecated/machines.h"
#include "deprecated/services.h"
#include "deprecated/cpumonitor.h"
#include "deprecated/memorymonitor.h"
#include "deprecated/networkmonitor.h"
#include "deprecated/diskiomonitor.h"
#include "deprecated/cgroupmonitor.h"
#include "deprecated/netdevmonitor.h"
#include "deprecated/blockdevmonitor.h"
#include "deprecated/mountmonitor.h"
#include "deprecated/services.h"

#include "common/cockpitjson.h"
#include "common/cockpitlog.h"
#include "common/cockpitpipetransport.h"
#include "common/cockpitunixfd.h"

#include <sys/prctl.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <glib-unix.h>


/* This program is run on each managed server, with the credentials
   of the user that is logged into the Server Console.
*/

static GHashTable *channels;
static gboolean init_received;

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  g_hash_table_remove (channels, cockpit_channel_get_id (channel));
}

static void
process_init (CockpitTransport *transport,
              JsonObject *options)
{
  gint64 version;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    version = -1;

  if (version == 0)
    {
      g_debug ("received init message");
      init_received = TRUE;
    }
  else
    {
      g_message ("unsupported version of cockpit protocol: %" G_GINT64_FORMAT, version);
      cockpit_transport_close (transport, "protocol-error");
    }
}

static void
process_open (CockpitTransport *transport,
              const gchar *channel_id,
              JsonObject *options)
{
  CockpitChannel *channel;

  if (!channel_id)
    {
      g_warning ("Caller tried to open channel with invalid id");
      cockpit_transport_close (transport, "protocol-error");
    }
  else if (g_hash_table_lookup (channels, channel_id))
    {
      g_warning ("Caller tried to reuse a channel that's already in use");
      cockpit_transport_close (transport, "protocol-error");
    }
  else
    {
      channel = cockpit_channel_open (transport, channel_id, options);
      g_hash_table_insert (channels, g_strdup (channel_id), channel);
      g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), NULL);
    }
}

static void
process_close (CockpitTransport *transport,
               const gchar *channel_id,
               JsonObject *options)
{
  CockpitChannel *channel;
  const gchar *problem;

  /*
   * The channel may no longer exist due to a race of the bridge closing
   * a channel and the web closing it at the same time.
   */

  if (!channel_id)
    {
      g_warning ("Caller tried to close channel without an id");
      cockpit_transport_close (transport, "protocol-error");
      return;
    }

  channel = g_hash_table_lookup (channels, channel_id);
  if (channel)
    {
      g_debug ("close channel %s", channel_id);
      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        problem = NULL;
      cockpit_channel_close (channel, problem);
    }
  else
    {
      g_debug ("already closed channel %s", channel_id);
    }
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  if (g_str_equal (command, "init"))
    {
      process_init (transport, options);
      return TRUE;
    }

  if (!init_received)
    {
      g_warning ("caller did not send 'init' message first");
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }

  if (g_str_equal (command, "open"))
    process_open (transport, channel_id, options);
  else if (g_str_equal (command, "close"))
    process_close (transport, channel_id, options);
  else
    return FALSE;
  return TRUE; /* handled */
}

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
  const gchar *response = "\n{ \"command\": \"init\", \"version\": 0 }";
  GBytes *bytes = g_bytes_new_static (response, strlen (response));
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static void
setup_dbus_daemon (gpointer addrfd)
{
  cockpit_unix_fd_close_all (3, GPOINTER_TO_INT (addrfd));
}

static GPid
start_dbus_daemon (void)
{
  GError *error = NULL;
  const gchar *env;
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

  /* Automatically start a DBus session if necessary */
  env = g_getenv ("DBUS_SESSION_BUS_ADDRESS");
  if (env != NULL && env[0] != '\0')
    {
      g_debug ("already have session bus: %s", env);
      goto out;
    }

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

static GDBusObjectManagerServer *
export_internal_objects (GDBusConnection *connection)
{
  GDBusObjectManagerServer *object_manager;
  CockpitManager *manager;
  CockpitMachines *machines;
  CockpitResourceMonitor *monitor;
  CockpitServices *services;
  CockpitMultiResourceMonitor *multi_monitor;
  CockpitObjectSkeleton *object = NULL;

  object_manager = g_dbus_object_manager_server_new ("/com/redhat/Cockpit");

  /* /com/redhat/Cockpit/Machines */
  machines = machines_new (object_manager);
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Machines");
  cockpit_object_skeleton_set_machines (object, machines);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (machines);
  g_object_unref (object);

  g_debug ("exported machines object");

  /* /com/redhat/Cockpit/Manager */
  manager = manager_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Manager");
  cockpit_object_skeleton_set_manager (object, manager);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (manager);
  g_object_unref (object);

  g_debug ("exported manager");

  /* /com/redhat/Cockpit/CpuMonitor */
  monitor = cpu_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/CpuMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  g_debug ("exported cpu monitor");

  /* /com/redhat/Cockpit/MemoryMonitor */
  monitor = memory_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/MemoryMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  g_debug ("exported memory monitor");

  /* /com/redhat/Cockpit/NetworkMonitor */
  monitor = network_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/NetworkMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  g_debug ("exported network monitor");

  /* /com/redhat/Cockpit/DiskIOMonitor */
  monitor = disk_io_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/DiskIOMonitor");
  cockpit_object_skeleton_set_resource_monitor (object, monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (monitor);
  g_object_unref (object);

  g_debug ("exported disk io monitor");

  /* /com/redhat/Cockpit/LxcMonitor */
  multi_monitor = cgroup_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/LxcMonitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, multi_monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (multi_monitor);
  g_object_unref (object);

  g_debug ("exported lxc monitor");

  /* /com/redhat/Cockpit/NetdevMonitor */
  multi_monitor = netdev_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/NetdevMonitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, multi_monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (multi_monitor);
  g_object_unref (object);

  g_debug ("exported net dev monitor");

  /* /com/redhat/Cockpit/BlockdevMonitor */
  multi_monitor = blockdev_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/BlockdevMonitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, multi_monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (multi_monitor);
  g_object_unref (object);

  g_debug ("exported block dev monitor");

  /* /com/redhat/Cockpit/MountMonitor */
  multi_monitor = mount_monitor_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/MountMonitor");
  cockpit_object_skeleton_set_multi_resource_monitor (object, multi_monitor);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (multi_monitor);
  g_object_unref (object);

  g_debug ("exported mount monitor");

  /* /com/redhat/Cockpit/Services */
  services = services_new ();
  object = cockpit_object_skeleton_new ("/com/redhat/Cockpit/Services");
  cockpit_object_skeleton_set_services (object, services);
  g_dbus_object_manager_server_export (object_manager, G_DBUS_OBJECT_SKELETON (object));
  g_object_unref (services);
  g_object_unref (object);

  g_debug ("exported services");

  /* Export the ObjectManager */
  g_dbus_object_manager_server_set_connection (object_manager, connection);

  return object_manager;
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean *closed = data;
  *closed = TRUE;
  return TRUE;
}

static int
run_bridge (void)
{
  CockpitTransport *transport;
  GDBusConnection *connection;
  gboolean terminated = FALSE;
  gboolean interupted = FALSE;
  gboolean closed = FALSE;
  CockpitSuperChannels *super = NULL;
  GDBusObjectManagerServer *exported;
  GError *error = NULL;
  gpointer polkit_agent = NULL;
  GPid daemon_pid;
  guint sig_term;
  guint sig_int;
  int outfd;

  cockpit_set_journal_logging (!isatty (2));

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

  /* Start a session daemon if necessary */
  daemon_pid = start_dbus_daemon ();

  g_type_init ();

  connection = g_bus_get_sync (G_BUS_TYPE_SESSION, NULL, &error);
  if (connection == NULL)
    {
      g_message ("couldn't connect to session bus: %s", error->message);
      g_clear_error (&error);

      exported = export_internal_objects (connection);
    }
  else
    {
      g_dbus_connection_set_exit_on_close (connection, FALSE);
    }

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);

  if (geteuid () != 0)
    {
      polkit_agent = cockpit_polkit_agent_register (transport, NULL);
      super = cockpit_super_channels_new (transport);
    }

  g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  send_init_command (transport);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);

  while (!terminated && !closed)
    g_main_context_iteration (NULL, TRUE);

  if (polkit_agent)
    cockpit_polkit_agent_unregister (polkit_agent);
  if (super)
    g_object_unref (super);
  if (exported)
    g_object_unref (exported);
  if (connection)
    g_object_unref (connection);
  g_object_unref (transport);
  g_hash_table_destroy (channels);

  if (daemon_pid)
    kill (daemon_pid, SIGTERM);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  /* So the caller gets the right signal */
  if (terminated)
    raise (SIGTERM);

  return 0;
}

int
main (int argc,
      char **argv)
{
  GOptionContext *context;
  GError *error = NULL;

  static gboolean opt_packages = FALSE;
  static GOptionEntry entries[] = {
    { "packages", 0, 0, G_OPTION_ARG_NONE, &opt_packages, "Show Cockpit package information", NULL },
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);

  /*
   * We have to tell GLib about an alternate default location for XDG_DATA_DIRS
   * if we've been compiled with a different prefix. GLib caches that, so need
   * to do this very early.
   */
  if (!g_getenv ("XDG_DATA_DIRS") && !g_str_equal (DATADIR, "/usr/share"))
    g_setenv ("XDG_DATA_DIRS", DATADIR, TRUE);

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
      cockpit_package_dump ();
      return 0;
    }

  if (isatty (1))
    {
      g_printerr ("cockpit-bridge: no option specified\n");
      return 2;
    }

  return run_bridge ();
}
