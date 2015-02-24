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

#include "cockpitpackages.h"

#include "cockpitchannel.h"

#include "common/cockpitjson.h"
#include "common/cockpittemplate.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include <glib.h>

#include <string.h>

/* Overridable from tests */
const gchar **cockpit_bridge_data_dirs = NULL; /* default */

gint cockpit_bridge_packages_port = 0;

struct _CockpitPackages {
  CockpitWebServer *web_server;
  GHashTable *listing;
  gchar *checksum;
  JsonArray *json;
};

struct _CockpitPackage {
  int refs;
  gchar *name;
  gchar *directory;
  JsonObject *manifest;
  JsonNode *alias;
  gboolean system;
};

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
                                                const gchar *root,
                                                const gchar *directory);

static void
cockpit_package_unref (gpointer data)
{
  CockpitPackage *package = data;
  package->refs--;
  if (package->refs == 0)
    {
      g_debug ("%s: freeing package", package->name);
      g_free (package->name);
      g_free (package->directory);
      if (package->manifest)
        json_object_unref (package->manifest);
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
  static const gchar *allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
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

static gboolean
package_checksum_file (GChecksum *checksum,
                       const gchar *root,
                       const gchar *filename)
{
  gchar *path = NULL;
  gchar *string = NULL;
  GError *error = NULL;
  GMappedFile *mapped = NULL;
  gboolean ret = FALSE;
  GBytes *bytes;

  if (!validate_path (filename))
    {
      g_warning ("package has an invalid path name: %s", filename);
      goto out;
    }

  path = g_build_filename (root, filename, NULL);
  if (g_file_test (path, G_FILE_TEST_IS_DIR))
    {
      ret = package_checksum_directory (checksum, root, filename);
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
  string = g_compute_checksum_for_bytes (G_CHECKSUM_SHA1, bytes);
  g_bytes_unref (bytes);

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
  if (mapped)
    g_mapped_file_unref (mapped);
  g_free (string);
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
      ret = package_checksum_file (checksum, root, filename);
      g_free (filename);
      if (!ret)
        goto out;
    }

out:
  g_free (path);
  g_strfreev (names);
  return ret;
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

static CockpitPackage *
maybe_add_package (GHashTable *listing,
                   const gchar *parent,
                   const gchar *name,
                   GChecksum *checksum)
{
  CockpitPackage *package = NULL;
  gchar *path = NULL;
  JsonObject *manifest = NULL;

  package = g_hash_table_lookup (listing, name);
  if (package)
    {
      package = NULL;
      goto out;
    }

  path = g_build_filename (parent, name, NULL);

  manifest = read_package_manifest (path, name);
  if (!manifest)
    goto out;

  if (checksum)
    {
      if (!package_checksum_directory (checksum, path, NULL))
        goto out;
    }

  package = cockpit_package_new (name);

  package->directory = path;
  package->manifest = manifest;

  g_hash_table_replace (listing, package->name, package);
  g_debug ("%s: added package at %s", package->name, package->directory);

out:
  if (!package)
    {
      g_free (path);
      if (manifest)
        json_object_unref (manifest);
    }

  return package;
}

static gboolean
build_package_listing (GHashTable *listing,
                       GChecksum *checksum)
{
  const gchar *const *directories;
  CockpitPackage *package;
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
        {
          /* If any user packages installed, no checksum */
          if (maybe_add_package (listing, directory, packages[j], checksum))
            checksum = NULL;
        }
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
            {
              package = maybe_add_package (listing, directory, packages[j], checksum);
              if (package)
                package->system = TRUE;
            }
          g_strfreev (packages);
        }
      g_free (directory);
    }

  return checksum != NULL;
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

static void
build_packages (CockpitPackages *packages)
{
  JsonArray *root = NULL;
  CockpitPackage *package;
  GChecksum *checksum;
  GHashTable *ids;
  JsonObject *object;
  JsonArray *id;
  GList *names, *l;
  GList *list;
  const gchar *name;
  JsonNode *node;
  JsonArray *array;
  guint i, length;

  packages->listing = g_hash_table_new_full (g_str_hash, g_str_equal,
                                             NULL, cockpit_package_unref);

  checksum = g_checksum_new (G_CHECKSUM_SHA1);
  if (build_package_listing (packages->listing, checksum))
    packages->checksum = g_strdup (g_checksum_get_string (checksum));
  g_checksum_free (checksum);

  /* Add aliases to the listing */
  list = g_hash_table_get_values (packages->listing);
  list = g_list_sort (list, compar_packages);
  g_list_foreach (list, (GFunc)cockpit_package_ref, NULL);
  for (l = list; l != NULL; l = g_list_next (l))
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
                add_alias_to_listing (packages->listing, package, json_array_get_element (array, i));
            }
          else
            {
              add_alias_to_listing (packages->listing, package, node);
            }
        }
    }
  g_list_free_full (list, (GDestroyNotify)cockpit_package_unref);

  /* Build JSON packages block */
  packages->json = root = json_array_new ();
  ids = g_hash_table_new (g_direct_hash, g_direct_equal);
  names = g_hash_table_get_keys (packages->listing);
  names = g_list_sort (names, (GCompareFunc)strcmp);

  for (l = names; l != NULL; l = g_list_next (l))
    {
      name = l->data;
      package = g_hash_table_lookup (packages->listing, name);
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

gchar *
cockpit_packages_resolve (CockpitPackages *packages,
                          const gchar *name,
                          const gchar *path,
                          CockpitPackage **package)
{
  CockpitPackage *mod;

  if (!path || !name)
    return NULL;

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

  if (!validate_checksum (name) && !validate_package (name))
    {
      g_message ("invalid 'package' name: %s", name);
      return NULL;
    }

  mod = g_hash_table_lookup (packages->listing, name);
  if (mod == NULL)
    {
      g_debug ("resource package was not found: %s", name);
      return NULL;
    }

  if (package)
    *package = mod;
  return g_build_filename (mod->directory, path, NULL);
}

static gboolean
handle_package_checksum (CockpitWebServer *server,
                         const gchar *path,
                         GHashTable *headers,
                         CockpitWebResponse *response,
                         CockpitPackages *packages)
{
  GHashTable *out_headers;
  GBytes *content;

  if (packages->checksum)
    content = g_bytes_new (packages->checksum, strlen (packages->checksum));
  else
    content = g_bytes_new_static ("", 0);

  out_headers = cockpit_web_server_new_table ();
  g_hash_table_insert (out_headers, g_strdup ("Content-Type"), g_strdup ("text/plain"));

  cockpit_web_response_content (response, out_headers, content, NULL);
  g_bytes_unref (content);
  return TRUE;
}

static GBytes *
json_array_to_bytes (JsonArray *array)
{
  JsonNode *node;
  gsize length;
  gchar *ret;

  node = json_node_new (JSON_NODE_ARRAY);
  json_node_set_array (node, array);
  ret = cockpit_json_write (node, &length);
  json_node_free (node);

  return g_bytes_new_take (ret, length);
}

static void
add_cache_header (GHashTable *headers,
                  CockpitPackages *packages,
                  GHashTable *out_headers)
{
  const gchar *pragma;

  pragma = g_hash_table_lookup (headers, "Pragma");
  if (packages->checksum && (!pragma || !strstr (pragma, "no-cache")))
    g_hash_table_insert (out_headers, g_strdup ("Cache-Control"), g_strdup ("max-age=31556926, public"));
}

static gboolean
handle_package_manifest_js (CockpitWebServer *server,
                            const gchar *path,
                            GHashTable *headers,
                            CockpitWebResponse *response,
                            CockpitPackages *packages)
{
  GHashTable *out_headers;
  GBytes *content;
  GBytes *prefix;
  GBytes *suffix;

  prefix = g_bytes_new_static ("define(", 7);
  content = json_array_to_bytes (packages->json);
  suffix = g_bytes_new_static (");", 2);

  out_headers = cockpit_web_server_new_table ();
  add_cache_header (headers, packages, out_headers);

  cockpit_web_response_content (response, out_headers, prefix, content, suffix, NULL);

  g_hash_table_unref (out_headers);
  g_bytes_unref (prefix);
  g_bytes_unref (suffix);
  g_bytes_unref (content);
  return TRUE;
}

static gboolean
handle_package_manifest_json (CockpitWebServer *server,
                              const gchar *path,
                              GHashTable *headers,
                              CockpitWebResponse *response,
                              CockpitPackages *packages)
{
  GHashTable *out_headers;
  GBytes *content;

  out_headers = cockpit_web_server_new_table ();
  add_cache_header (headers, packages, out_headers);

  content = json_array_to_bytes (packages->json);

  cockpit_web_response_content (response, out_headers, content, NULL);

  g_hash_table_unref (out_headers);
  g_bytes_unref (content);

  return TRUE;
}

static gchar *
calculate_accept_path (const gchar *path,
                       const gchar *accept)
{
  const gchar *dot;
  const gchar *slash;

  dot = strrchr (path, '.');
  slash = strrchr (path, '/');

  if (dot == NULL)
    return NULL;
  if (slash != NULL && dot < slash)
    return NULL;

  return g_strdup_printf ("%.*s.%s%s",
                          (int)(dot - path), path, accept, dot);
}

static GMappedFile *
open_file (CockpitWebResponse *response,
           const gchar *filename,
           gboolean *retry)
{
  GMappedFile *mapped = NULL;
  GError *error = NULL;

  g_assert (retry);
  *retry = FALSE;

  mapped = g_mapped_file_new (filename, FALSE, &error);
  if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ISDIR) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NAMETOOLONG) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_LOOP) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL))
    {
      g_debug ("resource file was not found: %s", error->message);
      *retry = TRUE;
    }
  else if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ACCES) ||
           g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_PERM))
    {
      g_message ("%s", error->message);
      cockpit_web_response_error (response, 403, NULL, NULL);
    }
  else if (error)
    {
      g_message ("%s", error->message);
      cockpit_web_response_error (response, 500, NULL, NULL);
    }

  g_clear_error (&error);
  return mapped;
}

static GBytes *
expand_callback (const gchar *variable,
                 gpointer user_data)
{
  const gchar *base = user_data;

  if (g_str_equal (variable, "base"))
    return g_bytes_new (base, strlen (base));

  return NULL;
}

static void
resource_queue (GBytes *input,
                const gchar *base,
                CockpitWebResponse *response)
{
  GList *blocks, *l;

  if (base)
    {
      /* Expand checksum anywhere */
      blocks = cockpit_template_expand (input, expand_callback, (gpointer)base);
    }
  else
    {
      blocks = g_list_append (NULL, g_bytes_ref (input));
    }

  /* Also break data into blocks */
  for (l = blocks; l != NULL; l = g_list_next (l))
    {
      cockpit_web_response_queue (response, l->data);
      g_bytes_unref (l->data);
    }

  g_list_free (blocks);
}

static gboolean
handle_packages (CockpitWebServer *server,
                 const gchar *unused,
                 GHashTable *headers,
                 CockpitWebResponse *response,
                 CockpitPackages *packages)
{
  CockpitPackage *package;
  gchar *filename = NULL;
  GError *error = NULL;
  gchar *name;
  const gchar *path;
  GHashTable *out_headers = NULL;
  gchar **accept = NULL;
  gchar *alternate;
  GMappedFile *mapped = NULL;
  gchar *string = NULL;
  GBytes *bytes = NULL;
  gboolean retry;
  gboolean expand;
  gchar *base = NULL;
  guint i;

  name = cockpit_web_response_pop_path (response);
  if (name == NULL)
    {
      name = g_strdup ("shell");
      path = "shell.html";
      expand = TRUE;
    }
  else
    {
      path = cockpit_web_response_get_path (response);
      expand = FALSE;
    }

  out_headers = cockpit_web_server_new_table ();

  filename = cockpit_packages_resolve (packages, name, path, &package);
  if (!filename)
    {
      cockpit_web_response_error (response, 404, NULL, NULL);
      goto out;
    }

  add_cache_header (headers, packages, out_headers);
  accept = cockpit_web_server_parse_languages (headers, package->system ? "min" : NULL);

  retry = TRUE;
  for (i = 0; !mapped && retry && accept && accept[i] != NULL; i++)
    {
      alternate = calculate_accept_path (filename, accept[i]);
      if (alternate)
        {
          mapped = open_file (response, alternate, &retry);
          if (mapped)
            {
              if (!g_str_equal (accept[i], "min"))
                g_hash_table_insert (out_headers, g_strdup ("Vary"), g_strdup ("Accept-Language"));
            }
        }
      g_free (alternate);
    }

  if (!mapped)
    {
      if (retry)
        mapped = open_file (response, filename, &retry);
      if (!mapped)
        {
          if (retry)
            cockpit_web_response_error (response, 404, NULL, NULL);
          goto out;
        }
    }

  cockpit_web_response_headers_full (response, 200, "OK", -1, out_headers);

  /* Expand and queue the data */
  bytes = g_mapped_file_get_bytes (mapped);
  if (expand)
    {
      if (packages->checksum)
        base = g_strdup_printf ("$%s", packages->checksum);
      else
        base = g_strdup_printf ("@%s", (gchar *)g_hash_table_lookup (headers, "Host"));
    }
  resource_queue (bytes, base, response);
  g_bytes_unref (bytes);

  cockpit_web_response_complete (response);

out:
  if (out_headers)
    g_hash_table_unref (out_headers);
  if (mapped)
    g_mapped_file_unref (mapped);
  g_free (name);
  g_strfreev (accept);
  g_free (string);
  g_clear_error (&error);
  g_free (filename);
  g_free (base);

  return TRUE;
}

CockpitPackages *
cockpit_packages_new (void)
{
  CockpitPackages *packages = NULL;
  GError *error = NULL;
  gboolean ret = FALSE;
  GSocketAddress *address = NULL;
  GInetAddress *inet = NULL;
  GSocket *socket = NULL;

  socket = g_socket_new (G_SOCKET_FAMILY_IPV4, G_SOCKET_TYPE_STREAM, G_SOCKET_PROTOCOL_DEFAULT, &error);
  if (socket == NULL)
    {
      g_warning ("couldn't create local ipv4 socket: %s", error->message);
      goto out;
    }

  g_socket_set_listen_backlog (socket, 64);

  inet = g_inet_address_new_loopback (G_SOCKET_FAMILY_IPV4);
  address = g_inet_socket_address_new (inet, 0);
  g_object_unref (inet);

  if (!g_socket_bind (socket, address, TRUE, &error) ||
      !g_socket_listen (socket, &error))
    {
      g_warning ("couldn't bind and listen to local ipv4 socket: %s", error->message);
      goto out;
    }

  g_object_unref (address);
  address = g_socket_get_local_address (socket, &error);
  if (address == NULL)
    {
      g_warning ("couldn't get local ipv4 socket address: %s", error->message);
      goto out;
    }

  packages = g_new0 (CockpitPackages, 1);

  packages->web_server = cockpit_web_server_new (-1, NULL, NULL, NULL, &error);
  if (!packages->web_server)
    {
      g_warning ("couldn't initialize bridge package server: %s", error->message);
      goto out;
    }

  if (!cockpit_web_server_add_socket (packages->web_server, socket, &error))
    {
      g_warning ("couldn't add socket to package server: %s", error->message);
      goto out;
    }

  cockpit_bridge_packages_port = (gint)g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (address));
  cockpit_channel_internal_address ("packages", address);

  g_debug ("package server port: %d", cockpit_bridge_packages_port);


  g_signal_connect (packages->web_server, "handle-resource::/checksum",
                    G_CALLBACK (handle_package_checksum), packages);
  g_signal_connect (packages->web_server, "handle-resource::/manifest.js",
                    G_CALLBACK (handle_package_manifest_js), packages);
  g_signal_connect (packages->web_server, "handle-resource::/manifest.json",
                    G_CALLBACK (handle_package_manifest_json), packages);
  g_signal_connect (packages->web_server, "handle-resource",
                    G_CALLBACK (handle_packages), packages);

  build_packages (packages);
  ret = TRUE;

out:
  g_clear_error (&error);
  g_clear_object (&address);
  g_clear_object (&socket);

  if (!ret)
    {
      cockpit_packages_free (packages);
      packages = NULL;
    }

  return packages;
}

const gchar *
cockpit_packages_get_checksum (CockpitPackages *packages)
{
  g_return_val_if_fail (packages != NULL, NULL);
  return packages->checksum;
}

void
cockpit_packages_free (CockpitPackages *packages)
{
  if (!packages)
    return;
  if (packages->json)
    json_array_unref (packages->json);
  g_free (packages->checksum);
  if (packages->listing)
    g_hash_table_unref (packages->listing);
  g_clear_object (&packages->web_server);
  g_free (packages);
}

void
cockpit_packages_dump (void)
{
  CockpitPackages *packages;
  GHashTable *by_name;
  GHashTableIter iter;
  CockpitPackage *package;
  GList *names, *l;
  const gchar *prefix;
  JsonArray *array;
  guint i;

  packages = g_new0 (CockpitPackages, 1);
  build_packages (packages);

  by_name = g_hash_table_new (g_str_hash, g_str_equal);

  g_hash_table_iter_init (&iter, packages->listing);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&package))
    g_hash_table_replace (by_name, package->name, package);

  names = g_hash_table_get_keys (by_name);
  names = g_list_sort (names, (GCompareFunc)strcmp);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      package = g_hash_table_lookup (by_name, l->data);
      g_print ("%s: %s\n", package->name, package->directory);

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

  if (packages->checksum)
    g_print ("checksum = %s\n", packages->checksum);

  g_list_free (names);
  g_hash_table_unref (by_name);
  cockpit_packages_free (packages);
}
