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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitwebserver.h"

#include "cockpithash.h"
#include "cockpitmemory.h"
#include "cockpitwebresponse.h"

#include "websocket/websocket.h"

#include <sys/socket.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include <systemd/sd-daemon.h>

/* Used during testing */
gboolean cockpit_webserver_want_certificate = FALSE;

guint cockpit_webserver_request_timeout = 30;
gsize cockpit_webserver_request_maximum = 4096;

typedef struct _CockpitWebServerClass CockpitWebServerClass;

struct _CockpitWebServer {
  GObject parent_instance;

  gint port;
  GInetAddress *address;
  gboolean socket_activated;
  GTlsCertificate *certificate;
  GString *ssl_exception_prefix;
  GString *url_root;
  gint request_timeout;
  gint request_max;
  gboolean redirect_tls;

  GSocketService *socket_service;
  GMainContext *main_context;
  GHashTable *requests;
};

struct _CockpitWebServerClass {
  GObjectClass parent_class;

  gboolean (* handle_stream)   (CockpitWebServer *server,
                                const gchar *original_path,
                                const gchar *path,
                                GIOStream *io_stream,
                                GHashTable *headers,
                                GByteArray *input);

  gboolean (* handle_resource) (CockpitWebServer *server,
                                const gchar *path,
                                GHashTable *headers,
                                CockpitWebResponse *response);
};

enum
{
  PROP_0,
  PROP_PORT,
  PROP_ADDRESS,
  PROP_CERTIFICATE,
  PROP_SSL_EXCEPTION_PREFIX,
  PROP_SOCKET_ACTIVATED,
  PROP_REDIRECT_TLS,
  PROP_URL_ROOT,
};

static gint sig_handle_stream = 0;
static gint sig_handle_resource = 0;

static void cockpit_request_free (gpointer data);

static void cockpit_request_start (CockpitWebServer *self,
                                   GIOStream *stream,
                                   gboolean first);

static void initable_iface_init (GInitableIface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitWebServer, cockpit_web_server, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (G_TYPE_INITABLE, initable_iface_init));

/* ---------------------------------------------------------------------------------------------------- */

static void
cockpit_web_server_init (CockpitWebServer *server)
{
  server->requests = g_hash_table_new_full (g_direct_hash, g_direct_equal,
                                            cockpit_request_free, NULL);
  server->main_context = g_main_context_ref_thread_default ();
  server->ssl_exception_prefix = g_string_new ("");
  server->url_root = g_string_new ("");
  server->redirect_tls = TRUE;
  server->address = NULL;
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

  g_clear_object (&server->address);
  g_clear_object (&server->certificate);
  g_hash_table_destroy (server->requests);
  if (server->main_context)
    g_main_context_unref (server->main_context);
  g_string_free (server->ssl_exception_prefix, TRUE);
  g_string_free (server->url_root, TRUE);
  g_clear_object (&server->socket_service);

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
    case PROP_PORT:
      g_value_set_int (value, cockpit_web_server_get_port (server));
      break;

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

    case PROP_SOCKET_ACTIVATED:
      g_value_set_boolean (value, server->socket_activated);
      break;

    case PROP_REDIRECT_TLS:
      g_value_set_boolean (value, server->redirect_tls);
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
  const gchar *address = NULL;

  switch (prop_id)
    {
    case PROP_PORT:
      server->port = g_value_get_int (value);
      break;

    case PROP_ADDRESS:
      address = g_value_get_string (value);
      if (address)
        {
          server->address = g_inet_address_new_from_string (address);
          if (!server->address)
            g_warning ("Couldn't parse IP address from: %s", address);
        }
      break;

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

    case PROP_REDIRECT_TLS:
      server->redirect_tls = g_value_get_boolean (value);
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
    cockpit_request_start (self, io, FALSE);
  else
    close_io_stream (io);
}

static gboolean
cockpit_web_server_default_handle_stream (CockpitWebServer *self,
                                          const gchar *original_path,
                                          const gchar *path,
                                          GIOStream *io_stream,
                                          GHashTable *headers,
                                          GByteArray *input)
{
  CockpitWebResponse *response;
  gboolean claimed = FALSE;
  GQuark detail;
  gchar *pos;
  gchar bak;

  /* Yes, we happen to know that we can modify this string safely. */
  pos = strchr (path, '?');
  if (pos != NULL)
    {
      *pos = '\0';
      pos++;
    }

  /* TODO: Correct HTTP version for response */
  response = cockpit_web_response_new (io_stream, original_path, path, pos, headers);
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
   */

  /* Temporarily null terminate string after first component */
  pos = NULL;
  if (path[0] != '\0')
    {
      pos = strchr (path + 1, '/');
      if (pos != NULL)
        {
          pos++;
          bak = *pos;
          *pos = '\0';
        }
    }
  detail = g_quark_try_string (path);
  if (pos != NULL)
    *pos = bak;

  /* See if we have any takers... */
  g_signal_emit (self,
                 sig_handle_resource, detail,
                 path,
                 headers,
                 response,
                 &claimed);

  /* TODO: Here is where we would plug keep-alive into respnse */
  g_object_unref (response);

  return claimed;
}

static gboolean
cockpit_web_server_default_handle_resource (CockpitWebServer *self,
                                            const gchar *path,
                                            GHashTable *headers,
                                            CockpitWebResponse *response)
{
  cockpit_web_response_error (response, 404, NULL, NULL);
  return TRUE;
}

static void
cockpit_web_server_class_init (CockpitWebServerClass *klass)
{
  GObjectClass *gobject_class;

  klass->handle_stream = cockpit_web_server_default_handle_stream;
  klass->handle_resource = cockpit_web_server_default_handle_resource;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->dispose = cockpit_web_server_dispose;
  gobject_class->finalize = cockpit_web_server_finalize;
  gobject_class->set_property = cockpit_web_server_set_property;
  gobject_class->get_property = cockpit_web_server_get_property;

  g_object_class_install_property (gobject_class,
                                   PROP_PORT,
                                   g_param_spec_int ("port", NULL, NULL,
                                                     -1, 65535, 8080,
                                                     G_PARAM_READABLE |
                                                     G_PARAM_WRITABLE |
                                                     G_PARAM_CONSTRUCT_ONLY |
                                                     G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class,
                                   PROP_ADDRESS,
                                   g_param_spec_string ("address", NULL, NULL, NULL,
                                                        G_PARAM_WRITABLE |
                                                        G_PARAM_CONSTRUCT_ONLY |
                                                        G_PARAM_STATIC_STRINGS));

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

  g_object_class_install_property (gobject_class, PROP_SOCKET_ACTIVATED,
                                   g_param_spec_boolean ("socket-activated", NULL, NULL, FALSE,
                                                        G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  g_object_class_install_property (gobject_class, PROP_REDIRECT_TLS,
                                   g_param_spec_boolean ("redirect-tls", NULL, NULL, TRUE,
                                                         G_PARAM_READABLE | G_PARAM_STATIC_STRINGS));

  sig_handle_stream = g_signal_new ("handle-stream",
                                    G_OBJECT_CLASS_TYPE (klass),
                                    G_SIGNAL_RUN_LAST,
                                    G_STRUCT_OFFSET (CockpitWebServerClass, handle_stream),
                                    g_signal_accumulator_true_handled,
                                    NULL, /* accu_data */
                                    g_cclosure_marshal_generic,
                                    G_TYPE_BOOLEAN,
                                    5,
                                    G_TYPE_STRING,
                                    G_TYPE_STRING,
                                    G_TYPE_IO_STREAM,
                                    G_TYPE_HASH_TABLE,
                                    G_TYPE_BYTE_ARRAY);

  sig_handle_resource = g_signal_new ("handle-resource",
                                      G_OBJECT_CLASS_TYPE (klass),
                                      G_SIGNAL_RUN_LAST | G_SIGNAL_DETAILED,
                                      G_STRUCT_OFFSET (CockpitWebServerClass, handle_resource),
                                      g_signal_accumulator_true_handled,
                                      NULL, /* accu_data */
                                      g_cclosure_marshal_generic,
                                      G_TYPE_BOOLEAN,
                                      3,
                                      G_TYPE_STRING,
                                      G_TYPE_HASH_TABLE,
                                      COCKPIT_TYPE_WEB_RESPONSE);
}

CockpitWebServer *
cockpit_web_server_new (const gchar *address,
                        gint port,
                        GTlsCertificate *certificate,
                        GCancellable *cancellable,
                        GError **error)
{
  GInitable *initable;
  initable = g_initable_new (COCKPIT_TYPE_WEB_SERVER,
                             cancellable,
                             error,
                             "port", port,
                             "address", address,
                             "certificate", certificate,
                             NULL);
  if (initable != NULL)
    return COCKPIT_WEB_SERVER (initable);
  else
    return NULL;
}

/* ---------------------------------------------------------------------------------------------------- */

gboolean
cockpit_web_server_get_socket_activated (CockpitWebServer *self)
{
  return self->socket_activated;
}

gint
cockpit_web_server_get_port (CockpitWebServer *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVER (self), -1);
  return self->port;
}

void
cockpit_web_server_set_redirect_tls (CockpitWebServer *self,
                                     gboolean          redirect_tls)
{
  g_return_if_fail (COCKPIT_IS_WEB_SERVER (self));

  self->redirect_tls = redirect_tls;
}

gboolean
cockpit_web_server_get_redirect_tls (CockpitWebServer *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_SERVER (self), FALSE);

  return self->redirect_tls;
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
cockpit_web_server_parse_languages (GHashTable *headers,
                                    const gchar *defawlt)
{
  const gchar *accept;
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

  accept = g_hash_table_lookup (headers, "Accept-Language");

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

/**
 * cockpit_web_server_parse_encoding:
 * @headers: a table of HTTP headers
 * @encoding: an encoding to check
 *
 * Check if the @headers allow for the @encoding. The Accept-Encoding
 * header is consulted along with its qvalues, and defaults.
 *
 * Returns: whether the encoding is acceptable
 */
gboolean
cockpit_web_server_parse_encoding (GHashTable *headers,
                                   const gchar *encoding)
{
  gboolean ret = FALSE;
  const gchar *header;
  gboolean any = FALSE;
  gchar *accept;
  double qvalue;
  gchar *copy;
  gchar *next;
  gchar *pos;

  header = g_hash_table_lookup (headers, "Accept-Encoding");
  if (!header)
    return TRUE;

  accept = copy = g_strdup (header);

  while (accept)
    {
      next = strchr (accept, ',');
      if (next)
        {
          *next = '\0';
          next++;
        }

      qvalue = 1;

      pos = strchr (accept, ';');
      if (pos)
        {
          *pos = '\0';
          if (strncmp (pos + 1, "q=", 2) == 0)
            {
              qvalue = g_ascii_strtod (pos + 3, NULL);
              if (qvalue < 0)
                qvalue = 0;
            }
        }

      accept = g_strstrip (accept);
      if (accept[0])
        any = TRUE;

      if (g_ascii_strcasecmp (encoding, accept) == 0)
        {
          ret = qvalue > 0;
          break;
        }

      accept = next;
    }

  /* Empty header, anything is acceptable */
  if (!ret && !any)
    ret = TRUE;

  g_free (copy);
  return ret;
}

/* ---------------------------------------------------------------------------------------------------- */

typedef struct {
  int state;
  GIOStream *io;
  GByteArray *buffer;
  gint delayed_reply;
  CockpitWebServer *web_server;
  gboolean eof_okay;
  GSource *source;
  GSource *timeout;
} CockpitRequest;

static void
cockpit_request_free (gpointer data)
{
  CockpitRequest *request = data;
  if (request->timeout)
    {
      g_source_destroy (request->timeout);
      g_source_unref (request->timeout);
    }
  if (request->source)
    {
      g_source_destroy (request->source);
      g_source_unref (request->source);
    }

  /*
   * Request memory is either cleared or used elsewhere, by
   * handle-stream handlers (eg: the default handler. Don't
   * clear it here. The buffer may still be in use.
   */
  g_byte_array_unref (request->buffer);
  g_object_unref (request->io);
  g_free (request);
}

static void
cockpit_request_finish (CockpitRequest *request)
{
  g_hash_table_remove (request->web_server->requests, request);
}

static void
process_delayed_reply (CockpitRequest *request,
                       const gchar *path,
                       GHashTable *headers)
{
  CockpitWebResponse *response;
  const gchar *host;
  const gchar *body;
  GBytes *bytes;
  gsize length;
  gchar *url;

  g_assert (request->delayed_reply > 299);

  response = cockpit_web_response_new (request->io, NULL, NULL, NULL, headers);
  g_signal_connect_data (response, "done", G_CALLBACK (on_web_response_done),
                         g_object_ref (request->web_server), (GClosureNotify)g_object_unref, 0);

  if (request->delayed_reply == 301)
    {
      body = "<html><head><title>Moved</title></head>"
        "<body>Please use TLS</body></html>";
      host = g_hash_table_lookup (headers, "Host");
      url = g_strdup_printf ("https://%s%s",
                             host != NULL ? host : "", path);
      length = strlen (body);
      cockpit_web_response_headers (response, 301, "Moved Permanently", length,
                                    "Content-Type", "text/html",
                                    "Location", url,
                                    NULL);
      g_free (url);
      bytes = g_bytes_new_static (body, length);
      if (cockpit_web_response_queue (response, bytes))
        cockpit_web_response_complete (response);
      g_bytes_unref (bytes);
    }
  else
    {
      cockpit_web_response_error (response, request->delayed_reply, NULL, NULL);
    }

  g_object_unref (response);
}

static gboolean
path_has_prefix (const gchar *path,
                 GString *prefix)
{
  return prefix->len > 0 &&
         strncmp (path, prefix->str, prefix->len) == 0 &&
         (path[prefix->len] == '\0' || path[prefix->len] == '/');
}

static void
process_request (CockpitRequest *request,
                 const gchar *path,
                 GHashTable *headers)
{
  gboolean claimed = FALSE;
  const gchar *actual_path;

  if (request->web_server->url_root->len &&
      !path_has_prefix (path, request->web_server->url_root))
    {
      request->delayed_reply = 404;
    }

  /*
   * If redirecting to TLS, check the path. Certain paths
   * don't require us to redirect.
   */
  if (request->delayed_reply == 301 &&
      path_has_prefix (path, request->web_server->ssl_exception_prefix))
    {
      request->delayed_reply = 0;
    }

  if (request->delayed_reply)
    {
      process_delayed_reply (request, path, headers);
      return;
    }

  actual_path = path + request->web_server->url_root->len;

  /* See if we have any takers... */
  g_signal_emit (request->web_server,
                 sig_handle_stream, 0,
                 path,
                 actual_path,
                 request->io,
                 headers,
                 request->buffer,
                 &claimed);

  if (!claimed)
    g_critical ("no handler responded to request: %s", actual_path);
}

static gboolean
parse_and_process_request (CockpitRequest *request)
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
  if (request->buffer->len > cockpit_webserver_request_maximum * 2)
    {
      g_message ("received HTTP request that was too large");
      goto out;
    }

  off1 = web_socket_util_parse_req_line ((const gchar *)request->buffer->data,
                                         request->buffer->len,
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
      request->delayed_reply = 400;
      goto out;
    }

  off2 = web_socket_util_parse_headers ((const gchar *)request->buffer->data + off1,
                                        request->buffer->len - off1,
                                        &headers);
  if (off2 == 0)
    {
      again = TRUE;
      goto out;
    }
  if (off2 < 0)
    {
      g_message ("received invalid HTTP request headers");
      request->delayed_reply = 400;
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
          request->delayed_reply = 400;
          goto out;
        }

      /* The soft limit, we return 413 */
      if (length != 0)
        {
          g_debug ("received non-zero Content-Length");
          request->delayed_reply = 413;
        }
    }

  /* Not enough data yet */
  if (request->buffer->len < off1 + off2 + length)
    {
      again = TRUE;
      goto out;
    }

  if (!g_str_equal (method, "GET"))
    {
      g_message ("received unsupported HTTP method");
      request->delayed_reply = 405;
    }

  str = g_hash_table_lookup (headers, "Host");
  if (!str || g_str_equal (str, ""))
    {
      g_message ("received HTTP request without Host header");
      request->delayed_reply = 400;
    }

  g_byte_array_remove_range (request->buffer, 0, off1 + off2);
  process_request (request, path, headers);

out:
  if (headers)
    g_hash_table_unref (headers);
  g_free (method);
  g_free (path);
  if (!again)
    cockpit_request_finish (request);
  return again;
}

static gboolean
should_suppress_request_error (GError *error)
{
  if (g_error_matches (error, G_TLS_ERROR, G_TLS_ERROR_EOF))
    {
      g_debug ("request error: %s", error->message);
      return TRUE;
    }

  return FALSE;
}

static gboolean
on_request_input (GObject *pollable_input,
                  gpointer user_data)
{
  GPollableInputStream *input = (GPollableInputStream *)pollable_input;
  CockpitRequest *request = user_data;
  GError *error = NULL;
  gsize length;
  gssize count;

  length = request->buffer->len;
  g_byte_array_set_size (request->buffer, length + 4096);

  count = g_pollable_input_stream_read_nonblocking (input, request->buffer->data + length,
                                                    4096, NULL, &error);
  if (count < 0)
    {
      g_byte_array_set_size (request->buffer, length);

      /* Just wait and try again */
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_error_free (error);
          return TRUE;
        }

      if (!should_suppress_request_error (error))
        g_message ("couldn't read from connection: %s", error->message);

      cockpit_request_finish (request);
      g_error_free (error);
      return FALSE;
    }

  g_byte_array_set_size (request->buffer, length + count);

  if (count == 0)
    {
      if (request->eof_okay)
        close_io_stream (request->io);
      else
        g_debug ("caller closed connection early");
      cockpit_request_finish (request);
      return FALSE;
    }

  /* Once we receive data EOF is unexpected (until possible next request) */
  request->eof_okay = FALSE;

  return parse_and_process_request (request);
}

static void
start_request_input (CockpitRequest *request)
{
  GPollableInputStream *poll_in;
  GInputStream *in;

  /* Both GSocketConnection and GTlsServerConnection are pollable */
  in = g_io_stream_get_input_stream (request->io);
  poll_in = NULL;
  if (G_IS_POLLABLE_INPUT_STREAM (in))
    poll_in = (GPollableInputStream *)in;

  if (!poll_in || !g_pollable_input_stream_can_poll (poll_in))
    {
      g_critical ("cannot use a non-pollable input stream: %s", G_OBJECT_TYPE_NAME (in));
      cockpit_request_finish (request);
      return;
    }

  /* Replace with a new source */
  if (request->source)
    {
      g_source_destroy (request->source);
      g_source_unref (request->source);
    }

  request->source = g_pollable_input_stream_create_source (poll_in, NULL);
  g_source_set_callback (request->source, (GSourceFunc)on_request_input, request, NULL);
  g_source_attach (request->source, request->web_server->main_context);
}

static gboolean
on_accept_certificate (GTlsConnection *conn,
                       GTlsCertificate *peer_cert,
                       GTlsCertificateFlags errors,
                       gpointer user_data)
{
  /* Only used during testing */
  g_assert (cockpit_webserver_want_certificate == TRUE);
  return TRUE;
}

static gboolean
on_socket_input (GSocket *socket,
                 GIOCondition condition,
                 gpointer user_data)
{
  CockpitRequest *request = user_data;
  guchar first_byte;
  GInputVector vector[1] = { { &first_byte, 1 } };
  gint flags = G_SOCKET_MSG_PEEK;
  gboolean redirect_tls;
  gboolean is_tls;
  GSocketAddress *addr;
  GInetAddress *inet;
  GError *error = NULL;
  GIOStream *tls_stream;
  gssize num_read;

  num_read = g_socket_receive_message (socket,
                                       NULL, /* out GSocketAddress */
                                       vector,
                                       1,
                                       NULL, /* out GSocketControlMessage */
                                       NULL, /* out num_messages */
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

      if (!should_suppress_request_error (error))
        g_message ("couldn't read from socket: %s", error->message);

      cockpit_request_finish (request);
      g_error_free (error);
      return FALSE;
    }

  is_tls = TRUE;
  redirect_tls = FALSE;

  /*
   * TLS streams are guaranteed to start with octet 22.. this way we can distinguish them
   * from regular HTTP requests
   */
  if (first_byte != 22 && first_byte != 0x80)
    {
      is_tls = FALSE;
      redirect_tls = request->web_server->redirect_tls;
      if (redirect_tls)
        {
          addr = g_socket_connection_get_local_address (G_SOCKET_CONNECTION (request->io), NULL);
          if (G_IS_INET_SOCKET_ADDRESS (addr))
            {
              inet = g_inet_socket_address_get_address (G_INET_SOCKET_ADDRESS (addr));
              redirect_tls = !g_inet_address_get_is_loopback (inet);
            }
          g_clear_object (&addr);
        }
    }

  if (is_tls)
    {
      tls_stream = g_tls_server_connection_new (request->io,
                                                request->web_server->certificate,
                                                &error);
      if (tls_stream == NULL)
        {
          g_warning ("couldn't create new TLS stream: %s", error->message);
          cockpit_request_finish (request);
          g_error_free (error);
          return FALSE;
        }

      if (cockpit_webserver_want_certificate)
        {
          g_object_set (tls_stream, "authentication-mode", G_TLS_AUTHENTICATION_REQUESTED, NULL);
          g_signal_connect (tls_stream, "accept-certificate", G_CALLBACK (on_accept_certificate), NULL);
        }

      g_object_unref (request->io);
      request->io = G_IO_STREAM (tls_stream);
    }
  else if (redirect_tls)
    {
      request->delayed_reply = 301;
    }

  start_request_input (request);

  /* No longer run *this* source */
  return FALSE;
}

static gboolean
on_request_timeout (gpointer data)
{
  CockpitRequest *request = data;
  if (request->eof_okay)
    g_debug ("request timed out, closing");
  else
    g_message ("request timed out, closing");
  cockpit_request_finish (request);
  return FALSE;
}

static void
cockpit_request_start (CockpitWebServer *self,
                       GIOStream *io,
                       gboolean first)
{
  GSocketConnection *connection;
  CockpitRequest *request;
  gboolean input = TRUE;
  GSocket *socket;

  request = g_new0 (CockpitRequest, 1);
  request->web_server = self;
  request->io = g_object_ref (io);
  request->buffer = g_byte_array_new ();

  /* Right before a request, EOF is not unexpected */
  request->eof_okay = TRUE;

  request->timeout = g_timeout_source_new_seconds (cockpit_webserver_request_timeout);
  g_source_set_callback (request->timeout, on_request_timeout, request, NULL);
  g_source_attach (request->timeout, self->main_context);

  if (first)
    {
      connection = G_SOCKET_CONNECTION (io);
      socket = g_socket_connection_get_socket (connection);
      g_socket_set_blocking (socket, FALSE);

      if (self->certificate)
        {
          request->source = g_socket_create_source (g_socket_connection_get_socket (connection),
                                                    G_IO_IN, NULL);
          g_source_set_callback (request->source, (GSourceFunc)on_socket_input, request, NULL);
          g_source_attach (request->source, self->main_context);

          /* Wait on reading input */
          input = FALSE;
        }

    }

  /* Owns the request */
  g_hash_table_add (self->requests, request);

  if (input)
    start_request_input (request);
}

static gboolean
on_incoming (GSocketService *service,
             GSocketConnection *connection,
             GObject *source_object,
             gpointer user_data)
{
  CockpitWebServer *self = COCKPIT_WEB_SERVER (user_data);
  cockpit_request_start (self, G_IO_STREAM (connection), TRUE);

  /* handled */
  return TRUE;
}

/* ---------------------------------------------------------------------------------------------------- */

static gboolean
cockpit_web_server_initable_init (GInitable *initable,
                                  GCancellable *cancellable,
                                  GError **error)
{
  CockpitWebServer *server = COCKPIT_WEB_SERVER (initable);
  GSocketAddress *socket_address = NULL;
  GSocketAddress *result_address = NULL;

  gboolean ret = FALSE;
  gboolean failed = FALSE;
  int n, fd;

  server->socket_service = g_socket_service_new ();

  n = sd_listen_fds (0);
  if (n > 0)
    {
      /* We got file descriptors passed in, use those. */

      for (fd = SD_LISTEN_FDS_START; fd < SD_LISTEN_FDS_START + n; fd++)
        {
          GSocket *s = NULL;
          gboolean b;
          int type;
          socklen_t l = sizeof (type);

          /*
           * HACK: Workaround g_error() happy code in GSocket
           * https://bugzilla.gnome.org/show_bug.cgi?id=746339
           */
          if (getsockopt (fd, SOL_SOCKET, SO_TYPE, &type, &l) < 0)
            {
              g_set_error (error, G_IO_ERROR, G_IO_ERROR_FAILED,
                           "invalid socket passed via systemd activation: %d: %s", fd, g_strerror (errno));
              goto out;
            }

          s = g_socket_new_from_fd (fd, error);
          if (s == NULL)
            {
              g_prefix_error (error, "Failed to acquire passed socket %i: ", fd);
              goto out;
            }

          b = cockpit_web_server_add_socket (server, s, error);
          g_object_unref (s);

          if (!b)
            {
              g_prefix_error (error, "Failed to add listener for socket %i: ", fd);
              goto out;
            }
        }

      server->socket_activated = TRUE;
    }
  else
    {
      if (server->address)
        {
          socket_address = g_inet_socket_address_new (server->address, server->port);
          if (socket_address)
            {
              failed = !g_socket_listener_add_address (G_SOCKET_LISTENER (server->socket_service),
                                                      socket_address, G_SOCKET_TYPE_STREAM,
                                                      G_SOCKET_PROTOCOL_DEFAULT,
                                                      NULL, &result_address,
                                                      error);
              if (!failed)
                {
                  server->port = g_inet_socket_address_get_port (G_INET_SOCKET_ADDRESS (result_address));
                  g_object_unref (result_address);
                }
              g_object_unref (socket_address);
            }
        }

      /* No fds passed in, let's listen on our own. */
      else if (server->port == 0)
        {
          server->port = g_socket_listener_add_any_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                              NULL, error);
          failed = (server->port == 0);
        }
      else if (server->port > 0)
        {
          failed = !g_socket_listener_add_inet_port (G_SOCKET_LISTENER (server->socket_service),
                                                     server->port, NULL, error);
        }
      if (failed)
        {
          g_prefix_error (error, "Failed to bind to port %d: ", server->port);
          goto out;
        }
    }

  g_signal_connect (server->socket_service,
                    "incoming",
                    G_CALLBACK (on_incoming),
                    server);

  ret = TRUE;

out:
  return ret;
}

gboolean
cockpit_web_server_add_socket (CockpitWebServer *self,
                               GSocket *socket,
                               GError **error)
{
  return g_socket_listener_add_socket (G_SOCKET_LISTENER (self->socket_service), socket, NULL, error);
}

static void
initable_iface_init (GInitableIface *iface)
{
  iface->init = cockpit_web_server_initable_init;
}

/* ---------------------------------------------------------------------------------------------------- */
