/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

#include "cockpitmachinesjson.h"
#include "common/cockpitconf.h"

#include <errno.h>
#include <glob.h>

static int
glob_err_func (const char *epath,
               int eerrno)
{
  /* Should Not Happen™ -- log the error for debugging */
  if (eerrno != ENOENT)
    g_warning ("%s: cannot read: %s", epath, g_strerror (eerrno));
  return 0;
}

static JsonNode *
new_object_node (void)
{
  JsonNode *n = json_node_new (JSON_NODE_OBJECT);
  json_node_take_object (n, json_object_new ());
  return n;
}

static JsonNode *
parse_json_file (const char *path)
{
  JsonParser *parser = NULL;
  GError *error = NULL;
  gboolean success;
  JsonNode *result = NULL;

  parser = json_parser_new ();
  success = json_parser_load_from_file (parser, path, &error);
  if (success)
    {
      result = json_parser_get_root (parser);
      /* root is NULL if the file is empty */
      if (result != NULL)
        {
          if (JSON_NODE_HOLDS_OBJECT (result))
            {
              result = json_node_copy (result);
            }
          else
            {
              g_message ("%s: does not contain a JSON object, ignoring", path);
              result = NULL;
            }
        }
    }
  else
    {
      if (error->code != G_FILE_ERROR_NOENT)
        g_message ("%s: invalid JSON: %s", path, error->message);
      g_error_free (error);
    }

  g_object_unref (parser);
  return result;
}

static gboolean
write_json_file (JsonNode *config, const char *path, GError **error)
{
  JsonGenerator *json_gen;
  gboolean res;

  json_gen = json_generator_new ();
  json_generator_set_root (json_gen, config);
  json_generator_set_pretty (json_gen, TRUE); /* bikeshed zone */
  res = json_generator_to_file (json_gen, path, error);
  g_object_unref (json_gen);
  return res;
}

static void
merge_config (JsonObject *machines,
              JsonObject *delta,
              const char *path)
{
  GList *hosts = json_object_get_members (delta);
  for (GList *i = g_list_first (hosts); i; i = g_list_next (i))
    {
      const char *hostname = i->data;
      JsonNode *delta_props = json_object_get_member (delta, hostname);

      if (!JSON_NODE_HOLDS_OBJECT (delta_props))
        {
          g_message ("%s: host name definition %s does not contain a JSON object, ignoring", path, hostname);
          continue;
        }

      /* merge delta properties info existing machines host */
      if (!json_object_has_member (machines, hostname))
        json_object_set_member (machines, hostname, new_object_node ());
      JsonObject *machine_props = json_object_get_object_member (machines, hostname);

      g_debug ("%s: merging updates to host name %s", path, hostname);
      GList *proplist = json_object_get_members (json_node_get_object (delta_props));
      for (GList *p = g_list_first (proplist); p; p = g_list_next (p))
        {
          const char *propname = p->data;
          JsonNode *prop_node = json_object_get_member (json_node_get_object (delta_props), propname);

          if (!JSON_NODE_HOLDS_VALUE (prop_node))
            {
              g_message ("%s: host name definition %s: property %s does not contain a simple value, ignoring", path, hostname, propname);
              continue;
            }

          g_debug ("%s:  host name %s: merging property %s", path, hostname, propname);
          json_object_set_member (machine_props, propname, json_node_copy (prop_node));
        }

      g_list_free (proplist);
    }

  g_list_free (hosts);
}

const char *
get_machines_json_dir (void)
{
  static gchar *path = NULL;
  if (path == NULL)
    path = g_build_filename (cockpit_conf_get_dirs ()[0], "cockpit", "machines.d", NULL);
  return path;
}

JsonNode *
read_machines_json (void)
{
  gchar *glob_str;
  glob_t conf_glob;
  int res;
  JsonNode *machines = NULL;

  /* find json config files */
  glob_str = g_build_filename (get_machines_json_dir (), "*.json", NULL);
  res = glob (glob_str, 0, glob_err_func, &conf_glob);
  if (G_UNLIKELY (res != 0 && res != GLOB_NOMATCH))
    {
      g_critical ("glob %s failed with return code %i", glob_str, res);
      globfree (&conf_glob);
      g_free (glob_str);
      return NULL;
    }

  /* start with an empty object */
  machines = new_object_node ();

  for (size_t i = 0; i < conf_glob.gl_pathc; ++i)
    {
      JsonNode *j = parse_json_file (conf_glob.gl_pathv[i]);
      if (j)
        {
          merge_config (json_node_get_object (machines), json_node_get_object (j), conf_glob.gl_pathv[i]);
          json_node_free (j);
        }
    }

  globfree (&conf_glob);
  g_free (glob_str);

  return machines;
}

/* iterator function for update_machines_json() */
static void
update_machine_property (JsonObject *object,
                         const gchar *member_name,
                         JsonNode *member_node,
                         gpointer user_data)
{
  json_object_set_member ((JsonObject *) user_data, member_name, json_node_copy (member_node));
}

gboolean
update_machines_json (const char *filename,
                      const char *hostname,
                      JsonNode *info,
                      GError **error)
{
  gchar *path;
  JsonNode *cur_config;
  JsonObject *cur_config_obj;
  JsonNode *cur_props;
  gboolean res;

  g_assert (JSON_NODE_HOLDS_OBJECT (info));

  path = g_build_filename (get_machines_json_dir (), filename, NULL);
  cur_config = parse_json_file (path);
  if (cur_config == NULL)
    cur_config = new_object_node ();
  cur_config_obj = json_node_get_object (cur_config);
  cur_props = json_object_get_member (cur_config_obj, hostname);

  if (cur_props)
    {
      /* update settings for hostname */
      g_assert (JSON_NODE_HOLDS_OBJECT (cur_props));
      json_object_foreach_member (json_node_get_object (info), update_machine_property, json_node_get_object (cur_props));
    }
  else
    {
      /* create new entry for host name */
      json_object_set_member (cur_config_obj, hostname, json_node_copy (info));
    }

  res = write_json_file (cur_config, path, error);
  g_free (path);
  json_node_free (cur_config);
  return res;
}
