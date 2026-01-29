/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitjson.h"

#include "testlib/cockpittest.h"

#include <math.h>
#include <string.h>

static const gchar *test_data =
  "{"
  "   \"string\": \"value\","
  "   \"number\": 55.4,"
  "   \"array\": [ \"one\", \"two\", \"three\" ],"
  "   \"object\": { \"test\": \"one\" },"
  "   \"bool\": true,"
  "   \"null\": null"
  "}";

typedef struct {
    JsonObject *root;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  GError *error = NULL;
  JsonNode *node;

  node = cockpit_json_parse (test_data, -1, &error);
  g_assert_no_error (error);

  g_assert (json_node_get_node_type (node) == JSON_NODE_OBJECT);
  tc->root = json_node_dup_object (node);
  json_node_free (node);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  json_object_unref (tc->root);
}

static void
test_get_string (TestCase *tc,
                 gconstpointer data)
{
  gboolean ret;
  const gchar *value;

  ret = cockpit_json_get_string (tc->root, "string", NULL, &value);
  g_assert (ret == TRUE);
  g_assert_cmpstr (value, ==, "value");

  ret = cockpit_json_get_string (tc->root, "string", NULL, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_string (tc->root, "unknown", NULL, &value);
  g_assert (ret == TRUE);
  g_assert_cmpstr (value, ==, NULL);

  ret = cockpit_json_get_string (tc->root, "unknown", "default", &value);
  g_assert (ret == TRUE);
  g_assert_cmpstr (value, ==, "default");

  ret = cockpit_json_get_string (tc->root, "number", NULL, &value);
  g_assert (ret == FALSE);

  ret = cockpit_json_get_string (tc->root, "number", NULL, NULL);
  g_assert (ret == FALSE);
}

static void
test_get_int (TestCase *tc,
              gconstpointer data)
{
  gboolean ret;
  gint64 value;

  ret = cockpit_json_get_int (tc->root, "number", 0, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, 55);

  ret = cockpit_json_get_int (tc->root, "number", 0, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_int (tc->root, "unknown", 66, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, 66);

  ret = cockpit_json_get_int (tc->root, "string", 66, &value);
  g_assert (ret == FALSE);

  ret = cockpit_json_get_int (tc->root, "string", 66, NULL);
  g_assert (ret == FALSE);
}

static void
test_get_bool (TestCase *tc,
               gconstpointer data)
{
  gboolean ret;
  gboolean value;

  ret = cockpit_json_get_bool (tc->root, "bool", FALSE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, TRUE);

  ret = cockpit_json_get_bool (tc->root, "bool", FALSE, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_bool (tc->root, "unknown", TRUE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, TRUE);

  ret = cockpit_json_get_bool (tc->root, "unknown", FALSE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, FALSE);

  ret = cockpit_json_get_bool (tc->root, "string", FALSE, &value);
  g_assert (ret == FALSE);

  ret = cockpit_json_get_bool (tc->root, "string", FALSE, NULL);
  g_assert (ret == FALSE);
}

static void
test_get_strv (TestCase *tc,
               gconstpointer data)
{
  const gchar *defawlt[] = { "1", "2", NULL };
  gboolean ret;
  const gchar **value;

  ret = cockpit_json_get_strv (tc->root, "array", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value != NULL);
  g_assert_cmpstr (value[0], ==, "one");
  g_assert_cmpstr (value[1], ==, "two");
  g_assert_cmpstr (value[2], ==, "three");
  g_assert_cmpstr (value[3], ==, NULL);
  g_free (value);

  ret = cockpit_json_get_strv (tc->root, "unknown", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value == NULL);

  ret = cockpit_json_get_strv (tc->root, "unknown", defawlt, &value);
  g_assert (ret == TRUE);
  g_assert (value != NULL);
  g_assert_cmpstr (value[0], ==, "1");
  g_assert_cmpstr (value[1], ==, "2");
  g_assert_cmpstr (value[2], ==, NULL);
  g_free (value);

  ret = cockpit_json_get_strv (tc->root, "number", NULL, &value);
  g_assert (ret == FALSE);
}

static void
test_get_object (TestCase *tc,
                gconstpointer data)
{
  JsonObject *defawlt = json_object_new ();
  gboolean ret;
  JsonObject *value;

  ret = cockpit_json_get_object (tc->root, "object", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value != NULL);
  g_assert_cmpstr (json_object_get_string_member (value, "test"), ==, "one");

  ret = cockpit_json_get_object (tc->root, "object", NULL, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_object (tc->root, "unknown", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value == NULL);

  ret = cockpit_json_get_object (tc->root, "unknown", defawlt, &value);
  g_assert (ret == TRUE);
  g_assert (value == defawlt);

  ret = cockpit_json_get_object (tc->root, "number", NULL, &value);
  g_assert (ret == FALSE);

  ret = cockpit_json_get_object (tc->root, "array", NULL, NULL);
  g_assert (ret == FALSE);

  json_object_unref (defawlt);
}

static void
test_parser_trims (void)
{
  GError *error = NULL;
  JsonNode *node;

  /* Test that the parser trims whitespace, as long as something is present */

  node = cockpit_json_parse (" 55  ", -1, &error);
  g_assert_no_error (error);
  g_assert (node);
  g_assert_cmpint (json_node_get_node_type (node), ==, JSON_NODE_VALUE);
  g_assert_cmpint (json_node_get_value_type (node), ==, G_TYPE_INT64);
  json_node_free (node);

  node = cockpit_json_parse (" \"xx\"  ", -1, &error);
  g_assert_no_error (error);
  g_assert (node);
  g_assert_cmpint (json_node_get_node_type (node), ==, JSON_NODE_VALUE);
  g_assert_cmpint (json_node_get_value_type (node), ==, G_TYPE_STRING);
  json_node_free (node);

  node = cockpit_json_parse (" {\"xx\":5}  ", -1, &error);
  g_assert_no_error (error);
  g_assert (node);
  g_assert_cmpint (json_node_get_node_type (node), ==, JSON_NODE_OBJECT);
  json_node_free (node);
}

static void
test_parser_empty (void)
{
  GError *error = NULL;
  JsonNode *node;

  node = cockpit_json_parse ("", 0, &error);
  g_assert_error (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_PARSE);
  g_error_free (error);
  g_assert (node == NULL);
}

static void
test_utf8_invalid (void)
{
  const gchar *input = "\"\xff\xff\"";
  GError *error = NULL;

  if (cockpit_json_parse (input, -1, &error))
    g_assert_not_reached ();

  g_assert_error (error, JSON_PARSER_ERROR, JSON_PARSER_ERROR_INVALID_DATA);
  g_error_free (error);
}

typedef struct {
    const gchar *str;
    const gchar *expect;
} FixtureString;

static const FixtureString string_fixtures[] = {
  { "abc", "\"abc\"" },
  { "a\x7fxc", "\"a\\u007fxc\"" },
  { "a\033xc", "\"a\\u001bxc\"" },
  { "a\nxc", "\"a\\nxc\"" },
  { "a\\xc", "\"a\\\\xc\"" },
  { "Barney B\303\244r", "\"Barney B\303\244r\"" },
};

static void
test_string_encode (gconstpointer data)
{
  const FixtureString *fixture = data;
  JsonNode *node;
  gsize length;
  gchar *output;

  node = json_node_init_string (json_node_alloc (), fixture->str);
  output = cockpit_json_write (node, &length);
  g_assert_cmpstr (output, ==, fixture->expect);
  g_assert_cmpuint (length, ==, strlen (fixture->expect));
  g_free (output);
  json_node_free (node);
}

static void
test_write_infinite_nan (void)
{
  JsonArray *array;
  gchar *string;
  JsonNode *node;

  array = json_array_new ();
  json_array_add_double_element (array, 3.0); /* number */
  json_array_add_double_element (array, 1.0/0.0); /* INFINITY */
  json_array_add_double_element (array, NAN); /* NaN */

  node = json_node_new (JSON_NODE_ARRAY);
  json_node_take_array (node, array);
  string = cockpit_json_write (node, NULL);

  g_assert_cmpstr (string, ==, "[3,null,null]");

  json_node_free (node);
  g_free (string);
}

int
main (int argc,
      char *argv[])
{
  gchar *escaped;
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/json/utf8-invalid", test_utf8_invalid);

  g_test_add ("/json/get-string", TestCase, NULL,
              setup, test_get_string, teardown);
  g_test_add ("/json/get-int", TestCase, NULL,
              setup, test_get_int, teardown);
  g_test_add ("/json/get-bool", TestCase, NULL,
              setup, test_get_bool, teardown);
  g_test_add ("/json/get-strv", TestCase, NULL,
              setup, test_get_strv, teardown);
  g_test_add ("/json/get-object", TestCase, NULL,
              setup, test_get_object, teardown);

  g_test_add_func ("/json/parser-trims", test_parser_trims);
  g_test_add_func ("/json/parser-empty", test_parser_empty);

  for (i = 0; i < G_N_ELEMENTS (string_fixtures); i++)
    {
      escaped = g_strcanon (g_strdup (string_fixtures[i].str), COCKPIT_TEST_CHARS, '_');
      name = g_strdup_printf ("/json/string/%s%d", escaped, i);
      g_test_add_data_func (name, string_fixtures + i, test_string_encode);
      g_free (escaped);
      g_free (name);
    }

  g_test_add_func ("/json/write/infinite-nan", test_write_infinite_nan);

  return g_test_run ();
}
