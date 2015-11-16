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
  const gchar *application;
  const gchar *checksum;
  const gchar *host;
  GString *str;
  GBytes *base;

  str = g_string_new ("");

  if (!inject->service)
    return;

  creds = cockpit_web_service_get_creds (inject->service);
  application = cockpit_creds_get_application (creds);

  checksum = cockpit_web_service_get_checksum (inject->service, transport);
  if (checksum)
    {
      g_string_printf (str, "\n    <base href=\"/%s/$%s%s\">", application, checksum, inject->base_path);
    }
  else
    {
      host = cockpit_web_service_get_host (inject->service, transport);
      g_string_printf (str, "\n    <base href=\"/%s/@%s%s\">", application, host, inject->base_path);
    }

  base = g_string_free_to_bytes (str);
  filter = cockpit_web_inject_new (marker, base);
  g_bytes_unref (base);

  cockpit_web_response_add_filter (response, filter);
  g_object_unref (filter);
}

typedef struct {
  const gchar *logname;
  gchar *channel;

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
  location = g_strdup_printf ("/%s/$%s%s",
                              cockpit_creds_get_application (creds),
                              checksum, path);

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
      if (state < COCKPIT_WEB_RESPONSE_COMPLETE)
        {
          g_message ("%s: invalid state while serving resource", chesp->logname);
          cockpit_web_response_abort (chesp->response);
        }
      else
        {
          g_debug ("%s: completed serving resource", chesp->logname);
        }
    }
  else if (state == COCKPIT_WEB_RESPONSE_READY)
    {
      if (g_str_equal (problem, "not-found"))
        {
          g_debug ("%s: resource not found", chesp->logname);
          cockpit_web_response_error (chesp->response, 404, NULL, NULL);
        }
      else if (g_str_equal (problem, "no-host") ||
               g_str_equal (problem, "no-forwarding") ||
               g_str_equal (problem, "unknown-hostkey") ||
               g_str_equal (problem, "authentication-failed"))
        {
          g_debug ("%s: remote server unavailable: %s", chesp->logname, problem);
          cockpit_web_response_error (chesp->response, 502, NULL, NULL);
        }
      else
        {
          g_message ("%s: failed to retrieve resource: %s", chesp->logname, problem);
          cockpit_web_response_error (chesp->response, 500, NULL, NULL);
        }
    }
  else
    {
      g_message ("%s: failure while serving resource: %s", chesp->logname, problem);
      cockpit_web_response_abort (chesp->response);
    }

  g_object_unref (chesp->response);
  g_object_unref (chesp->transport);
  g_hash_table_unref (chesp->headers);
  cockpit_channel_inject_free (chesp->inject);
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
on_transport_httpstream_headers (CockpitTransport *transport,
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
      if (chesp->inject)
        cockpit_channel_inject_perform (chesp->inject, chesp->response, chesp->transport);
      cockpit_web_response_headers_full (chesp->response, status, reason, -1, chesp->headers);
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

static void
on_transport_closed (CockpitTransport *transport,
                     const gchar *problem,
                     CockpitChannelResponse *chesp)
{
  cockpit_channel_response_close (chesp, problem ? problem : "disconnected");
}

void
cockpit_channel_response_serve (CockpitWebService *service,
                                GHashTable *headers,
                                CockpitWebResponse *response,
                                const gchar *where,
                                const gchar *path)
{
  CockpitChannelResponse *chesp;
  CockpitTransport *transport = NULL;
  const gchar *host = NULL;
  gchar *quoted_etag = NULL;
  gchar *val = NULL;
  gboolean handled = FALSE;
  GHashTableIter iter;
  GBytes *command;
  const gchar *checksum;
  JsonObject *object = NULL;
  JsonObject *heads;
  gpointer key;
  gpointer value;

  g_return_if_fail (COCKPIT_IS_WEB_SERVICE (service));
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (response));
  g_return_if_fail (headers != NULL);
  g_return_if_fail (path != NULL);

  if (where == NULL)
    {
      host = "localhost";
    }
  else if (where[0] == '@')
    {
      host = where + 1;
    }
  else if (where[0] == '$')
    {
      quoted_etag = g_strdup_printf ("\"%s\"", where);

      if (g_strcmp0 (g_hash_table_lookup (headers, "If-None-Match"), where) == 0 ||
          g_strcmp0 (g_hash_table_lookup (headers, "If-None-Match"), quoted_etag) == 0)
        {
          cockpit_web_response_headers (response, 304, "Not Modified", 0, "ETag", quoted_etag, NULL);
          cockpit_web_response_complete (response);
          handled = TRUE;
          goto out;
        }

      transport = cockpit_web_service_find_transport (service, where + 1);
      if (!transport)
        goto out;

      host = cockpit_web_service_get_host (service, transport);
      if (!host)
        {
          g_warn_if_reached ();
          goto out;
        }
    }
  else
    {
      goto out;
    }

  object = cockpit_transport_build_json ("command", "open",
                                         "payload", "http-stream1",
                                         "internal", "packages",
                                         "method", "GET",
                                         "host", host,
                                         "path", path,
                                         "binary", "raw",
                                         NULL);

  if (!transport)
    {
      transport = cockpit_web_service_ensure_transport (service, object);
      if (!transport)
        goto out;
    }

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

  chesp = g_new0 (CockpitChannelResponse, 1);
  chesp->response = g_object_ref (response);
  chesp->transport = g_object_ref (transport);
  chesp->headers = cockpit_web_server_new_table ();
  chesp->logname = cockpit_web_response_get_path (response);
  chesp->channel = cockpit_web_service_unique_channel (service);
  json_object_set_string_member (object, "channel", chesp->channel);

  chesp->transport_recv = g_signal_connect (transport, "recv", G_CALLBACK (on_transport_httpstream_headers), chesp);
  chesp->transport_closed = g_signal_connect (transport, "closed", G_CALLBACK (on_transport_closed), chesp);
  chesp->transport_control = g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), chesp);

  if (!where)
    {
      chesp->inject = cockpit_channel_inject_new (service, path);
    }

  if (quoted_etag)
    {
      /*
       * If we have a checksum, then use it as an ETag. It is intentional that
       * a cockpit-bridge version could (in the future) override this.
       */
      g_hash_table_insert (chesp->headers, g_strdup ("ETag"), quoted_etag);
      quoted_etag = NULL;
    }

  heads = json_object_new ();

  g_hash_table_iter_init (&iter, headers);
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

  command = cockpit_json_write_bytes (object);
  cockpit_transport_send (transport, NULL, command);
  g_bytes_unref (command);

  json_object_unref (object);
  object = cockpit_transport_build_json ("command", "done",
                                         "channel", chesp->channel,
                                         NULL);

  command = cockpit_json_write_bytes (object);
  cockpit_transport_send (transport, NULL, command);
  g_bytes_unref (command);

  handled = TRUE;

out:
  if (object)
    json_object_unref (object);
  g_free (quoted_etag);

  if (!handled)
    cockpit_web_response_error (response, 404, NULL, NULL);
}
