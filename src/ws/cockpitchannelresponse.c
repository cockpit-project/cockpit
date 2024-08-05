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

#include "common/cockpitchannel.h"
#include "common/cockpitconf.h"
#include "common/cockpitflow.h"
#include "common/cockpitwebinject.h"
#include "common/cockpitwebserver.h"
#include "common/cockpitwebresponse.h"

#include <string.h>

typedef struct {
  CockpitWebService *service;
  gchar *base_path;
  gchar *host;
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
      g_free (inject->host);
      g_free (inject);
    }
}

static CockpitChannelInject *
cockpit_channel_inject_new (CockpitWebService *service,
                            const gchar *path,
                            const gchar *host)
{
  CockpitChannelInject *inject = g_new (CockpitChannelInject, 1);
  inject->service = service;
  g_object_add_weak_pointer (G_OBJECT (inject->service), (gpointer *)&inject->service);
  inject->base_path = g_strdup (path);
  inject->host = g_strdup (host);
  return inject;
}

static void
cockpit_channel_inject_update_checksum (CockpitChannelInject *inject,
                                        GHashTable *headers)
{
  const gchar *checksum = g_hash_table_lookup (headers, COCKPIT_CHECKSUM_HEADER);

  if (checksum)
    cockpit_web_service_set_host_checksum (inject->service, inject->host, checksum);

  /* No need to send our custom header outside of cockpit */
  g_hash_table_remove (headers, COCKPIT_CHECKSUM_HEADER);
}

static void
cockpit_channel_inject_perform (CockpitChannelInject *inject,
                                CockpitWebResponse *response,
                                CockpitTransport *transport)
{
  static const gchar *marker = "<head>";
  g_autofree gchar *prefixed_application = NULL;

  const gchar *url_root = cockpit_web_response_get_url_root (response);

  if (!url_root && !inject->base_path)
    return;

  g_autoptr(GString) str = g_string_new ("");
  CockpitCreds *creds = cockpit_web_service_get_creds (inject->service);
  if (url_root)
    {
      g_string_append_printf (str, "\n    <meta name=\"url-root\" content=\"%s\">", url_root);
      prefixed_application = g_strdup_printf ("%s/%s",
                                              url_root,
                                              cockpit_creds_get_application (creds));
    }
  else
    {
      prefixed_application = g_strdup_printf ("/%s", cockpit_creds_get_application (creds));
    }

  {
    const gboolean allow_multihost = cockpit_conf_bool ("WebService", "AllowMultiHost",
                                                        ALLOW_MULTIHOST_DEFAULT);
    g_string_append_printf (str, "\n    <meta name=\"allow-multihost\" content=\"%s\">",
                            allow_multihost ? "yes" : "no");
  }

  if (inject->base_path)
    {
      const gchar *checksum = cockpit_web_service_get_checksum (inject->service, inject->host);
      if (checksum)
        {
          g_string_append_printf (str, "\n    <base href=\"%s/$%s%s\">",
                                  prefixed_application,
                                  checksum, inject->base_path);
        }
      else
        {
          g_string_append_printf (str, "\n    <base href=\"%s/@%s%s\">",
                                  prefixed_application, inject->host, inject->base_path);
        }
    }

  g_autoptr(GBytes) content = g_string_free_to_bytes (g_steal_pointer(&str));
  g_autoptr(CockpitWebFilter) filter = cockpit_web_inject_new (marker, content, 1);
  cockpit_web_response_add_filter (response, filter);
}

#define COCKPIT_TYPE_CHANNEL_RESPONSE  (cockpit_channel_response_get_type ())
#define COCKPIT_CHANNEL_RESPONSE(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_CHANNEL_RESPONSE, CockpitChannelResponse))
#define COCKPIT_IS_CHANNEL_RESPONSE(o) (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_CHANNEL_RESPONSE))

typedef struct {
  CockpitChannel parent;

  const gchar *logname;
  CockpitWebResponse *response;
  GHashTable *headers;

  /* We can handle http-stream1 and http-stream2 */
  gboolean http_stream1_prefix;
  gboolean http_stream2;

  /* Set when injecting data into response */
  CockpitChannelInject *inject;
} CockpitChannelResponse;

typedef struct {
  CockpitChannelClass parent;
} CockpitChannelResponseClass;

GType              cockpit_channel_response_get_type         (void);

G_DEFINE_TYPE (CockpitChannelResponse, cockpit_channel_response, COCKPIT_TYPE_CHANNEL);

static void
cockpit_channel_response_init (CockpitChannelResponse *self)
{

}

static void
cockpit_channel_response_finalize (GObject *object)
{
  CockpitChannelResponse *self = COCKPIT_CHANNEL_RESPONSE (object);

  g_object_unref (self->response);
  g_hash_table_unref (self->headers);
  cockpit_channel_inject_free (self->inject);

  G_OBJECT_CLASS (cockpit_channel_response_parent_class)->finalize (object);
}

static gboolean
ensure_headers (CockpitChannelResponse *self,
                guint status,
                const gchar *reason,
                gsize length)
{

  if (cockpit_web_response_get_state (self->response) == COCKPIT_WEB_RESPONSE_READY)
    {
      if (self->inject && self->inject->service)
        {
          cockpit_channel_inject_update_checksum (self->inject, self->headers);
          cockpit_channel_inject_perform (self->inject, self->response,
                                          cockpit_channel_get_transport (COCKPIT_CHANNEL (self)));
        }
      cockpit_web_response_headers_full (self->response, status, reason, length, self->headers);
      return TRUE;
    }

  return FALSE;
}

static void
cockpit_channel_response_close (CockpitChannel *channel,
                                const gchar *problem)
{
  CockpitChannelResponse *self = COCKPIT_CHANNEL_RESPONSE (channel);
  CockpitWebResponding state;

  /* The web response should not yet be complete */
  state = cockpit_web_response_get_state (self->response);

  if (problem == NULL)
    {
      /* Closed without any data */
      if (state == COCKPIT_WEB_RESPONSE_READY)
        {
          ensure_headers (self, 204, "OK", 0);
          cockpit_web_response_complete (self->response);
          g_debug ("%s: no content in external channel", self->logname);
        }
      else if (state < COCKPIT_WEB_RESPONSE_COMPLETE)
        {
          g_message ("%s: truncated data in external channel", self->logname);
          cockpit_web_response_abort (self->response);
        }
      else
        {
          g_debug ("%s: completed serving external channel", self->logname);
        }
    }
  else if (state == COCKPIT_WEB_RESPONSE_READY)
    {
      if (g_str_equal (problem, "not-found"))
        {
          g_debug ("%s: not found", self->logname);
          cockpit_web_response_error (self->response, 404, NULL, NULL);
        }
      else if (g_str_equal (problem, "access-denied"))
        {
          g_debug ("%s: forbidden", self->logname);
          cockpit_web_response_error (self->response, 403, NULL, NULL);
        }
      else if (g_str_equal (problem, "no-host") ||
               g_str_equal (problem, "no-cockpit") ||
               g_str_equal (problem, "unknown-hostkey") ||
               g_str_equal (problem, "unknown-host") ||
               g_str_equal (problem, "authentication-failed") ||
               g_str_equal (problem, "disconnected"))
        {
          g_debug ("%s: remote server unavailable: %s", self->logname, problem);
          cockpit_web_response_error (self->response, 502, NULL, "%s", problem);
        }
      else
        {
          g_message ("%s: external channel failed: %s", self->logname, problem);
          cockpit_web_response_error (self->response, 500, NULL, "%s", problem);
        }
    }
  else
    {
      if (g_str_equal (problem, "disconnected") || g_str_equal (problem, "terminated"))
        g_debug ("%s: failure while serving external channel: %s", self->logname, problem);
      else
        g_message ("%s: failure while serving external channel: %s", self->logname, problem);
      if (state < COCKPIT_WEB_RESPONSE_COMPLETE)
        cockpit_web_response_abort (self->response);
    }
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

  /* Remove hop-by-hop headers. See RFC 2068 */
  if (g_ascii_strcasecmp (header, "Connection") == 0 ||
      g_ascii_strcasecmp (header, "Keep-Alive") == 0 ||
      g_ascii_strcasecmp (header, "Public") == 0 ||
      g_ascii_strcasecmp (header, "Proxy-Authenticate") == 0 ||
      g_ascii_strcasecmp (header, "Transfer-Encoding") == 0 ||
      g_ascii_strcasecmp (header, "Upgrade") == 0)
    return;

  g_hash_table_insert (headers, g_strdup (header), g_strdup (value));
}

static gboolean
parse_httpstream_response (CockpitChannelResponse *self,
                           JsonObject *object,
                           gint64 *status,
                           const gchar **reason,
                           gssize *length)
{
  const gchar *content_length = NULL;
  JsonNode *node;

  if (!cockpit_json_get_int (object, "status", 200, status) ||
      !cockpit_json_get_string (object, "reason", NULL, reason))
    {
      g_warning ("%s: received invalid httpstream response", self->logname);
      return FALSE;
    }

  node = json_object_get_member (object, "headers");
  if (node)
    {
      if (!JSON_NODE_HOLDS_OBJECT (node))
        {
          g_warning ("%s: received invalid httpstream headers", self->logname);
          return FALSE;
        }
      json_object_foreach_member (json_node_get_object (node), object_to_headers, self->headers);
    }


  /* Default to unknown length */
  *length = -1;

  content_length = g_hash_table_lookup (self->headers, "Content-Length");
  if (content_length)
    {
      gchar *endptr = NULL;
      gint64 result = g_ascii_strtoll (content_length, &endptr, 10);
      if (result > 0 && result <= G_MAXSIZE && endptr && *endptr == '\0')
        *length = (gssize)result;

      /* We don't relay Content-Length directly, but expect CockpitWebResponse to set it again */
      g_hash_table_remove (self->headers, "Content-Length");
    }

  return TRUE;
}

static void
process_httpstream1_recv (CockpitChannelResponse *self,
                          GBytes *payload)
{
  GError *error = NULL;
  JsonObject *object;
  gint64 status;
  const gchar *reason;
  gssize length;

  g_return_if_fail (cockpit_web_response_get_state (self->response) == COCKPIT_WEB_RESPONSE_READY);

  object = cockpit_json_parse_bytes (payload, &error);
  if (error)
    {
      g_warning ("%s: couldn't parse http-stream1 header payload: %s", self->logname, error->message);
      cockpit_web_response_error (self->response, 500, NULL, NULL);
      g_error_free (error);
      return;
    }

  if (parse_httpstream_response (self, object, &status, &reason, &length))
    {
      if (!ensure_headers (self, status, reason, length))
        g_return_if_reached ();
    }
  else
    {
      cockpit_web_response_error (self->response, 500, NULL, NULL);
    }

  json_object_unref (object);
}

static void
cockpit_channel_response_recv (CockpitChannel *channel,
                               GBytes *payload)
{
  CockpitChannelResponse *self = COCKPIT_CHANNEL_RESPONSE (channel);

  /* First response payload message is meta data, then switch to actual data */
  if (self->http_stream1_prefix)
    {
      process_httpstream1_recv (self, payload);
      self->http_stream1_prefix = FALSE;
      return;
    }

  ensure_headers (self, 200, "OK", -1);
  cockpit_web_response_queue (self->response, payload);
}

static gboolean
cockpit_channel_response_control (CockpitChannel *channel,
                                  const gchar *command,
                                  JsonObject *options)
{
  CockpitChannelResponse *self = COCKPIT_CHANNEL_RESPONSE (channel);
  gint64 status;
  const gchar *reason;
  gssize length;

  if (self->http_stream2)
    {
      if (g_str_equal (command, "response"))
        {
          if (parse_httpstream_response (self, options, &status, &reason, &length))
            {
              if (!ensure_headers (self, status, reason, length))
                g_return_val_if_reached (FALSE);
            }
          else
            {
              cockpit_web_response_error (self->response, 500, NULL, NULL);
            }
          return TRUE;
        }
    }

  if (g_str_equal (command, "ready"))
    {
      gint64 content_length;
      if (cockpit_json_get_int (options, "size-hint", -1, &content_length) && content_length != -1)
        ensure_headers (self, 200, "OK", content_length);

      return TRUE;
    }

  if (g_str_equal (command, "done"))
    {
      ensure_headers (self, 200, "OK", 0);
      cockpit_web_response_complete (self->response);
      return TRUE;
    }

  return FALSE;
}

static void
cockpit_channel_response_prepare (CockpitChannel *channel)
{
  CockpitChannelResponse *self = COCKPIT_CHANNEL_RESPONSE (channel);
  const gchar *payload;
  JsonObject *open;

  COCKPIT_CHANNEL_CLASS (cockpit_channel_response_parent_class)->prepare (channel);

  /*
   * Tell the transport to throttle incoming flow on the given channel based on
   * output pressure in the web response.
   */
  cockpit_flow_throttle (COCKPIT_FLOW (channel), COCKPIT_FLOW (self->response));

  open = cockpit_channel_get_options (channel);
  cockpit_json_get_string (open, "path", NULL, &self->logname);
  if (!self->logname)
    self->logname = cockpit_channel_get_id (channel);

  payload = json_object_get_string_member (open, "payload");

  /* Special handling for http-stream1, splice in headers, handle injection */
  if (g_strcmp0 (payload, "http-stream1") == 0)
    self->http_stream1_prefix = TRUE;

  /* Special handling for http-stream2, splice in headers, handle injection */
  if (g_strcmp0 (payload, "http-stream2") == 0)
    self->http_stream2 = TRUE;

  /* Send the open message across the transport */
  cockpit_channel_control (channel, "open", open);

  /* Tell the channel we're ready */
  cockpit_channel_ready (channel, NULL);

  /* Indicate we are done sending input, we support no POST or PUT */
  cockpit_channel_control (channel, "done", NULL);
}

static void
cockpit_channel_response_class_init (CockpitChannelResponseClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->finalize = cockpit_channel_response_finalize;

  channel_class->prepare = cockpit_channel_response_prepare;
  channel_class->recv = cockpit_channel_response_recv;
  channel_class->control = cockpit_channel_response_control;
  channel_class->close = cockpit_channel_response_close;
}

static CockpitChannelResponse *
cockpit_channel_response_new (CockpitWebService *service,
                              CockpitWebResponse *response,
                              CockpitTransport *transport,
                              GHashTable *headers,
                              JsonObject *options)
{
  CockpitChannelResponse *self;
  gchar *id;

  id = cockpit_web_service_unique_channel (service);
  self = g_object_new (COCKPIT_TYPE_CHANNEL_RESPONSE,
                       "transport", transport,
                       "options", options,
                       "id", id,
                       NULL);

  self->response = g_object_ref (response);
  self->headers = g_hash_table_ref (headers);

  g_free (id);
  return self;
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
  const gchar *accept = NULL;
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

  *host = cockpit_web_service_get_host (service, where + 1);
  if (!*host)
    return FALSE;

  /* Top level resources (like the /manifests) are not translatable */
  translatable = is_resource_a_package_file (path);

  /* The ETag contains the language setting */
  if (translatable)
    {
      accept = g_hash_table_lookup (headers, "Accept-Language");
      languages = cockpit_web_server_parse_accept_list (accept, "C");
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
  CockpitChannelResponse *self = NULL;
  CockpitTransport *transport = NULL;
  CockpitCacheType cache_type = COCKPIT_WEB_RESPONSE_CACHE;
  const gchar *injecting_base_path = NULL;
  const gchar *host = NULL;
  const gchar *pragma;
  gchar *quoted_etag = NULL;
  GHashTable *out_headers = NULL;
  gchar *val = NULL;
  gboolean handled = FALSE;
  GHashTableIter iter;
  JsonObject *object = NULL;
  JsonObject *heads;
  const gchar *protocol;
  const gchar *http_host = "localhost";
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
      cache_type = COCKPIT_WEB_RESPONSE_CACHE;
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

  transport = cockpit_web_service_get_transport (service);
  if (!transport)
    goto out;

  out_headers = cockpit_web_server_new_table ();

  channel = cockpit_web_service_unique_channel (service);
  json_object_set_string_member (object, "channel", channel);
  json_object_set_boolean_member (object, "flow-control", TRUE);

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

      if (g_ascii_strcasecmp (key, "Cookie") == 0 ||
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
          g_ascii_strcasecmp (key, "Transfer-Encoding") == 0 ||
          g_ascii_strcasecmp (key, "X-Forwarded-For") == 0 ||
          g_ascii_strcasecmp (key, "X-Forwarded-Host") == 0 ||
          g_ascii_strcasecmp (key, "X-Forwarded-Protocol") == 0)
        continue;

      if (g_ascii_strcasecmp (key, "Host") == 0)
        http_host = (gchar *) value;
      else
        json_object_set_string_member (heads, key, value);

      g_free (val);
    }

  /* Send along the HTTP scheme the package should assume is accessing things */
  protocol = cockpit_web_response_get_protocol (response);

  json_object_set_string_member (heads, "Host", host);
  json_object_set_string_member (heads, "X-Forwarded-Proto", protocol);
  json_object_set_string_member (heads, "X-Forwarded-Host", http_host);

  /* We only inject a <base> if root level request */
  injecting_base_path = where ? NULL : path;
  if (injecting_base_path)
    {
      /* If we are injecting a <base> element, then we don't allow gzip compression */
      json_object_set_string_member (heads, "Accept-Encoding", "identity");
    }

  json_object_set_object_member (object, "headers", heads);

  self = cockpit_channel_response_new (service, response, transport,
                                       out_headers, object);

  self->inject = cockpit_channel_inject_new (service, injecting_base_path, host);
  handled = TRUE;

  /* Unref when the channel closes */
  g_signal_connect_after (self, "closed", G_CALLBACK (g_object_unref), NULL);

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
                               CockpitWebRequest *request,
                               JsonObject *open)
{
  CockpitChannelResponse *self;
  CockpitTransport *transport;
  WebSocketDataType data_type;
  GHashTable *headers;
  const gchar *content_type;
  const gchar *content_encoding;
  const gchar *content_disposition;

  g_autoptr(CockpitWebResponse) response = cockpit_web_request_respond (request);

  /* Parse the external */
  if (!cockpit_web_service_parse_external (open, &content_type, &content_encoding, &content_disposition, NULL))
    {
      cockpit_web_response_error (response, 400, NULL, "Bad channel request");
      return;
    }

  transport = cockpit_web_service_get_transport (service);
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

  json_object_set_boolean_member (open, "flow-control", TRUE);

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

  if (content_encoding)
    g_hash_table_insert (headers, g_strdup ("Content-Encoding"), g_strdup (content_encoding));

  /* We shouldn't need to send this part further */
  json_object_remove_member (open, "external");

  self = cockpit_channel_response_new (service, response, transport, headers, open);
  g_hash_table_unref (headers);

  /* Unref when the channel closes */
  g_signal_connect_after (self, "closed", G_CALLBACK (g_object_unref), NULL);
}
