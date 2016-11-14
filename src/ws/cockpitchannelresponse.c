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

#include "cockpitchannelresponse.h"

#include "common/cockpitwebinject.h"
#include "common/cockpitwebserver.h"

#include <string.h>

typedef struct {
  CockpitWebService *service;
  gchar *base_path;
} CockpitChannelInject;

static void
cockpit_channel_inject_free (gpointer data)
{
  CockpitChannelInject *inject = data;

  if (inject)
    {
      if (inject->service)
        g_object_remove_weak_pointer (G_OBJECT (inject->service), (gpointer *)&inject->service);
      g_free (inject->base_path);
      g_free (inject);
    }
}

static CockpitChannelInject *
cockpit_channel_inject_new (CockpitWebService *service,
                            const gchar *path)
{
  CockpitChannelInject *inject = g_new (CockpitChannelInject, 1);
  inject->service = service;
  g_object_add_weak_pointer (G_OBJECT (inject->service), (gpointer *)&inject->service);
  inject->base_path = g_strdup (path);
  return inject;
}

static void
cockpit_channel_inject_perform (CockpitChannelInject *inject,
                                CockpitWebResponse *response,
                                CockpitTransport *transport)
{
  static const gchar *marker = "<head>";
  CockpitWebFilter *filter;
  CockpitCreds *creds;
  gchar *prefixed_application = NULL;
  const gchar *checksum;
  const gchar *host;
  GString *str;
  GBytes *base;

  str = g_string_new ("");

  if (!inject->service)
    return;

  creds = cockpit_web_service_get_creds (inject->service);
  if (cockpit_web_response_get_url_root (response))
    {
      prefixed_application = g_strdup_printf ("%s/%s",
                                              cockpit_web_response_get_url_root (response),
                                              cockpit_creds_get_application (creds));
    }
  else
    {
      prefixed_application = g_strdup_printf ("/%s", cockpit_creds_get_application (creds));
    }

  checksum = cockpit_web_service_get_checksum (inject->service, transport);
  if (checksum)
    {
      g_string_printf (str, "\n    <base href=\"%s/$%s%s\">",
                       prefixed_application,
                       checksum, inject->base_path);
    }
  else
    {
      host = cockpit_web_service_get_host (inject->service, transport);
      g_string_printf (str, "\n    <base href=\"%s/@%s%s\">",
                       prefixed_application, host, inject->base_path);
    }

  base = g_string_free_to_bytes (str);
  filter = cockpit_web_inject_new (marker, base, 1);
  g_bytes_unref (base);

  cockpit_web_response_add_filter (response, filter);
  g_object_unref (filter);
  g_free (prefixed_application);
}

typedef struct {
  const gchar *logname;
  gchar *channel;
  JsonObject *open;

  CockpitWebResponse *response;
  GHashTable *headers;

  CockpitTransport *transport;
  gulong transport_recv;
  gulong transport_control;
  gulong transport_closed;

  /* Set when injecting data into response */
  CockpitChannelInject *inject;
} CockpitChannelResponse;

static gboolean
redirect_to_checksum_path (CockpitWebService *service,
                           CockpitWebResponse *response,
                           const gchar *checksum,
                           const gchar *path)
{
  CockpitCreds *creds;
  gchar *location;
  const gchar *body;
  GBytes *bytes;
  gboolean ret;
  gsize length;

  creds = cockpit_web_service_get_creds (service);
  if (cockpit_web_response_get_url_root (response))
    {
      location = g_strdup_printf ("%s/%s/$%s%s",
                                  cockpit_web_response_get_url_root (response),
                                  cockpit_creds_get_application (creds),
                                  checksum, path);
    }
  else
    {
      location = g_strdup_printf ("/%s/$%s%s",
                                  cockpit_creds_get_application (creds),
                                  checksum, path);
    }


  body = "<html><head><title>Temporary redirect</title></head>"
         "<body>Access via checksum</body></html>";

  length = strlen (body);
  cockpit_web_response_headers (response, 307, "Temporary Redirect", length,
                                "Content-Type", "text/html",
                                "Location", location,
                                NULL);
  g_free (location);

  bytes = g_bytes_new_static (body, length);
  ret = cockpit_web_response_queue (response, bytes);
  if (ret)
    cockpit_web_response_complete (response);
  g_bytes_unref (bytes);

  return ret;
}

static gboolean
ensure_headers (CockpitChannelResponse *chesp,
                guint status,
                const gchar *reason)
{
  if (cockpit_web_response_get_state (chesp->response) == COCKPIT_WEB_RESPONSE_READY)
    {
      if (chesp->inject)
        cockpit_channel_inject_perform (chesp->inject, chesp->response, chesp->transport);
      cockpit_web_response_headers_full (chesp->response, status, reason, -1, chesp->headers);
      return TRUE;
    }

  return FALSE;
}

static void
cockpit_channel_response_close (CockpitChannelResponse *chesp,
                                const gchar *problem)
{
  CockpitWebResponding state;

  /* Ensure no more signals arrive about our response */
  g_signal_handler_disconnect (chesp->transport, chesp->transport_recv);
  g_signal_handler_disconnect (chesp->transport, chesp->transport_control);
  g_signal_handler_disconnect (chesp->transport, chesp->transport_closed);

  /* The web response should not yet be complete */
  state = cockpit_web_response_get_state (chesp->response);

  if (problem == NULL)
    {
      /* Closed without any data */
      if (state == COCKPIT_WEB_RESPONSE_READY)
        {
          ensure_headers (chesp, 204, "OK");
          cockpit_web_response_complete (chesp->response);
          g_debug ("%s: no content in external channel", chesp->logname);
        }
      else if (state < COCKPIT_WEB_RESPONSE_COMPLETE)
        {
          g_message ("%s: truncated data in external channel", chesp->logname);
          cockpit_web_response_abort (chesp->response);
        }
      else
        {
          g_debug ("%s: completed serving external channel", chesp->logname);
        }
    }
  else if (state == COCKPIT_WEB_RESPONSE_READY)
    {
      if (g_str_equal (problem, "not-found"))
        {
          g_debug ("%s: not found", chesp->logname);
          cockpit_web_response_error (chesp->response, 404, NULL, NULL);
        }
      else if (g_str_equal (problem, "no-host") ||
               g_str_equal (problem, "no-cockpit") ||
               g_str_equal (problem, "unknown-hostkey") ||
               g_str_equal (problem, "authentication-failed") ||
               g_str_equal (problem, "disconnected"))
        {
          g_debug ("%s: remote server unavailable: %s", chesp->logname, problem);
          cockpit_web_response_error (chesp->response, 502, NULL, NULL);
        }
      else
        {
          g_message ("%s: external channel failed: %s", chesp->logname, problem);
          cockpit_web_response_error (chesp->response, 500, NULL, NULL);
        }
    }
  else
    {
      if (g_str_equal (problem, "disconnected"))
        g_debug ("%s: failure while serving external channel: %s", chesp->logname, problem);
      else
        g_message ("%s: failure while serving external channel: %s", chesp->logname, problem);
      cockpit_web_response_abort (chesp->response);
    }

  g_object_unref (chesp->response);
  g_object_unref (chesp->transport);
  g_hash_table_unref (chesp->headers);
  cockpit_channel_inject_free (chesp->inject);
  json_object_unref (chesp->open);
  g_free (chesp->channel);
  g_free (chesp);
}

static gboolean
on_transport_recv (CockpitTransport *transport,
                   const gchar *channel,
                   GBytes *payload,
                   CockpitChannelResponse *chesp)
{
  if (channel && g_str_equal (channel, chesp->channel))
    {
      ensure_headers (chesp, 200, "OK");
      cockpit_web_response_queue (chesp->response, payload);
      return TRUE;
    }

  return FALSE;
}

static void
object_to_headers (JsonObject *object,
                   const gchar *header,
                   JsonNode *node,
                   gpointer user_data)
{
  GHashTable *headers = user_data;
  const gchar *value = json_node_get_string (node);

  g_return_if_fail (value != NULL);

  if (g_ascii_strcasecmp (header, "Content-Length") == 0 ||
      g_ascii_strcasecmp (header, "Connection") == 0)
    return;

  g_hash_table_insert (headers, g_strdup (header), g_strdup (value));
}

static gboolean
parse_httpstream_response (CockpitChannelResponse *chesp,
                           JsonObject *object,
                           gint64 *status,
                           const gchar **reason)
{
  JsonNode *node;

  if (!cockpit_json_get_int (object, "status", 200, status) ||
      !cockpit_json_get_string (object, "reason", NULL, reason))
    {
      g_warning ("%s: received invalid httpstream response", chesp->logname);
      return FALSE;
    }

  node = json_object_get_member (object, "headers");
  if (node)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          g_warning ("%s: received invalid httpstream headers", chesp->logname);
          return FALSE;
        }
      json_object_foreach_member (json_node_get_object (node), object_to_headers, chesp->headers);
    }

  return TRUE;
}

static gboolean
on_httpstream_recv (CockpitTransport *transport,
                    const gchar *channel,
                    GBytes *payload,
                    CockpitChannelResponse *chesp)
{
  GError *error = NULL;
  JsonObject *object;
  gint64 status;
  const gchar *reason;

  if (!channel || !g_str_equal (channel, chesp->channel))
    return FALSE;

  g_return_val_if_fail (cockpit_web_response_get_state (chesp->response) == COCKPIT_WEB_RESPONSE_READY, FALSE);

  /* First response payload message is meta data, then switch to actual data */
  g_signal_handler_disconnect (chesp->transport, chesp->transport_recv);
  chesp->transport_recv = g_signal_connect (chesp->transport, "recv", G_CALLBACK (on_transport_recv), chesp);

  object = cockpit_json_parse_bytes (payload, &error);
  if (error)
    {
      g_warning ("%s: couldn't parse http-stream1 header payload: %s", chesp->logname, error->message);
      cockpit_web_response_error (chesp->response, 500, NULL, NULL);
      g_error_free (error);
      return TRUE;
    }

  if (parse_httpstream_response (chesp, object, &status, &reason))
    {
      if (!ensure_headers (chesp, status, reason))
        g_return_val_if_reached (FALSE);
    }
  else
    {
      cockpit_web_response_error (chesp->response, 500, NULL, NULL);
    }

  json_object_unref (object);
  return TRUE;
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const gchar *command,
                      const gchar *channel,
                      JsonObject *options,
                      GBytes *message,
                      CockpitChannelResponse *chesp)
{
  const gchar *problem = NULL;

  if (!channel || !g_str_equal (channel, chesp->channel))
    return FALSE; /* not handled */

  if (g_str_equal (command, "done"))
    {
      ensure_headers (chesp, 200, "OK");
      cockpit_web_response_complete (chesp->response);
      return TRUE;
    }
  else if (g_str_equal (command, "close"))
    {
      if (!cockpit_json_get_string (options, "problem", NULL, &problem))
        {
          g_message ("%s: received close command with invalid problem", chesp->logname);
          problem = "disconnected";
        }
      cockpit_channel_response_close (chesp, problem);
    }
  else
    {
      /* Ignore other control messages */
    }

  return TRUE; /* handled */
}

static gboolean
on_httpstream_control (CockpitTransport *transport,
                       const gchar *command,
                       const gchar *channel,
                       JsonObject *options,
                       GBytes *message,
                       CockpitChannelResponse *chesp)
{
  gint64 status;
  const gchar *reason;

  if (!channel || !g_str_equal (channel, chesp->channel))
    return FALSE; /* not handled */

  if (g_str_equal (command, "response"))
    {
      if (parse_httpstream_response (chesp, options, &status, &reason))
        {
          if (!ensure_headers (chesp, status, reason))
            g_return_val_if_reached (FALSE);
        }
      else
        {
          cockpit_web_response_error (chesp->response, 500, NULL, NULL);
        }
      return TRUE;
    }

  return on_transport_control (transport, command, channel, options, message, chesp);
}


static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     CockpitChannelResponse *chesp)
{
  cockpit_channel_response_close (chesp, problem ? problem : "disconnected");
}

static CockpitChannelResponse *
cockpit_channel_response_create (CockpitWebService *service,
                                 CockpitWebResponse *response,
                                 CockpitTransport *transport,
                                 const gchar *logname,
                                 GHashTable *headers,
                                 JsonObject *open)
{
  CockpitChannelResponse *chesp;
  const gchar *payload;
  JsonObject *done;
  GBytes *bytes;

  payload = json_object_get_string_member (open, "payload");

  chesp = g_new0 (CockpitChannelResponse, 1);
  chesp->response = g_object_ref (response);
  chesp->transport = g_object_ref (transport);
  chesp->headers = g_hash_table_ref (headers);
  chesp->channel = cockpit_web_service_unique_channel (service);
  chesp->open = json_object_ref (open);

  if (!cockpit_json_get_string (open, "path", chesp->channel, &chesp->logname))
    chesp->logname = chesp->channel;

  json_object_set_string_member (open, "command", "open");
  json_object_set_string_member (open, "channel", chesp->channel);

  /* Special handling for http-stream1, splice in headers, handle injection */
  if (g_strcmp0 (payload, "http-stream1") == 0)
    chesp->transport_recv = g_signal_connect (transport, "recv", G_CALLBACK (on_httpstream_recv), chesp);
  else
    chesp->transport_recv = g_signal_connect (transport, "recv", G_CALLBACK (on_transport_recv), chesp);

  /* Special handling for http-stream2, splice in headers, handle injection */
  if (g_strcmp0 (payload, "http-stream2") == 0)
    chesp->transport_control = g_signal_connect (transport, "control", G_CALLBACK (on_httpstream_control), chesp);
  else
    chesp->transport_control = g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), chesp);

  chesp->transport_closed = g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), chesp);

  bytes = cockpit_json_write_bytes (chesp->open);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);

  done = cockpit_transport_build_json ("command", "done", "channel", chesp->channel, NULL);
  bytes = cockpit_json_write_bytes (done);
  json_object_unref (done);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);

  return chesp;
}

static gboolean
is_resource_a_package_file (const gchar *path)
{
  return path && path[0] && strchr (path + 1, '/') != NULL;
}

static gboolean
parse_host_and_etag (CockpitWebService *service,
                     GHashTable *headers,
                     const gchar *where,
                     const gchar *path,
                     const gchar **host,
                     gchar **etag)
{
  CockpitTransport *transport;
  gchar **languages = NULL;
  gboolean translatable;
  gchar *language;

  /* Parse the language out of the CockpitLang cookie and set Accept-Language */
  language = cockpit_web_server_parse_cookie (headers, "CockpitLang");
  if (language)
    g_hash_table_replace (headers, g_strdup ("Accept-Language"), language);

  if (!where)
    {
      *host = "localhost";
      *etag = NULL;
      return TRUE;
    }
  if (where[0] == '@')
    {
      *host = where + 1;
      *etag = NULL;
      return TRUE;
    }

  if (!where || where[0] != '$')
    return FALSE;

  transport = cockpit_web_service_find_transport (service, where + 1);
  if (!transport)
    return FALSE;

  *host = cockpit_web_service_get_host (service, transport);
  if (!*host)
    {
      g_warn_if_reached ();
      return FALSE;
    }

  /* Top level resources (like the /manifests) are not translatable */
  translatable = is_resource_a_package_file (path);

  /* The ETag contains the language setting */
  if (translatable)
    {
      languages = cockpit_web_server_parse_languages (headers, "C");
      *etag = g_strdup_printf ("\"%s-%s\"", where, languages[0]);
      g_strfreev (languages);
    }
  else
    {
      *etag = g_strdup_printf ("\"%s\"", where);
    }

  return TRUE;
}

void
cockpit_channel_response_serve (CockpitWebService *service,
                                GHashTable *in_headers,
                                CockpitWebResponse *response,
                                const gchar *where,
                                const gchar *path)
{
  CockpitChannelResponse *chesp = NULL;
  CockpitTransport *transport = NULL;
  CockpitCacheType cache_type = COCKPIT_WEB_RESPONSE_CACHE_PRIVATE;
  const gchar *host = NULL;
  const gchar *pragma;
  gchar *quoted_etag = NULL;
  GHashTable *out_headers = NULL;
  gchar *val = NULL;
  gboolean handled = FALSE;
  GHashTableIter iter;
  const gchar *checksum = NULL;
  JsonObject *object = NULL;
  JsonObject *heads;
  gchar *channel = NULL;
  gpointer key;
  gpointer value;

  g_return_if_fail (COCKPIT_IS_WEB_SERVICE (service));
  g_return_if_fail (in_headers != NULL);
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (response));
  g_return_if_fail (path != NULL);

  /* Where might be NULL, but that's still valid */
  if (!parse_host_and_etag (service, in_headers, where, path, &host, &quoted_etag))
    {
      /* Did not recognize the where */
      goto out;
    }

  if (quoted_etag)
    {
      cache_type = COCKPIT_WEB_RESPONSE_CACHE_FOREVER;
      pragma = g_hash_table_lookup (in_headers, "Pragma");

      if ((!pragma || !strstr (pragma, "no-cache")) &&
           g_strcmp0 (g_hash_table_lookup (in_headers, "If-None-Match"), quoted_etag) == 0)
        {
          cockpit_web_response_headers (response, 304, "Not Modified", 0, "ETag", quoted_etag, NULL);
          cockpit_web_response_complete (response);
          handled = TRUE;
          goto out;
        }
    }

  cockpit_web_response_set_cache_type (response, cache_type);
  object = cockpit_transport_build_json ("command", "open",
                                         "payload", "http-stream1",
                                         "internal", "packages",
                                         "method", "GET",
                                         "host", host,
                                         "path", path,
                                         "binary", "raw",
                                         NULL);

  transport = cockpit_web_service_ensure_transport (service, object);
  if (!transport)
    goto out;

  if (where)
    {
      /*
       * Maybe send back a redirect to the checksum url. We only do this if actually
       * accessing a file, and not a some sort of data like '/checksum', or a root path
       * like '/'
       */
      if (where[0] == '@' && strchr (path, '.'))
        {
          checksum = cockpit_web_service_get_checksum (service, transport);
          if (checksum)
            {
              handled = redirect_to_checksum_path (service, response, checksum, path);
              goto out;
            }
        }
    }

  out_headers = cockpit_web_server_new_table ();

  channel = cockpit_web_service_unique_channel (service);
  json_object_set_string_member (object, "channel", channel);

  if (quoted_etag)
    {
      /*
       * If we have a checksum, then use it as an ETag. It is intentional that
       * a cockpit-bridge version could (in the future) override this.
       */
      g_hash_table_insert (out_headers, g_strdup ("ETag"), quoted_etag);
      quoted_etag = NULL;
    }

  heads = json_object_new ();

  g_hash_table_iter_init (&iter, in_headers);
  while (g_hash_table_iter_next (&iter, &key, &value))
    {
      val = NULL;

      if (g_ascii_strcasecmp (key, "Host") == 0 ||
          g_ascii_strcasecmp (key, "Cookie") == 0 ||
          g_ascii_strcasecmp (key, "Referer") == 0 ||
          g_ascii_strcasecmp (key, "Connection") == 0 ||
          g_ascii_strcasecmp (key, "Pragma") == 0 ||
          g_ascii_strcasecmp (key, "Cache-Control") == 0 ||
          g_ascii_strcasecmp (key, "User-Agent") == 0 ||
          g_ascii_strcasecmp (key, "Accept-Charset") == 0 ||
          g_ascii_strcasecmp (key, "Accept-Ranges") == 0 ||
          g_ascii_strcasecmp (key, "Content-Length") == 0 ||
          g_ascii_strcasecmp (key, "Content-MD5") == 0 ||
          g_ascii_strcasecmp (key, "Content-Range") == 0 ||
          g_ascii_strcasecmp (key, "Range") == 0 ||
          g_ascii_strcasecmp (key, "TE") == 0 ||
          g_ascii_strcasecmp (key, "Trailer") == 0 ||
          g_ascii_strcasecmp (key, "Upgrade") == 0 ||
          g_ascii_strcasecmp (key, "Transfer-Encoding") == 0)
        continue;

      json_object_set_string_member (heads, key, value);
      g_free (val);
    }

  json_object_set_string_member (heads, "Host", host);
  json_object_set_object_member (object, "headers", heads);

  chesp = cockpit_channel_response_create (service, response, transport,
                                           cockpit_web_response_get_path (response),
                                           out_headers, object);

  if (!where)
    chesp->inject = cockpit_channel_inject_new (service, path);

  handled = TRUE;

out:
  if (object)
    json_object_unref (object);
  g_free (quoted_etag);
  if (out_headers)
    g_hash_table_unref (out_headers);
  g_free (channel);

  if (!handled)
    cockpit_web_response_error (response, 404, NULL, NULL);
}

void
cockpit_channel_response_open (CockpitWebService *service,
                               GHashTable *in_headers,
                               CockpitWebResponse *response,
                               JsonObject *open)
{
  CockpitTransport *transport;
  WebSocketDataType data_type;
  GHashTable *headers;
  const gchar *content_type;
  const gchar *content_disposition;

  /* Parse the external */
  if (!cockpit_web_service_parse_external (open, &content_type, &content_disposition, NULL))
    {
      cockpit_web_response_error (response, 400, NULL, "Bad channel request");
      return;
    }

  transport = cockpit_web_service_ensure_transport (service, open);
  if (!transport)
    {
      cockpit_web_response_error (response, 502, NULL, "Failed to open channel transport");
      return;
    }

  headers = cockpit_web_server_new_table ();

  if (content_disposition)
    g_hash_table_insert (headers, g_strdup ("Content-Disposition"), g_strdup (content_disposition));

  if (!json_object_has_member (open, "binary"))
    json_object_set_string_member (open, "binary", "raw");

  if (!content_type)
    {
      if (!cockpit_web_service_parse_binary (open, &data_type))
        g_return_if_reached ();
      if (data_type == WEB_SOCKET_DATA_TEXT)
        content_type = "text/plain";
      else
        content_type = "application/octet-stream";
    }
  g_hash_table_insert (headers, g_strdup ("Content-Type"), g_strdup (content_type));

  /* We shouldn't need to send this part further */
  json_object_remove_member (open, "external");

  cockpit_channel_response_create (service, response, transport, NULL, headers, open);
  g_hash_table_unref (headers);
}
