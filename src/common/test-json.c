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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitjson.h"

#include "common/cockpittest.h"

#include <math.h>
#include <string.h>

static const gchar *test_data =
  "{"
  "   \"string\": \"value\","
  "   \"number\": 55,"
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
test_get_null (TestCase *tc,
                 gconstpointer data)
{
  gboolean ret;
  gboolean present;

  ret = cockpit_json_get_null (tc->root, "null", NULL);
  g_assert (ret == TRUE);

  present = FALSE;
  ret = cockpit_json_get_null (tc->root, "null", &present);
  g_assert (ret == TRUE);
  g_assert (present == TRUE);

  ret = cockpit_json_get_null (tc->root, "unknown", NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_null (tc->root, "unknown", &present);
  g_assert (ret == TRUE);
  g_assert (present == FALSE);

  ret = cockpit_json_get_null (tc->root, "number", NULL);
  g_assert (ret == FALSE);
}

static void
test_get_strv (TestCase *tc,
               gconstpointer data)
{
  const gchar *defawlt[] = { "1", "2", NULL };
  gboolean ret;
  gchar **value;

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
test_get_array (TestCase *tc,
                gconstpointer data)
{
  JsonArray *defawlt = json_array_new ();
  gboolean ret;
  JsonArray *value;

  ret = cockpit_json_get_array (tc->root, "array", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value != NULL);
  g_assert_cmpstr (json_array_get_string_element (value, 0), ==, "one");
  g_assert_cmpstr (json_array_get_string_element (value, 1), ==, "two");
  g_assert_cmpstr (json_array_get_string_element (value, 2), ==, "three");

  ret = cockpit_json_get_array (tc->root, "array", NULL, NULL);
  g_assert (ret == TRUE);

  ret = cockpit_json_get_array (tc->root, "unknown", NULL, &value);
  g_assert (ret == TRUE);
  g_assert (value == NULL);

  ret = cockpit_json_get_array (tc->root, "unknown", defawlt, &value);
  g_assert (ret == TRUE);
  g_assert (value == defawlt);

  ret = cockpit_json_get_array (tc->root, "number", NULL, &value);
  g_assert (ret == FALSE);

  ret = cockpit_json_get_array (tc->root, "number", NULL, NULL);
  g_assert (ret == FALSE);

  json_array_unref (defawlt);
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
test_hashtable_objects (void)
{
  JsonObject *object = json_object_new ();
  GHashTable *ht = NULL;
  const gchar *fields[] = {
    "test",
    "test2",
    "test4",
    "test5",
    NULL,
  };

  json_object_set_string_member (object, "test", "one");
  json_object_set_string_member (object, "test2", "two");
  json_object_set_string_member (object, "test3", "three");
  json_object_set_null_member (object, "test4");
  json_object_set_string_member (object, "test5", "five");

  ht = cockpit_json_to_hash_table (object, fields);
  g_assert_cmpstr (g_hash_table_lookup (ht, "test"), ==, "one");
  g_assert_cmpstr (g_hash_table_lookup (ht, "test2"), ==, "two");
  g_assert_cmpstr (g_hash_table_lookup (ht, "test5"), ==, "five");
  g_assert_false (g_hash_table_contains (ht, "test3"));
  g_assert_false (g_hash_table_contains (ht, "test4"));
  json_object_unref (object);

  object = cockpit_json_from_hash_table (ht, fields);
  g_assert_cmpstr (json_object_get_string_member (object, "test"), ==, "one");
  g_assert_cmpstr (json_object_get_string_member (object, "test2"), ==, "two");
  g_assert_cmpstr (json_object_get_string_member (object, "test5"), ==, "five");
  g_assert_false (json_object_has_member (object, "test3"));
  g_assert_true (json_object_get_null_member (object, "test4"));

  json_object_unref (object);
  g_hash_table_unref (ht);
}

static void
test_int_hash (void)
{
  gint64 one = 1;
  gint64 two = G_MAXINT;
  gint64 copy = 1;

  g_assert_cmpuint (cockpit_json_int_hash (&one), !=, cockpit_json_int_hash (&two));
  g_assert_cmpuint (cockpit_json_int_hash (&one), ==, cockpit_json_int_hash (&one));
  g_assert_cmpuint (cockpit_json_int_hash (&one), ==, cockpit_json_int_hash (&copy));
}

static void
test_int_equal (void)
{
  gint64 one = 1;
  gint64 two = G_MAXINT;
  gint64 copy = 1;

  g_assert (!cockpit_json_int_equal (&one, &two));
  g_assert (cockpit_json_int_equal (&one, &one));
  g_assert (cockpit_json_int_equal (&one, &copy));
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

typedef struct {
    const gchar *name;
    gboolean equal;
    const gchar *a;
    const gchar *b;
} FixtureEqual;

static const FixtureEqual equal_fixtures[] = {
 { "nulls", TRUE,
    NULL,
    NULL },
 { "null-non-null", FALSE,
    NULL,
    "555" },
 { "non-null-null", FALSE,
    "555",
    NULL },
 { "number-string", FALSE,
    "555",
    "\"str\"" },
 { "string-string", TRUE,
    "\"str\"",
    "\"str\"" },
 { "string-string-ne", FALSE,
    "\"xxxx\"",
    "\"str\"" },
 { "int-int", TRUE,
    "555",
    "555" },
 { "int-int-ne", FALSE,
    "555",
    "556" },
 { "double-double", TRUE,
    "555.0",
    "555.00" },
 { "boolean-boolean", TRUE,
    "true",
    "true" },
 { "boolean-boolean-ne", FALSE,
    "true",
    "false" },
 { "null-null", TRUE,
    "null",
    "null" },
 { "array-string", FALSE,
    "[]",
    "\"str\"" },
 { "array-array", TRUE,
    "[1, 2.0, 3]",
    "[1, 2.00, 3]" },
 { "array-array-ne", FALSE,
    "[1, 2.0, 3]",
    "[1, 4.00, 3]" },
 { "array-array-length", FALSE,
    "[1, 2.0, 3]",
    "[1]" },
 { "object-object", TRUE,
    "{\"one\": 1, \"two\": \"2.0\"}",
    "{\"one\": 1, \"two\": \"2.0\"}" },
 { "object-object-order", TRUE,
    "{\"one\": 1, \"two\": \"2.0\"}",
    "{\"two\": \"2.0\", \"one\": 1}" },
 { "object-object-missing", FALSE,
    "{\"one\": 1, \"two\": \"2.0\"}",
    "{\"two\": \"2.0\"}" },
 { "object-object-value", FALSE,
    "{\"one\": 1, \"two\": \"2.0\"}",
    "{\"one\": 1, \"two\": \"2\"}" },
};

static void
test_equal (gconstpointer data)
{
  const FixtureEqual *fixture = data;
  JsonNode *a = NULL;
  JsonNode *b = NULL;
  GError *error = NULL;

  if (fixture->a)
    a = cockpit_json_parse (fixture->a, -1, &error);
  if (fixture->b)
    b = cockpit_json_parse (fixture->b, -1, &error);

  g_assert (cockpit_json_equal (a, b) == fixture->equal);

  json_node_free (a);
  json_node_free (b);
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

static const gchar *patch_data =
 "{"
  "   \"string\": \"value\","
  "   \"number\": 55,"
  "   \"array\": [ \"one\", \"two\", \"three\" ],"
  "   \"bool\": true,"
  "   \"null\": null,"
  "   \"object\": {"
  "       \"one\": 1,"
  "       \"two\": 2,"
  "       \"nested\": {"
  "           \"three\": 3"
  "       }"
  "   }"
  "}";

typedef struct {
  const gchar *name;
  const gchar *patch;
  const gchar *result;
} PatchFixture;

static PatchFixture patch_fixtures[] = {
  {
    "simple-value",
    "{\"string\": 5}",
    "{"
     "   \"string\": 5,"
     "   \"number\": 55,"
     "   \"array\": [ \"one\", \"two\", \"three\" ],"
     "   \"bool\": true,"
     "   \"null\": null,"
     "   \"object\": {"
     "       \"one\": 1,"
     "       \"two\": 2,"
     "       \"nested\": {"
     "           \"three\": 3"
     "       }"
     "   }"
     "}",
  },
  {
    "multi-value",
    "{"
    "  \"array\": [ 5 ],"
    "  \"number\": { \"test\": true }"
    "}",
    "{"
     "   \"string\": \"value\","
     "   \"number\": { \"test\": true },"
     "   \"array\": [ 5 ],"
     "   \"bool\": true,"
     "   \"null\": null,"
     "   \"object\": {"
     "       \"one\": 1,"
     "       \"two\": 2,"
     "       \"nested\": {"
     "           \"three\": 3"
     "       }"
     "   }"
     "}",
  },
  {
    "add-and-remove",
    "{"
    "  \"array\": null,"
    "  \"number\": null,"
    "  \"object\": null,"
    "  \"added\": 42"
    "}",
    "{"
     "   \"string\": \"value\","
     "   \"bool\": true,"
     "   \"null\": null,"
     "   \"added\": 42"
     "}",
  },
  {
    "nested-objects",
    "{"
    "  \"object\": {"
    "    \"one\": \"uno\","
    "    \"nested\": null,"
    "    \"three\": \"tres\""
    "  }"
    "}",
    "{"
     "   \"string\": \"value\","
     "   \"number\": 55,"
     "   \"array\": [ \"one\", \"two\", \"three\" ],"
     "   \"bool\": true,"
     "   \"null\": null,"
     "   \"object\": {"
     "       \"one\": \"uno\","
     "       \"two\": 2,"
     "       \"three\": \"tres\""
     "   }"
     "}",
  }
};

static void
test_patch (gconstpointer data)
{
  const PatchFixture *fixture = data;
  GError *error = NULL;
  JsonObject *object;
  JsonObject *with;

  object = cockpit_json_parse_object (patch_data, -1, &error);
  g_assert_no_error (error);

  with = cockpit_json_parse_object (fixture->patch, -1, &error);
  g_assert_no_error (error);

  cockpit_json_patch (object, with);

  cockpit_assert_json_eq (object, fixture->result);
  json_object_unref (object);
  json_object_unref (with);
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
  json_array_add_double_element (array, sqrt (-1)); /* NaN */

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

  g_test_add_func ("/json/int-equal", test_int_equal);
  g_test_add_func ("/json/int-hash", test_int_hash);

  g_test_add_func ("/json/utf8-invalid", test_utf8_invalid);

  g_test_add ("/json/get-string", TestCase, NULL,
              setup, test_get_string, teardown);
  g_test_add ("/json/get-int", TestCase, NULL,
              setup, test_get_int, teardown);
  g_test_add ("/json/get-bool", TestCase, NULL,
              setup, test_get_bool, teardown);
  g_test_add ("/json/get-null", TestCase, NULL,
              setup, test_get_null, teardown);
  g_test_add ("/json/get-strv", TestCase, NULL,
              setup, test_get_strv, teardown);
  g_test_add ("/json/get-array", TestCase, NULL,
              setup, test_get_array, teardown);
  g_test_add ("/json/get-object", TestCase, NULL,
              setup, test_get_object, teardown);

  g_test_add_func ("/json/parser-trims", test_parser_trims);
  g_test_add_func ("/json/parser-empty", test_parser_empty);

  for (i = 0; i < G_N_ELEMENTS (equal_fixtures); i++)
    {
      name = g_strdup_printf ("/json/equal/%s", equal_fixtures[i].name);
      g_test_add_data_func (name, equal_fixtures + i, test_equal);
      g_free (name);
    }

  for (i = 0; i < G_N_ELEMENTS (string_fixtures); i++)
    {
      escaped = g_strcanon (g_strdup (string_fixtures[i].str), COCKPIT_TEST_CHARS, '_');
      name = g_strdup_printf ("/json/string/%s%d", escaped, i);
      g_test_add_data_func (name, string_fixtures + i, test_string_encode);
      g_free (escaped);
      g_free (name);
    }

  for (i = 0; i < G_N_ELEMENTS (patch_fixtures); i++)
    {
      name = g_strdup_printf ("/json/patch/%s", patch_fixtures[i].name);
      g_test_add_data_func (name, patch_fixtures + i, test_patch);
      g_free (name);
    }

  g_test_add_func ("/json/write/infinite-nan", test_write_infinite_nan);
  g_test_add_func ("/json/hashtable-objects", test_hashtable_objects);


  return g_test_run ();
}
