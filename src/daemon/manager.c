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

#include <string.h>
#include <stdio.h>
#include <math.h>

#include <glib.h>
#include <glib/gi18n-lib.h>

#include <gudev/gudev.h>

#include "daemon.h"
#include "manager.h"
#include "utils.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:manager
 * @title: Manager
 * @short_description: Implementation of #CockpitManager
 *
 * This type provides an implementation of the #CockpitManager interface.
 */

typedef struct _ManagerClass ManagerClass;

/**
 * Manager:
 *
 * The #Manager structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _Manager
{
  CockpitManagerSkeleton parent_instance;

  Daemon *daemon;
  GCancellable *cancellable;

  /* may be NULL */
  GDBusProxy *hostname1_proxy;

  GFileMonitor *systemd_shutdown_schedule_monitor;

  GFileMonitor *etc_os_release_monitor;
};

struct _ManagerClass
{
  CockpitManagerSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON
};

static void manager_iface_init (CockpitManagerIface *iface);

G_DEFINE_TYPE_WITH_CODE (Manager, manager, COCKPIT_TYPE_MANAGER_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MANAGER, manager_iface_init));

static void update_dmi (Manager *manager);

static void update_hostname1 (Manager *manager);
static void on_hostname1_properties_changed (GDBusProxy         *proxy,
                                             GVariant           *changed_properties,
                                             const gchar *const *invalidated_properties,
                                             gpointer            user_data);

/* ---------------------------------------------------------------------------------------------------- */

static void
manager_dispose (GObject *object)
{
  Manager *self = MANAGER (object);

  g_cancellable_cancel (self->cancellable);

  G_OBJECT_CLASS (manager_parent_class)->dispose (object);
}

static void
manager_finalize (GObject *object)
{
  Manager *manager = MANAGER (object);

  if (manager->hostname1_proxy != NULL)
    {
      g_signal_handlers_disconnect_by_func (manager->hostname1_proxy,
                                            G_CALLBACK (on_hostname1_properties_changed),
                                            manager);
      g_object_unref (manager->hostname1_proxy);
    }

  if (manager->systemd_shutdown_schedule_monitor)
    g_object_unref (manager->systemd_shutdown_schedule_monitor);

  g_clear_object (&manager->etc_os_release_monitor);

  G_OBJECT_CLASS (manager_parent_class)->finalize (object);
}

static void
manager_get_property (GObject *object,
                      guint prop_id,
                      GValue *value,
                      GParamSpec *pspec)
{
  Manager *manager = MANAGER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, manager_get_daemon (manager));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
manager_set_property (GObject *object,
                      guint prop_id,
                      const GValue *value,
                      GParamSpec *pspec)
{
  Manager *manager = MANAGER (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (manager->daemon == NULL);
      /* we don't take a reference to the daemon */
      manager->daemon = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
manager_init (Manager *manager)
{
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (manager),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);
  manager->cancellable = g_cancellable_new ();
}

static void
on_systemd_shutdown_scheduled_changed (GFileMonitor *monitor,
                                       GFile *file,
                                       GFile *other_file,
                                       GFileMonitorEvent event_type,
                                       gpointer user_data);

static void
reread_os_release (Manager *manager)
{
  cleanup_unref_object GFile *etc_os_release = g_file_new_for_path ("/etc/os-release");
  cleanup_free char *contents = NULL;
  const char *operating_system_value = NULL;
  char **lines = NULL;
  char **iter = NULL;
  gsize len;
  GError *local_error = NULL;
  cleanup_unref_hashtable GHashTable *os_release_keys =
    g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_free);

  if (!g_file_load_contents (etc_os_release, NULL, &contents, &len, NULL, &local_error))
    goto out;
  if (!g_utf8_validate (contents, len, NULL))
    {
      g_set_error (&local_error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                   "Invalid UTF-8");
      goto out;
    }

  lines = g_strsplit (contents, "\n", -1);
  for (iter = lines; iter && *iter; iter++)
    {
      char *line = *iter;
      char *eq;
      char *value;
      const char *quotedval;

      if (g_str_has_prefix (line, "#"))
        continue;

      eq = strchr (line, '=');
      if (!eq)
        continue;

      *eq = '\0';
      quotedval = eq + 1;
      value = g_shell_unquote (quotedval, NULL);
      if (!value)
        continue;

      g_hash_table_insert (os_release_keys, g_strdup (line), value);
    }

  operating_system_value = g_hash_table_lookup (os_release_keys, "PRETTY_NAME");
  if (operating_system_value)
    g_object_set (manager, "operating-system", operating_system_value, NULL);

out:
  g_strfreev (lines);
  if (local_error)
    {
      g_warning ("Failed to load /etc/os-release: %s",
                 local_error->message);
      g_error_free (local_error);
    }
}

static void
on_etc_os_release_changed (GFileMonitor *monitor,
                           GFile *file,
                           GFile *other_file,
                           GFileMonitorEvent *event,
                           gpointer user_data)
{
  Manager *manager = user_data;
  reread_os_release (manager);
}

static void
on_hostname_proxy_ready (GObject *source,
                         GAsyncResult *result,
                         gpointer user_data)
{
  Manager *self = MANAGER (user_data);
  GError *error = NULL;

  self->hostname1_proxy = g_dbus_proxy_new_for_bus_finish (result, &error);
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CANCELLED))
    {
      /* nothing */
    }
  else if (self->hostname1_proxy == NULL)
    {
      g_warning ("Unable to create hostname1 proxy: %s (%s, %d)",
                 error->message, g_quark_to_string (error->domain), error->code);
    }
  else
    {
      update_hostname1 (self);
      g_signal_connect (self->hostname1_proxy,
                        "g-properties-changed",
                        G_CALLBACK (on_hostname1_properties_changed),
                        self);
    }

  g_object_unref (self);
}

static void
update_hostname_from_kernel (Manager *manager)
{
  gchar hostname[HOST_NAME_MAX + 1];

  g_debug ("updating host name from kernel");

  if (gethostname (hostname, HOST_NAME_MAX) < 0)
    {
      g_message ("Error getting hostname: %m");
      strncpy (hostname, "<unknown>", HOST_NAME_MAX);
    }
  hostname[HOST_NAME_MAX] = '\0';

  cockpit_manager_set_hostname (COCKPIT_MANAGER (manager), hostname);
}

static void
manager_constructed (GObject *object)
{
  Manager *manager = MANAGER (object);
  GError *error = NULL;
  cleanup_unref_object GFile *etc_os_release = g_file_new_for_path ("/etc/os-release");

  manager->etc_os_release_monitor = g_file_monitor (etc_os_release, G_FILE_MONITOR_NONE, NULL, &error);
  if (!manager->etc_os_release_monitor)
    {
      g_warning ("Error monitoring /etc/os-release: %s", error->message);
      g_error_free (error);
    }
  else
    {
      g_signal_connect (manager->etc_os_release_monitor, "changed",
                        G_CALLBACK (on_etc_os_release_changed), manager);
      reread_os_release (manager);

      g_debug ("read /etc/os-release");
    }

  update_hostname_from_kernel (manager);

  g_dbus_proxy_new_for_bus (G_BUS_TYPE_SYSTEM,
                            G_DBUS_PROXY_FLAGS_GET_INVALIDATED_PROPERTIES,
                            NULL, /* GDBusInterfaceInfo* */
                            "org.freedesktop.hostname1",
                            "/org/freedesktop/hostname1",
                            "org.freedesktop.hostname1",
                            manager->cancellable,
                            on_hostname_proxy_ready,
                            g_object_ref (manager));

  update_dmi (manager);

  error = NULL;
  cleanup_unref_object GFile *f = g_file_new_for_path ("/run/systemd/shutdown/scheduled");
  manager->systemd_shutdown_schedule_monitor = g_file_monitor_file (f, 0, NULL, &error);
  if (error)
    {
      g_warning ("Can't watch: %s", error->message);
      g_error_free (error);
    }
  else
    {
      g_signal_connect (manager->systemd_shutdown_schedule_monitor,
                        "changed",
                        G_CALLBACK (on_systemd_shutdown_scheduled_changed),
                        manager);
      g_debug ("created shutdown schedule monitor");
    }

  if (G_OBJECT_CLASS (manager_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (manager_parent_class)->constructed (object);
}

static void
manager_class_init (ManagerClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = manager_dispose;
  gobject_class->finalize     = manager_finalize;
  gobject_class->constructed  = manager_constructed;
  gobject_class->set_property = manager_set_property;
  gobject_class->get_property = manager_get_property;

  /**
   * Manager:daemon:
   *
   * The #Daemon for the object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_DAEMON,
                                   g_param_spec_object ("daemon",
                                                        NULL,
                                                        NULL,
                                                        TYPE_DAEMON,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * manager_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #Manager instance.
 *
 * Returns: A new #Manager. Free with g_object_unref().
 */
CockpitManager *
manager_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_MANAGER (g_object_new (COCKPIT_TYPE_DAEMON_MANAGER,
                                        "daemon", daemon,
                                        "version", PACKAGE_VERSION,
                                        NULL));
}

/**
 * manager_get_daemon:
 * @manager: A #Manager.
 *
 * Gets the daemon used by @manager.
 *
 * Returns: A #Daemon. Do not free, the object is owned by @manager.
 */
Daemon *
manager_get_daemon (Manager *manager)
{
  g_return_val_if_fail (COCKPIT_IS_DAEMON_MANAGER (manager), NULL);
  return manager->daemon;
}

/* ---------------------------------------------------------------------------------------------------- */

static const gchar *
peek_str_prop (GDBusProxy *proxy,
               const gchar *name)
{
  const gchar *ret = NULL;
  GVariant *value;

  value = g_dbus_proxy_get_cached_property (proxy, name);
  if (value == NULL)
    goto out;

  ret = g_variant_get_string (value, NULL);
  g_variant_unref (value);

out:
  return ret;
}

static void
update_hostname1 (Manager *manager)
{
  gchar *name_owner = NULL;

  name_owner = g_dbus_proxy_get_name_owner (manager->hostname1_proxy);
  if (name_owner == NULL)
    goto out;

  cockpit_manager_set_hostname (COCKPIT_MANAGER (manager), peek_str_prop (manager->hostname1_proxy, "Hostname"));
  cockpit_manager_set_static_hostname (COCKPIT_MANAGER (manager), peek_str_prop (manager->hostname1_proxy, "StaticHostname"));
  cockpit_manager_set_pretty_hostname (COCKPIT_MANAGER (manager), peek_str_prop (manager->hostname1_proxy, "PrettyHostname"));

out:
  g_free (name_owner);
}

static void
on_hostname1_properties_changed (GDBusProxy *proxy,
                                 GVariant *changed_properties,
                                 const gchar * const *invalidated_properties,
                                 gpointer user_data)
{
  Manager *manager = MANAGER (user_data);
  update_hostname1 (manager);

}

/* ---------------------------------------------------------------------------------------------------- */

static gchar *
get_stripped_sysfs_attr (GUdevDevice *device,
                         const gchar *attr_name)
{
  gchar *ret;

  ret = g_strdup (g_udev_device_get_sysfs_attr (device, attr_name));
  if (ret == NULL)
    goto out;

  g_strstrip (ret);

  if (strlen (ret) == 0)
    {
      g_free (ret);
      ret = NULL;
    }

out:
  return ret;
}

static void
update_dmi (Manager *manager)
{
  GUdevClient *client = NULL;
  GUdevDevice *device = NULL;
  GString *str;
  gchar *s;

  /* TODO: Probably need some other and/or better heuristics to yield
   * useful info on as many systems as possible
   */

  g_debug ("updating dmi");

  client = g_udev_client_new (NULL);
  device = g_udev_client_query_by_sysfs_path (client, "/sys/devices/virtual/dmi/id");
  if (device == NULL)
    goto out;

  str = g_string_new (NULL);
  g_string_append_printf (str, "%s %s (%s)",
                          g_udev_device_get_sysfs_attr (device, "bios_vendor"),
                          g_udev_device_get_sysfs_attr (device, "bios_version"),
                          g_udev_device_get_sysfs_attr (device, "bios_date"));
  cockpit_manager_set_bios (COCKPIT_MANAGER (manager), str->str);
  g_string_free (str, TRUE);

  str = g_string_new (NULL);
  g_string_append_printf (str, "%s %s",
                          g_udev_device_get_sysfs_attr (device, "sys_vendor"),
                          g_udev_device_get_sysfs_attr (device, "product_name"));
  s = get_stripped_sysfs_attr (device, "product_version");
  if (s != NULL)
    {
      g_string_append_printf (str, " (%s)", s);
      g_free (s);
    }
  cockpit_manager_set_system (COCKPIT_MANAGER (manager), str->str);
  g_string_free (str, TRUE);

  s = get_stripped_sysfs_attr (device, "product_serial");
  if (s == NULL)
    s = get_stripped_sysfs_attr (device, "chassis_serial");
  cockpit_manager_set_system_serial (COCKPIT_MANAGER (manager), s);

out:
  g_clear_object (&device);
  g_clear_object (&client);
}

/* ---------------------------------------------------------------------------------------------------- */

/* runs in thread dedicated to handling the method call so may block */
static gboolean
handle_set_hostname (CockpitManager *_manager,
                     GDBusMethodInvocation *invocation,
                     const gchar *arg_pretty_hostname,
                     const gchar *arg_static_hostname,
                     GVariant *arg_options)
{
  Manager *manager = MANAGER (_manager);
  GError *error;

  error = NULL;
  if (!g_dbus_proxy_call_sync (manager->hostname1_proxy,
                               "SetPrettyHostname",
                               g_variant_new ("(sb)", arg_pretty_hostname, TRUE),
                               G_DBUS_CALL_FLAGS_NONE,
                               -1, /* timeout_msec */
                               NULL, /* GCancellable* */
                               &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_take_error (invocation, error);
      goto out;
    }

  error = NULL;
  if (!g_dbus_proxy_call_sync (manager->hostname1_proxy,
                               "SetStaticHostname",
                               g_variant_new ("(sb)", arg_static_hostname, TRUE),
                               G_DBUS_CALL_FLAGS_NONE,
                               -1, /* timeout_msec */
                               NULL, /* GCancellable* */
                               &error))
    {
      g_dbus_error_strip_remote_error (error);
      g_dbus_method_invocation_take_error (invocation, error);
      goto out;
    }

  cockpit_manager_complete_set_hostname (COCKPIT_MANAGER (manager), invocation);

out:
  return TRUE; /* Means we handled the invocation */
}

/* ---------------------------------------------------------------------------------------------------- */

static gchar *
get_avatar_data_url (void)
{
  const gchar *file = PACKAGE_SYSCONF_DIR "/cockpit/avatar.png";

  cleanup_free gchar *raw_data = NULL;
  gsize raw_size;
  cleanup_free gchar *base64_data = NULL;

  if (!g_file_get_contents (file, &raw_data, &raw_size, NULL))
    return NULL;

  base64_data = g_base64_encode ((guchar *)raw_data, raw_size);
  return g_strdup_printf ("data:image/png;base64,%s", base64_data);
}

static gboolean
handle_get_avatar_data_url (CockpitManager *_manager,
                            GDBusMethodInvocation *invocation)
{
  cleanup_free gchar *data = get_avatar_data_url ();
  cockpit_manager_complete_get_avatar_data_url (_manager, invocation, data? data : "");
  return TRUE;
}

static gboolean
handle_set_avatar_data_url (CockpitManager *object,
                            GDBusMethodInvocation *invocation,
                            const gchar *arg_data)
{
  GError *error = NULL;
  gsize raw_size;
  cleanup_free gchar *raw_data = NULL;

  const gchar *base64_data = strstr (arg_data, "base64,");
  if (base64_data == NULL)
    goto out;

  base64_data += strlen ("base64,");

  raw_data = (gchar *)g_base64_decode (base64_data, &raw_size);

  const gchar *file = PACKAGE_SYSCONF_DIR "/cockpit/avatar.png";
  if (!g_file_set_contents (file, raw_data, raw_size, &error))
    goto out;

  cockpit_manager_emit_avatar_changed (object);

out:
  if (error)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR, COCKPIT_ERROR_FAILED,
                                             "%s", error->message);
      g_clear_error (&error);
    }
  else
    cockpit_manager_complete_set_avatar_data_url (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

/* SHUTDOWN & RESTART
 */

static gboolean
handle_get_server_time (CockpitManager *object,
                        GDBusMethodInvocation *invocation)
{
  GDateTime *now = g_date_time_new_now_local ();
  cockpit_manager_complete_get_server_time (object, invocation,
                                            g_date_time_to_unix (now),
                                            g_date_time_get_timezone_abbreviation (now),
                                            g_date_time_get_utc_offset (now) / 1.0e6);
  g_date_time_unref (now);
  return TRUE;
}

static void
parse_scheduled_contents (Manager *manager,
                          const char *contents)
{
  char **lines = NULL;
  char **lines_iter = NULL;
  const char *mode = NULL;
  gboolean found_usec = FALSE;
  guint64 usec = 0;

  lines = g_strsplit (contents, "\n", -1);

  for (lines_iter = lines; *lines_iter; lines_iter++)
    {
      const char *line = *lines_iter;

      if (g_str_has_prefix (line, "USEC="))
        {
          usec = g_ascii_strtoull (line + strlen ("USEC="), NULL, 10);
          found_usec = TRUE;
        }
      else if (g_str_has_prefix (line, "MODE="))
        {
          mode = line + strlen ("MODE=");
        }
      else
        continue;
    }

  if (mode && found_usec)
    {
      GVariantBuilder schedule;
      g_variant_builder_init (&schedule, G_VARIANT_TYPE("a{sv}"));
      g_variant_builder_add (&schedule, "{sv}", "when_seconds",
                             g_variant_new_double (usec / 1.0e6));
      if (strcmp (mode, "poweroff") == 0)
        mode = "shutdown";
      else if (strcmp (mode, "reboot") == 0)
        mode = "restart";
      g_variant_builder_add (&schedule, "{sv}", "kind",
                             g_variant_new_string (mode));
      cockpit_manager_set_shutdown_schedule (COCKPIT_MANAGER (manager),
                                             g_variant_builder_end (&schedule));
    }
  else
    g_warning ("Failed to parse scheduled shutdown file");

  g_strfreev (lines);
}

static void
on_systemd_shutdown_scheduled_changed (GFileMonitor *monitor,
                                       GFile *file,
                                       GFile *other_file,
                                       GFileMonitorEvent event_type,
                                       gpointer user_data)
{
  Manager *manager = user_data;
  GError *error = NULL;
  cleanup_free char *scheduled_contents = NULL;

  if (!g_file_load_contents (file, NULL,
                             &scheduled_contents, NULL,
                             NULL, &error))
    {
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_NOT_FOUND))
        cockpit_manager_set_shutdown_schedule (COCKPIT_MANAGER(manager), NULL);
      else
        g_warning ("%s", error->message);
      g_error_free (error);
    }
  else
    parse_scheduled_contents (manager, scheduled_contents);
}

static void
redirect_stderr_to_stdout (gpointer unused)
{
  dup2 (1, 2);
}

static gboolean
run_cmd_for_invocation (GDBusMethodInvocation *invocation,
                        char **output,
                        const gchar *cmd,
                        ...)
{
  const int max_args = 20;
  const gchar *argv[max_args];

  va_list ap;
  va_start (ap, cmd);
  const gchar **p = argv;
  while (cmd && p < argv + max_args - 1)
    {
      *p++ = cmd;
      cmd = va_arg (ap, const gchar *);
    }
  *p = NULL;
  va_end (ap);

  GError *error = NULL;
  gint code;

  g_spawn_sync (NULL, (gchar **)argv, NULL,
                G_SPAWN_SEARCH_PATH | (output == NULL? G_SPAWN_STDOUT_TO_DEV_NULL : 0),
                redirect_stderr_to_stdout, NULL, output, NULL, &code, &error);
  if (error)
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "Can't run '%s': %s", argv[0], error->message);
      g_error_free (error);
      return FALSE;
    }
  else if (output == NULL && !g_spawn_check_exit_status (code, &error))
    {
      g_dbus_method_invocation_return_error (invocation,
                                             COCKPIT_ERROR,
                                             COCKPIT_ERROR_FAILED,
                                             "'%s' failed: %s", argv[0], error->message);
      g_error_free (error);
      return FALSE;
    }
  else
    return TRUE;
}

static gboolean
handle_shutdown (CockpitManager *object,
                 GDBusMethodInvocation *invocation,
                 const gchar *arg_kind,
                 const gchar *arg_when,
                 const gchar *arg_message)
{
  if (run_cmd_for_invocation (invocation, NULL,
                              "pkexec",
                              "shutdown",
                              (strcmp (arg_kind, "shutdown") == 0 ? "--poweroff" : "--reboot"),
                              arg_when,
                              arg_message,
                              NULL))
    cockpit_manager_complete_shutdown (object, invocation);

  return TRUE;
}

static gboolean
handle_cancel_shutdown (CockpitManager *object,
                        GDBusMethodInvocation *invocation)
{
  if (run_cmd_for_invocation (invocation, NULL, "pkexec", "shutdown", "-c", NULL))
    cockpit_manager_complete_cancel_shutdown (object, invocation);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
manager_iface_init (CockpitManagerIface *iface)
{
  iface->handle_set_hostname = handle_set_hostname;
  iface->handle_get_avatar_data_url = handle_get_avatar_data_url;
  iface->handle_set_avatar_data_url = handle_set_avatar_data_url;

  iface->handle_get_server_time = handle_get_server_time;
  iface->handle_shutdown = handle_shutdown;
  iface->handle_cancel_shutdown = handle_cancel_shutdown;
}
