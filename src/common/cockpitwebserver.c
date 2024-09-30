/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013-2014 Red Hat, Inc.
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

#include "cockpitwebserver.h"

#include "cockpitconf.h"
#include "cockpithash.h"
#include "cockpitjson.h"
#include "cockpitmemfdread.h"
#include "cockpitmemory.h"
#include "cockpitsocket.h"
#include "cockpitwebresponse.h"

#include "websocket/websocket.h"

#include <sys/socket.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "cockpitwebrequest-private.h"

/* Used during testing */
gboolean cockpit_webserver_want_certificate = FALSE;

guint cockpit_webserver_request_timeout = 30;
const gsize cockpit_webserver_request_maximum = 8192;

struct _CockpitWebServer {
  GObject parent_instance;

  GTlsCertificate *certificate;
  GString *ssl_exception_prefix;
  GString *url_root;
  gint request_timeout;
  gint request_max;
  CockpitWebServerFlags flags;

  gchar *protocol_header;
  gchar *forwarded_for_header;

  GSocketService *socket_service;
  GMainContext *main_context;
  GHashTable *requests;
};

enum
{
  PROP_0,
  PROP_CERTIFICATE,
  PROP_SSL_EXCEPTION_PREFIX,
  PROP_FLAGS,
  PROP_URL_ROOT,
};

static gint sig_handle_stream = 0;
static gint sig_handle_resource = 0;

static void cockpit_web_request_free (gpointer data);

static void cockpit_web_request_start (CockpitWebServer *web_server,
                                       GIOStream *stream,
                                       gboolean first);

G_DEFINE_TYPE (CockpitWebServer, cockpit_web_server, G_TYPE_OBJECT)

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
on_incoming (GSocketService *service,
             GSocketConnection *connection,
             GObject *source_object,
             gpointer user_data)
{
  CockpitWebServer *self = COCKPIT_WEB_SERVER (user_data);
  cockpit_web_request_start (self, G_IO_STREAM (connection), TRUE);

  /* handled */
  return TRUE;
}

static void
cockpit_web_server_init (CockpitWebServer *server)
{
  server->requests = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                            cockpit_web_request_free, NULL);
  server->main_context = g_main_context_ref_thread_default ();
  server->ssl_exception_prefix = g_string_new ("");
  server->url_root = g_string_new ("");

  server->socket_service = g_socket_service_new ();

  /* The web server has to be explicitly started */
  g_socket_service_stop (server->socket_service);

  g_signal_connect (server->socket_service, "incoming",
                    G_CALLBACK (on_incoming), server);
}

static void
cockpit_web_server_dispose (GObject *object)
{
  CockpitWebServer *self = COCKPIT_WEB_SERVER (object);

  g_hash_table_remove_all (self->requests);

  G_OBJECT_CLASS (cockpit_web_server_parent_class)->dispose (object);
}

static void
cockpit_web_server_finalize (GObject *object)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  g_clear_object (&server->certificate);
  g_hash_table_destroy (server->requests);
  if (server->main_context)
    g_main_context_unref (server->main_context);
  g_string_free (server->ssl_exception_prefix, TRUE);
  g_string_free (server->url_root, TRUE);
  g_clear_object (&server->socket_service);
  g_free (server->protocol_header);
  g_free (server->forwarded_for_header);

  G_OBJECT_CLASS (cockpit_web_server_parent_class)->finalize (object);
}

static void
cockpit_web_server_get_property (GObject *object,
                                 guint prop_id,
                                 GValue *value,
                                 GParamSpec *pspec)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);

  switch (prop_id)
    {
    case PROP_CERTIFICATE:
      g_value_set_object (value, server->certificate);
      break;

    case PROP_SSL_EXCEPTION_PREFIX:
      g_value_set_string (value, server->ssl_exception_prefix->str);
      break;

    case PROP_URL_ROOT:
      if (server->url_root->len)
        g_value_set_string (value, server->url_root->str);
      else
        g_value_set_string (value, NULL);
      break;

    case PROP_FLAGS:
      g_value_set_int (value, server->flags);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
cockpit_web_server_set_property (GObject *object,
                                 guint prop_id,
                                 const GValue *value,
                                 GParamSpec *pspec)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (object);
  GString *str;

  switch (prop_id)
    {
    case PROP_CERTIFICATE:
      server->certificate = g_value_dup_object (value);
      break;

    case PROP_SSL_EXCEPTION_PREFIX:
      g_string_assign (server->ssl_exception_prefix, g_value_get_string (value));
      break;

    case PROP_URL_ROOT:
      str = g_string_new (g_value_get_string (value));

      while (str->str[0] == '/')
        g_string_erase (str, 0, 1);

      if (str->len)
        {
          while (str->str[str->len - 1] == '/')
            g_string_truncate (str, str->len - 1);
        }

      if (str->len)
        g_string_printf (server->url_root, "/%s", str->str);
      else
        g_string_assign (server->url_root, str->str);

      g_string_free (str, TRUE);
      break;

    case PROP_FLAGS:
      server->flags = g_value_get_int (value);
      break;

    default:
      G_OBJECT_WARN_INVALID_PROPERTY_ID (object, prop_id, pspec);
      break;
    }
}

static void
on_io_closed (GObject *stream,
              GAsyncResult *result,
              gpointer user_data)
{
  GError *error = NULL;

  if (!g_io_stream_close_finish (G_IO_STREAM (stream), result, &error))
    {
      if (!cockpit_web_should_suppress_output_error ("http", error))
        g_message ("http close error: %s", error->message);
      g_error_free (error);
    }
}

static void
close_io_stream (GIOStream *io)
{
  g_io_stream_close_async (io, G_PRIORITY_DEFAULT, NULL, on_io_closed, NULL);
}

static void
on_web_response_done (CockpitWebResponse *response,
                      gboolean reusable,
                      gpointer user_data)
{
  CockpitWebServer *self = user_data;
  GIOStream *io;

  io = cockpit_web_response_get_stream (response);
  if (reusable)
    cockpit_web_request_start (self, io, FALSE);
  else
    close_io_stream (io);
}

static gboolean
cockpit_web_server_default_handle_resource (CockpitWebServer *self,
                                            CockpitWebRequest *request,
                                            const gchar *path,
                                            GHashTable *headers,
                                            CockpitWebResponse *response)
{
  cockpit_web_response_error (response, 404, NULL, NULL);
  return TRUE;
}

static gboolean
cockpit_web_server_default_handle_stream (CockpitWebServer *self,
                                          CockpitWebRequest *request)
{
  CockpitWebResponse *response;
  gboolean claimed = FALSE;
  GQuark detail = 0;

  /* TODO: Correct HTTP version for response */
  response = cockpit_web_request_respond (request);
  g_signal_connect_data (response, "done", G_CALLBACK (on_web_response_done),
                         g_object_ref (self), (GClosureNotify)g_object_unref, 0);

  /*
   * If the path has more than one component, then we search
   * for handlers registered under the detail like this:
   *
   *   /component/
   *
   * Otherwise we search for handlers registered under detail
   * of the entire path:
   *
   *  /component
   *
   * We only bother to calculate the detail if it would have a length of
   * less than 100: nobody is going to register a signal handler for a
   * longer path than that.
   */
  g_assert (request->path[0] == '/');
  gsize component_end = 1 + strcspn (request->path + 1, "/");
  if (request->path[component_end] == '/')
    component_end++;
  if (component_end < 100)
    {
      gchar buffer[component_end + 1];
      memcpy (buffer, request->path, component_end);
      buffer[component_end] = '\0';
      detail = g_quark_try_string (buffer);
    }

  /* See if we have any takers... */
  g_signal_emit (self,
                 sig_handle_resource, detail,
                 request,
                 request->path,
                 request->headers,
                 response,
                 &claimed);

  if (!claimed)
    claimed = cockpit_web_server_default_handle_resource (self, request, request->path, request->headers, response);

  /* TODO: Here is where we would plug keep-alive into response */
  g_object_unref (response);

  return claimed;
}

static void
cockpit_web_server_class_init (CockpitWebServerClass *klass)
{
  GObjectClass *gobject_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = cockpit_web_server_dispose;
  gobject_class->finalize = cockpit_web_server_finalize;
  gobject_class->set_property = cockpit_web_server_set_property;
  gobject_class->get_property = cockpit_web_server_get_property;

  g_object_class_install_property (gobject_class,
                                   PROP_CERTIFICATE,
                                   g_param_spec_object ("certificate", NULL, NULL,
                                                        G_TYPE_TLS_CERTIFICATE,
                                                        G_PARAM_READABLE |
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_SSL_EXCEPTION_PREFIX,
                                   g_param_spec_string ("ssl-exception-prefix", NULL, NULL, "",
                                                        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_URL_ROOT,
                                   g_param_spec_string ("url-root", NULL, NULL, "",
                                                        G_PARAM_READWRITE | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_FLAGS,
                                   g_param_spec_int ("flags", NULL, NULL, 0, COCKPIT_WEB_SERVER_FLAGS_MAX, 0,
                                                     G_PARAM_READABLE |
                                                     G_PARAM_WRITABLE |
                                                     G_PARAM_CONSTRUCT_ONLY |
                                                     G_PARAM_STATIC_STRINGS));

  sig_handle_stream = g_signal_new ("handle-stream",
                                    G_OBJECT_CLASS_TYPE (klass),
                                    G_SIGNAL_RUN_LAST,
                                    0, /* class offset */
                                    g_signal_accumulator_true_handled,
                                    NULL, /* accu_data */
                                    g_cclosure_marshal_generic,
                                    G_TYPE_BOOLEAN,
                                    1,
                                    COCKPIT_TYPE_WEB_REQUEST | G_SIGNAL_TYPE_STATIC_SCOPE);

  sig_handle_resource = g_signal_new ("handle-resource",
                                      G_OBJECT_CLASS_TYPE (klass),
                                      G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                      0, /* class offset */
                                      g_signal_accumulator_true_handled,
                                      NULL, /* accu_data */
                                      g_cclosure_marshal_generic,
                                      G_TYPE_BOOLEAN,
                                      4,
                                      COCKPIT_TYPE_WEB_REQUEST | G_SIGNAL_TYPE_STATIC_SCOPE,
                                      G_TYPE_STRING,
                                      G_TYPE_HASH_TABLE,
                                      COCKPIT_TYPE_WEB_RESPONSE);
}

CockpitWebServer *
cockpit_web_server_new (GTlsCertificate *certificate,
                        CockpitWebServerFlags flags)
{
  return g_object_new (COCKPIT_TYPE_WEB_SERVER,
                       "certificate", certificate,
                       "flags", flags,
                       NULL);
}

/* ---------------------------------------------------------------------------------------------------- */

CockpitWebServerFlags
cockpit_web_server_get_flags (CockpitWebServer *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVER (self), COCKPIT_WEB_SERVER_NONE);

  return self->flags;
}

GHashTable *
cockpit_web_server_new_table (void)
{
  return g_hash_table_new_full (cockpit_str_case_hash, cockpit_str_case_equal, g_free, g_free);
}

gchar *
cockpit_web_server_parse_cookie (GHashTable *headers,
                                 const gchar *name)
{
  const gchar *header;
  const gchar *pos;
  const gchar *value;
  const gchar *end;
  gboolean at_start = TRUE;
  gchar *decoded;
  gint diff;
  gint offset;

  header = g_hash_table_lookup (headers, "Cookie");
  if (!header)
    return NULL;

  for (;;)
    {
      pos = strstr (header, name);
      if (!pos)
        return NULL;

      if (pos != header)
        {
          diff = strlen (header) - strlen (pos);
          offset = 1;
          at_start = FALSE;
          while (offset < diff)
            {
              if (!g_ascii_isspace (*(pos - offset)))
                {
                  at_start = *(pos - offset) == ';';
                  break;
                }
              offset++;
            }
        }

      pos += strlen (name);
      if (*pos == '=' && at_start)
        {
          value = pos + 1;
          end = strchr (value, ';');
          if (end == NULL)
            end = value + strlen (value);

          decoded = g_uri_unescape_segment (value, end, NULL);
          if (!decoded)
            g_debug ("invalid cookie encoding");

          return decoded;
        }
      else
        {
          at_start = FALSE;
        }
      header = pos;
    }
}

typedef struct {
  double qvalue;
  const gchar *value;
} Language;

static gint
sort_qvalue (gconstpointer a,
             gconstpointer b)
{
  const Language *la = *((Language **)a);
  const Language *lb = *((Language **)b);
  if (lb->qvalue == la->qvalue)
    return 0;
  return lb->qvalue < la->qvalue ? -1 : 1;
}

gchar **
cockpit_web_server_parse_accept_list (const gchar *accept,
                                      const gchar *defawlt)
{
  Language *lang;
  GPtrArray *langs;
  GPtrArray *ret;
  gchar *copy;
  gchar *value;
  gchar *next;
  gchar *pos;
  guint i;

  langs = g_ptr_array_new_with_free_func (g_free);

  if (defawlt)
    {
      lang = g_new0 (Language, 1);
      lang->qvalue = 0.1;
      lang->value = defawlt;
      g_ptr_array_add (langs, lang);
    }

  /* First build up an array we can sort */
  accept = copy = g_strdup (accept);

  while (accept)
    {
      next = strchr (accept, ',');
      if (next)
        {
          *next = '\0';
          next++;
        }

      lang = g_new0 (Language, 1);
      lang->qvalue = 1;

      pos = strchr (accept, ';');
      if (pos)
        {
          *pos = '\0';
          if (strncmp (pos + 1, "q=", 2) == 0)
            {
              lang->qvalue = g_ascii_strtod (pos + 3, NULL);
              if (lang->qvalue < 0)
                lang->qvalue = 0;
            }
        }

      lang->value = accept;
      g_ptr_array_add (langs, lang);
      accept = next;
    }

  g_ptr_array_sort (langs, sort_qvalue);

  /* Now in the right order add all the prefs */
  ret = g_ptr_array_new ();
  for (i = 0; i < langs->len; i++)
    {
      lang = langs->pdata[i];
      if (lang->qvalue > 0)
        {
          value = g_strstrip (g_ascii_strdown (lang->value, -1));
          g_ptr_array_add (ret, value);
        }
    }

  /* Add base languages after that */
  for (i = 0; i < langs->len; i++)
    {
      lang = langs->pdata[i];
      if (lang->qvalue > 0)
        {
          pos = strchr (lang->value, '-');
          if (pos)
            {
              value = g_strstrip (g_ascii_strdown (lang->value, pos - lang->value));
              g_ptr_array_add (ret, value);
            }
        }
    }

  g_free (copy);
  g_ptr_array_add (ret, NULL);
  g_ptr_array_free (langs, TRUE);
  return (gchar **)g_ptr_array_free (ret, FALSE);
}

/* ---------------------------------------------------------------------------------------------------- */

guint16
cockpit_web_server_add_inet_listener (CockpitWebServer *self,
                                      const gchar *address,
                                      guint16 port,
                                      GError **error)
{
  if (address != NULL)
    {
      g_autoptr(GSocketAddress) socket_address = g_inet_socket_address_new_from_string (address, port);
      if (socket_address == NULL)
        {
          g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_DATA,
                       "Couldn't parse IP address from `%s`", address);
          return 0;
        }

      g_autoptr(GSocketAddress) result_address = NULL;
      if (!g_socket_listener_add_address (G_SOCKET_LISTENER (self->socket_service), socket_address,
                                          G_SOCKET_TYPE_STREAM, G_SOCKET_PROTOCOL_DEFAULT,
                                          NULL, &result_address, error))
        return 0;

      port = g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (result_address));
      g_assert (port != 0);

      return port;
    }

  else if (port > 0)
    {
      if (g_socket_listener_add_inet_port (G_SOCKET_LISTENER (self->socket_service), port, NULL, error))
        return port;
      else
        return 0;
    }
  else
    return g_socket_listener_add_any_inet_port (G_SOCKET_LISTENER (self->socket_service), NULL, error);
}

gboolean
cockpit_web_server_add_fd_listener (CockpitWebServer *self,
                                    int fd,
                                    GError **error)
{
  g_autoptr(GSocket) socket = g_socket_new_from_fd (fd, error);
  if (socket == NULL)
    {
      g_prefix_error (error, "Failed to acquire passed socket %i: ", fd);
      return FALSE;
    }

  if (!g_socket_listener_add_socket (G_SOCKET_LISTENER (self->socket_service), socket, NULL, error))
    {
      g_prefix_error (error, "Failed to add listener for socket %i: ", fd);
      return FALSE;
    }

  return TRUE;
}

void
cockpit_web_server_start (CockpitWebServer *self)
{
  g_return_if_fail (COCKPIT_IS_WEB_SERVER (self));
  g_socket_service_start (self->socket_service);
}

/* ---------------------------------------------------------------------------------------------------- */

void
cockpit_web_server_set_protocol_header (CockpitWebServer *self,
                                        const gchar *protocol_header)
{
  g_free (self->protocol_header);
  self->protocol_header = g_strdup (protocol_header);
}

void
cockpit_web_server_set_forwarded_for_header (CockpitWebServer *self,
                                             const gchar *forwarded_for_header)
{
  g_free (self->forwarded_for_header);
  self->forwarded_for_header = g_strdup (forwarded_for_header);
}

/* ---------------------------------------------------------------------------------------------------- */

static CockpitWebRequest *
never_copy (CockpitWebRequest *self)
{
  g_assert_not_reached ();
}

static void
never_free (CockpitWebRequest *self)
{
  g_assert_not_reached ();
}

G_DEFINE_BOXED_TYPE(CockpitWebRequest, cockpit_web_request, never_copy, never_free);

static void
cockpit_web_request_free (gpointer data)
{
  CockpitWebRequest *self = data;
  if (self->timeout)
    {
      g_source_destroy (self->timeout);
      g_source_unref (self->timeout);
    }
  if (self->source)
    {
      g_source_destroy (self->source);
      g_source_unref (self->source);
    }

  /*
   * Request memory is either cleared or used elsewhere, by
   * handle-stream handlers (eg: the default handler. Don't
   * clear it here. The buffer may still be in use.
   */
  g_byte_array_unref (self->buffer);
  g_object_unref (self->io);
  g_free (self);
}

static void
cockpit_web_request_finish (CockpitWebRequest *self)
{
  g_hash_table_remove (self->web_server->requests, self);
}

static void
cockpit_web_request_process_delayed_reply (CockpitWebRequest *self,
                                           const gchar *path,
                                           GHashTable *headers)
{
  g_assert (self->delayed_reply > 299);

  g_autoptr(CockpitWebResponse) response = cockpit_web_request_respond (self);
  g_signal_connect_data (response, "done", G_CALLBACK (on_web_response_done),
                         g_object_ref (self->web_server), (GClosureNotify)g_object_unref, 0);

  if (self->delayed_reply == 301)
    {
      const gchar *host = g_hash_table_lookup (headers, "Host");
      g_autofree gchar *url = g_strdup_printf ("https://%s%s", host != NULL ? host : "", path);
      cockpit_web_response_headers (response, 301, "Moved Permanently", 0, "Location", url, NULL);
      cockpit_web_response_complete (response);
    }
  else
    {
      cockpit_web_response_error (response, self->delayed_reply, NULL, NULL);
    }
}

static gboolean
path_has_prefix (const gchar *path,
                 GString *prefix)
{
  return prefix->len > 0 &&
         strncmp (path, prefix->str, prefix->len) == 0 &&
         (path[prefix->len] == '\0' || path[prefix->len] == '/');
}

static gboolean
is_localhost_connection (GSocketConnection *conn)
{
  g_autoptr (GSocketAddress) addr = g_socket_connection_get_local_address (conn, NULL);
  if (G_IS_INET_SOCKET_ADDRESS (addr))
    {
      GInetAddress *inet = g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (addr));
      return g_inet_address_get_is_loopback (inet);
    }

  return FALSE;
}

static void
cockpit_web_request_process (CockpitWebRequest *self,
                             const gchar *method,
                             const gchar *path,
                             const gchar *host,
                             GHashTable *headers)
{
  gboolean claimed = FALSE;

  if (self->web_server->url_root->len &&
      !path_has_prefix (path, self->web_server->url_root))
    {
      self->delayed_reply = 404;
    }

  /* Redirect to TLS? */
  if (!self->delayed_reply && self->check_tls_redirect)
    {
      self->check_tls_redirect = FALSE;

      /* Certain paths don't require us to redirect */
      if (!path_has_prefix (path, self->web_server->ssl_exception_prefix))
        {
          if (!is_localhost_connection (G_SOCKET_CONNECTION (self->io)))
            {
              g_debug ("redirecting request from Host: %s to TLS", host);
              self->delayed_reply = 301;
            }
        }
    }

  self->method = method;

  if (self->delayed_reply)
    {
      cockpit_web_request_process_delayed_reply (self, path, headers);
      return;
    }

  g_autofree gchar *path_copy = g_strdup (path);

  self->original_path = path_copy;
  self->path = path_copy + self->web_server->url_root->len;
  self->headers = headers;
  self->host = host;

  gchar *query = strchr (path_copy, '?');
  if (query)
    {
      *query = '\0';
      self->query = query + 1;
    }
  else
    self->query = "";

  /* See if we have any takers... */
  g_signal_emit (self->web_server, sig_handle_stream, 0, self, &claimed);

  if (!claimed)
    claimed = cockpit_web_server_default_handle_stream (self->web_server, self);

  self->original_path = NULL;
  self->path = NULL;
  self->query = NULL;

  if (!claimed)
    g_critical ("no handler responded to request: %s", self->path);
}

static gboolean
cockpit_web_request_parse_and_process (CockpitWebRequest *self)
{
  gboolean again = FALSE;
  GHashTable *headers = NULL;
  gchar *method = NULL;
  gchar *path = NULL;
  const gchar *str;
  gchar *end = NULL;
  gssize off1;
  gssize off2;
  guint64 length;

  /* The hard input limit, we just terminate the connection */
  if (self->buffer->len > cockpit_webserver_request_maximum * 2)
    {
      g_message ("received HTTP request that was too large");
      goto out;
    }

  off1 = web_socket_util_parse_req_line ((const gchar *)self->buffer->data,
                                         self->buffer->len,
                                         &method,
                                         &path);
  if (off1 == 0)
    {
      again = TRUE;
      goto out;
    }
  if (off1 < 0)
    {
      g_message ("received invalid HTTP request line");
      self->delayed_reply = 400;
      goto out;
    }
  if (!path || path[0] != '/')
    {
      g_message ("received invalid HTTP path");
      self->delayed_reply = 400;
      goto out;
    }

  off2 = web_socket_util_parse_headers ((const gchar *)self->buffer->data + off1,
                                        self->buffer->len - off1,
                                        &headers);
  if (off2 == 0)
    {
      again = TRUE;
      goto out;
    }
  if (off2 < 0)
    {
      g_message ("received invalid HTTP request headers");
      self->delayed_reply = 400;
      goto out;
    }

  /* If we get a Content-Length then verify it is zero */
  length = 0;
  str = g_hash_table_lookup (headers, "Content-Length");
  if (str != NULL)
    {
      end = NULL;
      length = g_ascii_strtoull (str, &end, 10);
      if (!end || end[0])
        {
          g_message ("received invalid Content-Length");
          self->delayed_reply = 400;
          goto out;
        }

      /* The soft limit, we return 413 */
      if (length != 0)
        {
          g_debug ("received non-zero Content-Length");
          self->delayed_reply = 413;
        }
    }

  /* Not enough data yet */
  if (self->buffer->len < off1 + off2 + length)
    {
      again = TRUE;
      goto out;
    }

  if (!g_str_equal (method, "GET") && !g_str_equal (method, "HEAD"))
    {
      g_message ("received unsupported HTTP method");
      self->delayed_reply = 405;
    }

  str = g_hash_table_lookup (headers, "Host");
  if (!str || g_str_equal (str, ""))
    {
      g_message ("received HTTP request without Host header");
      self->delayed_reply = 400;
    }

  g_byte_array_remove_range (self->buffer, 0, off1 + off2);
  cockpit_web_request_process (self, method, path, str, headers);

out:
  if (headers)
    g_hash_table_unref (headers);
  g_free (method);
  g_free (path);
  if (!again)
    cockpit_web_request_finish (self);
  return again;
}

#if !GLIB_CHECK_VERSION(2,43,2)
#define G_IO_ERROR_CONNECTION_CLOSED G_IO_ERROR_BROKEN_PIPE
#endif

static gboolean
should_suppress_request_error (GError *error,
                               gsize received)
{
  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF) ||
      g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_NOT_TLS))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }

  /* If no bytes received, then don't worry about ECONNRESET and friends */
  if (received > 0)
    return FALSE;

  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CONNECTION_CLOSED) ||
      g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }

#if !GLIB_CHECK_VERSION(2,43,2)
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_FAILED) &&
      strstr (error->message, g_strerror (ECONNRESET)))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }
#endif

  return FALSE;
}

static gboolean
cockpit_web_request_on_input (GObject *pollable_input,
                              gpointer user_data)
{
  GPollableInputStream *input = (GPollableInputStream *)pollable_input;
  CockpitWebRequest *self = user_data;
  GError *error = NULL;
  gsize length;
  gssize count;

  length = self->buffer->len;

  /* With a GTlsServerConnection, the GSource callback is not called again if
   * there is still pending data in GnuTLS'es buffer.
   * (https://gitlab.gnome.org/GNOME/glib-networking/issues/20). Thus read up
   * to our allowed maximum size to ensure we got everything that's pending.
   * Add one extra byte so that cockpit_web_request_parse_and_process()
   * correctly rejects requests that are > maximum, instead of hanging.
   *
   * FIXME: This may still hang for several large requests that are pipelined;
   * for these this needs to be changed into a loop.
   */
  g_byte_array_set_size (self->buffer, length + cockpit_webserver_request_maximum + 1);

  count = g_pollable_input_stream_read_nonblocking (input, self->buffer->data + length,
                                                    cockpit_webserver_request_maximum + 1, NULL, &error);
  if (count < 0)
    {
      g_byte_array_set_size (self->buffer, length);

      /* Just wait and try again */
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_error_free (error);
          return TRUE;
        }

      if (!should_suppress_request_error (error, length))
        g_message ("couldn't read from connection: %s", error->message);

      cockpit_web_request_finish (self);
      g_error_free (error);
      return FALSE;
    }

  g_byte_array_set_size (self->buffer, length + count);

  if (count == 0)
    {
      if (self->eof_okay)
        close_io_stream (self->io);
      else
        g_debug ("caller closed connection early");
      cockpit_web_request_finish (self);
      return FALSE;
    }

  /* Once we receive data EOF is unexpected (until possible next request) */
  self->eof_okay = FALSE;

  return cockpit_web_request_parse_and_process (self);
}

static void
cockpit_web_request_start_input (CockpitWebRequest *self)
{
  GPollableInputStream *poll_in;
  GInputStream *in;

  /* Both GSocketConnection and GTlsServerConnection are pollable */
  in = g_io_stream_get_input_stream (self->io);
  poll_in = NULL;
  if (G_IS_POLLABLE_INPUT_STREAM (in))
    poll_in = (GPollableInputStream *)in;

  if (!poll_in || !g_pollable_input_stream_can_poll (poll_in))
    {
      if (in)
        g_critical ("cannot use a non-pollable input stream: %s", G_OBJECT_TYPE_NAME (in));
      else
        g_critical ("no input stream available");

      cockpit_web_request_finish (self);
      return;
    }

  /* Replace with a new source */
  if (self->source)
    {
      g_source_destroy (self->source);
      g_source_unref (self->source);
    }

  self->source = g_pollable_input_stream_create_source (poll_in, NULL);
  g_source_set_callback (self->source, (GSourceFunc)cockpit_web_request_on_input, self, NULL);
  g_source_attach (self->source, self->web_server->main_context);
}

static gboolean
cockpit_web_request_on_accept_certificate (GTlsConnection *conn,
                                           GTlsCertificate *peer_cert,
                                           GTlsCertificateFlags errors,
                                           gpointer user_data)
{
  /* Only used during testing */
  g_assert (cockpit_webserver_want_certificate == TRUE);
  return TRUE;
}

static gboolean
cockpit_web_request_on_socket_input (GSocket *socket,
                                     GIOCondition condition,
                                     gpointer user_data)
{
  CockpitWebRequest *self = user_data;
  guchar first_byte;
  GInputVector vector[1] = { { &first_byte, 1 } };
  gint flags = G_SOCKET_MSG_PEEK;
  GError *error = NULL;
  GIOStream *tls_stream;
  gssize num_read;
  g_auto(CockpitControlMessages) ccm = COCKPIT_CONTROL_MESSAGES_INIT;

  num_read = g_socket_receive_message (socket,
                                       NULL, /* out GSocketAddress */
                                       vector,
                                       1,
                                       &ccm.messages,
                                       &ccm.n_messages,
                                       &flags,
                                       NULL, /* GCancellable* */
                                       &error);

  if (num_read < 0)
    {
      /* Just wait and try again */
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_error_free (error);
          return TRUE;
        }

      if (!should_suppress_request_error (error, 0))
        g_message ("couldn't read from socket: %s", error->message);

      cockpit_web_request_finish (self);
      g_error_free (error);
      return FALSE;
    }

  JsonObject *metadata = cockpit_memfd_read_json_from_control_messages (&ccm, &error);
  if (metadata)
    {
      g_assert (G_IS_SOCKET_CONNECTION (self->io));
      g_object_set_qdata_full (G_OBJECT (self->io),
                               g_quark_from_static_string ("metadata"),
                               metadata, (GDestroyNotify) json_object_unref);
    }
  else if (error != NULL)
    {
      g_warning ("Failed while reading metadata from new connection: %s", error->message);
      g_clear_error (&error);
    }

  /*
   * TLS streams are guaranteed to start with octet 22.. this way we can distinguish them
   * from regular HTTP requests
   */
  if (first_byte == 22 || first_byte == 0x80)
    {
      if (self->web_server->certificate == NULL)
        {
          g_warning ("Received unexpected TLS connection and no certificate was configured");
          cockpit_web_request_finish (self);
          return FALSE;
        }

      tls_stream = g_tls_server_connection_new (self->io,
                                                self->web_server->certificate,
                                                &error);
      if (tls_stream == NULL)
        {
          g_warning ("couldn't create new TLS stream: %s", error->message);
          cockpit_web_request_finish (self);
          g_error_free (error);
          return FALSE;
        }

      if (cockpit_webserver_want_certificate)
        {
          g_object_set (tls_stream, "authentication-mode", G_TLS_AUTHENTICATION_REQUESTED, NULL);
          g_signal_connect (tls_stream, "accept-certificate", G_CALLBACK (cockpit_web_request_on_accept_certificate), NULL);
        }

      g_object_unref (self->io);
      self->io = G_IO_STREAM (tls_stream);
    }
  else
    {
      if (self->web_server->certificate || self->web_server->flags & COCKPIT_WEB_SERVER_REDIRECT_TLS)
        {
          /* non-TLS stream; defer redirection check until after header parsing */
          if (cockpit_web_server_get_flags (self->web_server) & COCKPIT_WEB_SERVER_REDIRECT_TLS)
            self->check_tls_redirect = TRUE;
        }
    }

  cockpit_web_request_start_input (self);

  /* No longer run *this* source */
  return FALSE;
}

static gboolean
cockpit_web_request_on_timeout (gpointer data)
{
  CockpitWebRequest *self = data;
  if (self->eof_okay)
    g_debug ("request timed out, closing");
  else
    g_message ("request timed out, closing");
  cockpit_web_request_finish (self);
  return FALSE;
}

static void
cockpit_web_request_start (CockpitWebServer *web_server,
                            GIOStream *io,
                            gboolean first)
{
  GSocketConnection *connection;
  GSocket *socket;

  CockpitWebRequest *self = g_new0 (CockpitWebRequest, 1);
  self->web_server = web_server;
  self->io = g_object_ref (io);
  self->buffer = g_byte_array_new ();

  /* Right before a request, EOF is not unexpected */
  self->eof_okay = TRUE;

  self->timeout = g_timeout_source_new_seconds (cockpit_webserver_request_timeout);
  g_source_set_callback (self->timeout, cockpit_web_request_on_timeout, self, NULL);
  g_source_attach (self->timeout, web_server->main_context);

  if (first)
    {
      connection = G_SOCKET_CONNECTION (io);
      socket = g_socket_connection_get_socket (connection);
      g_socket_set_blocking (socket, FALSE);

      self->source = g_socket_create_source (g_socket_connection_get_socket (connection),
                                             G_IO_IN, NULL);
      g_source_set_callback (self->source, (GSourceFunc)cockpit_web_request_on_socket_input, self, NULL);
      g_source_attach (self->source, web_server->main_context);
    }
  else
    cockpit_web_request_start_input (self);

  /* Owns the request */
  g_hash_table_add (web_server->requests, self);
}

CockpitWebResponse *
cockpit_web_request_respond (CockpitWebRequest *self)
{
  return cockpit_web_response_new (self->io, self->original_path, self->path, self->headers,
                                   self->method, cockpit_web_request_get_protocol (self));
}

const gchar *
cockpit_web_request_get_path (CockpitWebRequest *self)
{
  return self->path;
}

const gchar *
cockpit_web_request_get_query (CockpitWebRequest *self)
{
  return self->query;
}

const gchar *
cockpit_web_request_get_method (CockpitWebRequest *self)
{
  return self->method;
}

GByteArray *
cockpit_web_request_get_buffer (CockpitWebRequest *self)
{
  return self->buffer;
}

GHashTable *
cockpit_web_request_get_headers (CockpitWebRequest *self)
{
  return self->headers;
}

const gchar *
cockpit_web_request_lookup_header (CockpitWebRequest *self,
                                   const gchar *header)
{
  if (!self->headers)
    return NULL;

  return g_hash_table_lookup (self->headers, header);
}

gchar *
cockpit_web_request_parse_cookie (CockpitWebRequest *self,
                                  const gchar *name)
{
  if (!self->headers)
    return NULL;

  return cockpit_web_server_parse_cookie (self->headers, name);
}

GIOStream *
cockpit_web_request_get_io_stream (CockpitWebRequest *self)
{
  return self->io;
}

const gchar *
cockpit_web_request_get_host (CockpitWebRequest *self)
{
  return self->host;
}

const gchar *
cockpit_web_request_get_protocol (CockpitWebRequest *self)
{
  if (G_IS_TLS_CONNECTION (self->io))
    return "https";

  if (self->web_server && self->web_server->flags & COCKPIT_WEB_SERVER_FOR_TLS_PROXY)
    return "https";

  if (self->web_server && self->web_server->protocol_header)
    {
      const gchar *protocol = g_hash_table_lookup (self->headers, self->web_server->protocol_header);
      if (protocol)
        return protocol;
    }

  return "http";
}

gchar *
cockpit_web_request_get_remote_address (CockpitWebRequest *self)
{
  if (self->web_server && self->web_server->forwarded_for_header)
    {
      const gchar *forwarded_header = g_hash_table_lookup (self->headers, self->web_server->forwarded_for_header);
      if (forwarded_header && forwarded_header[0])
        {
          /* This isn't really standardised, but in practice, it's a
           * space separated list and the last item is from the
           * immediately upstream server.
           */
          const gchar *last_space = strrchr (forwarded_header, ' ');
          if (last_space)
            return g_strdup (last_space + 1);
          else
            return g_strdup (forwarded_header);
        }
    }

  if (self->io == NULL)
    return NULL;

  JsonObject *metadata = g_object_get_qdata (G_OBJECT (self->io), g_quark_from_static_string ("metadata"));
  if (metadata)
    {
      const gchar *tmp;
      if (cockpit_json_get_string (metadata, "origin-ip", NULL, &tmp))
        return g_strdup (tmp);
    }

  g_autoptr(GIOStream) base = NULL;
  if (G_IS_TLS_CONNECTION (self->io))
    g_object_get (self->io, "base-io-stream", &base, NULL);
  else
    base = g_object_ref (self->io);

  /* This is definitely a socket */
  g_return_val_if_fail (G_IS_SOCKET_CONNECTION (base), NULL);

  /* ...but it might be a unix socket.  NB: GInetSocketAddress includes IPv6. */
  g_autoptr(GSocketAddress) remote = g_socket_connection_get_remote_address (G_SOCKET_CONNECTION (base), NULL);
  if (remote && G_IS_INET_SOCKET_ADDRESS (remote))
    return g_inet_address_to_string (g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (remote)));

  return NULL;
}

const gchar *
cockpit_web_request_get_client_certificate (CockpitWebRequest *self)
{
  if (self->io == NULL)
    return NULL;

  JsonObject *metadata = g_object_get_qdata (G_OBJECT (self->io), g_quark_from_static_string ("metadata"));
  if (metadata == NULL)
    return NULL;

  const gchar *client_certificate = NULL;
  cockpit_json_get_string (metadata, "client-certificate", NULL, &client_certificate);
  return client_certificate;
}
