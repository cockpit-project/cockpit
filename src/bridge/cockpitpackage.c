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

#include "cockpitpackage.h"

#include "common/cockpitjson.h"
#include "common/cockpittemplate.h"

#include <glib.h>

#include <string.h>

/* Overridable from tests */
const gchar **cockpit_bridge_data_dirs = NULL; /* default */

/*
 * Note that the way we construct checksums is not a stable part of our ABI. It
 * can be changed, as long as it then produces a different set of checksums
 *
 * It is also *not* a security sensitive use case. The hashes are never shared
 * or compared between different users, only the same user (with same credentials)
 * on different machines.
 *
 * So we use the fastest, good ol' SHA1.
 */

static gboolean   package_checksum_directory   (GChecksum *checksum,
                                                GHashTable *depends,
                                                const gchar *root,
                                                const gchar *directory);

typedef struct {
  int refs;
  gchar *name;
  gchar *checksum;
  gchar *raw_checksum;
  gboolean checksum_finished;
  gchar *directory;
  GHashTable *depends;
  JsonObject *manifest;
  JsonNode *alias;
} CockpitPackage;

static void
cockpit_package_unref (gpointer data)
{
  CockpitPackage *package = data;
  package->refs--;
  if (package->refs == 0)
    {
      g_debug ("%s: freeing package", package->name);
      g_free (package->name);
      g_free (package->checksum);
      g_free (package->raw_checksum);
      g_free (package->directory);
      if (package->manifest)
        json_object_unref (package->manifest);
      if (package->depends)
        g_hash_table_unref (package->depends);
      if (package->alias)
        json_node_free (package->alias);
      g_free (package);
    }
}

static CockpitPackage *
cockpit_package_ref (CockpitPackage *package)
{
  package->refs++;
  return package;
}

static CockpitPackage *
cockpit_package_new (const gchar *name)
{
  CockpitPackage *package = g_new0 (CockpitPackage, 1);
  package->name = g_strdup (name);
  package->refs = 1;
  return package;
}

static gboolean
validate_package (const gchar *name)
{
  static const gchar *allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_";
  gsize len = strspn (name, allowed);
  return len && name[len] == '\0';
}

static gboolean
validate_checksum (const gchar *name)
{
  static const gchar *allowed = "abcdef0123456789";
  gsize len;

  if (name[0] != '$')
    return FALSE;

  name++;
  len = strspn (name, allowed);
  return len && name[len] == '\0';
}


static gboolean
validate_path (const gchar *name)
{
  static const gchar *allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.,/";
  gsize len = strspn (name, allowed);
  return len && name[len] == '\0';
}

static GBytes *
gather_depends (const gchar *variable,
                gpointer user_data)
{
  GHashTable *depends = user_data;
  g_hash_table_add (depends, g_strdup (variable));
  return NULL; /* Checksum original data */
}

static gboolean
package_checksum_file (GChecksum *checksum,
                       GHashTable *depends,
                       const gchar *root,
                       const gchar *filename)
{
  gchar *path = NULL;
  const gchar *string;
  GError *error = NULL;
  GChecksum *inner = NULL;
  GMappedFile *mapped = NULL;
  gboolean ret = FALSE;
  GList *output = NULL;
  GBytes *bytes;
  GList *l;

  if (!validate_path (filename))
    {
      g_warning ("package has an invalid path name: %s", filename);
      goto out;
    }

  path = g_build_filename (root, filename, NULL);
  if (g_file_test (path, G_FILE_TEST_IS_DIR))
    {
      ret = package_checksum_directory (checksum, depends, root, filename);
      goto out;
    }

  mapped = g_mapped_file_new (path, FALSE, &error);
  if (error)
    {
      g_warning ("couldn't open file: %s: %s", path, error->message);
      g_error_free (error);
      goto out;
    }

  bytes = g_mapped_file_get_bytes (mapped);
  output = cockpit_template_expand (bytes, gather_depends, depends);
  g_bytes_unref (bytes);

  inner = g_checksum_new (G_CHECKSUM_SHA1);

  for (l = output; l != NULL; l = g_list_next (l))
    {
      g_checksum_update (inner,
                         g_bytes_get_data (l->data, NULL),
                         g_bytes_get_size (l->data));
    }

  string = g_checksum_get_string (inner);

  /*
   * Place file name and hex checksum into checksum,
   * include the null terminators so these values
   * cannot be accidentally have a boundary discrepancy.
   */
  g_checksum_update (checksum, (const guchar *)filename,
                     strlen (filename) + 1);
  g_checksum_update (checksum, (const guchar *)string,
                     strlen (string) + 1);
  ret = TRUE;

out:
  g_list_free_full (output, (GDestroyNotify)g_bytes_unref);
  g_checksum_free (inner);
  if (mapped)
    g_mapped_file_unref (mapped);
  g_free (path);
  return ret;
}

static gint
compare_filenames (gconstpointer v1,
                   gconstpointer v2)
{
  const gchar *const *s1 = v1;
  const gchar *const *s2 = v2;

  /* Just a simple byte compare, nothing fancy */
  return strcmp (*s1, *s2);
}

static gchar **
directory_filenames (const char *directory)
{
  GError *error = NULL;
  GPtrArray *names;
  const gchar *name;
  GDir *dir;

  dir = g_dir_open (directory, 0, &error);
  if (error != NULL)
    {
      g_warning ("couldn't list directory: %s: %s", directory, error->message);
      g_error_free (error);
      return FALSE;
    }

  names = g_ptr_array_new ();
  for (;;)
    {
      name = g_dir_read_name (dir);
      if (!name)
        break;
      g_ptr_array_add (names, g_strdup (name));
    }

  g_dir_close (dir);

  g_ptr_array_sort (names, compare_filenames);
  g_ptr_array_add (names, NULL);

  return (gchar **)g_ptr_array_free (names, FALSE);
}

static gboolean
package_checksum_directory (GChecksum *checksum,
                            GHashTable *depends,
                            const gchar *root,
                            const gchar *directory)
{
  gboolean ret = FALSE;
  gchar *path = NULL;
  gchar **names = NULL;
  gchar *filename;
  gint i;

  path = g_build_filename (root, directory, NULL);
  names = directory_filenames (path);
  if (!names)
    goto out;

  ret = TRUE;
  for (i = 0; names[i] != NULL; i++)
    {
      if (directory)
        filename = g_build_filename (directory, names[i], NULL);
      else
        filename = g_strdup (names[i]);
      ret = package_checksum_file (checksum, depends, root, filename);
      g_free (filename);
      if (!ret)
        goto out;
    }

out:
  g_free (path);
  g_strfreev (names);
  return ret;
}

static gchar *
package_checksum (GHashTable *depends,
                 const gchar *path)
{
  GChecksum *checksum;
  gchar *string = NULL;

  checksum = g_checksum_new (G_CHECKSUM_SHA1);
  if (package_checksum_directory (checksum, depends, path, NULL))
    string = g_strdup (g_checksum_get_string (checksum));
  g_checksum_free (checksum);

  return string;
}

static JsonObject *
read_package_manifest (const gchar *directory,
                       const gchar *package)
{
  JsonObject *manifest = NULL;
  GError *error = NULL;
  GMappedFile *mapped;
  gchar *filename;
  GBytes *bytes;

  filename = g_build_filename (directory, "manifest.json", NULL);
  mapped = g_mapped_file_new (filename, FALSE, &error);
  if (!mapped)
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        g_debug ("no manifest found: %s", filename);
      else if (!g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOTDIR))
        g_message ("%s: %s", package, error->message);
      g_clear_error (&error);
    }
  else
    {
     if (!validate_package (package))
       {
         g_warning ("package has invalid name: %s", package);
       }
     else
       {
         bytes = g_mapped_file_get_bytes (mapped);
         manifest = cockpit_json_parse_bytes (bytes, &error);
         g_bytes_unref (bytes);

         if (!manifest)
           {
             g_message ("%s: invalid manifest: %s", package, error->message);
             g_clear_error (&error);
           }
       }

      g_mapped_file_unref (mapped);
    }

  g_free (filename);
  return manifest;
}

static void
maybe_add_package (GHashTable *listing,
                   const gchar *parent,
                   const gchar *name,
                   gboolean do_checksum)
{
  CockpitPackage *package = NULL;
  gchar *path = NULL;
  GHashTable *depends = NULL;
  JsonObject *manifest = NULL;
  gchar *checksum = NULL;

  if (g_hash_table_lookup (listing, name))
    goto out;

  path = g_build_filename (parent, name, NULL);

  manifest = read_package_manifest (path, name);
  if (!manifest)
    goto out;

  if (do_checksum)
    {
      depends = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
      checksum = package_checksum (depends, path);
      if (!checksum)
        goto out;
    }

  package = cockpit_package_new (name);

  package->directory = path;
  package->manifest = manifest;
  package->depends = depends;
  package->raw_checksum = checksum;

  g_hash_table_replace (listing, package->name, package);
  g_debug ("%s: added package at %s", package->name, package->directory);

out:
  if (!package)
    {
      g_free (path);
      if (depends)
        g_hash_table_unref (depends);
      if (manifest)
        json_object_unref (manifest);
      g_free (checksum);
    }
}

static void
build_package_listing (GHashTable *listing)
{
  const gchar *const *directories;
  gchar *directory = NULL;
  gchar **packages;
  gint i, j;

  /* User package directory: no checksums */
  if (!cockpit_bridge_data_dirs)
    directory = g_build_filename (g_get_user_data_dir (), "cockpit", NULL);
  if (directory && g_file_test (directory, G_FILE_TEST_IS_DIR))
    {
      packages = directory_filenames (directory);
      for (j = 0; packages[j] != NULL; j++)
        maybe_add_package (listing, directory, packages[j], FALSE);
      g_strfreev (packages);
    }
  g_free (directory);

  /* System package directories */
  if (cockpit_bridge_data_dirs)
    directories = cockpit_bridge_data_dirs;
  else
    directories = g_get_system_data_dirs ();

  for (i = 0; directories[i] != NULL; i++)
    {
      directory = g_build_filename (directories[i], "cockpit", NULL);
      if (g_file_test (directory, G_FILE_TEST_IS_DIR))
        {
          packages = directory_filenames (directory);
          for (j = 0; packages && packages[j] != NULL; j++)
            maybe_add_package (listing, directory, packages[j], TRUE);
          g_strfreev (packages);
        }
      g_free (directory);
    }
}

static void
finish_checksums (GHashTable *listing)
{
  GList *names, *l;
  GList *depends, *k;
  GChecksum *checksum;
  CockpitPackage *package;
  CockpitPackage *dep;

  /*
   * We have to fold the checksums of any dependencies into the checksum of this
   * package, so that when the dependencies change their checksum, then this package
   * gets a new checksum, which causes it to be reloaded and templates to kick in
   * again.
   *
   * All checksums are prefixed with '$'. We add this here.
   *
   * If a dependency doesn't have a checksum, then the dependent package also doesn't
   * have a checksum.
   */

  names = g_hash_table_get_keys (listing);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      package = g_hash_table_lookup (listing, l->data);

      /* A package might be in the hastable under multiple names, but
       * we only want to process it once.
       */
      if (package->checksum_finished)
        continue;

      if (!package->raw_checksum)
        continue;

      checksum = g_checksum_new (G_CHECKSUM_SHA1);
      g_checksum_update (checksum, (const guchar *)package->raw_checksum, -1);

      depends = package->depends ? g_hash_table_get_keys (package->depends) : NULL;
      depends = g_list_sort (depends, (GCompareFunc)strcmp);
      for (k = depends; k != NULL; k = g_list_next (k))
        {
          dep = g_hash_table_lookup (listing, k->data);
          if (dep == package)
            continue;

          /* No dependency, or no dependency checksum -> bail */
          if (!dep || !dep->raw_checksum)
            {
              g_checksum_free (checksum);
              checksum = NULL;
              break;
            }

          g_checksum_update (checksum, (const guchar *)dep->raw_checksum, -1);
        }
      g_list_free (depends);

      if (checksum)
        {
          package->checksum = g_strdup_printf ("$%s", g_checksum_get_string (checksum));
          g_checksum_free (checksum);
        }

      package->checksum_finished = TRUE;
    }
  g_list_free (names);
}

static void
add_alias_to_listing (GHashTable *listing,
                      CockpitPackage *package,
                      JsonNode *node)
{
  const gchar *value;

  if (JSON_NODE_HOLDS_VALUE (node) && json_node_get_value_type (node) == G_TYPE_STRING)
    {
      value = json_node_get_string (node);
      if (validate_package (value))
        {
          g_hash_table_replace (listing, (gchar *)value, cockpit_package_ref (package));
          g_debug ("%s: package has alias: %s", package->name, value);
        }
      else
        {
          g_message ("invalid \"alias\" package name: \"%s\"", value);
        }
    }
  else
    {
      g_message ("invalid \"alias\" value type: \"%s\"", json_node_type_name (node));
    }
}

static gint
compar_packages (gconstpointer v1,
                 gconstpointer v2)
{
  return strcmp (((CockpitPackage *)v1)->name,
                 ((CockpitPackage *)v2)->name);
}

GHashTable *
cockpit_package_listing (JsonArray **json)
{
  JsonArray *root = NULL;
  GHashTable *listing;
  CockpitPackage *package;
  GHashTable *ids;
  JsonObject *object;
  JsonArray *id;
  GList *names, *l;
  GList *packages;
  const gchar *name;
  JsonNode *node;
  JsonArray *array;
  guint i, length;

  listing = g_hash_table_new_full (g_str_hash, g_str_equal,
                                   NULL, cockpit_package_unref);

  build_package_listing (listing);

  /* Add aliases to the listing */
  packages = g_hash_table_get_values (listing);
  packages = g_list_sort (packages, compar_packages);
  g_list_foreach (packages, (GFunc)cockpit_package_ref, NULL);
  for (l = packages; l != NULL; l = g_list_next (l))
    {
      package = l->data;

      node = json_object_get_member (package->manifest, "alias");
      if (node)
        {
          /*
           * Process and remove "alias" from the manifest, as it results in
           * confusing and duplicated information for the front end.
           */
          package->alias = node = json_node_copy (node);
          json_object_remove_member (package->manifest, "alias");

          if (JSON_NODE_HOLDS_ARRAY (node))
            {
              array = json_node_get_array (node);
              length = json_array_get_length (array);
              for (i = 0; i < length; i++)
                add_alias_to_listing (listing, package, json_array_get_element (array, i));
            }
          else
            {
              add_alias_to_listing (listing, package, node);
            }
        }
    }
  g_list_free_full (packages, (GDestroyNotify)cockpit_package_unref);

  /* Now wrap up the checksums */
  finish_checksums (listing);

  /* Add checksums to the listing */
  packages = g_hash_table_get_values (listing);
  g_list_foreach (packages, (GFunc)cockpit_package_ref, NULL);
  for (l = packages; l != NULL; l = g_list_next (l))
    {
      package = l->data;
      if (package->checksum && !g_hash_table_contains (listing, package->checksum))
        {
          g_hash_table_replace (listing, package->checksum, cockpit_package_ref (package));
          g_debug ("%s: package has checksum: %s", package->name, package->checksum);
        }
    }
  g_list_free_full (packages, (GDestroyNotify)cockpit_package_unref);

  /* Build JSON packages block */
  if (json)
    {
      *json = root = json_array_new ();
      ids = g_hash_table_new (g_direct_hash, g_direct_equal);
      names = g_hash_table_get_keys (listing);
      names = g_list_sort (names, (GCompareFunc)strcmp);

      for (l = names; l != NULL; l = g_list_next (l))
        {
          name = l->data;
          package = g_hash_table_lookup (listing, name);
          id = g_hash_table_lookup (ids, package);
          if (!id)
            {
              object = json_object_new ();
              id = json_array_new();

              /* The actual package name always comes first */
              json_object_set_array_member (object, "id", id);
              json_array_add_string_element (id, package->name);
              g_hash_table_insert (ids, package, id);

              json_object_set_object_member (object, "manifest", json_object_ref (package->manifest));
              json_array_add_object_element (root, object);
            }

          /* Other ways to refer to the package */
          if (!g_str_equal (name, package->name))
              json_array_add_string_element (id, name);
        }

      g_list_free (names);
      g_hash_table_destroy (ids);
    }

  return listing;
}

gchar *
cockpit_package_resolve (GHashTable *listing,
                         const gchar *package,
                         const gchar *path)
{
  CockpitPackage *mod;

  /*
   * This is *not* a security check. We're accessing files as the user.
   * What this does is prevent package authors from drawing outside the
   * lines. Keeps everyone honest.
   */
  if (strstr (path, "../") || strstr (path, "/..") || !validate_path (path))
    {
      g_message ("invalid 'path' used as a resource: %s", path);
      return NULL;
    }

  if (!validate_checksum (package) && !validate_package (package))
    {
      g_message ("invalid 'package' name: %s", package);
      return NULL;
    }

  mod = g_hash_table_lookup (listing, package);
  if (mod == NULL)
    {
      g_debug ("resource package was not found: %s", package);
      return NULL;
    }

  return g_build_filename (mod->directory, path, NULL);
}

typedef struct {
  GHashTable *listing;
  const gchar *host;
} ExpandInfo;

static GBytes *
expand_variables (const gchar *variable,
                  gpointer user_data)
{
  ExpandInfo *expand = user_data;
  CockpitPackage *package;
  gchar *val;

  package = g_hash_table_lookup (expand->listing, variable);
  if (package)
    {
      if (package->checksum)
        {
          return g_bytes_new_with_free_func (package->checksum, strlen (package->checksum),
                                             cockpit_package_unref,
                                             cockpit_package_ref (package));
        }
      else if (expand->host)
        {
          val = g_strdup_printf ("%s@%s", package->name, expand->host);
          return g_bytes_new_take (val, strlen (val));
        }
      else
        {
          return g_bytes_new_with_free_func (package->name, strlen (package->name),
                                             cockpit_package_unref,
                                             cockpit_package_ref (package));
        }
    }
  else
    {
      return g_bytes_new (variable, strlen (variable));
    }
}

static gboolean
is_binary_data (GBytes *bytes)
{
  gsize length;
  gconstpointer data = g_bytes_get_data (bytes, &length);
  return (memchr (data, '\0', length) != NULL);
}

void
cockpit_package_expand (GHashTable *listing,
                        const gchar *host,
                        GBytes *input,
                        GQueue *output)
{
  ExpandInfo expand = { listing, host };
  GList *blocks;
  GList *l;
  gsize size;
  gsize length;
  gsize offset;

  if (is_binary_data (input))
    {
      /* If binary data, no variable expansion takes place */
      blocks = g_list_prepend (NULL, g_bytes_ref (input));
    }
  else
    {
      /* Expand all variables */
      blocks = cockpit_template_expand (input, expand_variables, &expand);
    }

  /* Also break data into blocks */
  for (l = blocks; l != NULL; l = g_list_next (l))
    {
      size = g_bytes_get_size (l->data);
      if (size < 8192)
        {
          g_queue_push_tail (output, l->data);
        }
      else
        {
          for (offset = 0; offset < size; offset += 4096)
            {
              length = MIN (4096, size - offset);
              g_queue_push_tail (output, g_bytes_new_from_bytes (l->data, offset, length));
            }
          g_bytes_unref (l->data);
        }
    }

  g_list_free (blocks);
}

void
cockpit_package_dump (void)
{
  GHashTable *listing;
  GHashTable *by_name;
  GHashTableIter iter;
  CockpitPackage *package;
  GList *names, *l;
  const gchar *prefix;
  JsonArray *array;
  guint i;

  listing = cockpit_package_listing (NULL);
  by_name = g_hash_table_new (g_str_hash, g_str_equal);

  g_hash_table_iter_init (&iter, listing);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&package))
    g_hash_table_replace (by_name, package->name, package);

  names = g_hash_table_get_keys (by_name);
  names = g_list_sort (names, (GCompareFunc)strcmp);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      package = g_hash_table_lookup (by_name, l->data);
      g_print ("%s: %s\n", package->name, package->directory);
      if (package->checksum)
        g_print ("    checksum: %s\n", package->checksum);

      if (package->alias)
        {
          prefix = "    alias: ";
          if (JSON_NODE_HOLDS_ARRAY (package->alias))
            {
              array = json_node_get_array (package->alias);
              for (i = 0; i < json_array_get_length (array); i++)
                {
                  g_print ("%s%s\n", prefix, json_array_get_string_element (array, i));
                  prefix = "           ";
                }
            }
          else
            {
              g_print ("%s%s\n", prefix, json_node_get_string (package->alias));
            }
        }
    }

  g_list_free (names);
  g_hash_table_unref (by_name);
  g_hash_table_unref (listing);
}
