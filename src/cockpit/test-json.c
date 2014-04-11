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

#include "cockpit/cockpittest.h"

#include "string.h"

static const gchar *test_data =
  "{"
  "   \"string\": \"value\","
  "   \"number\": 55,"
  "   \"array\": [ \"one\", \"two\", \"three\" ]"
  "}";

typedef struct {
    JsonParser *parser;
    JsonObject *root;
} TestCase;

static void
setup (TestCase *tc,
       gconstpointer data)
{
  GError *error = NULL;
  JsonNode *node;

  tc->parser = json_parser_new ();
  json_parser_load_from_data (tc->parser, test_data, -1, &error);
  g_assert_no_error (error);

  node = json_parser_get_root (tc->parser);
  g_assert (json_node_get_node_type (node) == JSON_NODE_OBJECT);
  tc->root = json_node_get_object (node);
}

static void
teardown (TestCase *tc,
          gconstpointer data)
{
  g_object_unref (tc->parser);
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

  ret = cockpit_json_get_string (tc->root, "unknown", NULL, &value);
  g_assert (ret == TRUE);
  g_assert_cmpstr (value, ==, NULL);

  ret = cockpit_json_get_string (tc->root, "unknown", "default", &value);
  g_assert (ret == TRUE);
  g_assert_cmpstr (value, ==, "default");

  ret = cockpit_json_get_string (tc->root, "number", NULL, &value);
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

  ret = cockpit_json_get_int (tc->root, "unknown", 66, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, 66);

  ret = cockpit_json_get_int (tc->root, "string", 66, &value);
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

typedef struct {
    const gchar *name;
    const gchar *json;
    gint blocks[8];
} FixtureSkip;

static const FixtureSkip skip_fixtures[] = {
  { "number", "0123456789",
      { 10 } },
  { "number-fancy", "-0123456789.33E-5",
      { 17 } },
  { "string", "\"string\"",
      { 8 } },
  { "string-escaped", "\"st\\\"ring\"",
      { 10 } },
  { "string-truncated", "\"string",
      { 0 } },
  { "boolean", "true",
      { 4 } },
  { "null", "null",
      { 4 } },
  { "string-number", "\"string\"0123456789",
      { 8, 10 } },
  { "number-string", "0123456789\"string\"",
      { 10, 8 } },
  { "number-number", "0123456789 123",
      { 11, 3 } },
  { "string-string-string", "\"string\"\"two\"\"three\"",
      { 8, 5, 7 } },
  { "string-string-truncated", "\"string\"\"tw",
      { 8, 0 } },
  { "array", "[\"string\",\"two\",\"three\"]",
      { 24, } },
  { "array-escaped", "[\"string\",\"two\",\"thr]e\"]",
      { 24, } },
  { "array-spaces", " [ \"string\", \"two\" ,\"thr]e\" ]\t",
      { 30, } },
  { "array-truncated", "[\"string\",\"two\",\"thr",
      { 0, } },
  { "object", "{\"string\":\"two\",\"number\":222}",
      { 29, } },
  { "object-escaped", "{\"string\":\"two\",\"num]}}ber\":222}",
      { 32, } },
  { "object-spaces", "{ \"string\": \"two\", \"number\": 222 }",
      { 34, } },
  { "object-object", "{\"string\":\"two\",\"number\":222}{\"string\":\"two\",\"number\":222}",
      { 29, 29, } },
  { "object-line-object", "{\"string\":\"two\",\"number\":222}\n{\"string\":\"two\",\"number\":222}",
      { 30, 29, } },
  { "object-truncated", "{\"stri}ng\"",
      { 0, } },
  { "whitespace", "  \r\n\t \v",
      { 7, } },
};

static void
test_skip (gconstpointer data)
{
  const FixtureSkip *fixture = data;
  const gchar *string = fixture->json;
  gsize length = strlen (string);
  gsize off;
  gint i;

  for (i = 0; TRUE; i++)
    {
      off = cockpit_json_skip (string, length, NULL);
      g_assert_cmpuint (off, ==, fixture->blocks[i]);
      g_assert_cmpuint (off, <=, length);

      if (off == 0)
        break;

      string += off;
      length -= off;
    }
}

static void
test_skip_whitespace (void)
{
  gsize spaces;
  gsize off;

  off = cockpit_json_skip ("  234  ", 7, &spaces);
  g_assert_cmpuint (off, ==, 7);
  g_assert_cmpuint (spaces, ==, 2);

  off = cockpit_json_skip ("   \t   ", 7, &spaces);
  g_assert_cmpuint (off, ==, 7);
  g_assert_cmpuint (spaces, ==, 7);
}

static void
test_parser_trims (void)
{
  JsonParser *parser = json_parser_new ();
  GError *error = NULL;

  /* Test that the parser trims whitespace, as long as something is present */

  json_parser_load_from_data (parser, " 55  ", -1, &error);
  g_assert_no_error (error);
  g_assert_cmpint (json_node_get_node_type (json_parser_get_root (parser)), ==, JSON_NODE_VALUE);
  g_assert_cmpint (json_node_get_value_type (json_parser_get_root (parser)), ==, G_TYPE_INT64);

  json_parser_load_from_data (parser, " \"xx\"  ", -1, &error);
  g_assert_no_error (error);
  g_assert_cmpint (json_node_get_node_type (json_parser_get_root (parser)), ==, JSON_NODE_VALUE);
  g_assert_cmpint (json_node_get_value_type (json_parser_get_root (parser)), ==, G_TYPE_STRING);

  json_parser_load_from_data (parser, " {\"xx\":5}  ", -1, &error);
  g_assert_no_error (error);
  g_assert_cmpint (json_node_get_node_type (json_parser_get_root (parser)), ==, JSON_NODE_OBJECT);

  g_object_unref (parser);
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
  JsonParser *parser;
  JsonNode *a = NULL;
  JsonNode *b = NULL;
  GError *error = NULL;

  parser = json_parser_new ();
  if (fixture->a)
    {
      json_parser_load_from_data (parser, fixture->a, -1, &error);
      g_assert_no_error (error);
      a = json_node_copy (json_parser_get_root (parser));
    }
  if (fixture->b)
    {
      json_parser_load_from_data (parser, fixture->b, -1, &error);
      g_assert_no_error (error);
      b = json_node_copy (json_parser_get_root (parser));
    }

  g_assert (cockpit_json_equal (a, b) == fixture->equal);

  if (a)
    json_node_free (a);
  if (b)
    json_node_free (b);
  g_object_unref (parser);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);

  g_test_add_func ("/json/int-equal", test_int_equal);
  g_test_add_func ("/json/int-hash", test_int_hash);

  g_test_add ("/json/get-string", TestCase, NULL,
              setup, test_get_string, teardown);
  g_test_add ("/json/get-int", TestCase, NULL,
              setup, test_get_int, teardown);
  g_test_add ("/json/get-strv", TestCase, NULL,
              setup, test_get_strv, teardown);

  g_test_add_func ("/json/parser-trims", test_parser_trims);

  for (i = 0; i < G_N_ELEMENTS (skip_fixtures); i++)
    {
      name = g_strdup_printf ("/json/skip/%s", skip_fixtures[i].name);
      g_test_add_data_func (name, skip_fixtures + i, test_skip);
      g_free (name);
    }
  g_test_add_func ("/json/skip/return-spaces", test_skip_whitespace);

  for (i = 0; i < G_N_ELEMENTS (equal_fixtures); i++)
    {
      name = g_strdup_printf ("/json/equal/%s", equal_fixtures[i].name);
      g_test_add_data_func (name, equal_fixtures + i, test_equal);
      g_free (name);
    }

  return g_test_run ();
}
