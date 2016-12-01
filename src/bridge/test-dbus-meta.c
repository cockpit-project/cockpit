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
#include "common/cockpittest.h"

#include <string.h>

typedef struct {
  const GDBusInterfaceInfo *iface;
  const gchar *result;
} BuildFixture;

static const GDBusArgInfo janitor_method_say_what = {
    -1, (gchar *)"what", "s"
};

static const GDBusArgInfo janitor_method_say_how = {
    -1, (gchar *)"how", "i",
};

static const GDBusArgInfo *janitor_method_say_in[] = {
    &janitor_method_say_what,
    &janitor_method_say_how,
    NULL,
};

static const GDBusArgInfo janitor_method_say_said = {
    -1, (gchar *)"said", "a{sv}",
};

static const GDBusArgInfo *janitor_method_say_out[] = {
    &janitor_method_say_said,
    NULL,
};

static const GDBusMethodInfo janitor_method_say = {
    -1, (gchar *)"Say",
    (GDBusArgInfo **) &janitor_method_say_in,
    (GDBusArgInfo **) &janitor_method_say_out,
};

static const GDBusArgInfo janitor_method_mop_mess = {
    -1, (gchar *)"mess", "sa{sa{sv}}a{sv}a{sv}a{sv}a{sv}a{sv}a{sv}ssa{sv}a{sv}b"
};

static const GDBusArgInfo *janitor_method_mop_out[] = {
    &janitor_method_mop_mess,
    NULL,
};

static const GDBusMethodInfo janitor_method_mop = {
    -1, (gchar *)"Mop",
    (GDBusArgInfo **) NULL,
    (GDBusArgInfo **) &janitor_method_mop_out,
};

static const GDBusMethodInfo *janitor_methods[] = {
    &janitor_method_say,
    &janitor_method_mop,
    NULL
};

static const GDBusArgInfo janitor_signal_oh_oh = {
    -1, (gchar *)"oh", "v",
};

static const GDBusArgInfo janitor_signal_oh_marmalade = {
    -1, (gchar *)"marmalade", "v"
};

static const GDBusArgInfo *janitor_signal_oh_args[] = {
    &janitor_signal_oh_oh,
    &janitor_signal_oh_marmalade,
    NULL,
};

static const GDBusSignalInfo janitor_signal_oh = {
    -1, (gchar *)"Oh",
    (GDBusArgInfo **)&janitor_signal_oh_args
};

static const GDBusSignalInfo janitor_signal_boom = {
    -1, (gchar *)"Oh",
    (GDBusArgInfo **)&janitor_signal_oh_args
};

static const GDBusSignalInfo *janitor_signals[] = {
    &janitor_signal_oh,
    &janitor_signal_boom,
    NULL
};

static const GDBusPropertyInfo janitor_property_name = {
    -1, (gchar *)"Name", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE
};

static const GDBusPropertyInfo janitor_property_habit = {
    -1, (gchar *)"Habit", "a{sv}", G_DBUS_PROPERTY_INFO_FLAGS_READABLE | G_DBUS_PROPERTY_INFO_FLAGS_WRITABLE
};

static const GDBusPropertyInfo janitor_property_hidden = {
    -1, (gchar *)"Hidden", "b", G_DBUS_PROPERTY_INFO_FLAGS_WRITABLE
};

static const GDBusPropertyInfo *janitor_properties[] = {
    &janitor_property_name,
    &janitor_property_habit,
    &janitor_property_hidden,
    NULL
};

static const GDBusInterfaceInfo janitor_interface = {
    -1, "planet.express.Janitor",
    (GDBusMethodInfo **) &janitor_methods,
    (GDBusSignalInfo **) &janitor_signals,
    (GDBusPropertyInfo **) &janitor_properties,
    NULL
};

static const gchar janitor_json[] = "{"
  "\"methods\": {"
    "\"Say\": {"
      "\"in\": [\"s\",\"i\"],"
      "\"out\":[\"a{sv}\"]"
    "},"
    "\"Mop\": {"
      "\"out\":[\"sa{sa{sv}}a{sv}a{sv}a{sv}a{sv}a{sv}a{sv}ssa{sv}a{sv}b\"]"
    "}"
  "},"
  "\"properties\": {"
    "\"Name\": {"
      "\"flags\": \"r\","
      "\"type\": \"s\""
    "},"
    "\"Habit\": {"
      "\"flags\": \"rw\","
      "\"type\": \"a{sv}\""
    "},"
    "\"Hidden\": {"
      "\"flags\": \"w\","
      "\"type\": \"b\""
    "}"
  "},"
  "\"signals\": {"
    "\"Oh\": {"
      "\"in\": [\"v\",\"v\"]"
    "}"
  "}"
"}";

static const GDBusInterfaceInfo no_methods_interface = {
    -1, "planet.express.NoMethods",
    (GDBusMethodInfo **) NULL,
    (GDBusSignalInfo **) &janitor_signals,
    (GDBusPropertyInfo **) &janitor_properties,
    NULL
};

static const gchar no_methods_json[] = "{"
  "\"properties\": {"
    "\"Name\": {"
      "\"flags\": \"r\","
      "\"type\": \"s\""
    "},"
    "\"Habit\": {"
      "\"flags\": \"rw\","
      "\"type\": \"a{sv}\""
    "},"
    "\"Hidden\": {"
      "\"flags\": \"w\","
      "\"type\": \"b\""
    "}"
  "},"
  "\"signals\": {"
    "\"Oh\": {"
      "\"in\": [\"v\",\"v\"]"
    "}"
  "}"
"}";

static const GDBusInterfaceInfo no_signals_interface = {
    -1, "planet.express.NoSignals",
    (GDBusMethodInfo **) &janitor_methods,
    (GDBusSignalInfo **) NULL,
    (GDBusPropertyInfo **) &janitor_properties,
    NULL
};

static const gchar no_signals_json[] = "{"
  "\"methods\": {"
    "\"Say\": {"
      "\"in\": [\"s\",\"i\"],"
      "\"out\":[\"a{sv}\"]"
    "},"
    "\"Mop\": {"
      "\"out\":[\"sa{sa{sv}}a{sv}a{sv}a{sv}a{sv}a{sv}a{sv}ssa{sv}a{sv}b\"]"
    "}"
  "},"
  "\"properties\": {"
    "\"Name\": {"
      "\"flags\": \"r\","
      "\"type\": \"s\""
    "},"
    "\"Habit\": {"
      "\"flags\": \"rw\","
      "\"type\": \"a{sv}\""
    "},"
    "\"Hidden\": {"
      "\"flags\": \"w\","
      "\"type\": \"b\""
    "}"
  "}"
"}";

static const GDBusInterfaceInfo no_properties_interface = {
    -1, "planet.express.NoProperties",
    (GDBusMethodInfo **) &janitor_methods,
    (GDBusSignalInfo **) &janitor_signals,
    (GDBusPropertyInfo **) NULL,
    NULL
};

static const gchar no_properties_json[] = "{"
  "\"methods\": {"
    "\"Say\": {"
      "\"in\": [\"s\",\"i\"],"
      "\"out\":[\"a{sv}\"]"
    "},"
    "\"Mop\": {"
      "\"out\":[\"sa{sa{sv}}a{sv}a{sv}a{sv}a{sv}a{sv}a{sv}ssa{sv}a{sv}b\"]"
    "}"
  "},"
  "\"signals\": {"
    "\"Oh\": {"
      "\"in\": [\"v\",\"v\"]"
    "}"
  "}"
"}";

static const BuildFixture build_janitor_fixture = {
  &janitor_interface,
  janitor_json
};

static const BuildFixture build_no_methods_fixture = {
  &no_methods_interface,
  no_methods_json
};

static const BuildFixture build_no_signals_fixture = {
  &no_signals_interface,
  no_signals_json
};

static const BuildFixture build_no_properties_fixture = {
  &no_properties_interface,
  no_properties_json
};

static void
test_build (gconstpointer data)
{
  const BuildFixture *fixture = data;
  JsonObject *object;

  object = cockpit_dbus_meta_build ((GDBusInterfaceInfo *)fixture->iface);
  cockpit_assert_json_eq (object, fixture->result);
  json_object_unref (object);
}

static void
assert_equal_arg (GDBusArgInfo *one,
                  GDBusArgInfo *two)
{
  g_assert (one != NULL);
  g_assert (two != NULL);
  g_assert_cmpstr (one->signature, ==, two->signature);
}

static void
assert_equal_args (GDBusArgInfo **one,
                   GDBusArgInfo **two)
{
  if (one == NULL || two == NULL)
    {
      g_assert (one == NULL && two == NULL);
      return;
    }

  while (*one != NULL && *two != NULL)
    {
      assert_equal_arg (*one, *two);
      one++;
      two++;
    }
}

static void
assert_equal_method (GDBusMethodInfo *one,
                     GDBusMethodInfo *two)
{
  g_assert (one != NULL);
  g_assert (two != NULL);
  g_assert_cmpstr (one->name, ==, two->name);
  assert_equal_args (one->in_args, two->in_args);
  assert_equal_args (one->out_args, two->out_args);
}

static void
assert_equal_methods (GDBusMethodInfo **one,
                      GDBusMethodInfo **two)
{
  if (one == NULL || two == NULL)
    {
      g_assert (one == NULL && two == NULL);
      return;
    }

  while (*one != NULL && *two != NULL)
    {
      assert_equal_method (*one, *two);
      one++;
      two++;
    }
}

static void
assert_equal_signal (GDBusSignalInfo *one,
                     GDBusSignalInfo *two)
{
  g_assert (one != NULL);
  g_assert (two != NULL);
  g_assert_cmpstr (one->name, ==, two->name);
  assert_equal_args (one->args, two->args);
}

static void
assert_equal_signals (GDBusSignalInfo **one,
                      GDBusSignalInfo **two)
{
  if (one == NULL || two == NULL)
    {
      g_assert (one == NULL && two == NULL);
      return;
    }

  while (*one != NULL && *two != NULL)
    {
      assert_equal_signal (*one, *two);
      one++;
      two++;
    }
}

static void
assert_equal_property (GDBusPropertyInfo *one,
                       GDBusPropertyInfo *two)
{
  g_assert (one != NULL);
  g_assert (two != NULL);
  g_assert_cmpstr (one->name, ==, two->name);
  g_assert_cmpstr (one->signature, ==, two->signature);
  g_assert_cmpuint (one->flags, ==, two->flags);
}

static void
assert_equal_properties (GDBusPropertyInfo **one,
                         GDBusPropertyInfo **two)
{
  if (one == NULL || two == NULL)
    {
      g_assert (one == NULL && two == NULL);
      return;
    }

  while (*one != NULL && *two != NULL)
    {
      assert_equal_property (*one, *two);
      one++;
      two++;
    }
}

static void
assert_equal_interface (GDBusInterfaceInfo *one,
                        GDBusInterfaceInfo *two)
{
  g_assert (one != NULL);
  g_assert (two != NULL);
  g_assert_cmpstr (one->name, ==, two->name);
  assert_equal_methods (one->methods, two->methods);
  assert_equal_signals (one->signals, two->signals);
  assert_equal_properties (one->properties, two->properties);
}

typedef struct {
  const gchar *name;
  const gchar *input;
  const GDBusInterfaceInfo *iface;
} ParseFixture;

static const ParseFixture parse_janitor_fixture = {
    "planet.express.Janitor",
    janitor_json,
    &janitor_interface
};

static const ParseFixture parse_no_methods_fixture = {
    "planet.express.NoMethods",
    no_methods_json,
    &no_methods_interface
};

static const ParseFixture parse_no_signals_fixture = {
    "planet.express.NoSignals",
    no_signals_json,
    &no_signals_interface
};

static const ParseFixture parse_no_properties_fixture = {
    "planet.express.NoProperties",
    no_properties_json,
    &no_properties_interface
};

static void
test_parse (gconstpointer data)
{
  const ParseFixture *fixture = data;
  GDBusInterfaceInfo *iface;
  GError *error = NULL;
  JsonObject *object;

  object = cockpit_json_parse_object (fixture->input, -1, &error);
  g_assert_no_error (error);

  iface = cockpit_dbus_meta_parse (fixture->name, object, &error);
  g_assert_no_error (error);

  assert_equal_interface (iface, (GDBusInterfaceInfo *)fixture->iface);

  g_dbus_interface_info_unref (iface);
  json_object_unref (object);
}

typedef struct {
  const gchar *input;
  const gchar *message;
} ErrorFixture;

static const gchar invalid_in_argument_json[] = "{"
  "\"methods\": {"
    "\"BrokenMethod\": {"
      "\"in\": [ true ]"
    "}"
  "}"
"}";

static const ErrorFixture error_invalid_in_argument = {
    invalid_in_argument_json,
    "invalid argument in dbus meta field"
};

static const gchar invalid_out_argument_json[] = "{"
  "\"methods\": {"
    "\"BrokenMethod\": {"
      "\"out\": [ true ]"
    "}"
  "}"
"}";

static const ErrorFixture error_invalid_out_argument = {
    invalid_out_argument_json,
    "invalid argument in dbus meta field"
};

static const gchar invalid_signal_argument_json[] = "{"
  "\"signals\": {"
    "\"BrokenSignal\": {"
      "\"in\": [ true ]"
    "}"
  "}"
"}";

static const ErrorFixture error_invalid_signal_argument = {
    invalid_signal_argument_json,
    "invalid argument in dbus meta field"
};

static const gchar invalid_signature_argument_json[] = "{"
  "\"methods\": {"
    "\"BrokenMethod\": {"
      "\"in\": [\"s\",\"!!!\"]"
    "}"
  "}"
"}";

static const ErrorFixture error_signature_argument = {
    invalid_signature_argument_json,
   "argument in dbus meta field has invalid signature: !!!"
};

static const gchar invalid_in_method_json[] = "{"
  "\"methods\": {"
    "\"BrokenMethod\": {"
      "\"in\": true,"
      "\"out\":[\"a{sv}\"]"
    "}"
  "}"
"}";

static const ErrorFixture error_invalid_in_method = {
    invalid_in_method_json,
    "invalid \"in\" field in dbus meta method: BrokenMethod"
};

static const gchar invalid_out_method_json[] = "{"
  "\"methods\": {"
    "\"BrokenMethod\": {"
      "\"in\":[\"a{sv}\"],"
      "\"out\": 5"
    "}"
  "}"
"}";

static const ErrorFixture error_invalid_out_method = {
    invalid_out_method_json,
    "invalid \"out\" field in dbus meta method: BrokenMethod"
};

static const gchar invalid_in_signal_json[] = "{"
  "\"signals\": {"
    "\"BrokenSignal\": {"
      "\"in\": { }"
    "}"
  "}"
"}";

static const ErrorFixture error_in_signal_fixture = {
    invalid_in_signal_json,
    "invalid \"in\" field in dbus meta signal: BrokenSignal"
};

static const gchar invalid_flags_property_json[] = "{"
  "\"properties\": {"
    "\"BrokenProperty\": {"
      "\"flags\": [ ],"
      "\"type\": \"s\""
    "}"
  "}"
"}";

static const ErrorFixture error_flags_property_fixture = {
    invalid_flags_property_json,
    "invalid \"flags\" field in dbus property: BrokenProperty"
};

static const gchar invalid_type_property_json[] = "{"
  "\"properties\": {"
    "\"BrokenProperty\": {"
      "\"flags\": \"r\","
      "\"type\": 555"
    "}"
  "}"
"}";

static const ErrorFixture error_type_property_fixture = {
    invalid_type_property_json,
    "invalid \"type\" field in dbus property: BrokenProperty"
};

static const gchar missing_type_property_json[] = "{"
  "\"properties\": {"
    "\"BrokenProperty\": {"
      "\"flags\": \"r\""
    "}"
  "}"
"}";

static const ErrorFixture error_type_missing_fixture = {
    missing_type_property_json,
    "missing \"type\" field in dbus property: BrokenProperty"
};

static const gchar invalid_signature_property_json[] = "{"
  "\"properties\": {"
    "\"BrokenProperty\": {"
      "\"flags\": \"r\","
      "\"type\": \"???\""
    "}"
  "}"
"}";

static const ErrorFixture error_signature_property_fixture = {
    invalid_signature_property_json,
    "the \"type\" field in dbus property is not a dbus signature: ???"
};

static const gchar invalid_methods_json[] = "{"
  "\"methods\": [ ]"
"}";

static const ErrorFixture error_methods_fixture = {
    invalid_methods_json,
    "invalid \"methods\" field in dbus meta structure"
};

static const gchar invalid_method_json[] = "{"
  "\"methods\": {"
    "\"BadMethod\": [ ]"
  "}"
"}";

static const ErrorFixture error_method_json = {
    invalid_method_json,
    "invalid method field in dbus meta structure: BadMethod",
};

static const gchar invalid_signals_json[] = "{"
  "\"signals\": 555"
"}";

static const ErrorFixture error_signals_json = {
    invalid_signals_json,
    "invalid \"signals\" field in dbus meta structure"
};

static const gchar invalid_signal_json[] = "{"
  "\"signals\": {"
    "\"BadSignal\": true"
  "}"
"}";

static const ErrorFixture error_signal_json = {
    invalid_signal_json,
    "invalid signal field in dbus meta structure: BadSignal",
};

static const gchar invalid_properties_json[] = "{"
  "\"properties\": [ ]"
"}";

static const ErrorFixture error_properties_json = {
    invalid_properties_json,
    "invalid \"properties\" field in dbus meta structure"
};

static const gchar invalid_property_json[] = "{"
  "\"properties\": {"
    "\"BadProperty\": true"
  "}"
"}";

static const ErrorFixture error_property_json = {
    invalid_property_json,
    "invalid property field in dbus meta structure: BadProperty",
};

static void
test_error (gconstpointer data)
{
  const ErrorFixture *fixture = data;
  GDBusInterfaceInfo *iface;
  GError *error = NULL;
  JsonObject *object;

  object = cockpit_json_parse_object (fixture->input, -1, &error);
  g_assert_no_error (error);

  iface = cockpit_dbus_meta_parse ("name.not.Important", object, &error);
  g_assert (iface == NULL);
  g_assert_error (error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS);
  g_assert_cmpstr (error->message, ==, fixture->message);

  g_error_free (error);
  json_object_unref (object);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add_data_func ("/dbus-meta/build/basic",
                        &build_janitor_fixture, test_build);
  g_test_add_data_func ("/dbus-meta/build/no-methods",
                        &build_no_methods_fixture, test_build);
  g_test_add_data_func ("/dbus-meta/build/no-signals",
                        &build_no_signals_fixture, test_build);
  g_test_add_data_func ("/dbus-meta/build/no-properties",
                        &build_no_properties_fixture, test_build);

  g_test_add_data_func ("/dbus-meta/parse/basic",
                        &parse_janitor_fixture, test_parse);
  g_test_add_data_func ("/dbus-meta/parse/no-methods",
                        &parse_no_methods_fixture, test_parse);
  g_test_add_data_func ("/dbus-meta/parse/no-signals",
                        &parse_no_signals_fixture, test_parse);
  g_test_add_data_func ("/dbus-meta/parse/no-properties",
                        &parse_no_properties_fixture, test_parse);

  g_test_add_data_func ("/dbus-meta/parse/invalid-in-argument",
                        &error_invalid_in_argument, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-out-argument",
                        &error_invalid_out_argument, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-signal-argument",
                        &error_invalid_signal_argument, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-signature-argument",
                        &error_signature_argument, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-in-arguments",
                        &error_invalid_in_method, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-out-arguments",
                        &error_invalid_out_method, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-signal-arguments",
                        &error_in_signal_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-property-flags",
                        &error_flags_property_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-property-type",
                        &error_type_property_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/missing-property-type",
                        &error_type_missing_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-property-signature",
                        &error_signature_property_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-methods",
                        &error_methods_fixture, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-method",
                        &error_method_json, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-signals",
                        &error_signals_json, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-signal",
                        &error_signal_json, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-properties",
                        &error_properties_json, test_error);
  g_test_add_data_func ("/dbus-meta/parse/invalid-property",
                        &error_property_json, test_error);

  return g_test_run ();
}
