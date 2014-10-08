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

#include "cockpitresource.h"

#include "common/cockpitjson.h"

#include <glib.h>

#include <string.h>

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

static gboolean
package_checksum_file (GChecksum *checksum,
                       const gchar *root,
                       const gchar *filename)
{
  gchar *path = NULL;
  const gchar *string;
  GError *error = NULL;
  GChecksum *inner = NULL;
  GMappedFile *mapped = NULL;
  gboolean ret = FALSE;

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

  inner = g_checksum_new (G_CHECKSUM_SHA1);
  g_checksum_update (inner,
                     (const guchar *)g_mapped_file_get_contents (mapped),
                     g_mapped_file_get_length (mapped));
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

static gchar *
package_checksum (const gchar *root,
                  const gchar *package)
{
  GChecksum *checksum;
  gchar *string = NULL;

  checksum = g_checksum_new (G_CHECKSUM_SHA1);
  if (package_checksum_directory (checksum, root, package))
    {
      string = g_strdup (g_checksum_get_string (checksum));
      g_debug ("checksum for package %s is %s", package, string);
    }
  g_checksum_free (checksum);

  return string;
}

/**
 * CockpitResource:
 *
 * A #CockpitChannel that sends resources as messages. The resource
 * is automatically chunked so it doesn't overwhelm the transport
 *
 * The payload type for this channel is 'resource1'.
 */

#define COCKPIT_RESOURCE(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_RESOURCE, CockpitResource))

typedef struct {
  CockpitChannel parent;
  GMappedFile *mapped;
  const guint8 *data;
  gsize length;
  gsize offset;
  guint idler;
} CockpitResource;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitResourceClass;

G_DEFINE_TYPE (CockpitResource, cockpit_resource, COCKPIT_TYPE_CHANNEL);

static gboolean
on_idle_send_block (gpointer data)
{
  CockpitChannel *channel = data;
  CockpitResource *self = data;
  GBytes *payload;
  gsize block;

  g_assert (self->offset <= self->length);

  block = 4096;
  if (self->offset + block > self->length)
    block = self->length - self->offset;

  payload = g_bytes_new_with_free_func (self->data + self->offset, block,
                                        (GDestroyNotify)g_mapped_file_unref,
                                        g_mapped_file_ref (self->mapped));
  self->offset += block;

  cockpit_channel_send (channel, payload);
  g_bytes_unref (payload);

  if (self->offset == self->length)
    {
      self->idler = 0;
      cockpit_channel_close (channel, NULL);
      return FALSE;
    }

  return TRUE;
}

static void
cockpit_resource_recv (CockpitChannel *channel,
                       GBytes *message)
{
  g_message ("received unexpected message in resource channel");
  cockpit_channel_close (channel, "protocol-error");
}

static void
cockpit_resource_close (CockpitChannel *channel,
                        const gchar *problem)
{
  CockpitResource *self = COCKPIT_RESOURCE (channel);

  if (self->idler)
    {
      g_source_remove (self->idler);
      self->idler = 0;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_resource_parent_class)->close (channel, problem);
}

static void
cockpit_resource_init (CockpitResource *self)
{

}

static JsonObject *
read_package_manifest (const gchar *directory,
                       const gchar *package)
{
  JsonObject *manifest = NULL;
  GError *error = NULL;
  gchar *contents = NULL;
  gchar *filename;
  gsize length;

  filename = g_build_filename (directory, package, "manifest.json", NULL);
  if (!g_file_get_contents (filename, &contents, &length, &error))
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        g_debug ("no manifest found: %s", filename);
      else if (!g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOTDIR))
        g_message ("%s: %s", package, error->message);
      g_clear_error (&error);
    }
  else
    {
      manifest = cockpit_json_parse_object (contents, length, &error);
      if (!manifest)
        {
          g_message ("%s: invalid manifest: %s", package, error->message);
          g_clear_error (&error);
        }
    }

  g_free (contents);
  g_free (filename);
  return manifest;
}

static void
respond_package_listing (CockpitChannel *channel)
{
  const gchar *const *directories;
  gchar *checksum;
  gchar *directory;
  gchar **packages;
  JsonObject *manifest;
  JsonObject *root;
  JsonObject *object;
  gint i, j;

  root = json_object_new ();

  /* User package directory: no checksums */
  directory = g_build_filename (g_get_user_data_dir (), "cockpit", NULL);
  if (g_file_test (directory, G_FILE_TEST_IS_DIR))
    {
      packages = directory_filenames (directory);
      for (j = 0; packages[j] != NULL; j++)
        {
          manifest = read_package_manifest (directory, packages[j]);
          if (manifest)
            {
              object = json_object_new ();
              json_object_set_object_member (object, "manifest", manifest);
              json_object_set_object_member (root, packages[j], object);
            }
        }
      g_strfreev (packages);
    }
  g_free (directory);

  /* System package directories */
  directories = g_get_system_data_dirs();
  for (i = 0; directories[i] != NULL; i++)
    {
      directory = g_build_filename (directories[i], "cockpit", NULL);
      if (g_file_test (directory, G_FILE_TEST_IS_DIR))
        {
          packages = directory_filenames (directory);
          for (j = 0; packages && packages[j] != NULL; j++)
            {
              /* $XDG_DATA_DIRS is preference ordered, ascending */
              if (!json_object_has_member (root, packages[j]))
                {
                  manifest = read_package_manifest (directory, packages[j]);
                  if (manifest)
                    {
                      object = json_object_new ();
                      checksum = package_checksum (directory, packages[j]);
                      if (checksum)
                        {
                          json_object_set_string_member (object, "checksum", checksum);
                          g_free (checksum);
                        }
                      json_object_set_object_member (object, "manifest", manifest);
                      json_object_set_object_member (root, packages[j], object);
                    }
                }
            }
          g_strfreev (packages);
        }
      g_free (directory);
    }

  cockpit_channel_close_obj_option (channel, "resources", root);
  json_object_unref (root);

  /* All done */
  cockpit_channel_close (channel, NULL);
}

static gboolean
on_prepare_channel (gpointer data)
{
  CockpitResource *self = COCKPIT_RESOURCE (data);
  CockpitChannel *channel = COCKPIT_CHANNEL (data);
  const gchar *const *directories;
  gchar *filename = NULL;
  gchar *base = NULL;
  GError *error = NULL;
  const gchar *path;
  const gchar *package;
  gint i;

  self->idler = 0;

  package = cockpit_channel_get_option (channel, "package");
  path = cockpit_channel_get_option (channel, "path");

  if (!package && !path)
    {
      respond_package_listing (channel);
      goto out;
    }
  else if (!path)
    {
      g_message ("no 'path' specified for resource channel");
      cockpit_channel_close (channel, "protocol-error");
      goto out;
    }
  else if (!package)
    {
      g_message ("no 'package' specified for resource channel");
      cockpit_channel_close (channel, "protocol-error");
      goto out;
    }

  /*
   * This is *not* a security check. We're accessing files as the user.
   * What this does is prevent package authors from drawing outside the
   * lines. Keeps everyone honest.
   */
  if (strstr (path, "../") || strstr (path, "/.."))
    {
      g_message ("invalid 'path' used as a resource: %s", path);
      cockpit_channel_close (channel, "protocol-error");
      goto out;
    }

  base = g_build_filename (g_get_user_data_dir (), "cockpit", package, NULL);
  if (!g_file_test (base, G_FILE_TEST_IS_DIR))
    {
      g_free (base);
      base = NULL;

      directories = g_get_system_data_dirs ();
      for (i = 0; directories && directories[i]; i++)
        {
          base = g_build_filename (directories[i], "cockpit", package, NULL);
          if (g_file_test (base, G_FILE_TEST_IS_DIR))
            break;
          g_free (base);
          base = NULL;
        }
    }
  if (base == NULL)
    {
      g_debug ("resource package was not found: %s", package);
      cockpit_channel_close (channel, "not-found");
      goto out;
    }

  filename = g_build_filename (base, path, NULL);
  self->mapped = g_mapped_file_new (filename, FALSE, &error);
  if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ISDIR) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NAMETOOLONG) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_LOOP) ||
      g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_INVAL))
    {
      g_debug ("resource file was not found: %s", error->message);
      cockpit_channel_close (channel, "not-found");
    }
  else if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ACCES) ||
           g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_PERM))
    {
      g_message ("%s", error->message);
      cockpit_channel_close (channel, "not-authorized");
    }
  else if (error)
    {
      g_message ("%s", error->message);
      cockpit_channel_close (channel, "internal-error");
    }
  else
    {
      /* Start sending resource data */
      self->offset = 0;
      self->data = (const guint8 *)g_mapped_file_get_contents (self->mapped);
      self->length = g_mapped_file_get_length (self->mapped);
      self->idler = g_idle_add (on_idle_send_block, self);
      cockpit_channel_ready (channel);
    }

out:
  g_clear_error (&error);
  g_free (filename);
  g_free (base);
  return FALSE;
}

static void
cockpit_resource_constructed (GObject *object)
{
  CockpitResource *self = COCKPIT_RESOURCE (object);

  G_OBJECT_CLASS (cockpit_resource_parent_class)->constructed (object);

  /* Do basic construction later, to provide guarantee not to close immediately */
  self->idler = g_idle_add (on_prepare_channel, self);
}

static void
cockpit_resource_finalize (GObject *object)
{
  CockpitResource *self = COCKPIT_RESOURCE (object);

  if (self->mapped)
    g_mapped_file_unref (self->mapped);
  g_assert (self->idler == 0);

  G_OBJECT_CLASS (cockpit_resource_parent_class)->finalize (object);
}

static void
cockpit_resource_class_init (CockpitResourceClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->constructed = cockpit_resource_constructed;
  gobject_class->finalize = cockpit_resource_finalize;

  channel_class->recv = cockpit_resource_recv;
  channel_class->close = cockpit_resource_close;
}

/**
 * cockpit_resource_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @package: the optional package of resource
 * @path: the optional path
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitResource is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_resource_open (CockpitTransport *transport,
                       const gchar *channel_id,
                       const gchar *package,
                       const gchar *path)
{
  CockpitChannel *channel;
  JsonObject *options;

  options = json_object_new ();
  json_object_set_string_member (options, "payload", "resource1");
  if (package)
    json_object_set_string_member (options, "package", package);
  if (path)
    json_object_set_string_member (options, "path", path);

  channel = g_object_new (COCKPIT_TYPE_RESOURCE,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
