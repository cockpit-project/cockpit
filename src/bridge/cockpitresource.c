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
#include "cockpitpackage.h"

#include "common/cockpitjson.h"

#include <glib.h>

#include <string.h>

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
  GQueue *queue;
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

  payload = g_queue_pop_head (self->queue);
  if (payload == NULL)
    {
      self->idler = 0;
      cockpit_channel_close (channel, NULL);
      return FALSE;
    }
  else
    {
      cockpit_channel_send (channel, payload, FALSE);
      g_bytes_unref (payload);
      return TRUE;
    }
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

static GHashTable *
load_package_listing (JsonArray **json)
{
  static GHashTable *package_listing;
  GHashTable *listing;

  if (package_listing == NULL || json)
    {
      listing = cockpit_package_listing (json);
      if (package_listing)
        g_hash_table_unref (package_listing);
      package_listing = listing;
    }

  return g_hash_table_ref (package_listing);
}

static void
respond_package_listing (CockpitChannel *channel)
{
  JsonArray *root;
  GHashTable *listing;
  JsonNode *node;

  listing = load_package_listing (&root);
  node = json_node_init_array (json_node_alloc (), root);
  cockpit_channel_close_json_option (channel, "packages", node);
  g_hash_table_unref (listing);
  json_node_free (node);
  json_array_unref (root);

  /* All done */
  cockpit_channel_close (channel, NULL);
}

static gchar *
calculate_minified_path (const gchar *path)
{
  const gchar *dot;
  const gchar *slash;

  dot = strrchr (path, '.');
  slash = strrchr (path, '/');

  if (dot == NULL)
    return NULL;
  if (slash != NULL && dot < slash)
    return NULL;

  return g_strdup_printf ("%.*s.min%s",
                          (int)(dot - path), path, dot);
}

static GMappedFile *
open_file (CockpitChannel *channel,
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
      cockpit_channel_close (channel, "not-authorized");
    }
  else if (error)
    {
      g_message ("%s", error->message);
      cockpit_channel_close (channel, "internal-error");
    }

  g_clear_error (&error);
  return mapped;
}

static gboolean
on_prepare_channel (gpointer data)
{
  CockpitResource *self = COCKPIT_RESOURCE (data);
  CockpitChannel *channel = COCKPIT_CHANNEL (data);
  GHashTable *listing = NULL;
  gchar *filename = NULL;
  const gchar *host = NULL;
  GError *error = NULL;
  const gchar *path;
  const gchar *package;
  const gchar *accept;
  gchar *alternate = NULL;
  GMappedFile *mapped = NULL;
  gchar *string = NULL;
  const gchar *pos;
  GBytes *bytes;
  gboolean retry;

  self->idler = 0;

  package = cockpit_channel_get_option (channel, "package");
  path = cockpit_channel_get_option (channel, "path");
  accept = cockpit_channel_get_option (channel, "accept");

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

  /* Remove any host qualifier from the package */
  pos = strchr (package, '@');
  if (pos)
    {
      string = g_strndup (package, pos - package);
      package = string;
      host = pos + 1;
    }

  listing = load_package_listing (NULL);

  filename = cockpit_package_resolve (listing, package, path);
  if (!filename)
    {
      cockpit_channel_close (channel, "not-found");
      goto out;
    }

  retry = TRUE;
  if (accept && g_str_equal (accept, "minified"))
    {
      alternate = calculate_minified_path (filename);
      if (alternate)
        mapped = open_file (channel, alternate, &retry);
    }

  if (!mapped && retry)
    mapped = open_file (channel, filename, &retry);

  if (!mapped && retry)
    {
      cockpit_channel_close (channel, "not-found");
      goto out;
    }

  /* Expand the data */
  self->queue = g_queue_new ();
  bytes = g_mapped_file_get_bytes (mapped);
  cockpit_package_expand (listing, host, bytes, self->queue);
  g_bytes_unref (bytes);

  self->idler = g_idle_add (on_idle_send_block, self);
  cockpit_channel_ready (channel);

out:
  if (mapped)
    g_mapped_file_unref (mapped);
  if (listing)
    g_hash_table_unref (listing);
  g_free (string);
  g_clear_error (&error);
  g_free (filename);
  g_free (alternate);
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

  if (self->queue)
    {
      while (!g_queue_is_empty (self->queue))
        g_bytes_unref (g_queue_pop_head (self->queue));
      g_queue_free (self->queue);
    }
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
                       const gchar *path,
                       const gchar *accept)
{
  CockpitChannel *channel;
  JsonObject *options;

  options = json_object_new ();
  json_object_set_string_member (options, "payload", "resource1");
  if (package)
    json_object_set_string_member (options, "package", package);
  if (path)
    json_object_set_string_member (options, "path", path);
  if (accept)
    json_object_set_string_member (options, "accept", accept);

  channel = g_object_new (COCKPIT_TYPE_RESOURCE,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
