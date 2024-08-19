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

#include <stdio.h>

#include "cockpitpackages.h"

#include "cockpitconnect.h"
#include "cockpitdbusinternal.h"

#include "common/cockpitchannel.h"
#include "common/cockpitconf.h"
#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitlocale.h"
#include "common/cockpitsystem.h"
#include "common/cockpittemplate.h"
#include "common/cockpitversion.h"
#include "common/cockpitwebinject.h"
#include "common/cockpitwebresponse.h"
#include "common/cockpitwebserver.h"

#include <glib.h>

#include <string.h>

/* Overridable from tests */
const gchar **cockpit_bridge_data_dirs = NULL; /* default */

static CockpitPackages *packages_singleton = NULL;

/* Packages might change while the bridge is running, and we support
   that with slightly complicated handling of checksums.

   The bridge reports a single checksum for the whole bundle of
   packages.  This is the checksum that ends up in URLs and cockpit-ws
   makes routing decisions based on it.

   When the packages change on disk, this bundle checksum also
   changes.  However, the bridge will not change what it reports; it
   will keep reporting the original bundle checksum.  This ensures
   that URLs that use the original checksum continue to work.

   The manifest for a package also contains a checksum, and this
   checksum will change when the package changes.  The shell can use
   this second checksum to decide whether to reload a component, for
   example.

   The checksum of a package in its manifest is also a bundle
   checksum.  More precisely, it is the oldest bundle checksum that
   the bridge has seen that includes the exact files of the given
   package.

   Thus, after the bridge has started, the reported checksum and all
   manifest checksums are the same.  If a new package appears but none
   of the old packages are changed, the new package has the new bundle
   checksum in its manifest, and all the old packages still have the
   reported checksum.

   In order to load the files of a new package, the shell should not
   use the reported bridge checksum.  The request might be routed to a
   wrong host that has the same reported checksum but not the new
   files.  Loading might also succeed, but the files will then be
   cached incorrectly.  If the new package changes again, we would
   still load its old files from the cache.

   The shell should also not use the new checksum from the manifest.
   Loading will not work because cockpit-ws does not know how to route
   that checksum.

   Thus, the shell needs to load a new (or updated) package with a
   "@<host>" URL path.

   In other words: The shell can treat the manifest checksum as a
   per-package checksum for deciding which packages have been updated.
   Furthermore, if the manifest checksum is equal to the reported
   bridge checksum, the shell can (and should) use that checksum in
   URLs to load files from that package.


   In order to detect whether a package has changed or not, the bridge
   also keeps track of per-package checksums.  These never appear in
   the API.
*/

struct _CockpitPackages {
  CockpitWebServer *web_server;
  GHashTable *listing;
  gchar *checksum;
  gchar *bundle_checksum;
  JsonObject *json;
  gchar *locale;

  gboolean dbus_inited;
  void (*on_change_callback) (gconstpointer data);
  gconstpointer on_change_callback_data;
  gboolean reload_hint;
};

struct _CockpitPackage {
  gchar *name;
  gchar *directory;
  JsonObject *manifest;
  GHashTable *paths;
  gchar *unavailable;
  gchar *content_security_policy;
  gchar *own_checksum;
  gchar *bundle_checksum;
};

/*
 * Note that the way we construct checksums is not a stable part of our ABI. It
 * can be changed, as long as it then produces a different set of checksums
 *
 * It is also *not* a security sensitive use case. The hashes are never shared
 * or compared between different users, only the same user (with same credentials)
 * on different machines.
 */

static gboolean   package_walk_directory   (GChecksum *own_checksum,
                                            GChecksum *bundle_checksum,
                                            GHashTable *paths,
                                            const gchar *root,
                                            const gchar *directory);

static void
cockpit_package_free (gpointer data)
{
  CockpitPackage *package = data;
  g_debug ("%s: freeing package", package->name);
  g_free (package->name);
  g_free (package->directory);
  g_free (package->content_security_policy);
  if (package->paths)
    g_hash_table_unref (package->paths);
  if (package->manifest)
    json_object_unref (package->manifest);
  g_free (package->unavailable);
  g_free (package->own_checksum);
  g_free (package->bundle_checksum);
  g_free (package);
}

static CockpitPackage *
cockpit_package_new (const gchar *name)
{
  CockpitPackage *package = g_new0 (CockpitPackage, 1);
  package->name = g_strdup (name);
  return package;
}

static gboolean
validate_package (const gchar *name)
{
  gsize len = strspn (name, COCKPIT_RESOURCE_PACKAGE_VALID);
  return len && name[len] == '\0';
}

static gboolean
validate_path (const gchar *name)
{
  static const gchar *allowed = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.,@/";
  gsize len = strspn (name, allowed);
  return len && name[len] == '\0';
}

static gboolean
package_walk_file (GChecksum *own_checksum,
                   GChecksum *bundle_checksum,
                   GHashTable *paths,
                   const gchar *root,
                   const gchar *filename)
{
  gchar *path = NULL;
  gchar *string = NULL;
  GError *error = NULL;
  GMappedFile *mapped = NULL;
  gboolean ret = FALSE;
  GBytes *bytes;

  /* Skip invalid files: we refuse to serve them (below) */
  if (!validate_path (filename))
    {
      g_debug ("package has an invalid path name: %s", filename);
      ret = TRUE;
      goto out;
    }

  path = g_build_filename (root, filename, NULL);
  if (g_file_test (path, G_FILE_TEST_IS_DIR))
    {
      ret = package_walk_directory (own_checksum, bundle_checksum, paths, root, filename);
      goto out;
    }

  mapped = g_mapped_file_new (path, FALSE, &error);
  if (error)
    {
      g_warning ("couldn't open file: %s: %s", path, error->message);
      g_error_free (error);
      goto out;
    }

  if (own_checksum && bundle_checksum)
    {
      bytes = g_mapped_file_get_bytes (mapped);
      string = g_compute_checksum_for_bytes (G_CHECKSUM_SHA256, bytes);
      g_bytes_unref (bytes);

      /*
       * Place file name and hex checksum into the checksums,
       * include the null terminators so these values
       * cannot be accidentally have a boundary discrepancy.
       */
      g_checksum_update (own_checksum, (const guchar *)filename,
                         strlen (filename) + 1);
      g_checksum_update (own_checksum, (const guchar *)string,
                         strlen (string) + 1);
      g_checksum_update (bundle_checksum, (const guchar *)filename,
                         strlen (filename) + 1);
      g_checksum_update (bundle_checksum, (const guchar *)string,
                         strlen (string) + 1);
    }

  if (paths)
    {
      g_hash_table_add (paths, path);
      path = NULL;
    }

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
package_walk_directory (GChecksum *own_checksum,
                        GChecksum *bundle_checksum,
                        GHashTable *paths,
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
      ret = package_walk_file (own_checksum, bundle_checksum, paths, root, filename);
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
read_json_file (const gchar *path,
                GError **error)
{
  g_autoptr(GMappedFile) mapped = g_mapped_file_new (path, FALSE, error);

  if (!mapped)
    return NULL;

  g_autoptr(GBytes) bytes = g_mapped_file_get_bytes (mapped);
  return cockpit_json_parse_bytes (bytes, error);
}

static GBytes *
expand_libexec (const gchar *variable,
                gpointer     user_data)
{
  if (g_str_equal (variable, "libexecdir"))
    return g_bytes_new (LIBEXECDIR, strlen (LIBEXECDIR));

  return NULL;
}

static void
apply_override (JsonObject *manifest,
                const char *path)
{
  g_autoptr(GError) error = NULL;

  g_autoptr(JsonObject) override = read_json_file (path, &error);
  if (override)
    {
      cockpit_json_patch (manifest, override);
    }
  else
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        g_debug ("no override found in %s", path);
      else
        g_warning ("couldn't read %s: %s", path, error->message);
    }
}

static JsonObject *
read_package_manifest (const gchar *directory,
                       const gchar *package)
{
  JsonObject *manifest = NULL;
  GError *error = NULL;

  g_autofree gchar *manifest_path = g_build_filename (directory, "manifest.json", NULL);
  manifest = read_json_file (manifest_path, &error);
  if (!manifest)
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        g_debug ("%s: no manifest found", package);
      else if (!g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOTDIR))
        g_warning ("%s: couldn't read manifest.json: %s", package, error->message);
      g_clear_error (&error);
    }
  else if (!validate_package (package))
    {
      g_warning ("%s: package has invalid name", package);
      json_object_unref (manifest);
      return NULL;
    }
  else
    {
      /* possible override locations, in ascending priority */
      g_autofree gchar *pkgdir_override = g_build_filename (directory, "override.json", NULL);
      /* same directory as the package itself */
      apply_override (manifest, pkgdir_override);

      g_autofree gchar *package_override_name = g_strconcat (package, ".override.json", NULL);

      const char * const *dirs = cockpit_conf_get_dirs ();
      for (gint i = 0; dirs[i]; i++)
        {
          g_autofree gchar *path = g_build_filename (dirs[i], "cockpit", package_override_name, NULL);
          apply_override (manifest, path);
        }

      g_autofree gchar *user_override = g_build_filename (g_get_user_config_dir (), "cockpit", package_override_name, NULL);
      apply_override (manifest, user_override);

      json_object_seal (manifest);

      JsonObject *expanded = cockpit_template_expand_json (manifest, "${", "}",
                                                           expand_libexec, NULL);
      json_object_unref (manifest);

      manifest = expanded;
    }

  return manifest;
}

static const gchar *
read_package_name (JsonObject *manifest,
                   const gchar *name)
{
  const gchar *value;

  if (!cockpit_json_get_string (manifest, "name", name, &value))
    {
      g_warning ("%s: invalid \"name\" field in package manifest", name);
      value = NULL;
    }
  else if (!validate_package (value))
    {
      g_warning ("%s: invalid package \"name\" field in manifest", name);
      value = NULL;
    }

  return value;
}

static gint
compar_manifest_priority (JsonObject *manifest1,
                          JsonObject *manifest2,
                          const gchar *name)
{
  gdouble priority1 = 1;
  gdouble priority2 = 1;

  if (!cockpit_json_get_double (manifest1, "priority", 1, &priority1) ||
      !cockpit_json_get_double (manifest2, "priority", 1, &priority2))
    {
      g_message ("%s%sinvalid \"priority\" field in package manifest",
                 name ? name : "", name ? ": " : "");
    }

  if (priority1 == priority2)
    return 0;
  else if (priority1 < priority2)
    return -1;
  else
    return 1;
}

static gint
compar_package_priority (gconstpointer value1,
                         gconstpointer value2,
                         gpointer user_data)
{
  const CockpitPackage *package1 = value1;
  const CockpitPackage *package2 = value2;
  return compar_manifest_priority (package1->manifest, package2->manifest, user_data);
}

static gboolean
check_package_compatible (CockpitPackage *package,
                          JsonObject *manifest)
{
  const gchar *minimum = NULL;
  JsonObject *requires;
  GList *l, *keys;

  if (!cockpit_json_get_object (manifest, "requires", NULL, &requires))
    {
      g_warning ("%s: invalid \"requires\" field", package->name);
      return FALSE;
    }

  if (!requires)
    return TRUE;

  if (!cockpit_json_get_string (requires, "cockpit", NULL, &minimum))
    {
      g_warning ("%s: invalid \"cockpit\" requirement field", package->name);
      return FALSE;
    }

  /*
   * This is the minimum version of the bridge and base package
   * which should always be shipped together.
   */
  if (minimum && cockpit_version_compare (PACKAGE_VERSION, minimum) < 0)
    {
      g_message ("%s: package requires a later version of cockpit: %s > %s",
                 package->name, minimum, PACKAGE_VERSION);
      package->unavailable = g_strdup_printf ("This package requires Cockpit version %s or later", minimum);
    }

  /* Look for any other unknown keys */
  keys = json_object_get_members (requires);
  for (l = keys; l != NULL; l = g_list_next (l))
    {
      /* All other requires are unknown until a later time */
      if (!g_str_equal (l->data, "cockpit"))
        {
          g_message ("%s: package has an unknown requirement: %s", package->name, (gchar *)l->data);
          package->unavailable = g_strdup ("This package is not compatible with this version of Cockpit");
        }
    }
  g_list_free (keys);

  return TRUE;
}

static gboolean
setup_package_manifest (CockpitPackage *package,
                        JsonObject *manifest)
{
  const gchar *field = "content-security-policy";
  const gchar *policy = NULL;

  if (!check_package_compatible (package, manifest))
    return FALSE;

  if (!cockpit_json_get_string (manifest, field, NULL, &policy) ||
      (policy && !cockpit_web_response_is_header_value (policy)))
    {
      g_warning ("%s: invalid %s: %s", package->name, field, policy);
      return FALSE;
    }

  package->content_security_policy = g_strdup (policy);
  json_object_remove_member (manifest, field);

  package->manifest = json_object_ref (manifest);
  return TRUE;
}

static gchar *
calc_package_directory (JsonObject *manifest,
                        const gchar *name,
                        const gchar *path)
{
  const gchar *base = NULL;

  /* See if the module override the base directory */
  if (!cockpit_json_get_string (manifest, "base", NULL, &base))
    {
      g_warning ("%s: invalid 'base' field in manifest", name);
      return NULL;
    }

  if (!base)
    {
      return g_strdup (path);
    }
  else if (g_path_is_absolute (base))
    {
      return g_strdup (base);
    }
  else
    {
      return g_build_filename (path, base, NULL);
    }
}

static CockpitPackage *
maybe_add_package (GHashTable *listing,
                   GHashTable *old_listing,
                   const gchar *parent,
                   const gchar *name,
                   GChecksum *bundle_checksum,
                   gboolean system)
{
  CockpitPackage *package = NULL;
  gchar *path = NULL;
  gchar *directory = NULL;
  JsonObject *manifest = NULL;
  GChecksum *own_checksum = NULL;
  GHashTable *paths = NULL;
  CockpitPackage *old_package;

  path = g_build_filename (parent, name, NULL);

  manifest = read_package_manifest (path, name);
  if (!manifest)
    goto out;

  /* Manifest could specify a different name */
  name = read_package_name (manifest, name);
  if (!name)
    goto out;

  /* In case the package is already present */
  package = g_hash_table_lookup (listing, name);
  if (package)
    {
      if (compar_manifest_priority (manifest, package->manifest, name) <= 0)
        {
          package = NULL;
          goto out;
        }
      else
        {
          package = NULL;
        }
    }

  directory = calc_package_directory (manifest, name, path);

  if (system)
    paths = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);

  if (bundle_checksum)
    own_checksum = g_checksum_new (G_CHECKSUM_SHA256);

  if (bundle_checksum || paths)
    {
      if (!package_walk_directory (own_checksum, bundle_checksum, paths, directory, NULL))
        goto out;
    }

  package = cockpit_package_new (name);
  package->directory = directory;
  directory = NULL;

  if (own_checksum)
    {
       /* digest the whole final manifest, which may have overrides from external directories */
      gsize manifest_len;
      g_autofree gchar *manifest_str = cockpit_json_write_object (manifest, &manifest_len);
      g_checksum_update (own_checksum, (guchar *) manifest_str, manifest_len);
      g_checksum_update (bundle_checksum, (guchar *) manifest_str, manifest_len);

       package->own_checksum = g_strdup (g_checksum_get_string (own_checksum));
    }

  // Keep the old bundle_checksum for this package if none of its
  // files has changed.
  if (old_listing)
    {
      old_package = g_hash_table_lookup (old_listing, name);
      if (old_package &&
          old_package->bundle_checksum &&
          old_package->own_checksum &&
          g_strcmp0 (old_package->own_checksum, package->own_checksum) == 0)
        {
          package->bundle_checksum = g_strdup (old_package->bundle_checksum);
        }
    }

  if (paths)
    package->paths = g_hash_table_ref (paths);

  if (!setup_package_manifest (package, manifest))
    {
      cockpit_package_free (package);
      package = NULL;
      goto out;
    }

  g_hash_table_replace (listing, package->name, package);
  g_debug ("%s: added package at %s", package->name, package->directory);

out:
  g_free (directory);
  g_free (path);
  if (manifest)
    json_object_unref (manifest);
  if (paths)
    g_hash_table_unref (paths);
  if (own_checksum)
    g_checksum_free (own_checksum);
  return package;
}

static gboolean
build_package_listing (GHashTable *listing,
                       GChecksum *checksum,
                       GHashTable *old_listing)
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
        {
          /* If any user packages installed, no checksum */
          if (maybe_add_package (listing, old_listing, directory, packages[j], checksum, FALSE))
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
            maybe_add_package (listing, old_listing, directory, packages[j], checksum, TRUE);
          g_strfreev (packages);
        }
      g_free (directory);
    }

  return checksum != NULL;
}

static void
build_packages (CockpitPackages *packages)
{
  GHashTable *old_listing;
  JsonObject *root = NULL;
  CockpitPackage *package;
  GChecksum *checksum;
  GList *names, *l;
  const gchar *name;

  old_listing = packages->listing;

  packages->listing = g_hash_table_new_full (g_str_hash, g_str_equal,
                                             NULL, cockpit_package_free);
  g_free (packages->bundle_checksum);
  packages->bundle_checksum = NULL;

  checksum = g_checksum_new (G_CHECKSUM_SHA256);
  if (build_package_listing (packages->listing, checksum, old_listing))
    {
      packages->bundle_checksum = g_strdup (g_checksum_get_string (checksum));
      if (!packages->checksum)
        packages->checksum = g_strdup (packages->bundle_checksum);
    }
  g_checksum_free (checksum);
  if (old_listing)
    g_hash_table_unref (old_listing);

  /* Build JSON packages block and fixup checksums */
  if (packages->json)
    json_object_unref (packages->json);
  packages->json = root = json_object_new ();
  if (packages->checksum)
    json_object_set_string_member (root, ".checksum", packages->checksum);

  names = g_hash_table_get_keys (packages->listing);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      name = l->data;
      package = g_hash_table_lookup (packages->listing, name);
      if (package->manifest) {
        json_object_set_object_member (root, name, json_object_ref (package->manifest));
        if (!package->bundle_checksum)
          package->bundle_checksum = g_strdup (packages->bundle_checksum);
        if (package->bundle_checksum)
          json_object_set_string_member (package->manifest, ".checksum", package->bundle_checksum);
      }
    }

  g_list_free (names);
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

  if (!validate_package (name))
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
                         CockpitWebRequest *request,
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

  if (packages->checksum)
    {
      g_hash_table_insert (out_headers, g_strdup (COCKPIT_CHECKSUM_HEADER),
                           g_strdup (packages->checksum));
    }

  cockpit_web_response_content (response, out_headers, content, NULL);
  g_bytes_unref (content);
  g_hash_table_unref (out_headers);
  return TRUE;
}

static void
set_manifest_headers (CockpitWebResponse *response,
                      CockpitPackages *packages,
                      GHashTable *out_headers)
{
  if (packages->checksum)
    {
      g_hash_table_insert (out_headers, g_strdup (COCKPIT_CHECKSUM_HEADER),
                           g_strdup (packages->checksum));
      g_hash_table_insert (out_headers, g_strdup ("ETag"),
                           g_strdup_printf ("\"$%s\"", packages->checksum));
    }
  else
    {
      cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);
    }
}

static gboolean
handle_package_manifests_js (CockpitWebServer *server,
                             CockpitWebRequest *request,
                             const gchar *path,
                             GHashTable *headers,
                             CockpitWebResponse *response,
                             CockpitPackages *packages)
{
  const gchar *template =
    "(function (root, data) { if (typeof define === 'function' && define.amd) { define(data); }"
    " if(typeof cockpit === 'object') { cockpit.manifests = data; }"
    " else { root.manifests = data; } }(this, ";
  GHashTable *out_headers;
  GBytes *content;
  GBytes *prefix;
  GBytes *suffix;

  prefix = g_bytes_new_static (template, strlen (template));
  content = cockpit_json_write_bytes (packages->json);
  suffix = g_bytes_new_static ("));", 3);

  out_headers = cockpit_web_server_new_table ();

  set_manifest_headers (response, packages, out_headers);
  cockpit_web_response_content (response, out_headers, prefix, content, suffix, NULL);

  g_hash_table_unref (out_headers);
  g_bytes_unref (prefix);
  g_bytes_unref (suffix);
  g_bytes_unref (content);
  return TRUE;
}

static gboolean
handle_package_manifests_json (CockpitWebServer *server,
                               CockpitWebRequest *request,
                               const gchar *path,
                               GHashTable *headers,
                               CockpitWebResponse *response,
                               CockpitPackages *packages)
{
  GHashTable *out_headers;
  GBytes *content;

  out_headers = cockpit_web_server_new_table ();

  content = cockpit_json_write_bytes (packages->json);

  set_manifest_headers (response, packages, out_headers);
  cockpit_web_response_content (response, out_headers, content, NULL);

  g_hash_table_unref (out_headers);
  g_bytes_unref (content);

  return TRUE;
}

static gboolean
package_content (CockpitPackages *packages,
                 CockpitWebResponse *response,
                 const gchar *name,
                 const gchar *path,
                 const gchar *language,
                 gboolean allow_gzipped,
                 const gchar *self_origin,
                 GHashTable *headers)
{
  GBytes *uncompressed = NULL;
  CockpitPackage *package;
  gboolean result = FALSE;
  gchar *filename = NULL;
  GError *error = NULL;
  GBytes *bytes = NULL;
  gboolean globbing;
  gboolean gzipped = FALSE;
  gboolean is_language_specific = FALSE;
  const gchar *type;
  gchar *policy;

  if (!self_origin)
    self_origin = cockpit_web_response_get_origin (response);

  GList *names;
  globbing = g_str_equal (name, "*");
  if (globbing)
    {
      names = g_hash_table_get_keys (packages->listing);
      names = g_list_sort (names, (GCompareFunc) g_strcmp0);

      /* When globbing files together no gzip encoding is possible */
      allow_gzipped = FALSE;
    }
  else
    names = g_list_prepend (NULL, (gchar *) name);

  for (GList *l = names; l != NULL; l = g_list_next (l))
    {
      name = l->data;
      g_free (filename);
      package = NULL;

      /* Resolve the path name and check it */
      filename = cockpit_packages_resolve (packages, name, path, &package);

      if (!filename)
        {
          /* On the first round */
          if (l == names)
            {
              /* cockpit_packages_resolve() only fails if the entire
               * package is missing.  Check if that's a package that
               * ought to have been available and issue a more helpful
               * message.
               */
              if (g_str_equal (name, "shell") || g_str_equal (name, "systemd"))
                cockpit_web_response_error (response, 404, NULL, "Server is missing the cockpit-system package");
              else
                cockpit_web_response_error (response, 404, NULL, NULL);
            }
          else
            cockpit_web_response_abort (response);
          goto out;
        }

      if (bytes)
        g_bytes_unref (bytes);

      g_clear_error (&error);

      bytes = cockpit_web_response_negotiation (filename, package ? package->paths : NULL, language, &is_language_specific, &gzipped, &error);

      /* HACK: if a translation file is missing, just return empty
       * content. This saves a whole lot of 404s in the developer
       * console when trying to fetch po.js for English, for example.
       * Note that error == NULL only in the 'not found' case.
       */
      if (bytes == NULL && error == NULL && g_str_has_suffix (filename, "/po.js"))
        {
          bytes = g_bytes_new_static ("", 0);
          is_language_specific = TRUE;
          gzipped = FALSE;
        }

      /* When globbing most errors result in a zero length block */
      if (globbing)
        {
          if (error)
            {
              g_message ("%s", error->message);
              bytes = g_bytes_new_static ("", 0);
              gzipped = FALSE;
              is_language_specific = FALSE;
            }
        }
      else
        {
          if (error)
            {
              if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ACCES) ||
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
              goto out;
            }
          else if (!bytes)
            {
              cockpit_web_response_error (response, 404, NULL, NULL);
              goto out;
            }
          else if (package && package->unavailable)
            {
              cockpit_web_response_error (response, 503, NULL, "%s", package->unavailable);
              goto out;
            }
        }

      /* If the response is language specific, don't cache the file. Caching "po.js" breaks
       * changing the language in Chromium, as that does not respect `Vary: Cookie` properly.
       * See https://github.com/cockpit-project/cockpit/issues/8160 */
      if (is_language_specific || globbing)
        cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);

      /* Do we need to decompress this content? */
      if (gzipped && !allow_gzipped)
        {
          g_clear_error (&error);
          uncompressed = cockpit_web_response_gunzip (bytes, &error);
          if (error)
            {
              g_message ("couldn't decompress: %s: %s", filename, error->message);
              g_clear_error (&error);
              uncompressed = g_bytes_new_static ("", 0);
            }
          g_bytes_unref (bytes);
          bytes = uncompressed;
          gzipped = FALSE;
        }

      /* The first one */
      if (l == names)
        {
          if (gzipped)
            g_hash_table_insert (headers, g_strdup ("Content-Encoding"), g_strdup ("gzip"));

          type = cockpit_web_response_content_type (path);
          if (type)
            {
              g_hash_table_insert (headers, g_strdup ("Content-Type"), g_strdup (type));
              if (g_str_has_prefix (type, "text/html"))
                {
                  if (package)
                    {
                      policy = cockpit_web_response_security_policy (package->content_security_policy,
                                                                     self_origin);
                      g_hash_table_insert (headers, g_strdup ("Content-Security-Policy"), policy);
                    }
                }
            }

          cockpit_web_response_headers_full (response, 200, "OK", -1, headers);
        }

      if (bytes && !cockpit_web_response_queue (response, bytes))
        goto out;
    }

  cockpit_web_response_complete (response);
  result = TRUE;

out:
  if (bytes)
    g_bytes_unref (bytes);
  g_list_free (names);
  g_free (filename);
  g_clear_error (&error);
  return result;
}

static gboolean
handle_packages (CockpitWebServer *server,
                 CockpitWebRequest *request,
                 const gchar *unused,
                 GHashTable *headers,
                 CockpitWebResponse *response,
                 CockpitPackages *packages)
{
  gchar *name;
  const gchar *path;
  GHashTable *out_headers = NULL;
  gchar **languages = NULL;
  gchar **encodings = NULL;
  gchar *origin = NULL;
  const gchar *protocol;
  const gchar *accept;
  const gchar *host;

  name = cockpit_web_response_pop_path (response);
  path = cockpit_web_response_get_path (response);

  if (name == NULL || path == NULL)
    {
      cockpit_web_response_error (response, 404, NULL, NULL);
      goto out;
    }

  out_headers = cockpit_web_server_new_table ();

  accept = g_hash_table_lookup (headers, "Accept-Language");
  languages = cockpit_web_server_parse_accept_list (accept, NULL);

  /*
   * This is how we find out about the frontends cockpitlang
   * environment. We tell this process to update its locale
   * if it has changed.
   */
  cockpit_locale_set_language (languages[0]);

  if (packages->checksum)
    {
      g_hash_table_insert (out_headers, g_strdup (COCKPIT_CHECKSUM_HEADER),
                           g_strdup (packages->checksum));
    }
  else
    {
      cockpit_web_response_set_cache_type (response, COCKPIT_WEB_RESPONSE_NO_CACHE);
    }

  protocol = g_hash_table_lookup (headers, "X-Forwarded-Proto");
  host = g_hash_table_lookup (headers, "X-Forwarded-Host");
  if (protocol && host)
    origin = g_strdup_printf ("%s://%s", protocol, host);
  if (origin)
    g_hash_table_insert (out_headers, g_strdup ("Access-Control-Allow-Origin"), origin);

  package_content (packages, response, name, path, languages[0],
                   cockpit_web_request_accepts_encoding (request, "gzip"),
                   origin, out_headers);

out:
  if (out_headers)
    g_hash_table_unref (out_headers);
  g_strfreev (languages);
  g_strfreev (encodings);
  g_free (name);
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

  g_assert (packages_singleton == NULL);

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

  packages->web_server = cockpit_web_server_new (NULL, COCKPIT_WEB_SERVER_NONE);

  g_signal_connect (packages->web_server, "handle-resource::/checksum",
                    G_CALLBACK (handle_package_checksum), packages);
  g_signal_connect (packages->web_server, "handle-resource::/manifests.js",
                    G_CALLBACK (handle_package_manifests_js), packages);
  g_signal_connect (packages->web_server, "handle-resource::/manifests.json",
                    G_CALLBACK (handle_package_manifests_json), packages);
  g_signal_connect (packages->web_server, "handle-resource",
                    G_CALLBACK (handle_packages), packages);

  build_packages (packages);
  ret = TRUE;

out:
  g_clear_error (&error);
  g_clear_object (&address);
  g_clear_object (&socket);

  if (ret)
    packages_singleton = packages;
  else
    cockpit_packages_free (packages);

  return packages_singleton;
}

GIOStream *
cockpit_packages_connect (void)
{
  g_return_val_if_fail (packages_singleton != NULL, NULL);

  return cockpit_web_server_connect (packages_singleton->web_server);
}

const gchar *
cockpit_packages_get_checksum (CockpitPackages *packages)
{
  g_return_val_if_fail (packages != NULL, NULL);
  return packages->checksum;
}

gchar **
cockpit_packages_get_names (CockpitPackages *packages)
{
  GHashTableIter iter;
  GPtrArray *array;
  gpointer key;
  gpointer value;
  CockpitPackage *package;

  g_return_val_if_fail (packages != NULL, NULL);

  array = g_ptr_array_new ();
  g_hash_table_iter_init (&iter, packages->listing);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      package = value;
      if (!package->unavailable)
        g_ptr_array_add (array, key);
    }
  g_ptr_array_add (array, NULL);

  return (gchar **)g_ptr_array_free (array, FALSE);
}

/**
 * cockpit_packages_get_bridges:
 * @packages: The packages object
 *
 * Get a list of configured "bridges" JSON config objects in
 * the order of priority. See doc/guide/ for the actual format
 * of the JSON objects.
 *
 * Returns: (transfer container): A list of JSONObject each owned
 *          by CockpitPackages. Free with g_list_free() when done.
 */
GList *
cockpit_packages_get_bridges (CockpitPackages *packages)
{
  CockpitPackage *package;
  GList *l, *listing;
  GList *result = NULL;
  JsonArray *bridges;
  JsonArray *bridge;
  JsonObject *item;
  JsonObject *match;
  gboolean privileged;
  const gchar *problem;
  JsonNode *node;
  guint i;

  g_return_val_if_fail (packages != NULL, NULL);

  listing = g_hash_table_get_values (packages->listing);
  listing = g_list_sort_with_data (listing, compar_package_priority, NULL);
  listing = g_list_reverse (listing);

  /* Convert every package to the equivalent bridge listing */
  for (l = listing; l != NULL; l = g_list_next (l))
    {
      package = l->data;
      if (!cockpit_json_get_array (package->manifest, "bridges", NULL, &bridges))
        {
          g_message ("%s: invalid \"bridges\" field in package manifest", package->name);
          continue;
        }

      for (i = 0; bridges && i < json_array_get_length (bridges); i++)
        {
          node = json_array_get_element (bridges, i);
          if (!node || !JSON_NODE_HOLDS_OBJECT (node))
            {
              g_message ("%s: invalid bridge in \"bridges\" field in package manifest", package->name);
              continue;
            }

          item = json_node_get_object (node);
          if (!cockpit_json_get_array (item, "spawn", NULL, &bridge))
            {
              g_message ("%s: invalid \"spawn\" field in package manifest", package->name);
            }
          else if (!cockpit_json_get_array (item, "environ", NULL, &bridge))
            {
              g_message ("%s: invalid \"environ\" field in package manifest", package->name);
            }
          else if (!cockpit_json_get_object (item, "match", NULL, &match))
            {
              g_message ("%s: invalid \"match\" field in package manifest", package->name);
            }
          else if (!cockpit_json_get_bool (item, "privileged", FALSE, &privileged))
            {
              g_message ("%s: invalid \"privileged\" field in package manifest", package->name);
            }
          else if ((match == NULL) != privileged)
            {
              g_message ("%s: Exactly one of \"match\" or \"privileged\" required", package->name);
            }
          else if (!cockpit_json_get_string (item, "problem", NULL, &problem))
            {
              g_message ("%s: invalid \"problem\" field in package manifest", package->name);
            }
          else
            {
              result = g_list_prepend (result, item);
            }
        }
    }

  g_list_free (listing);
  return g_list_reverse (result);
}

JsonObject *
cockpit_packages_peek_json (CockpitPackages *packages)
{
  return packages->json;
}

void
cockpit_packages_on_change (CockpitPackages *packages,
                            void (*callback) (gconstpointer user_data),
                            gconstpointer user_data)
{
  g_assert (callback == NULL || packages->on_change_callback == NULL);
  packages->on_change_callback = callback;
  packages->on_change_callback_data = user_data;
}

static void packages_emit_changed (CockpitPackages *packages);

void
cockpit_packages_reload (CockpitPackages *packages)
{
  build_packages (packages);
  if (packages->on_change_callback)
    packages->on_change_callback (packages->on_change_callback_data);
  packages_emit_changed (packages);
}

void
cockpit_packages_free (CockpitPackages *packages)
{
  if (!packages)
    return;

  g_assert (packages_singleton == packages);
  packages_singleton = NULL;

  if (packages->json)
    json_object_unref (packages->json);
  g_free (packages->bundle_checksum);
  g_free (packages->checksum);
  if (packages->listing)
    g_hash_table_unref (packages->listing);
  g_clear_object (&packages->web_server);
  g_free (packages);
}

static void
cockpit_packages_print_menu_labels (JsonObject *manifest,
                                    const gchar *menu_key,
                                    GString *result)
{
  JsonNode *node;
  JsonObject *menu;
  JsonObjectIter iter;
  JsonNode *member_node;

  node = json_object_get_member (manifest, menu_key);
  if (!node || !JSON_NODE_HOLDS_OBJECT (node))
    return;

  menu = json_node_get_object (node);

  json_object_iter_init (&iter, menu);
  while (json_object_iter_next (&iter, NULL, &member_node))
    {
      JsonObject *item;
      const gchar *label;

      if (!JSON_NODE_HOLDS_OBJECT (member_node))
        continue;

      item = json_node_get_object (member_node);
      if (!cockpit_json_get_string (item, "label", NULL, &label))
        continue;

      if (result->len > 0)
        g_string_append (result, ", ");

      g_string_append (result, label);
    }
}

void
cockpit_packages_dump (void)
{
  CockpitPackages *packages;
  GHashTable *by_name;
  GHashTableIter iter;
  CockpitPackage *package;
  GList *names, *l;

  g_assert (packages_singleton == NULL);

  packages = g_new0 (CockpitPackages, 1);
  packages_singleton = packages;

  build_packages (packages);

  by_name = g_hash_table_new (g_str_hash, g_str_equal);

  g_hash_table_iter_init (&iter, packages->listing);
  while (g_hash_table_iter_next (&iter, NULL, (gpointer *)&package))
    g_hash_table_replace (by_name, package->name, package);

  names = g_hash_table_get_keys (by_name);
  names = g_list_sort (names, (GCompareFunc)strcmp);
  for (l = names; l != NULL; l = g_list_next (l))
    {
      GString *menuitems = g_string_new (NULL);

      package = g_hash_table_lookup (by_name, l->data);

      cockpit_packages_print_menu_labels (package->manifest, "menu", menuitems);
      cockpit_packages_print_menu_labels (package->manifest, "tools", menuitems);

      g_print ("%-20.20s %-40.40s %s\n", package->name, menuitems->str, package->directory);

      g_string_free (menuitems, TRUE);
    }

  if (packages->checksum)
    g_print ("checksum = %s\n", packages->checksum);

  g_list_free (names);
  g_hash_table_unref (by_name);
  cockpit_packages_free (packages);
}

/* D-Bus interface */

static GVariant *
packages_get_manifests (CockpitPackages *packages)
{
  GBytes *content = cockpit_json_write_bytes (packages->json);
  GVariant *manifests = g_variant_new ("s", g_bytes_get_data (content, NULL));
  g_bytes_unref (content);
  return manifests;
}

static void
packages_emit_changed (CockpitPackages *packages)
{
  if (!packages->dbus_inited)
    return;

  GDBusConnection *connection = cockpit_dbus_internal_server ();
  if (!connection)
    return;

  GVariant *signal_value;
  GVariantBuilder builder;
  GError *error = NULL;

  g_variant_builder_init (&builder, G_VARIANT_TYPE ("a{sv}"));
  g_variant_builder_add (&builder, "{sv}", "Manifests", packages_get_manifests (packages));
  signal_value = g_variant_ref_sink (g_variant_new ("(sa{sv}as)", "cockpit.Packages", &builder, NULL));

  g_dbus_connection_emit_signal (connection,
                                 NULL,
                                 "/packages",
                                 "org.freedesktop.DBus.Properties",
                                 "PropertiesChanged",
                                 signal_value,
                                 &error);
  if (error != NULL)
    {
      if (!g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CLOSED))
        g_critical ("failed to send PropertiesChanged signal: %s", error->message);
      g_error_free (error);
    }
  g_variant_unref (signal_value);
}

static void
packages_method_call (GDBusConnection *connection,
                      const gchar *sender,
                      const gchar *object_path,
                      const gchar *interface_name,
                      const gchar *method_name,
                      GVariant *parameters,
                      GDBusMethodInvocation *invocation,
                      gpointer user_data)
{
  CockpitPackages *packages = user_data;

  if (g_str_equal (method_name, "Reload"))
    {
      cockpit_packages_reload (packages);
      g_dbus_method_invocation_return_value (invocation, NULL);
    }
  else if (g_str_equal (method_name, "ReloadHint"))
    {
      if (packages->reload_hint)
        cockpit_packages_reload (packages);
      packages->reload_hint = TRUE;
      g_dbus_method_invocation_return_value (invocation, NULL);
    }
  else
    g_return_if_reached ();
}

static GVariant *
packages_get_property (GDBusConnection *connection,
                       const gchar *sender,
                       const gchar *object_path,
                       const gchar *interface_name,
                       const gchar *property_name,
                       GError **error,
                       gpointer user_data)
{
  CockpitPackages *packages = user_data;

  g_return_val_if_fail (property_name != NULL, NULL);

  if (g_str_equal (property_name, "Manifests"))
    return packages_get_manifests (packages);
  else
    g_return_val_if_reached (NULL);
}

static GDBusInterfaceVTable packages_vtable = {
  .method_call = packages_method_call,
  .get_property = packages_get_property,
};

static GDBusMethodInfo packages_reload_method = {
  -1, "Reload", NULL, NULL, NULL
};

static GDBusMethodInfo packages_reload_hint_method = {
  -1, "ReloadHint", NULL, NULL, NULL
};

static GDBusMethodInfo *packages_methods[] = {
  &packages_reload_method,
  &packages_reload_hint_method,
  NULL
};

static GDBusPropertyInfo packages_manifests_property = {
  -1, "Manifests", "s", G_DBUS_PROPERTY_INFO_FLAGS_READABLE, NULL
};

static GDBusPropertyInfo *packages_properties[] = {
  &packages_manifests_property,
  NULL
};

static GDBusInterfaceInfo packages_interface = {
  -1, "cockpit.Packages",
  packages_methods,
  NULL, /* signals */
  packages_properties,
  NULL  /* annotations */
};

void
cockpit_packages_dbus_startup (CockpitPackages *packages)
{
  GDBusConnection *connection;
  GError *error = NULL;

  connection = cockpit_dbus_internal_server ();
  g_return_if_fail (connection != NULL);

  g_dbus_connection_register_object (connection, "/packages", &packages_interface,
                                     &packages_vtable, packages, NULL, &error);

  g_object_unref (connection);

  if (error != NULL)
    {
      g_critical ("couldn't register DBus cockpit.Packages object: %s", error->message);
      g_error_free (error);
      return;
    }

  packages->dbus_inited = TRUE;
}
