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

#include "machine.h"
#include "machines.h"

#include "common/cockpitmemory.h"

/**
 * SECTION:machine
 * @title: Machine
 * @short_description: Implementation of #CockpitMachine
 *
 * This type provides an implementation of the #CockpitMachine interface.
 */

typedef struct _MachineClass MachineClass;

/**
 * Machine:
 *
 * The #Machine structure contains only private data and should
 * only be accessed using the provided API.
 */
struct _Machine
{
  CockpitMachineSkeleton parent_instance;

  Machines *machines;
  gchar *id;
};

struct _MachineClass
{
  CockpitMachineSkeletonClass parent_class;
};

enum
{
  PROP_0,
  PROP_MACHINES,
  PROP_ID
};

static void machine_iface_init (CockpitMachineIface *iface);

G_DEFINE_TYPE_WITH_CODE (Machine, machine, COCKPIT_TYPE_MACHINE_SKELETON,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_MACHINE, machine_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
find_tag (const gchar *const *tags,
          const gchar *tag)
{
  if (tags == NULL)
    return FALSE;

  for (int i = 0; tags[i]; i++)
    {
      if (g_strcmp0 (tags[i], tag) == 0)
        return TRUE;
    }
  return FALSE;
}

static int
count_tags (const gchar *const *tags)
{
  if (tags == NULL)
    return 0;

  return g_strv_length ((gchar **)tags);
}

/* ---------------------------------------------------------------------------------------------------- */

void
machine_read (Machine *machine, GKeyFile *file, const gchar *group)
{
  cleanup_free gchar *address = g_key_file_get_string (file, group, "address", NULL);
  cockpit_machine_set_address (COCKPIT_MACHINE (machine), address? address : "");

  cleanup_strfreev gchar **tags = g_key_file_get_string_list (file, group, "tags", NULL, NULL);
  cockpit_machine_set_tags (COCKPIT_MACHINE (machine), (const gchar *const *)tags);

  cleanup_free gchar *name = g_key_file_get_string (file, group, "name", NULL);
  cockpit_machine_set_name (COCKPIT_MACHINE (machine), name? name : "");

  cleanup_free gchar *color = g_key_file_get_string (file, group, "color", NULL);
  cockpit_machine_set_color (COCKPIT_MACHINE (machine), color? color : "");

  cleanup_free gchar *avatar = g_key_file_get_string (file, group, "avatar", NULL);
  cockpit_machine_set_avatar (COCKPIT_MACHINE (machine), avatar? avatar : "");
}

void
machine_write (Machine *machine, GKeyFile *file)
{
  const gchar *address = cockpit_machine_get_address (COCKPIT_MACHINE (machine));
  g_key_file_set_string (file, machine->id, "address", address);

  const gchar *const *tags = cockpit_machine_get_tags (COCKPIT_MACHINE (machine));
  g_key_file_set_string_list (file, machine->id, "tags", tags, count_tags(tags));

  const gchar *name = cockpit_machine_get_name (COCKPIT_MACHINE (machine));
  g_key_file_set_string (file, machine->id, "name", name? name : "");

  const gchar *color = cockpit_machine_get_color (COCKPIT_MACHINE (machine));
  g_key_file_set_string (file, machine->id, "color", color? color: "");

  const gchar *avatar = cockpit_machine_get_avatar (COCKPIT_MACHINE (machine));
  g_key_file_set_string (file, machine->id, "avatar", avatar? avatar: "");
}

static gchar *
utils_generate_object_path (const gchar *base,
                            const gchar *s)
{
  guint n;
  GString *str;

  g_return_val_if_fail (g_variant_is_object_path (base), NULL);
  g_return_val_if_fail (g_utf8_validate (s, -1, NULL), NULL);

  str = g_string_new (base);
  g_string_append_c (str, '/');
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
          g_string_append_printf (str, "_%02x", c & 0xFF);
        }
    }
  return g_string_free (str, FALSE);
}

void
machine_export (Machine *machine,
                GDBusObjectManagerServer *object_manager)
{
  if (g_dbus_interface_get_object (G_DBUS_INTERFACE (machine)) == NULL)
    {
      CockpitObjectSkeleton *object = NULL;
      cleanup_free gchar *object_path = NULL;

      object_path = utils_generate_object_path ("/com/redhat/Cockpit/Machines", machine->id);
      object = cockpit_object_skeleton_new (object_path);
      cockpit_object_skeleton_set_machine (object, COCKPIT_MACHINE (machine));
      g_dbus_object_manager_server_export_uniquely (object_manager, G_DBUS_OBJECT_SKELETON (object));
      g_object_unref (object);
    }
}

void
machine_unexport (Machine *machine,
                  GDBusObjectManagerServer *object_manager)
{
  GDBusObject *object = g_dbus_interface_get_object (G_DBUS_INTERFACE (machine));
  if (object)
    g_dbus_object_manager_server_unexport (object_manager, g_dbus_object_get_object_path (object));
}

static void
machine_finalize (GObject *object)
{
  Machine *self = MACHINE (object);

  g_free (self->id);

  G_OBJECT_CLASS (machine_parent_class)->finalize (object);
}

static void
machine_set_property (GObject *object,
                       guint prop_id,
                       const GValue *value,
                       GParamSpec *pspec)
{
  Machine *machine = MACHINE (object);

  switch (prop_id)
    {
    case PROP_MACHINES:
      g_assert (machine->machines == NULL);
      /* we don't take a reference to the machines */
      machine->machines = g_value_get_object (value);
      break;

    case PROP_ID:
      g_assert (machine->id == NULL);
      machine->id = g_value_dup_string (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
machine_init (Machine *machine)
{
}

static void
machine_constructed (GObject *object)
{
  if (G_OBJECT_CLASS (machine_parent_class)->constructed != NULL)
    G_OBJECT_CLASS (machine_parent_class)->constructed (object);
}

static void
machine_class_init (MachineClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize     = machine_finalize;
  gobject_class->constructed  = machine_constructed;
  gobject_class->set_property = machine_set_property;

  /**
   * Machine:machines:
   *
   * A pointer back to the #Machines object.
   */
  g_object_class_install_property (gobject_class,
                                   PROP_MACHINES,
                                   g_param_spec_object ("machines",
                                                        NULL,
                                                        NULL,
                                                        COCKPIT_TYPE_DAEMON_MACHINES,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  /**
   * Machine:id:
   *
   * The Machine id
   */
  g_object_class_install_property (gobject_class,
                                   PROP_ID,
                                   g_param_spec_string ("id",
                                                        NULL,
                                                        NULL,
                                                        NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));
}

/**
 * machine_new:
 * @machines: an object manager to add machine to
 *
 * Creates a new #Machine instance.
 *
 * Returns: A new #Machine. Free with g_object_unref().
 */
CockpitMachine *
machine_new (Machines *machines,
             const gchar *id)
{
  g_return_val_if_fail (COCKPIT_IS_DAEMON_MACHINES (machines), NULL);
  return COCKPIT_MACHINE (g_object_new (COCKPIT_TYPE_DAEMON_MACHINE,
                                        "machines", machines,
                                        "id", id,
                                         NULL));
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
handle_add_tag (CockpitMachine *object,
                GDBusMethodInvocation *invocation,
                const gchar *tag)
{
  GError *error = NULL;
  Machine *machine = MACHINE (object);

  const gchar *const *tags = cockpit_machine_get_tags (object);

  if (!find_tag (tags, tag))
    {
      int n = count_tags (tags);
      cleanup_free const gchar **new_tags = g_new0 (const gchar *, n+2);
      for (int i = 0; i < n; i++)
        new_tags[i] = tags[i];
      new_tags[n] = tag;

      cockpit_machine_set_tags (object, new_tags);
      if (!machines_write (machine->machines, &error))
        {
          g_dbus_method_invocation_take_error (invocation, error);
          return TRUE;
        }
    }

  cockpit_machine_complete_add_tag (object, invocation);
  return TRUE;
}

static gboolean
handle_remove_tag (CockpitMachine *object,
                   GDBusMethodInvocation *invocation,
                   const gchar *tag)
{
  GError *error = NULL;
  Machine *machine = MACHINE (object);

  const gchar *const *tags = cockpit_machine_get_tags (object);

  if (find_tag (tags, tag))
    {
      int n = count_tags (tags);
      cleanup_free const gchar **new_tags = g_new0 (const gchar *, n);
      for (int i = 0, j = 0; i < n; i++)
        {
          if (g_strcmp0 (tags[i], tag) != 0)
            new_tags[j++] = tags[i];
        }

      cockpit_machine_set_tags (object, new_tags);
      if (!machines_write (machine->machines, &error))
        {
          g_dbus_method_invocation_take_error (invocation, error);
          return TRUE;
        }
    }

  cockpit_machine_complete_add_tag (object, invocation);
  return TRUE;
}

static gboolean
handle_set_name (CockpitMachine *object,
                 GDBusMethodInvocation *invocation,
                 const gchar *name)
{
  GError *error = NULL;
  Machine *machine = MACHINE (object);

  cockpit_machine_set_name (object, name);
  if (!machines_write (machine->machines, &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
      return TRUE;
    }

  cockpit_machine_complete_set_name (object, invocation);
  return TRUE;
}

static gboolean
handle_set_color (CockpitMachine *object,
                  GDBusMethodInvocation *invocation,
                  const gchar *color)
{
  GError *error = NULL;
  Machine *machine = MACHINE (object);

  cockpit_machine_set_color (object, color);
  if (!machines_write (machine->machines, &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
      return TRUE;
    }

  cockpit_machine_complete_set_color (object, invocation);
  return TRUE;
}

static gboolean
handle_set_avatar (CockpitMachine *object,
                   GDBusMethodInvocation *invocation,
                   const gchar *avatar)
{
  GError *error = NULL;
  Machine *machine = MACHINE (object);

  cockpit_machine_set_avatar (object, avatar);
  if (!machines_write (machine->machines, &error))
    {
      g_dbus_method_invocation_take_error (invocation, error);
      return TRUE;
    }

  cockpit_machine_complete_set_avatar (object, invocation);
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static void
machine_iface_init (CockpitMachineIface *iface)
{
  iface->handle_add_tag = handle_add_tag;
  iface->handle_remove_tag = handle_remove_tag;
  iface->handle_set_name = handle_set_name;
  iface->handle_set_color = handle_set_color;
  iface->handle_set_avatar = handle_set_avatar;
}
