/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#include "cockpitdbusmeta.h"

#include "common/cockpitjson.h"

#include <string.h>

static JsonArray *
build_meta_arguments (GDBusArgInfo **args)
{
  JsonArray *arguments = json_array_new ();
  while (*args)
    {
      json_array_add_string_element (arguments, (*args)->signature);
      args++;
    }
  return arguments;
}

static JsonObject *
build_meta_method (GDBusMethodInfo *meth)
{
  JsonObject *method = json_object_new ();
  if (meth->in_args)
    {
      json_object_set_array_member (method, "in",
                                    build_meta_arguments (meth->in_args));
    }
  if (meth->out_args)
    {
      json_object_set_array_member (method, "out",
                                    build_meta_arguments (meth->out_args));
    }
  return method;
}

static JsonObject *
build_meta_signal (GDBusSignalInfo *sig)
{
  JsonObject *signal = json_object_new ();
  if (sig->args)
    {
      json_object_set_array_member (signal, "in",
                                    build_meta_arguments (sig->args));
    }
  return signal;
}

static JsonObject *
build_meta_property (GDBusPropertyInfo *prop)
{
  JsonObject *property = json_object_new ();;
  GString *flags = g_string_new ("");

  if (prop->flags & G_DBUS_PROPERTY_INFO_FLAGS_READABLE)
    g_string_append_c (flags, 'r');
  if (prop->flags & G_DBUS_PROPERTY_INFO_FLAGS_WRITABLE)
    g_string_append_c (flags, 'w');
  json_object_set_string_member (property, "flags", flags->str);
  if (prop->signature)
    json_object_set_string_member (property, "type", prop->signature);
  g_string_free (flags, TRUE);
  return property;
}

JsonObject *
cockpit_dbus_meta_build (GDBusInterfaceInfo *iface)
{
  JsonObject *interface;
  JsonObject *methods;
  JsonObject *properties;
  JsonObject *signals;
  guint i;

  g_return_val_if_fail (iface != NULL, NULL);

  interface = json_object_new ();

  if (iface->methods)
    {
      methods = json_object_new ();
      for (i = 0; iface->methods[i] != NULL; i++)
        {
          json_object_set_object_member (methods, iface->methods[i]->name,
                                         build_meta_method (iface->methods[i]));
        }
      json_object_set_object_member (interface, "methods", methods);
    }

  if (iface->properties)
    {
      properties = json_object_new ();
      for (i = 0; iface->properties[i] != NULL; i++)
        {
          json_object_set_object_member (properties, iface->properties[i]->name,
                                         build_meta_property (iface->properties[i]));
        }
      json_object_set_object_member (interface, "properties", properties);
    }

  if (iface->signals)
    {
      signals = json_object_new ();
      for (i = 0; iface->signals[i] != NULL; i++)
        {
          json_object_set_object_member (signals, iface->signals[i]->name,
                                         build_meta_signal (iface->signals[i]));
        }
      json_object_set_object_member (interface, "signals", signals);
    }

  return interface;
}

static GDBusArgInfo **
parse_meta_arguments (JsonArray *arguments,
                      GError **error)
{
  const gchar *signature;
  GDBusArgInfo *arg;
  GPtrArray *args;
  guint i, length;
  JsonNode *node;

  args = g_ptr_array_new ();
  g_ptr_array_set_free_func (args, (GDestroyNotify)g_dbus_arg_info_unref);

  length = json_array_get_length (arguments);
  for (i = 0; i < length; i++)
    {
      node = json_array_get_element (arguments, i);
      if (!JSON_NODE_HOLDS_VALUE(node) || json_node_get_value_type (node) != G_TYPE_STRING)
        {
          g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                       "invalid argument in dbus meta field");
          break;
        }

      signature = json_node_get_string (node);
      if (!g_variant_is_signature (signature))
        {
          g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                       "argument in dbus meta field has invalid signature: %s", signature);
          break;
        }

      arg = g_new0 (GDBusArgInfo, 1);
      arg->ref_count = 1;
      arg->name = g_strdup_printf ("argument_%u", i);
      arg->signature = g_strdup (signature);
      g_ptr_array_add (args, arg);
    }

  if (i != length)
    {
      g_ptr_array_free (args, TRUE);
      return NULL;
    }
  else
    {
      g_ptr_array_add (args, NULL);
      return (GDBusArgInfo **)g_ptr_array_free (args, FALSE);
    }
}

static GDBusMethodInfo *
parse_meta_method (const gchar *method_name,
                   JsonObject *method,
                   GError **error)
{
  GDBusMethodInfo *ret = NULL;
  GDBusMethodInfo *meth;
  JsonArray *args;

  meth = g_new0 (GDBusMethodInfo, 1);
  meth->ref_count = 1;
  meth->name = g_strdup (method_name);

  if (!cockpit_json_get_array (method, "in", NULL, &args))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"in\" field in dbus meta method: %s", method_name);
      goto out;
    }

  if (args && json_array_get_length (args) > 0)
    {
      meth->in_args = parse_meta_arguments (args, error);
      if (!meth->in_args)
        goto out;
    }

  if (!cockpit_json_get_array (method, "out", NULL, &args))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"out\" field in dbus meta method: %s", method_name);
      goto out;
    }

  if (args && json_array_get_length (args) > 0)
    {
      meth->out_args = parse_meta_arguments (args, error);
      if (!meth->out_args)
        goto out;
    }

  ret = meth;
  meth = NULL;

out:
  if (meth)
    g_dbus_method_info_unref (meth);
  return ret;
}

static GDBusSignalInfo *
parse_meta_signal (const gchar *signal_name,
                   JsonObject *signal,
                   GError **error)
{
  GDBusSignalInfo *ret = NULL;
  GDBusSignalInfo *sig;
  JsonArray *args;

  sig = g_new0 (GDBusSignalInfo, 1);
  sig->ref_count = 1;
  sig->name = g_strdup (signal_name);

  if (!cockpit_json_get_array (signal, "in", NULL, &args))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"in\" field in dbus meta signal: %s", signal_name);
      goto out;
    }

  if (args && json_array_get_length (args) > 0)
    {
      sig->args = parse_meta_arguments (args, error);
      if (!sig->args)
        goto out;
    }

  ret = sig;
  sig = NULL;

out:
  if (sig)
    g_dbus_signal_info_unref (sig);
  return ret;
}

static GDBusPropertyInfo *
parse_meta_property (const gchar *property_name,
                     JsonObject *property,
                     GError **error)
{
  GDBusPropertyInfo *prop;
  GDBusPropertyInfo *ret = NULL;
  const gchar *flags;
  const gchar *type;

  prop = g_new0 (GDBusPropertyInfo, 1);
  prop->ref_count = 1;
  prop->name = g_strdup (property_name);

  if (!cockpit_json_get_string (property, "flags", NULL, &flags))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"flags\" field in dbus property: %s", property_name);
      goto out;
    }

  if (flags && strchr (flags, 'r'))
    prop->flags |= G_DBUS_PROPERTY_INFO_FLAGS_READABLE;
  if (flags && strchr (flags, 'w'))
    prop->flags |= G_DBUS_PROPERTY_INFO_FLAGS_WRITABLE;

  if (!cockpit_json_get_string (property, "type", NULL, &type))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"type\" field in dbus property: %s", property_name);
      goto out;
    }
  else if (!type)
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "missing \"type\" field in dbus property: %s", property_name);
      goto out;
    }
  else if (!g_variant_is_signature (type))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "the \"type\" field in dbus property is not a dbus signature: %s", type);
      goto out;
    }

  prop->signature = g_strdup (type);

  ret = prop;
  prop = NULL;

out:
  if (prop)
    g_dbus_property_info_unref (prop);
  return ret;
}

GDBusInterfaceInfo *
cockpit_dbus_meta_parse (const gchar *iface_name,
                         JsonObject *interface,
                         GError **error)
{
  GDBusInterfaceInfo *ret = NULL;
  GDBusInterfaceInfo *iface;
  GDBusMethodInfo *meth;
  GDBusSignalInfo *sig;
  GDBusPropertyInfo *prop;
  JsonObject *methods;
  JsonObject *method;
  JsonObject *signals;
  JsonObject *signal;
  JsonObject *properties;
  JsonObject *property;
  GPtrArray *array = NULL;
  GList *names = NULL, *l;

  g_return_val_if_fail (iface_name != NULL, NULL);
  g_return_val_if_fail (interface != NULL, NULL);
  g_return_val_if_fail (!error || !*error, NULL);

  iface = g_new0 (GDBusInterfaceInfo, 1);
  iface->name = g_strdup (iface_name);
  iface->ref_count = 1;

  if (!cockpit_json_get_object (interface, "methods", NULL, &methods))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"methods\" field in dbus meta structure");
      goto out;
    }

  if (methods)
    {
      array = g_ptr_array_new ();
      g_ptr_array_set_free_func (array, (GDestroyNotify)g_dbus_method_info_unref);

      names = json_object_get_members (methods);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          if (!cockpit_json_get_object (methods, l->data, NULL, &method))
            {
              g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                           "invalid method field in dbus meta structure: %s",
                           (const gchar *)l->data);
              goto out;
            }

          g_assert (method != NULL);
          meth = parse_meta_method (l->data, method, error);
          if (!meth)
            goto out;

          g_ptr_array_add (array, meth);
        }

      g_list_free (names);
      names = NULL;

      g_ptr_array_add (array, NULL);
      iface->methods = (GDBusMethodInfo **)g_ptr_array_free (array, FALSE);
      array = NULL;
    }

  if (!cockpit_json_get_object (interface, "signals", NULL, &signals))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"signals\" field in dbus meta structure");
      goto out;
    }

  if (signals)
    {
      array = g_ptr_array_new ();
      g_ptr_array_set_free_func (array, (GDestroyNotify)g_dbus_signal_info_unref);

      names = json_object_get_members (signals);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          if (!cockpit_json_get_object (signals, l->data, NULL, &signal))
            {
              g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                           "invalid signal field in dbus meta structure: %s",
                           (const gchar *)l->data);
              goto out;
            }

          g_assert (signal != NULL);
          sig = parse_meta_signal (l->data, signal, error);
          if (!sig)
            goto out;

          g_ptr_array_add (array, sig);
        }

      g_list_free (names);
      names = NULL;

      g_ptr_array_add (array, NULL);
      iface->signals = (GDBusSignalInfo **)g_ptr_array_free (array, FALSE);
      array = NULL;
    }

  if (!cockpit_json_get_object (interface, "properties", NULL, &properties))
    {
      g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                   "invalid \"properties\" field in dbus meta structure");
      goto out;
    }

  if (properties)
    {
      array = g_ptr_array_new ();
      g_ptr_array_set_free_func (array, (GDestroyNotify)g_dbus_property_info_unref);

      names = json_object_get_members (properties);
      for (l = names; l != NULL; l = g_list_next (l))
        {
          if (!cockpit_json_get_object (properties, l->data, NULL, &property))
            {
              g_set_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                           "invalid property field in dbus meta structure: %s",
                           (const gchar *)l->data);
              goto out;
            }

          g_assert (property != NULL);
          prop = parse_meta_property (l->data, property, error);
          if (!prop)
            goto out;

          g_ptr_array_add (array, prop);
        }

      g_list_free (names);
      names = NULL;

      g_ptr_array_add (array, NULL);
      iface->properties = (GDBusPropertyInfo **)g_ptr_array_free (array, FALSE);
      array = NULL;
    }

  ret = iface;
  iface = NULL;

out:
  if (iface)
    g_dbus_interface_info_unref (iface);
  if (array)
    g_ptr_array_free (array, TRUE);
  if (names)
    g_list_free (names);
  return ret;
}
