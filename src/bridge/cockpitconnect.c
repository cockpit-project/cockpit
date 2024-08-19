/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2015 Red Hat, Inc.
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

#include "cockpitconnect.h"

#include "common/cockpitjson.h"
#include "common/cockpitloopback.h"

#include <glib/gstdio.h>

#include <gio/gunixsocketaddress.h>

#include <errno.h>

const gchar * cockpit_bridge_local_address = NULL;

CockpitConnectable *
cockpit_connectable_ref (CockpitConnectable *connectable)
{
  g_return_val_if_fail (connectable != NULL, NULL);

  if (connectable->refs <= 0)
    {
      connectable = g_memdup (connectable, sizeof (CockpitConnectable));
      g_object_ref (connectable->address);
      if (connectable->tls_cert)
        g_object_ref (connectable->tls_cert);
      if (connectable->tls_database)
        g_object_ref (connectable->tls_database);
      connectable->name = g_strdup (connectable->name ? connectable->name : "connect");
      connectable->refs = 1;
    }
  else
    {
      connectable->refs++;
    }

  return connectable;
}

void
cockpit_connectable_unref (gpointer data)
{
  CockpitConnectable *connectable = data;

  g_return_if_fail (connectable != NULL);
  g_return_if_fail (connectable->refs > 0);

  if (--connectable->refs == 0)
    {
      if (connectable->tls_cert)
        g_object_unref (connectable->tls_cert);
      if (connectable->tls_database)
        g_object_unref (connectable->tls_database);
      g_object_unref (connectable->address);
      g_free (connectable->name);
      g_free (connectable);
    }
}

static void
socket_client_event (GSocketClient      *client,
                     GSocketClientEvent  event,
                     GSocketConnectable *gconnectable,
                     GIOStream          *connection,
                     gpointer            user_data)
{
  CockpitConnectable *connectable = user_data;

  switch (event)
    {
    case G_SOCKET_CLIENT_TLS_HANDSHAKING:
      {
        GTlsClientConnection *tls_client = G_TLS_CLIENT_CONNECTION (connection);

        g_tls_client_connection_set_validation_flags (tls_client, connectable->tls_flags);

        if (connectable->tls_cert)
          g_tls_connection_set_certificate (G_TLS_CONNECTION (tls_client), connectable->tls_cert);

        if (connectable->tls_database)
          g_tls_connection_set_database (G_TLS_CONNECTION (tls_client), connectable->tls_database);

        g_tls_connection_set_require_close_notify (G_TLS_CONNECTION (tls_client), FALSE);

        return;
      }

    default:
      return;
  }
}

static void
socket_client_connect_done (GObject      *object,
                            GAsyncResult *result,
                            gpointer      user_data)
{
  g_autoptr(GTask) task = user_data;
  g_autoptr(GError) error = NULL;

  g_autoptr(GSocketConnection) connection = g_socket_client_connect_finish (G_SOCKET_CLIENT (object), result, &error);
  if (connection != NULL)
    {
      GIOStream *stream; /* weak */

      if (G_IS_TCP_WRAPPER_CONNECTION (connection))
        {
          stream = g_tcp_wrapper_connection_get_base_io_stream (G_TCP_WRAPPER_CONNECTION (connection));
          g_assert (G_IS_TLS_CONNECTION (stream));
        }
      else
        stream = G_IO_STREAM (connection);

      g_task_return_pointer (task, g_object_ref (stream), g_object_unref);
    }
  else
    g_task_return_error (task, g_steal_pointer (&error));
}

void
cockpit_connect_stream (GSocketConnectable *address,
                        GCancellable *cancellable,
                        GAsyncReadyCallback callback,
                        gpointer user_data)
{
  CockpitConnectable connectable = { .address = address };

  g_return_if_fail (G_IS_SOCKET_CONNECTABLE (address));
  g_return_if_fail (!cancellable || G_IS_CANCELLABLE (cancellable));

  cockpit_connect_stream_full (&connectable, cancellable, callback, user_data);
}

void
cockpit_connect_stream_full (CockpitConnectable *connectable,
                             GCancellable *cancellable,
                             GAsyncReadyCallback callback,
                             gpointer user_data)
{
  g_return_if_fail (connectable != NULL);
  g_return_if_fail (G_IS_SOCKET_CONNECTABLE (connectable->address));
  g_return_if_fail (!cancellable || G_IS_CANCELLABLE (cancellable));

  g_autoptr(GSocketClient) client = g_socket_client_new ();

  /* otherwise, we'll go fishing around in GSettings... */
  g_socket_client_set_enable_proxy (client, FALSE);

  if (connectable->tls)
    {
      g_signal_connect_data (client, "event", G_CALLBACK (socket_client_event),
                             cockpit_connectable_ref (connectable),
                             (GClosureNotify) cockpit_connectable_unref, 0);

      g_socket_client_set_tls (client, TRUE);
    }

  g_socket_client_connect_async (client, connectable->address, cancellable, socket_client_connect_done,
                                 g_task_new (NULL, cancellable, callback, user_data));
}

GIOStream *
cockpit_connect_stream_finish (GAsyncResult *result,
                               GError **error)
{
  g_return_val_if_fail (g_task_is_valid (result, NULL), NULL);

  return g_task_propagate_pointer (G_TASK (result), error);
}

static GSocketConnectable *
parse_address (CockpitChannel *channel,
               gchar **possible_name,
               gboolean *local_address)
{
  GSocketConnectable *connectable = NULL;
  const gchar *unix_path;
  const gchar *address;
  JsonObject *options;
  gboolean local = FALSE;
  GError *error = NULL;
  const gchar *host;
  gint64 port;
  gchar *name = NULL;
  gboolean open = FALSE;

  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_string (options, "unix", NULL, &unix_path))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"unix\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_int (options, "port", G_MAXINT64, &port))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"port\" option in channel");
      goto out;
    }
  if (!cockpit_json_get_string (options, "address", NULL, &address))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"address\" option in channel");
      goto out;
    }

  if (port != G_MAXINT64 && unix_path)
    {
      cockpit_channel_fail (channel, "protocol-error", "cannot specify both \"port\" and \"unix\" options");
      goto out;
    }
  else if (port != G_MAXINT64)
    {
      if (port <= 0 || port > 65535)
        {
          cockpit_channel_fail (channel, "protocol-error", "received invalid \"port\" option");
          goto out;
        }

      if (address)
        {
          connectable = g_network_address_new (address, port);
          host = address;

          /* This isn't perfect, but matches the use case. Specify address => non-local */
          local = FALSE;
        }
      else if (cockpit_bridge_local_address)
        {
          connectable = g_network_address_parse (cockpit_bridge_local_address, port, &error);
          host = cockpit_bridge_local_address;
          local = TRUE;
        }
      else
        {
          connectable = cockpit_loopback_new (port);
          host = "localhost";
          local = TRUE;
        }

      if (error != NULL)
        {
          cockpit_channel_fail (channel, "internal-error",
                                "couldn't parse local address: %s: %s", host, error->message);
          goto out;
        }
      else
        {
          name = g_strdup_printf ("%s:%d", host, (gint)port);
        }
    }
  else if (unix_path)
    {
      name = g_strdup (unix_path);
      connectable = G_SOCKET_CONNECTABLE (g_unix_socket_address_new (unix_path));
      local = FALSE;
    }
  else
    {
      cockpit_channel_fail (channel, "protocol-error",
                            "no \"port\" or \"unix\" or other address option for channel");
      goto out;
    }

  open = TRUE;

out:
  g_clear_error (&error);
  if (open)
    {
      if (possible_name)
          *possible_name = g_strdup (name);
      if (local_address)
        *local_address = local;
    }
  else
    {
      if (connectable)
        g_object_unref (connectable);
      connectable = NULL;
    }

  g_free (name);
  return connectable;
}

GSocketAddress *
cockpit_connect_parse_address (CockpitChannel *channel,
                               gchar **possible_name)
{
  GSocketAddress *address;
  g_autoptr(GError) error = NULL;
  g_autofree gchar *name = NULL;

  g_autoptr(GSocketConnectable)  connectable = parse_address (channel, &name, NULL);
  if (!connectable)
    return NULL;

  /* This is sync, but realistically, it doesn't matter for current use cases */
  g_autoptr(GSocketAddressEnumerator) enumerator = g_socket_connectable_enumerate (connectable);

  address = g_socket_address_enumerator_next (enumerator, NULL, &error);

  if (error != NULL)
    {
      cockpit_channel_fail (channel, "not-found", "couldn't find address: %s: %s", name, error->message);
      return NULL;
    }

  if (possible_name)
    *possible_name = g_steal_pointer (&name);

  return address;
}

static gboolean
parse_option_file_or_data (CockpitChannel *channel,
                           JsonObject *options,
                           const gchar *option,
                           const gchar **file,
                           const gchar **data)
{
  JsonObject *object;
  JsonNode *node;

  g_assert (file != NULL);
  g_assert (data != NULL);

  node = json_object_get_member (options, option);
  if (!node)
    {
      *file = NULL;
      *data = NULL;
      return TRUE;
    }

  if (!JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"%s\" tls option for channel", option);
      return FALSE;
    }

  object = json_node_get_object (node);

  if (!cockpit_json_get_string (object, "file", NULL, file))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"file\" %s option for channel", option);
    }
  else if (!cockpit_json_get_string (object, "data", NULL, data))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"data\" %s option for channel", option);
    }
  else if (!*file && !*data)
    {
      cockpit_channel_fail (channel, "not-supported", "missing or unsupported \"%s\" option for channel", option);
    }
  else if (*file && *data)
    {
      cockpit_channel_fail (channel, "protocol-error", "cannot specify both \"file\" and \"data\" in \"%s\" option for channel", option);
    }
  else
    {
      return TRUE;
    }

  return FALSE;
}

static gboolean
load_pem_contents (CockpitChannel *channel,
                   const gchar *filename,
                   const gchar *option,
                   GString *pem)
{
  GError *error = NULL;
  gchar *contents = NULL;
  gsize len;

  if (!g_file_get_contents (filename, &contents, &len, &error))
    {
      cockpit_channel_fail (channel, "internal-error",
                            "couldn't load \"%s\" file: %s: %s", option, filename, error->message);
      g_clear_error (&error);
      return FALSE;
    }
  else
    {
      g_string_append_len (pem, contents, len);
      g_string_append_c (pem, '\n');
      g_free (contents);
      return TRUE;
    }
}

static gchar *
expand_filename (const gchar *filename)
{
  if (!g_path_is_absolute (filename))
    return g_build_filename (g_get_home_dir (), filename, NULL);
  else
    return g_strdup (filename);
}

static gboolean
parse_cert_option_as_pem (CockpitChannel *channel,
                          JsonObject *options,
                          const gchar *option,
                          GString *pem)
{
  gboolean ret = TRUE;
  const gchar *file;
  const gchar *data;
  gchar *path;

  if (!parse_option_file_or_data (channel, options, option, &file, &data))
    return FALSE;

  if (file)
    {
      path = expand_filename (file);

      /* For now we assume file contents are PEM */
      ret = load_pem_contents (channel, path, option, pem);

      g_free (path);
    }
  else if (data)
    {
      /* Format this as PEM of the given type */
      g_string_append (pem, data);
      g_string_append_c (pem, '\n');
    }

  return ret;
}

static gboolean
parse_cert_option_as_database (CockpitChannel *channel,
                               JsonObject *options,
                               const gchar *option,
                               GTlsDatabase **database)
{
  gboolean temporary = FALSE;
  GError *error = NULL;
  gboolean ret = TRUE;
  const gchar *file;
  const gchar *data;
  gchar *path;
  gint fd;

  if (!parse_option_file_or_data (channel, options, option, &file, &data))
    return FALSE;

  if (file)
    {
      path = expand_filename (file);
      ret = TRUE;
    }
  else if (data)
    {
      temporary = TRUE;
      path = g_build_filename (g_get_user_runtime_dir (), "cockpit-bridge-cert-authority.XXXXXX", NULL);
      fd = g_mkstemp (path);
      if (fd < 0)
        {
          ret = FALSE;
          cockpit_channel_fail (channel, "internal-error",
                                "couldn't create temporary directory: %s: %s", path, g_strerror (errno));
        }
      else
        {
          close (fd);
          if (!g_file_set_contents (path, data, -1, &error))
            {
              cockpit_channel_fail (channel, "internal-error",
                                    "couldn't write temporary data to: %s: %s", path, error->message);
              g_clear_error (&error);
              ret = FALSE;
            }
        }
    }
  else
    {
      /* Not specified */
      *database = NULL;
      return TRUE;
    }

  if (ret)
    {
      *database = g_tls_file_database_new (path, &error);
      if (error)
        {
          cockpit_channel_fail (channel, "internal-error",
                                "couldn't load certificate data: %s: %s", path, error->message);
          g_clear_error (&error);
          ret = FALSE;
        }
    }

  /* Leave around when problem, for debugging */
  if (temporary && ret == TRUE)
    g_unlink (path);

  g_free (path);

  return ret;
}

static gboolean
parse_stream_options (CockpitChannel *channel,
                      CockpitConnectable *connectable)
{
  gboolean ret = FALSE;
  GTlsCertificate *cert = NULL;
  GTlsDatabase *database = NULL;
  gboolean use_tls = FALSE;
  GError *error = NULL;
  GString *pem = NULL;
  JsonObject *options;
  JsonNode *node;

  /* No validation for local servers by default */
  gboolean validate = !connectable->local;

  options = cockpit_channel_get_options (channel);
  node = json_object_get_member (options, "tls");
  if (node && !JSON_NODE_HOLDS_OBJECT (node))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"tls\" option for channel");
      goto out;
    }
  else if (node)
    {
      options = json_node_get_object (node);
      use_tls = TRUE;

      /*
       * The only function in GLib to parse private keys takes
       * them in PEM concatenated form. This is a limitation of GLib,
       * rather than concatenated form being a decent standard for
       * certificates and keys. So build a combined PEM as expected by
       * GLib here.
       */

      pem = g_string_sized_new (8192);

      if (!parse_cert_option_as_pem (channel, options, "certificate", pem))
        goto out;

      if (pem->len)
        {
          if (!parse_cert_option_as_pem (channel, options, "key", pem))
            goto out;

          cert = g_tls_certificate_new_from_pem (pem->str, pem->len, &error);
          if (error != NULL)
            {
              cockpit_channel_fail (channel, "internal-error",
                                    "invalid \"certificate\" or \"key\" content: %s", error->message);
              g_error_free (error);
              goto out;
            }
        }

      if (!parse_cert_option_as_database (channel, options, "authority", &database))
        goto out;

      if (!cockpit_json_get_bool (options, "validate", validate, &validate))
        {
          cockpit_channel_fail (channel, "protocol-error", "invalid \"validate\" option");
          goto out;
        }
    }

  ret = TRUE;

out:
  if (ret)
    {
      connectable->tls = use_tls;
      connectable->tls_cert = cert;
      cert = NULL;

      if (database)
        {
          connectable->tls_database = database;
          connectable->tls_flags = G_TLS_CERTIFICATE_VALIDATE_ALL;
          if (!validate)
              connectable->tls_flags &= ~(G_TLS_CERTIFICATE_INSECURE | G_TLS_CERTIFICATE_BAD_IDENTITY);
          database = NULL;
        }
      else
        {
          if (validate)
            connectable->tls_flags = G_TLS_CERTIFICATE_VALIDATE_ALL;
          else
            connectable->tls_flags = G_TLS_CERTIFICATE_GENERIC_ERROR;
        }
    }

  if (pem)
    g_string_free (pem, TRUE);
  if (cert)
    g_object_unref (cert);
  if (database)
    g_object_unref (database);

  return ret;
}

CockpitConnectable *
cockpit_connect_parse_stream (CockpitChannel *channel)
{
  CockpitConnectable *connectable;
  GSocketConnectable *address;
  gboolean local = FALSE;
  gchar *name = NULL;

  address = parse_address (channel, &name, &local);
  if (!address)
    {
      g_free (name);
      return NULL;
    }

  connectable = g_new0 (CockpitConnectable, 1);
  connectable->address = address;
  connectable->name = name;
  connectable->refs = 1;
  connectable->local = local;

  if (!parse_stream_options (channel, connectable))
    {
      cockpit_connectable_unref (connectable);
      connectable = NULL;
    }

  return connectable;
}

