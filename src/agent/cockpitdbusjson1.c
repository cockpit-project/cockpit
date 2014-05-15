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

#include "cockpitdbusjson1.h"

#include "cockpitchannel.h"
#include "cockpitfakemanager.h"

#include "cockpit/cockpitjson.h"

#include <unistd.h>
#include <stdint.h>
#include <stdio.h>
#include <pwd.h>

#include <gio/gio.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>
#include <json-glib/json-glib.h>

#include <gsystem-local-alloc.h>

#include <string.h>

/**
 * CockpitDBusJson1:
 *
 * TODO: Outdated old dbus-json1 protocol.
 *
 * A #CockpitChannel that sends DBus messages with the dbus-json1 payload
 * type.
 */

#define COCKPIT_DBUS_JSON1(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_DBUS_JSON1, CockpitDBusJson1))

typedef struct {
  CockpitChannel parent;
  GDBusObjectManager       *object_manager;
  GCancellable             *cancellable;
  GList                    *active_calls;
  GHashTable               *introspect_cache;
} CockpitDBusJson1;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitDBusJson1Class;


G_DEFINE_TYPE (CockpitDBusJson1, cockpit_dbus_json1, COCKPIT_TYPE_CHANNEL);

/* Returns a new floating variant (essentially a fixed-up copy of @value) */
static GVariant *
_my_replace (GVariant *value)
{
  GVariant *ret;
  const gchar *dbus_type;

  if (g_variant_is_of_type (value, G_VARIANT_TYPE_VARDICT) &&
      g_variant_lookup (value, "_dbus_type", "&s", &dbus_type))
    {
      GVariant *passed_value;
      passed_value = g_variant_lookup_value (value, "value", NULL);
      if (passed_value != NULL)
        {
          JsonNode *serialized;
          GError *error;

          serialized = json_gvariant_serialize (passed_value);
          error = NULL;
          ret = json_gvariant_deserialize (serialized,
                                           dbus_type,
                                           &error);
          json_node_free (serialized);
          if (ret == NULL)
            {
              /*
               * HACK: Work around bug in JSON-glib, see:
               * https://bugzilla.gnome.org/show_bug.cgi?id=724319
               */
              if (error->domain == G_IO_ERROR && error->code == G_IO_ERROR_INVALID_DATA &&
                  g_variant_is_of_type (passed_value, G_VARIANT_TYPE_INT64) &&
                  g_strcmp0 (dbus_type, "d") == 0)
                {
                  ret = g_variant_new_double (g_variant_get_int64 (passed_value));
                  g_clear_error (&error);
                }
              else
                {
                  g_warning ("Error converting JSON to requested type %s: %s (%s, %d)",
                             dbus_type,
                             error->message, g_quark_to_string (error->domain), error->code);
                  g_error_free (error);
                  ret = g_variant_ref (value);
                }
            }
        }
      else
        {
          g_warning ("Malformed _dbus_type vardict");
          ret = g_variant_ref (value);
        }
    }
  else if (g_variant_is_container (value))
    {
      GVariantBuilder builder;
      GVariantIter iter;
      GVariant *child;

      g_variant_builder_init (&builder, g_variant_get_type (value));

      g_variant_iter_init (&iter, value);
      while ((child = g_variant_iter_next_value (&iter)) != NULL)
        {
          g_variant_builder_add_value (&builder, _my_replace (child));
          g_variant_unref (child);
        }
      ret = g_variant_builder_end (&builder);
    }
  else
    {
      ret = g_variant_ref (value);
    }
  return ret;
}

static JsonBuilder *
_json_builder_add_gvariant (JsonBuilder *builder,
                            GVariant *value)
{
  g_return_val_if_fail (JSON_IS_BUILDER (builder), builder);

  g_variant_ref_sink (value);

  switch (g_variant_classify (value))
    {
    case G_VARIANT_CLASS_BOOLEAN:
      json_builder_add_boolean_value (builder, g_variant_get_boolean (value));
      break;

    case G_VARIANT_CLASS_BYTE:
      json_builder_add_int_value (builder, g_variant_get_byte (value));
      break;

    case G_VARIANT_CLASS_INT16:
      json_builder_add_int_value (builder, g_variant_get_int16 (value));
      break;

    case G_VARIANT_CLASS_UINT16:
      json_builder_add_int_value (builder, g_variant_get_uint16 (value));
      break;

    case G_VARIANT_CLASS_INT32:
      json_builder_add_int_value (builder, g_variant_get_int32 (value));
      break;

    case G_VARIANT_CLASS_UINT32:
      json_builder_add_int_value (builder, g_variant_get_uint32 (value));
      break;

    case G_VARIANT_CLASS_INT64:
      json_builder_add_int_value (builder, g_variant_get_int64 (value));
      break;

    case G_VARIANT_CLASS_UINT64:
      json_builder_add_int_value (builder, g_variant_get_uint64 (value));
      break;

    case G_VARIANT_CLASS_HANDLE:
      json_builder_add_int_value (builder, g_variant_get_handle (value));
      break;

    case G_VARIANT_CLASS_DOUBLE:
      json_builder_add_double_value (builder, g_variant_get_double (value));
      break;

    case G_VARIANT_CLASS_STRING:      /* explicit fall-through */
    case G_VARIANT_CLASS_OBJECT_PATH: /* explicit fall-through */
    case G_VARIANT_CLASS_SIGNATURE:
      json_builder_add_string_value (builder, g_variant_get_string (value, NULL));
      break;

     /* TODO: */
    case G_VARIANT_CLASS_VARIANT:
      {
        GVariant *child;
        child = g_variant_get_variant (value);
        _json_builder_add_gvariant (builder, child);
        g_variant_unref (child);
      }
      break;

    case G_VARIANT_CLASS_MAYBE:
      g_assert_not_reached ();
      break;

    case G_VARIANT_CLASS_ARRAY:
      {
        const GVariantType *type;
        const GVariantType *element_type;

        type = g_variant_get_type (value);
        element_type = g_variant_type_element (type);
        if (g_variant_type_is_dict_entry (element_type))
          {
            GVariantIter iter;
            GVariant *child;

            json_builder_begin_object (builder);

            g_variant_iter_init (&iter, value);
            while ((child = g_variant_iter_next_value (&iter)) != NULL)
              {
                _json_builder_add_gvariant (builder, child);
                g_variant_unref (child);
              }

            json_builder_end_object (builder);
          }
        else
          {
            GVariantIter iter;
            GVariant *child;

            json_builder_begin_array (builder);

            g_variant_iter_init (&iter, value);
            while ((child = g_variant_iter_next_value (&iter)) != NULL)
              {
                _json_builder_add_gvariant (builder, child);
                g_variant_unref (child);
              }

            json_builder_end_array (builder);
          }
      }
      break;

    case G_VARIANT_CLASS_TUPLE:
      {
        GVariantIter iter;
        GVariant *child;

        json_builder_begin_array (builder);

        g_variant_iter_init (&iter, value);
        while ((child = g_variant_iter_next_value (&iter)) != NULL)
          {
            _json_builder_add_gvariant (builder, child);
            g_variant_unref (child);
          }

        json_builder_end_array (builder);
      }
      break;

    case G_VARIANT_CLASS_DICT_ENTRY:
      {
        GVariant *dict_key;
        GVariant *dict_value;
        gchar *dict_key_string;

        dict_key = g_variant_get_child_value (value, 0);
        dict_value = g_variant_get_child_value (value, 1);

        if (g_variant_is_of_type (dict_key, G_VARIANT_TYPE("s")))
          dict_key_string = g_variant_dup_string (dict_key, NULL);
        else
          dict_key_string = g_variant_print (dict_key, FALSE);

        json_builder_set_member_name (builder, dict_key_string);
        _json_builder_add_gvariant (builder, dict_value);
        g_free (dict_key_string);

        g_variant_unref (dict_key);
        g_variant_unref (dict_value);
      }
      break;
    }

  g_variant_unref (value);

  return builder;
}

static GBytes *
_json_builder_to_bytes (CockpitDBusJson1 *self,
                        JsonBuilder *builder)
{
  JsonNode *root;
  gsize length;
  gchar *ret;

  root = json_builder_get_root (builder);
  ret = cockpit_json_write (root, &length);
  json_node_free (root);

  return g_bytes_new_take (ret, length);
}

static JsonBuilder *
prepare_builder (const gchar *command)
{
  JsonBuilder *builder;
  builder = json_builder_new ();
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, command);
  json_builder_set_member_name (builder, "data");
  return builder;
}

static void
write_builder (CockpitDBusJson1 *self,
               JsonBuilder *builder)
{
  GBytes *bytes;

  json_builder_end_object (builder);
  bytes = _json_builder_to_bytes (self, builder);
  cockpit_channel_send (COCKPIT_CHANNEL (self), bytes);
  g_bytes_unref (bytes);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
add_interface (JsonBuilder *builder,
               GDBusInterface *interface,
               GVariant *changed_properties)
{
  gchar *s;

  json_builder_set_member_name (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_begin_object (builder);

  if (changed_properties == NULL)
    {
      gchar **properties;
      guint n;

      properties = g_dbus_proxy_get_cached_property_names (G_DBUS_PROXY (interface));
      for (n = 0; properties != NULL && properties[n] != NULL; n++)
        {
          const gchar *property_name = properties[n];
          GVariant *value;
          value = g_dbus_proxy_get_cached_property (G_DBUS_PROXY (interface), property_name);
          if (value != NULL)
            {
              s = g_strconcat ("dbus_prop_", property_name, NULL);
              json_builder_set_member_name (builder, s);
              g_free (s);
              _json_builder_add_gvariant (builder, value);
              g_variant_unref (value);
            }
        }
      g_strfreev (properties);

      if (properties == NULL)
        {
          json_builder_set_member_name (builder, "HackEmpty");
          json_builder_add_string_value (builder, "HackEmpty");
        }
    }
  else
    {
      GVariantIter iter;
      const gchar *property_name;
      GVariant *value;
      g_variant_iter_init (&iter, changed_properties);
      while (g_variant_iter_next (&iter, "{&sv}", &property_name, &value))
        {
          s = g_strconcat ("dbus_prop_", property_name, NULL);
          json_builder_set_member_name (builder, property_name);
          g_free (s);
          _json_builder_add_gvariant (builder, value);
          g_variant_unref (value);
        }
    }

  json_builder_end_object (builder);
}

static void
add_object (JsonBuilder *builder,
            GDBusObject *object)
{
  GList *interfaces;
  GList *l;

  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object)));

  json_builder_set_member_name (builder, "ifaces");
  json_builder_begin_object (builder);

  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = l->next)
    {
      GDBusInterface *interface = G_DBUS_INTERFACE (l->data);
      add_interface (builder, interface, NULL);
    }
  g_list_foreach (interfaces, (GFunc)g_object_unref, NULL);
  g_list_free (interfaces);

  json_builder_end_object (builder);
}

static void
send_seed (CockpitDBusJson1 *self)
{
  gs_unref_object JsonBuilder *builder = json_builder_new ();

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "command");
  json_builder_add_string_value (builder, "seed");

  json_builder_set_member_name (builder, "options");
  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "byteorder");
  if (G_BYTE_ORDER == G_LITTLE_ENDIAN)
    json_builder_add_string_value (builder, "le");
  else if (G_BYTE_ORDER == G_BIG_ENDIAN)
    json_builder_add_string_value (builder, "be");
  else
    json_builder_add_string_value (builder, "");
  json_builder_end_object (builder);

  json_builder_set_member_name (builder, "data");
  json_builder_begin_object (builder);

  GList *objects = g_dbus_object_manager_get_objects (self->object_manager);
  for (GList *l = objects; l != NULL; l = l->next)
    {
      GDBusObject *object = G_DBUS_OBJECT (l->data);
      json_builder_set_member_name (builder, g_dbus_object_get_object_path (object));
      json_builder_begin_object (builder);
      add_object (builder, object);
      json_builder_end_object (builder);
    }
  g_list_foreach (objects, (GFunc)g_object_unref, NULL);
  g_list_free (objects);
  json_builder_end_object (builder);

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_object_added (GDBusObjectManager *manager,
                 GDBusObject *object,
                 gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-added");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "object");
  json_builder_begin_object (builder);
  add_object (builder, object);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_object_removed (GDBusObjectManager *manager,
                   GDBusObject *object,
                   gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("object-removed");

  json_builder_begin_array (builder);
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_end_array (builder);

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
on_interface_added (GDBusObjectManager *manager,
                    GDBusObject *object,
                    GDBusInterface *interface,
                    gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-added");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_set_member_name (builder, "iface");
  json_builder_begin_object (builder);
  add_interface (builder, interface, NULL);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_interface_removed (GDBusObjectManager *manager,
                      GDBusObject *object,
                      GDBusInterface *interface,
                      gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-removed");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (object));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (G_DBUS_PROXY (interface)));
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_interface_proxy_properties_changed (GDBusObjectManager *manager,
                                       GDBusObjectProxy *object_proxy,
                                       GDBusProxy *interface_proxy,
                                       GVariant *changed_properties,
                                       const gchar * const *invalidated_properties,
                                       gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-properties-changed");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (interface_proxy));
  /* It's a bit of a waste to send all properties - would be cheaper to just
   * send @changed_properties and @invalidated_properties. But this is simpler.
   */
  json_builder_set_member_name (builder, "iface");
  json_builder_begin_object (builder);
  add_interface (builder, G_DBUS_INTERFACE (interface_proxy), changed_properties);
  json_builder_end_object (builder);
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static void
on_interface_proxy_signal (GDBusObjectManager *manager,
                           GDBusObjectProxy *object_proxy,
                           GDBusProxy *interface_proxy,
                           gchar *sender_name,
                           gchar *signal_name,
                           GVariant *parameters,
                           gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  gs_unref_object JsonBuilder *builder = prepare_builder ("interface-signal");

  GVariantIter iter;
  GVariant *child;

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "objpath");
  json_builder_add_string_value (builder, g_dbus_object_get_object_path (G_DBUS_OBJECT (object_proxy)));
  json_builder_set_member_name (builder, "iface_name");
  json_builder_add_string_value (builder, g_dbus_proxy_get_interface_name (interface_proxy));
  json_builder_set_member_name (builder, "signal_name");
  json_builder_add_string_value (builder, signal_name);

  json_builder_set_member_name (builder, "args");
  json_builder_begin_array (builder);
  g_variant_iter_init (&iter, parameters);
  while ((child = g_variant_iter_next_value (&iter)) != NULL)
    {
      _json_builder_add_gvariant (builder, child);
      g_variant_unref (child);
    }
  json_builder_end_array (builder);

  json_builder_end_object (builder);

  write_builder (self, builder);
}

/* ---------------------------------------------------------------------------------------------------- */

static void
send_dbus_reply (CockpitDBusJson1 *self, const gchar *cookie, GVariant *result, GError *error)
{
  gs_unref_object JsonBuilder *builder = NULL;
  builder = prepare_builder ("call-reply");

  json_builder_begin_object (builder);
  json_builder_set_member_name (builder, "cookie");
  json_builder_add_string_value (builder, cookie);

  if (result == NULL)
    {
      gchar *error_name;
      error_name = g_dbus_error_get_remote_error (error);
      g_dbus_error_strip_remote_error (error);

      json_builder_set_member_name (builder, "error_name");
      json_builder_add_string_value (builder, error_name != NULL ? error_name : "");

      json_builder_set_member_name (builder, "error_message");
      json_builder_add_string_value (builder, error->message);

      g_free (error_name);
    }
  else
    {
      json_builder_set_member_name (builder, "result");
      _json_builder_add_gvariant (builder, result);
    }
  json_builder_end_object (builder);

  write_builder (self, builder);
}

static GVariantType *
compute_complete_signature (GDBusArgInfo **args)
{
  const GVariantType *arg_types[256];
  guint n;

  if (args)
    {
      for (n = 0; args[n] != NULL; n++)
        {
          /* DBus places a hard limit of 255 on signature length.
           * therefore number of args must be less than 256.
           */
          if (n >= G_N_ELEMENTS (arg_types))
            return NULL;

          arg_types[n] = G_VARIANT_TYPE (args[n]->signature);

          if G_UNLIKELY (arg_types[n] == NULL)
            return NULL;
        }
    }
  else
    {
      n = 0;
    }
  return g_variant_type_new_tuple (arg_types, n);
}

typedef struct
{
  /* Cleared by dispose */
  GList *link;
  CockpitDBusJson1 *dbus_json;

  /* Request data */
  GDBusConnection *connection;
  JsonObject *request;

  /* Owned by proxy or cache */
  GDBusInterfaceInfo *iface_info;

  /* Owned by request */
  const gchar *cookie;
  const gchar *iface_name;
  const gchar *method_name;
  const gchar *objpath;
  JsonArray *args;
} CallData;

static void
call_data_free (CallData *data)
{
  if (data->dbus_json)
    data->dbus_json->active_calls = g_list_delete_link (data->dbus_json->active_calls, data->link);

  g_object_unref (data->connection);
  json_object_unref (data->request);
  g_free (data);
}

static void
dbus_call_cb (GDBusConnection *connection,
              GAsyncResult *res,
              gpointer user_data)
{
  CallData *data = user_data;
  GVariant *result;
  GError *error;

  error = NULL;
  result = g_dbus_connection_call_finish (connection, res, &error);

  if (data->dbus_json)
    send_dbus_reply (data->dbus_json, data->cookie, result, error);

  if (result)
    g_variant_unref (result);
  g_clear_error (&error);
  call_data_free (data);
}


static void
handle_dbus_call_on_interface (CockpitDBusJson1 *self,
                               CallData *call_data)
{
  GDBusMethodInfo *method_info = NULL;
  GVariantBuilder arg_builder;
  GVariantType *reply_type;
  guint n;
  GError *error = NULL;
  gchar *owner;

  if (call_data->iface_info)
    method_info = g_dbus_interface_info_lookup_method (call_data->iface_info, call_data->method_name);
  if (method_info == NULL)
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "Introspection data for method %s on D-Bus interface %s not in cache",
                   call_data->iface_name, call_data->method_name);
      goto out;
    }

  g_variant_builder_init (&arg_builder, G_VARIANT_TYPE_TUPLE);
  for (n = 0; n < json_array_get_length (call_data->args); n++)
    {
      GVariant *arg_gvariant;
      JsonNode *arg_node;
      GDBusArgInfo *arg_info;
      GVariant *old;

      arg_node = json_array_get_element (call_data->args, n);

      arg_info = method_info->in_args != NULL ? method_info->in_args[n] : NULL;
      if (arg_info == NULL)
        {
          g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED, "No GDBusArgInfo for arg %d", n);
          g_variant_builder_clear (&arg_builder);
          goto out;
        }

      arg_gvariant = json_gvariant_deserialize (arg_node,
                                                arg_info->signature,
                                                &error);
      if (arg_gvariant == NULL)
        {
          /*
           * HACK: Work around bug in JSON-glib, see:
           * https://bugzilla.gnome.org/show_bug.cgi?id=724319
           */
          if (error &&
              g_error_matches (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA) &&
              json_node_get_node_type (arg_node) == JSON_NODE_VALUE &&
              g_strcmp0 (arg_info->signature, "d") == 0)
            {
              arg_gvariant = g_variant_new_double (json_node_get_int (arg_node));
              g_clear_error (&error);
            }
          else
            {
              g_assert (error);
              g_prefix_error (&error,
                              "Error converting arg %d to GVariant of type %s for method %s on interface %s: ",
                              n,
                              arg_info->signature,
                              call_data->method_name,
                              call_data->iface_name);
              g_variant_builder_clear (&arg_builder);
              goto out;
            }
        }
      /* replace DBusValue(type, value) entries */
      old = arg_gvariant;
      arg_gvariant = _my_replace (arg_gvariant);
      g_variant_unref (old);
      g_variant_builder_add_value (&arg_builder, arg_gvariant);
    }

  g_debug ("invoking %s %s.%s", call_data->objpath, call_data->iface_name, call_data->method_name);

  g_object_get (self->object_manager,
                "name-owner", &owner,
                NULL);

  reply_type = compute_complete_signature (method_info->out_args);

  /* and now, issue the call */
  g_dbus_connection_call (call_data->connection, owner, call_data->objpath,
                          call_data->iface_name, call_data->method_name,
                          g_variant_builder_end (&arg_builder),
                          reply_type,
                          G_DBUS_CALL_FLAGS_NO_AUTO_START,
                          G_MAXINT, /* timeout */
                          self->cancellable,
                          (GAsyncReadyCallback)dbus_call_cb,
                          call_data); /* user_data*/

  g_variant_type_free (reply_type);

  g_free (owner);

out:
  if (error)
    {
      send_dbus_reply (self, call_data->cookie, NULL, error);
      g_error_free (error);
      call_data_free (call_data);
    }
}

static void
on_introspect_ready (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  CallData *call_data = (CallData *)user_data;
  CockpitDBusJson1 *self;
  GVariant *val = NULL;
  GDBusNodeInfo *node = NULL;
  GDBusInterfaceInfo *iface = NULL;
  const gchar *xml = NULL;
  GError *error = NULL;
  gboolean not_found;
  gboolean expected;
  gchar *remote;
  gint i;

  /* Cancelled? */
  if (!call_data->dbus_json)
    {
      call_data_free (call_data);
      return;
    }

  not_found = FALSE;

  self = COCKPIT_DBUS_JSON1 (call_data->dbus_json);
  val = g_dbus_connection_call_finish (G_DBUS_CONNECTION (source), result, &error);
  if (error)
    {
      /*
       * Note that many DBus implementations don't return errors when
       * an unknown object path is introspected. They just return empty
       * introspect data. GDBus is one of these.
       */

      expected = FALSE;
      remote = g_dbus_error_get_remote_error (error);
      if (remote)
        {
          /*
           * DBus used to only have the UnknownMethod error. It didn't have
           * specific errors for UnknownObject and UnknownInterface. So we're
           * pretty liberal on what we treat as an expected error here.
           *
           * HACK: GDBus also doesn't understand the newer error codes :S
           *
           * https://bugzilla.gnome.org/show_bug.cgi?id=727900
           */
          expected = (g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownMethod") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownObject") ||
                      g_str_equal (remote, "org.freedesktop.DBus.Error.UnknownInterface"));
          not_found = TRUE;
          g_free (remote);
        }

      if (expected)
        {
          g_debug ("no introspect data found for object %s", call_data->objpath);
        }
      else
        {
          g_message ("Couldn't look up introspection for object %s: %s",
                     call_data->objpath, error->message);
        }
      g_clear_error (&error);
    }

  if (val)
    {
      g_debug ("got introspect data for %s", call_data->objpath);

      g_variant_get (val, "(&s)", &xml);
      node = g_dbus_node_info_new_for_xml (xml, &error);
      if (error)
        {
          g_message ("Invalid DBus introspect data received for object %s: %s",
                     call_data->objpath, error->message);
          g_clear_error (&error);
        }
      else if (node)
        {
          not_found = TRUE;
          for (i = 0; node->interfaces && node->interfaces[i] != NULL; i++)
            {
              iface = node->interfaces[i];
              if (iface->name)
                {
                  g_hash_table_replace (self->introspect_cache, iface->name,
                                        g_dbus_interface_info_ref (iface));
                  if (g_str_equal (iface->name, call_data->iface_name))
                    not_found = FALSE;
                }
            }
          g_dbus_node_info_unref (node);
        }
      g_variant_unref (val);
    }

  /*
   * If we got introspect data *but* the service didn't know about the object, then
   * we know there's no such object. We cannot simply perform the call and have the
   * service reply with the real error message. We have no way to make the call with
   * the right arguments.
   *
   * So return an intelligent error message here.
   */
  if (not_found)
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED,
                   "No iface for objpath %s and iface %s calling %s",
                   call_data->objpath, call_data->iface_name, call_data->method_name);
      send_dbus_reply (self, call_data->cookie, NULL, error);
      g_error_free (error);
      call_data_free (call_data);
      return;
    }

  call_data->iface_info = g_hash_table_lookup (self->introspect_cache, call_data->iface_name);
  handle_dbus_call_on_interface (self, call_data);
}

static gboolean
handle_dbus_call (CockpitDBusJson1 *self,
                  JsonObject *root)
{
  GDBusInterface *iface_proxy;
  gchar *owner = NULL;
  CallData *call_data;

  call_data = g_new0 (CallData, 1);
  call_data->objpath = json_object_get_string_member (root, "objpath");
  call_data->iface_name = json_object_get_string_member (root, "iface");
  call_data->method_name = json_object_get_string_member (root, "method");
  call_data->cookie = json_object_get_string_member (root, "cookie");
  call_data->args = json_object_get_array_member (root, "args");

  if (!(g_variant_is_object_path (call_data->objpath) &&
        g_dbus_is_interface_name (call_data->iface_name) &&
        g_dbus_is_member_name (call_data->method_name) &&
        call_data->cookie != NULL &&
        call_data->args != NULL))
    {
      g_warning ("Invalid data in call message");
      g_free (call_data);
      return FALSE;
    }

  call_data->dbus_json = self;
  call_data->request = json_object_ref (root);
  self->active_calls = g_list_prepend (self->active_calls, call_data);
  call_data->link = g_list_find (self->active_calls, call_data);
  g_object_get (self->object_manager, "connection", &call_data->connection, NULL);

  call_data->iface_info = g_hash_table_lookup (self->introspect_cache,
                                               call_data->iface_name);
  if (call_data->iface_info)
    {
      g_debug ("found introspect data for %s in cache", call_data->iface_name);
    }
  else
    {
      iface_proxy = g_dbus_object_manager_get_interface (self->object_manager,
                                                         call_data->objpath,
                                                         call_data->iface_name);
      if (iface_proxy)
        {
          call_data->iface_info = g_dbus_interface_get_info (iface_proxy);
          g_object_unref (iface_proxy);
        }
    }

  if (call_data->iface_info != NULL)
    {
      /* Frees call data when done */
      handle_dbus_call_on_interface (self, call_data);
    }
  else
    {
      g_debug ("no introspect data for %s %s", call_data->objpath, call_data->iface_name);

      g_object_get (self->object_manager,
                    "name-owner", &owner,
                    NULL);

      g_dbus_connection_call (call_data->connection, owner, call_data->objpath,
                              "org.freedesktop.DBus.Introspectable", "Introspect",
                              NULL, G_VARIANT_TYPE ("(s)"),
                              G_DBUS_CALL_FLAGS_NO_AUTO_START,
                              -1, /* timeout */
                              NULL, /* GCancellable */
                              on_introspect_ready, call_data);

      g_free (owner);
    }

  return TRUE;
}

static void
cockpit_dbus_json1_recv (CockpitChannel *channel,
                          GBytes *message)
{
  CockpitDBusJson1 *self = COCKPIT_DBUS_JSON1 (channel);
  GError *error = NULL;
  gs_free gchar *buf = NULL;
  JsonObject *root = NULL;

  root = cockpit_json_parse_bytes (message, &error);
  if (!root)
    {
      g_prefix_error (&error, "Error parsing `%s' as JSON: ", buf);
      goto close;
    }

  if (g_strcmp0 (json_object_get_string_member (root, "command"), "call") == 0)
    {
      if (!handle_dbus_call (self, root))
        goto close;
    }
  else
    {
      g_set_error (&error, G_IO_ERROR, G_IO_ERROR_FAILED, "Unknown command in JSON");
      goto close;
    }

  return;

close:
  if (root)
    json_object_unref (root);
  if (error)
    {
      g_warning ("%s", error->message);
      g_error_free (error);
    }
  cockpit_channel_close (channel, "protocol-error");
}

static void
on_object_manager_ready (GObject *source,
                         GAsyncResult *result,
                         gpointer user_data)
{
  CockpitDBusJson1 *self = user_data;
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  GAsyncInitable *initable;
  GError *error = NULL;

  initable = G_ASYNC_INITABLE (source);
  self->object_manager = G_DBUS_OBJECT_MANAGER (g_async_initable_new_finish (initable, result, &error));

  if (self->object_manager == NULL)
    {
      g_warning ("%s", error->message);
      cockpit_channel_close (channel, "internal-error");
    }
  else
    {
      g_signal_connect (self->object_manager,
                        "object-added",
                        G_CALLBACK (on_object_added),
                        self);
      g_signal_connect (self->object_manager,
                        "object-removed",
                        G_CALLBACK (on_object_removed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-added",
                        G_CALLBACK (on_interface_added),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-removed",
                        G_CALLBACK (on_interface_removed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-proxy-properties-changed",
                        G_CALLBACK (on_interface_proxy_properties_changed),
                        self);
      g_signal_connect (self->object_manager,
                        "interface-proxy-signal",
                        G_CALLBACK (on_interface_proxy_signal),
                        self);

      send_seed (self);
      cockpit_channel_ready (channel);
    }

  g_object_unref (self);
}

static void
cockpit_dbus_json1_init (CockpitDBusJson1 *self)
{
  self->cancellable = g_cancellable_new ();
  self->introspect_cache = g_hash_table_new_full (g_str_hash, g_str_equal, NULL,
                                                  (GDestroyNotify)g_dbus_interface_info_unref);
}

static gboolean
on_idle_protocol_error (gpointer user_data)
{
  cockpit_channel_close (user_data, "protocol-error");
  return FALSE;
}

static void
cockpit_dbus_json1_constructed (GObject *object)
{
  CockpitDBusJson1 *self = COCKPIT_DBUS_JSON1 (object);
  CockpitChannel *channel = COCKPIT_CHANNEL (self);
  const gchar *dbus_service;
  const gchar *dbus_path;
  const gchar *new_prop_name;
  GType object_manager_type;
  gconstpointer new_prop_value;

  G_OBJECT_CLASS (cockpit_dbus_json1_parent_class)->constructed (object);

  /*
   * Guarantee: Remember that we cannot close the channel until we've
   * hit the main loop. This is to make it easier and predictable on
   * callers. See teh similar GLib async guarantee.
   */

  dbus_service = cockpit_channel_get_option (channel, "service");
  if (dbus_service == NULL || !g_dbus_is_name (dbus_service))
    {
      g_warning ("agent got invalid dbus service");
      g_idle_add (on_idle_protocol_error, channel);
      return;
    }

  dbus_path = cockpit_channel_get_option (channel, "object-manager");
  if (dbus_path == NULL)
    {
      new_prop_value = cockpit_channel_get_strv_option (channel, "paths");
      new_prop_name = "object-paths";
      object_manager_type = COCKPIT_TYPE_FAKE_MANAGER;
    }
  else if (!g_variant_is_object_path (dbus_path))
    {
      g_warning ("agent got invalid object-manager path");
      g_idle_add (on_idle_protocol_error, channel);
      return;
    }
  else
    {
      new_prop_value = dbus_path;
      new_prop_name = "object-path";
      object_manager_type = G_TYPE_DBUS_OBJECT_MANAGER_CLIENT;
    }

  /* Both GDBusObjectManager and CockpitFakeManager have similar props */
  g_async_initable_new_async (object_manager_type,
                              G_PRIORITY_DEFAULT, NULL,
                              on_object_manager_ready,
                              g_object_ref (self),
                              "bus-type", G_BUS_TYPE_SYSTEM,
                              "flags", G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_NONE,
                              "name", dbus_service,
                              new_prop_name, new_prop_value,
                              NULL);
}

static void
cockpit_dbus_json1_dispose (GObject *object)
{
  CockpitDBusJson1 *self = COCKPIT_DBUS_JSON1 (object);
  GList *l;

  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_object_added),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_object_removed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_added),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_removed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_proxy_properties_changed),
                                        self);
  g_signal_handlers_disconnect_by_func (self->object_manager,
                                        G_CALLBACK (on_interface_proxy_signal),
                                        self);

  /* Divorce ourselves the outstanding calls */
  for (l = self->active_calls; l != NULL; l = g_list_next (l))
    ((CallData *)l->data)->dbus_json = NULL;
  g_list_free (self->active_calls);
  self->active_calls = NULL;

  /* And cancel them all, which should free them */
  g_cancellable_cancel (self->cancellable);

  G_OBJECT_CLASS (cockpit_dbus_json1_parent_class)->dispose (object);
}

static void
cockpit_dbus_json1_finalize (GObject *object)
{
  CockpitDBusJson1 *self = COCKPIT_DBUS_JSON1 (object);

  if (self->object_manager)
    g_object_unref (self->object_manager);
  g_object_unref (self->cancellable);
  g_hash_table_destroy (self->introspect_cache);

  G_OBJECT_CLASS (cockpit_dbus_json1_parent_class)->finalize (object);
}

static void
cockpit_dbus_json1_class_init (CockpitDBusJson1Class *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_dbus_json1_constructed;
  gobject_class->dispose = cockpit_dbus_json1_dispose;
  gobject_class->finalize = cockpit_dbus_json1_finalize;

  channel_class->recv = cockpit_dbus_json1_recv;
}

/**
 * cockpit_dbus_json1_open:
 * @transport: transport to send messages on
 * @channel_id: the channel id
 * @dbus_service: the DBus service name to talk to
 * @dbus_path: the o.f.D.ObjectManager path
 *
 * This function is mainly used by tests. The normal way to open
 * channels is cockpit_channel_open().
 *
 * Guarantee: channel will not close immediately, even on invalid input.
 *
 * Returns: (transfer full): a new channel
 */
CockpitChannel *
cockpit_dbus_json1_open (CockpitTransport *transport,
                        const gchar *channel_id,
                        const gchar *dbus_service,
                        const gchar *dbus_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "service", dbus_service);
  json_object_set_string_member (options, "object-manager", dbus_path);
  json_object_set_string_member (options, "payload", "dbus-json1");

  channel = g_object_new (COCKPIT_TYPE_DBUS_JSON1,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
