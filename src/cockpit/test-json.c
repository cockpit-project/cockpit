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
  "   \"array\": [ \"one\", \"two\", \"three\" ],"
  "   \"bool\": true"
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
test_get_bool (TestCase *tc,
               gconstpointer data)
{
  gboolean ret;
  gboolean value;

  ret = cockpit_json_get_bool (tc->root, "bool", FALSE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, TRUE);

  ret = cockpit_json_get_bool (tc->root, "unknown", TRUE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, TRUE);

  ret = cockpit_json_get_bool (tc->root, "unknown", FALSE, &value);
  g_assert (ret == TRUE);
  g_assert_cmpint (value, ==, FALSE);

  ret = cockpit_json_get_bool (tc->root, "string", FALSE, &value);
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

static void
test_skip_truncated_in_escape (void)
{
  const gchar *test_data = "[{\"Created\":1402070687,\"Id\":\"cef2fb693e75e40adf1f6f7527f87fea71caf82e1b"
    "d537dbee39c0fda3411921\",\"ParentId\":\"ceb50fff53c1302b3a9ad26408278a251d68235a5ae2a01b23cede49d34"
    "e866e\",\"RepoTags\":[\"\\u003cnone\\u003e:\\u003cnone\\u003e\"],\"Size\":0,\"VirtualSize\":7472734"
    "75}\n,{\"Created\":1400665659,\"Id\":\"509fa7c0852e90a845448abd7eb2841db28f804945afffd5a32824c2f9ec"
    "0d8a\",\"ParentId\":\"926be66cef7268afb34b4cf1b2b9c6ffcdfe31ab46b693403f230957f6f3daa2\",\"RepoTags"
    "\":[\"docker:HEAD\"],\"Size\":55952500,\"VirtualSize\":1375678976}\n,{\"Created\":1400663579,\"Id\""
    ":\"5b32b4e9704752be67cde7728d3f5c03a556bfa870389bbda861342e86fb560f\",\"ParentId\":\"e254744f8fa4dc"
    "74c4ca5d26ae7768e2cb2b50243b7a8c1165a44d7b12c7c42b\",\"RepoTags\":[\"docker:master\"],\"Size\":3870"
    "1691,\"VirtualSize\":1446111967}\n,{\"Created\":1400663532,\"Id\":\"9a68657408a0a2ff2a39713b8fa6858"
    "abd86eb2c0b211db6b37d403c8190fb6c\",\"ParentId\":\"e254744f8fa4dc74c4ca5d26ae7768e2cb2b50243b7a8c11"
    "65a44d7b12c7c42b\",\"RepoTags\":[\"\\u003cnone\\u003e:\\u003cnone\\u003e\"],\"Size\":38701679,\"Vir"
    "tualSize\":1446111955}\n,{\"Created\":1400663441,\"Id\":\"73ee80db5f34021056658a9548712b879b2e3a476"
    "44d9eadefe645724c52f7e3\",\"ParentId\":\"e254744f8fa4dc74c4ca5d26ae7768e2cb2b50243b7a8c1165a44d7b12"
    "c7c42b\",\"RepoTags\":[\"\\u003cnone\\u003e:\\u003cnone\\u003e\"],\"Size\":56037289,\"VirtualSize\""
    ":1463447565}\n,{\"Created\":1400651897,\"Id\":\"d3dc4f0900ddb9ffff061ed33b4932fff2b958216755cecc848"
    "69c1004b3ff63\",\"ParentId\":\"e254744f8fa4dc74c4ca5d26ae7768e2cb2b50243b7a8c1165a44d7b12c7c42b\",\""
    "RepoTags\":[\"\\u003cnone\\u003e:\\u003cnone\\u003e\"],\"Size\":52895116,\"VirtualSize\":1460305392"
    "}\n,{\"Created\":1400499581,\"Id\":\"b7056496ef2e90f157de5ac540f28eb6a261e5ec310cefaacd9e619592451e"
    "e0\",\"ParentId\":\"4e9e2401ad26a9e944f7682c1b7d9fd8081d6b815328dbc4518546fccad73de7\",\"RepoTags\""
    ":[\"\\u003cnone\\u003e:\\u003cnone\\u003e\"],\"Size\":38535116,\"VirtualSize\":1445611408}\n,{\"Cre"
    "ated\":1400455136,\"Id\":\"6927a389deb65faddfc9f72a909b03f60d8f51f1ed0f6cd9fca4e7919521a4c9\",\"Par"
    "entId\":\"e91614297ac6eaf572b66ccc896b5ef986c4bd31bbb8517ae5b91891ae9a7de7\",\"RepoTags\":[\"fedora"
    "/apache:latest\"],\"Size\":0,\"VirtualSize\":450607288}\n,{\"Created\":1398393838,\"Id\":\"5e019ab7"
    "bf6deb75b211411ef7257d1e76bf7edee31d9da62a392df98d0529d6\",\"ParentId\":\"2209cbf9dcd35615211a2fdc6"
    "762bb5e651b5c847537359f05b9ab1bc9a74614\",\"RepoTags\":[\"ubuntu:13.10\"],\"Size\":73660060,\"Virtu"
    "alSize\":179957072}\n,{\"Created\":1398356275,\"Id\":\"99ec81b80c55d906afd8179560fdab0ee93e32c52053"
    "816ca1d531597c1ff48f\",\"ParentId\":\"d4010efcfd86c7f59f6b83b90e9c66d4cc4d78cd2266e853b95d464ea0eb7"
    "3e6\",\"RepoTags\":[\"ubuntu:14.04\"],\"Size\":73333288,\"VirtualSize\":266007088}\n,{\"Created\":1"
    "396557724,\"Id\":\"6200c4cca7aecad6d78749a7866cee8a4d3b0f508f407d9ab9006e1f40db66c9\",\"ParentId\":"
    "\"a5f9e852518a475dd667e3c18490cf4efb6d55194921adf078fba4930deee6dc\",\"RepoTags\":[\"mvollmer/memea"
    "ter:latest\"],\"Size\":20,\"VirtualSize\":812020}\n,{\"Created\":1396557723,\"Id\":\"42c71324bbfc76"
    "7572487df6c90e21041f79609a47687aeccfa1ab7286eaf01a\",\"ParentId\":\"a5f9e852518a475dd667e3c18490cf4"
                                                               /* real data ends here ---v */
    "efb6d55194921adf078fba4930deee6dc\",\"RepoTags\":[\"\\u003cnone\\u003e:\\u003cnone\\e\":\"\",\"Entr"
    "ypoint\":null,\"Env\":[\"HOME=/\",\"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/b"
    "in\"],\"ExposedPorts\":null,\"Hostname\":\"4afa84ed8809\",\"Image\":\"fedora:rawhide\",\"Memory\":0"
    ",\"MemorySwap\":0,\"NetworkDisabled\":false,\"OnBuild\":null,\"OpenStdin\":true,\"PortSpecs\":null,"
    "\"StdinOnce\":true,\"Tty\":false,\"User\":\"\",\"Volumes\":null,\"WorkingDir\":\"\"},\"Created\":\""
    "2014-03-25T09:37:33.948365902Z\",\"Driver\":\"devicemapper\",\"ExecDriver\":\"native-0.1\",\"HostCo"
    "nfig\":{\"Binds\":null,\"ContainerIDFile\":\"\",\"Dns\":null,\"DnsSearch\":null,\"Links\":null,\"Lx"
    "cConf\":[],\"NetworkMode\":\"\",\"PortBindings\":{},\"Privileged\":false,\"PublishAllPorts\":false,"
    "\"VolumesFrom\":null},\"HostnamePath\":\"/var/lib/docker/containers/4afa84ed8809253111a6d63433503af"
    "525b577740293bf219e5ff8223a702cf7/hostname\",\"HostsPath\":\"/var/lib/docker/containers/4afa84ed880"
    "9253111a6d63433503af525b577740293bf219e5ff8223a702cf7/hosts\",\"Id\":\"4afa84ed8809253111a6d6343350"
    "3af525b577740293bf219e5ff8223a702cf7\",\"Image\":\"0d20aec6529d5d396b195182c0eaa82bfe014c3e82ab3902"
    "03ed56a774d2c404\",\"MountLabel\":\"\",\"Name\":\"/silly_curie\",\"NetworkSettings\":{\"Bridge\":\""
    "docker0\",\"Gateway\":\"172.17.42.1\",\001\276";
  gsize limit = 2984;
  gsize spaces = G_MAXSIZE;
  gsize offset;

  offset = cockpit_json_skip (test_data, limit, &spaces);
  g_assert_cmpuint (offset, ==, 0);
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
  g_test_add_func ("/json/skip/truncated-in-escape", test_skip_truncated_in_escape);

  for (i = 0; i < G_N_ELEMENTS (equal_fixtures); i++)
    {
      name = g_strdup_printf ("/json/equal/%s", equal_fixtures[i].name);
      g_test_add_data_func (name, equal_fixtures + i, test_equal);
      g_free (name);
    }

  for (i = 0; i < G_N_ELEMENTS (string_fixtures); i++)
    {
      escaped = g_strescape (string_fixtures[i].str, NULL);
      name = g_strdup_printf ("/json/string/%s", escaped);
      g_test_add_data_func (name, string_fixtures + i, test_string_encode);
      g_free (escaped);
      g_free (name);
    }


  return g_test_run ();
}
