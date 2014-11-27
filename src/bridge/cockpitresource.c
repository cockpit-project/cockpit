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
 * The payload type for this channel is 'resource2'.
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
  JsonObject *options;

  listing = load_package_listing (&root);
  options = cockpit_channel_close_options (channel);
  json_object_set_array_member (options, "packages", root);
  g_hash_table_unref (listing);

  /* All done */
  cockpit_channel_ready (channel);
  cockpit_channel_close (channel, NULL);
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

static void
cockpit_resource_prepare (CockpitChannel *channel)
{
  CockpitResource *self = COCKPIT_RESOURCE (channel);
  const gchar *problem = "protocol-error";
  GHashTable *listing = NULL;
  gchar *filename = NULL;
  const gchar *host = NULL;
  GError *error = NULL;
  const gchar *path;
  const gchar *package;
  gchar **accept = NULL;
  const gchar *accepted;
  gchar *alternate;
  GMappedFile *mapped = NULL;
  JsonObject *object;
  JsonObject *options;
  gchar *string = NULL;
  const gchar *pos;
  GBytes *bytes;
  gboolean retry;
  guint i;

  COCKPIT_CHANNEL_CLASS (cockpit_resource_parent_class)->prepare (channel);

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "package", NULL, &package))
    {
      g_warning ("invalid \"package\" option in resource channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "path", NULL, &path))
    {
      g_warning ("invalid \"package\" option in resource channel");
      goto out;
    }
  if (!cockpit_json_get_strv (options, "accept", NULL, &accept))
    {
      g_warning ("invalid \"accept\" option in resource channel");
      goto out;
    }

  if (!package && !path)
    {
      respond_package_listing (channel);
      problem = NULL;
      goto out;
    }
  else if (!path)
    {
      g_message ("no \"path\" option specified for resource channel");
      goto out;
    }
  else if (!package)
    {
      g_message ("no \"package\" option specified for resource channel");
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
      problem = "not-found";
      goto out;
    }

  retry = TRUE;
  accepted = NULL;
  for (i = 0; !mapped && retry && accept && accept[i] != NULL; i++)
    {
      alternate = calculate_accept_path (filename, accept[i]);
      if (alternate)
        {
          mapped = open_file (channel, alternate, &retry);
          if (mapped)
            accepted = accept[i];
        }
      g_free (alternate);
    }

  if (!mapped && retry)
    mapped = open_file (channel, filename, &retry);

  if (!mapped && retry)
    {
      problem = "not-found";
      goto out;
    }

  self->queue = g_queue_new ();
  problem = NULL;

  /* The first reply payload is meta info */
  object = json_object_new ();
  if (accepted)
    json_object_set_string_member (object, "accept", accepted);
  g_queue_push_head (self->queue, cockpit_json_write_bytes (object));
  json_object_unref (object);

  /* Expand the data */
  bytes = g_mapped_file_get_bytes (mapped);
  cockpit_package_expand (listing, host, bytes, self->queue);
  g_bytes_unref (bytes);

  self->idler = g_idle_add (on_idle_send_block, self);
  cockpit_channel_ready (channel);

out:
  if (problem)
      cockpit_channel_close (channel, problem);
  if (mapped)
    g_mapped_file_unref (mapped);
  if (listing)
    g_hash_table_unref (listing);
  g_free (accept);
  g_free (string);
  g_clear_error (&error);
  g_free (filename);
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

  gobject_class->finalize = cockpit_resource_finalize;

  channel_class->prepare = cockpit_resource_prepare;
  channel_class->recv = cockpit_resource_recv;
  channel_class->close = cockpit_resource_close;
}

/**
 * cockpit_resource_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @package: the optional package of resource
 * @path: the optional path
 * @accept: various content negotiation options
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
                       const gchar **accept)
{
  CockpitChannel *channel;
  JsonObject *options;
  JsonArray *array;
  guint i;

  options = json_object_new ();
  json_object_set_string_member (options, "payload", "resource2");
  if (package)
    json_object_set_string_member (options, "package", package);
  if (path)
    json_object_set_string_member (options, "path", path);
  if (accept)
    {
      array = json_array_new ();
      for (i = 0; accept[i] != NULL; i++)
        json_array_add_string_element (array, accept[i]);
      json_object_set_array_member (options, "accept", array);
    }

  channel = g_object_new (COCKPIT_TYPE_RESOURCE,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
