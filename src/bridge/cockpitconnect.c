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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitconnect.h"

#include "common/cockpitjson.h"
#include "common/cockpitloopback.h"

#include <glib/gstdio.h>

#include <gio/gunixsocketaddress.h>

#include <errno.h>

const gchar * cockpit_bridge_local_address = NULL;

static GHashTable *internal_addresses;

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

typedef struct {
  CockpitConnectable *connectable;
  GSocketAddressEnumerator *enumerator;
  GCancellable *cancellable;
  GIOStream *io;
  GError *error;
} ConnectStream;

static void
connect_stream_free (gpointer data)
{
  ConnectStream *cs = data;
  if (cs->connectable)
    cockpit_connectable_unref (cs->connectable);
  if (cs->cancellable)
    g_object_unref (cs->cancellable);
  g_object_unref (cs->enumerator);
  g_clear_error (&cs->error);
  if (cs->io)
    g_object_unref (cs->io);
  g_free (cs);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data);

static void
on_socket_connect (GObject *object,
                   GAsyncResult *result,
                   gpointer user_data)
{
  GSimpleAsyncResult *simple = G_SIMPLE_ASYNC_RESULT (user_data);
  ConnectStream *cs = g_simple_async_result_get_op_res_gpointer (simple);
  CockpitConnectable *connectable = cs->connectable;
  GError *error = NULL;

  g_socket_connection_connect_finish (G_SOCKET_CONNECTION (object), result, &error);

  g_debug ("%s: connected", connectable->name);

  if (error)
    {
      g_debug ("%s: couldn't connect: %s", connectable->name, error->message);
      g_clear_error (&cs->error);
      cs->error = error;

      g_socket_address_enumerator_next_async (cs->enumerator, cs->cancellable,
                                              on_address_next, g_object_ref (simple));
    }
  else
    {
      g_debug ("%s: connected", connectable->name);

      if (connectable->tls)
        {
          cs->io = g_tls_client_connection_new (G_IO_STREAM (object), NULL, &error);
          if (cs->io)
            {
              g_debug ("%s: tls handshake", connectable->name);

              g_tls_client_connection_set_validation_flags (G_TLS_CLIENT_CONNECTION (cs->io),
                                                            connectable->tls_flags);

              if (connectable->tls_cert)
                g_tls_connection_set_certificate (G_TLS_CONNECTION (cs->io), connectable->tls_cert);
              if (connectable->tls_database)
                g_tls_connection_set_database (G_TLS_CONNECTION (cs->io), connectable->tls_database);

              /* We track data end the same way we do for HTTP */
              g_tls_connection_set_require_close_notify (G_TLS_CONNECTION (cs->io), FALSE);
            }

          else if (error)
            {
              g_debug ("%s: couldn't open tls connection: %s", connectable->name, error->message);
              g_clear_error (&cs->error);
              cs->error = error;
            }
        }
      else
        {
          cs->io = g_object_ref (object);
        }

      g_simple_async_result_complete (simple);
    }

  g_object_unref (object);
  g_object_unref (simple);
}

static void
on_address_next (GObject *object,
                 GAsyncResult *result,
                 gpointer user_data)
{
  GSimpleAsyncResult *simple = G_SIMPLE_ASYNC_RESULT (user_data);
  ConnectStream *cs = g_simple_async_result_get_op_res_gpointer (simple);
  CockpitConnectable *connectable = cs->connectable;
  GSocketConnection *connection;
  GSocketAddress *address;
  GError *error = NULL;
  GSocket *sock;

  address = g_socket_address_enumerator_next_finish (G_SOCKET_ADDRESS_ENUMERATOR (object),
                                                     result, &error);

  if (error)
    {
      g_debug ("%s: couldn't resolve: %s", connectable->name, error->message);
      g_clear_error (&cs->error);
      cs->error = error;
      g_simple_async_result_complete (simple);
    }
  else if (address)
    {
      sock = g_socket_new (g_socket_address_get_family (address), G_SOCKET_TYPE_STREAM, 0, &error);
      if (sock)
        {
          g_socket_set_blocking (sock, FALSE);

          connection = g_socket_connection_factory_create_connection (sock);
          g_object_unref (sock);

          g_socket_connection_connect_async (connection, address, cs->cancellable,
                                             on_socket_connect, g_object_ref (simple));
        }

      if (error)
        {
          g_debug ("%s: couldn't open socket: %s", connectable->name, error->message);
          g_clear_error (&cs->error);
          cs->error = error;
          g_simple_async_result_complete (simple);
        }
      g_object_unref (address);
    }
  else
    {
      if (!cs->error)
          g_message ("%s: no addresses found", connectable->name);
      g_simple_async_result_complete (simple);
    }

  g_object_unref (simple);
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
  GSimpleAsyncResult *simple;
  ConnectStream *cs;

  g_return_if_fail (connectable != NULL);
  g_return_if_fail (G_IS_SOCKET_CONNECTABLE (connectable->address));
  g_return_if_fail (!cancellable || G_IS_CANCELLABLE (cancellable));

  simple = g_simple_async_result_new (NULL, callback, user_data, cockpit_connect_stream);
  cs = g_new0 (ConnectStream, 1);
  cs->connectable = cockpit_connectable_ref (connectable);
  cs->cancellable = cancellable ? g_object_ref (cancellable) : NULL;
  cs->enumerator = g_socket_connectable_enumerate (connectable->address);
  g_simple_async_result_set_op_res_gpointer (simple, cs, connect_stream_free);

  g_socket_address_enumerator_next_async (cs->enumerator, NULL,
                                          on_address_next, g_object_ref (simple));

  g_object_unref (simple);
}

GIOStream *
cockpit_connect_stream_finish (GAsyncResult *result,
                               GError **error)
{
  GSimpleAsyncResult *simple;
  ConnectStream *cs;

  g_return_val_if_fail (g_simple_async_result_is_valid (result, NULL, cockpit_connect_stream), NULL);

  simple = G_SIMPLE_ASYNC_RESULT (result);
  cs = g_simple_async_result_get_op_res_gpointer (simple);

  if (cs->io)
    {
      return g_object_ref (cs->io);
    }
  else if (cs->error)
    {
      g_propagate_error (error, cs->error);
      cs->error = NULL;
      return NULL;
    }
  else
    {
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_HOST_NOT_FOUND, "No addresses found");
      return NULL;
    }
}

static void
safe_unref (gpointer data)
{
  GObject *object = data;
  if (object != NULL)
    g_object_unref (object);
}

static gboolean
lookup_internal (const gchar *name,
                 GSocketConnectable **connectable)
{
  const gchar *env;
  gboolean ret = FALSE;
  GSocketAddress *address;

  g_assert (name != NULL);
  g_assert (connectable != NULL);

  if (internal_addresses)
    {
      ret = g_hash_table_lookup_extended (internal_addresses, name, NULL,
                                          (gpointer *)connectable);
    }

  if (!ret && g_str_equal (name, "ssh-agent"))
    {
      *connectable = NULL;
      env = g_getenv ("SSH_AUTH_SOCK");
      if (env != NULL && env[0] != '\0')
        {
          address = g_unix_socket_address_new (env);
          *connectable = G_SOCKET_CONNECTABLE (address);
          cockpit_connect_add_internal_address ("ssh-agent", address);
        }
      ret = TRUE;
    }

  return ret;
}

void
cockpit_connect_add_internal_address (const gchar *name,
                                      GSocketAddress *address)
{
  if (!internal_addresses)
    {
      internal_addresses = g_hash_table_new_full (g_str_hash, g_str_equal,
                                                  g_free, safe_unref);
    }

  if (address)
    address = g_object_ref (address);

  g_hash_table_replace (internal_addresses, g_strdup (name), address);
}

gboolean
cockpit_connect_remove_internal_address (const gchar *name)
{
  gboolean ret = FALSE;
  if (internal_addresses)
      ret = g_hash_table_remove (internal_addresses, name);
  return ret;
}

static GSocketConnectable *
parse_address (CockpitChannel *channel,
               gchar **possible_name,
               gboolean *local_address)
{
  GSocketConnectable *connectable = NULL;
  const gchar *unix_path;
  const gchar *internal;
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
  if (!cockpit_json_get_string (options, "internal", NULL, &internal))
    {
      cockpit_channel_fail (channel, "protocol-error", "invalid \"internal\" option in channel");
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
  else if (internal)
    {
      gboolean reg = lookup_internal (internal, &connectable);

      if (!connectable)
        {
          if (reg)
            cockpit_channel_close (channel, "not-found");
          else
            cockpit_channel_fail (channel, "not-found", "couldn't find internal address: %s", internal);
          goto out;
        }

      name = g_strdup (internal);
      connectable = g_object_ref (connectable);
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
  GSocketConnectable *connectable;
  GSocketAddressEnumerator *enumerator;
  GSocketAddress *address;
  GError *error = NULL;
  gchar *name = NULL;

  connectable = parse_address (channel, &name, NULL);
  if (!connectable)
    return NULL;

  /* This is sync, but realistically, it doesn't matter for current use cases */
  enumerator = g_socket_connectable_enumerate (connectable);
  g_object_unref (connectable);

  address = g_socket_address_enumerator_next (enumerator, NULL, &error);
  g_object_unref (enumerator);

  if (error != NULL)
    {
      cockpit_channel_fail (channel, "not-found", "couldn't find address: %s: %s", name, error->message);
      g_error_free (error);
      g_free (name);
      return NULL;
    }

  if (possible_name)
    *possible_name = name;
  else
    g_free (name);

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
    return NULL;

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

