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

#include <gsystem-local-alloc.h>

#include "daemon.h"
#include "auth.h"
#include "machines.h"
#include "machine.h"
#include "utils.h"

/**
 * SECTION:machines
 * @title: Machines
 * @short_description: Implementation of #CockpitMachines
 *
 * This type provides an implementation of the #CockpitMachines interface.
 */

typedef struct _MachinesClass MachinesClass;

/**
 * Machines:
 *
 * The #Machines structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _Machines
{
  CockpitMachinesSkeleton parent_instance;

  Daemon *daemon;

  GMutex lock;
  GArray *machines;  /* of Machine */
};

struct _MachinesClass
{
  CockpitMachinesSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_DAEMON
};

static void machines_iface_init (CockpitMachinesIface *iface);

G_DEFINE_TYPE_WITH_CODE (Machines, machines, COCKPIT_TYPE_MACHINES_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MACHINES, machines_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

#define MACHINES_FILE PACKAGE_LOCALSTATE_DIR "/lib/cockpit/machines"

static gboolean
machines_write_inlock (Machines *machines, GError **error)
{
  GKeyFile *file = g_key_file_new ();

  for (int i = 0; i < machines->machines->len; i++)
    machine_write (g_array_index (machines->machines, Machine *, i), file);

  gs_free gchar *data = g_key_file_to_data (file, NULL, NULL);
  g_key_file_free (file);

  return g_file_set_contents (MACHINES_FILE, data, -1, error);
}

gboolean
machines_write (Machines *machines, GError **error)
{
  gboolean res;

  g_mutex_lock (&machines->lock);
  res = machines_write_inlock (machines, error);
  g_mutex_unlock (&machines->lock);
  return res;
}

static Machine *
machines_new_machine (Machines *machines)
{
  gs_free gchar *id = g_strdup_printf ("%d", machines->machines->len);
  Machine *machine = MACHINE (machine_new (machines->daemon, id));
  g_object_ref_sink (machine);
  g_array_append_val (machines->machines, machine);
  return machine;
}

static void
machines_read (Machines *machines)
{
  GError *error = NULL;
  GKeyFile *file = NULL;
  gs_strfreev gchar **groups = NULL;

  g_mutex_lock (&machines->lock);

  g_array_set_size (machines->machines, 0);

  file = g_key_file_new();
  if (!g_key_file_load_from_file (file, MACHINES_FILE, 0, &error))
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        {
          const gchar *address = "localhost";
          const gchar *const tags[] = { "dashboard", NULL };

          Machine *machine = machines_new_machine (machines);
          cockpit_machine_set_address (COCKPIT_MACHINE (machine), address);
          cockpit_machine_set_tags (COCKPIT_MACHINE (machine), tags);
          machine_export (machine);
          machines_write_inlock (machines, NULL);
        }
      else
        g_warning ("Can't read %s: %s", MACHINES_FILE, error->message);
      goto out;
    }

  groups = g_key_file_get_groups (file, NULL);
  for (int i = 0; groups[i]; i++)
    {
      Machine *machine = machines_new_machine (machines);
      machine_read (machine, file, groups[i]);
      machine_export (machine);
    }

 out:
  g_key_file_free (file);
  g_clear_error (&error);
  g_mutex_unlock (&machines->lock);
  return;
}

static void
machines_finalize (GObject *object)
{
  Machines *machines = MACHINES (object);

  g_mutex_clear (&machines->lock);

  G_OBJECT_CLASS (machines_parent_class)->finalize (object);
}

static void
machines_get_property (GObject *object,
                       guint prop_id,
                       GValue *value,
                       GParamSpec *pspec)
{
  Machines *machines = MACHINES (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_value_set_object (value, machines_get_daemon (machines));
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
machines_set_property (GObject *object,
                       guint prop_id,
                       const GValue *value,
                       GParamSpec *pspec)
{
  Machines *machines = MACHINES (object);

  switch (prop_id)
    {
    case PROP_DAEMON:
      g_assert (machines->daemon == NULL);
      /* we don't take a reference to the daemon */
      machines->daemon = g_value_get_object (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
machines_init (Machines *machines)
{
  g_dbus_interface_skeleton_set_flags (G_DBUS_INTERFACE_SKELETON (machines),
                                       G_DBUS_INTERFACE_SKELETON_FLAGS_HANDLE_METHOD_INVOCATIONS_IN_THREAD);
  g_mutex_init (&machines->lock);
}

static void
machines_constructed (GObject *object)
{
  Machines *machines = MACHINES (object);

  machines->machines = g_array_new (FALSE, FALSE, sizeof(Machine *));
  machines_read (machines);

  if (G_OBJECT_CLASS (machines_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (machines_parent_class)->constructed (object);
}

static void
machines_class_init (MachinesClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = machines_finalize;
  gobject_class->constructed  = machines_constructed;
  gobject_class->set_property = machines_set_property;
  gobject_class->get_property = machines_get_property;

  /**
   * Machines:daemon:
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
 * machines_new:
 * @daemon: A #Daemon.
 *
 * Creates a new #Machines instance.
 *
 * Returns: A new #Machines. Free with g_object_unref().
 */
CockpitMachines *
machines_new (Daemon *daemon)
{
  g_return_val_if_fail (IS_DAEMON (daemon), NULL);
  return COCKPIT_MACHINES (g_object_new (COCKPIT_TYPE_DAEMON_MACHINES,
                                        "daemon", daemon,
                                         NULL));
}

/**
 * machines_get_daemon:
 * @machines: A #Machines.
 *
 * Gets the daemon used by @machines.
 *
 * Returns: A #Daemon. Do not free, the object is owned by @machines.
 */
Daemon *
machines_get_daemon (Machines *machines)
{
  g_return_val_if_fail (COCKPIT_IS_DAEMON_MACHINES (machines), NULL);
  return machines->daemon;
}

/* ---------------------------------------------------------------------------------------------------- */

static Machine *
machines_add (Machines *machines, const gchar *address, GError **error)
{
  Machine *machine;

  g_mutex_lock (&machines->lock);

  for (int i = 0; i < machines->machines->len; i++)
    {
      machine = g_array_index (machines->machines, Machine *, i);
      if (g_strcmp0 (cockpit_machine_get_address (COCKPIT_MACHINE (machine)), address) == 0)
        goto out;
    }

  machine = machines_new_machine (machines);
  cockpit_machine_set_address (COCKPIT_MACHINE (machine), address);
  machine_export (machine);

  if (!machines_write_inlock (machines, error))
    {
      g_warning ("Can't write machines: %s", (*error)->message);
      g_clear_error (error);
    }

 out:
  g_mutex_unlock (&machines->lock);
  return machine;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_add (CockpitMachines *object,
            GDBusMethodInvocation *invocation,
            const gchar *arg_address)
{
  GError *error = NULL;
  Machines *machines = MACHINES (object);
  Machine *machine;

  machine = machines_add (machines, arg_address, &error);
  if (machine)
    {
      GDBusObject *obj = g_dbus_interface_get_object (G_DBUS_INTERFACE (machine));
      cockpit_machines_complete_add (object, invocation, g_dbus_object_get_object_path (obj));
    }
  else
    g_dbus_method_invocation_take_error (invocation, error);

  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
machines_iface_init (CockpitMachinesIface *iface)
{
  iface->handle_add = handle_add;
}
