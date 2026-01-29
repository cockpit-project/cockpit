/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "websocket.h"
#include "websocketprivate.h"

#include <stdlib.h>
#include <string.h>

/**
 * WebSocketState:
 * @WEB_SOCKET_STATE_CONNECTING: the WebSocket is not yet ready to send messages
 * @WEB_SOCKET_STATE_OPEN: the Websocket is ready to send messages
 * @WEB_SOCKET_STATE_CLOSING: the Websocket is in the process of closing down, no further messages sent
 * @WEB_SOCKET_STATE_CLOSED: the Websocket is completely closed down
 *
 * The WebSocket is in the %WEB_SOCKET_STATE_CONNECTING state during initial
 * connection setup, and handshaking. If the handshake or connection fails it
 * can go directly to the %WEB_SOCKET_STATE_CLOSED state from here.
 *
 * Once the WebSocket handshake completes successfully it will be in the
 * %WEB_SOCKET_STATE_OPEN state. During this state, and only during this state
 * can WebSocket messages be sent.
 *
 * WebSocket messages can be received during either the %WEB_SOCKET_STATE_OPEN
 * or %WEB_SOCKET_STATE_CLOSING states.
 *
 * The WebSocket goes into the %WEB_SOCKET_STATE_CLOSING state once it has
 * successfully sent a close request to the peer. If we had not yet received
 * an earlier close request from the peer, then the WebSocket waits for a
 * response to the close request (until a timeout).
 *
 * Once actually closed completely down the WebSocket state is
 * %WEB_SOCKET_STATE_CLOSED. No communication is possible during this state.
 */

GQuark
web_socket_error_get_quark (void)
{
  return g_quark_from_static_string ("web-socket-error-quark");
}

static inline const gchar *
strskip (const gchar *start,
         const gchar c,
         const gchar *end)
{
  while (start != end && start[0] == c)
    start++;
  return start;
}

static gsize
parse_version (const gchar *data,
               gsize length,
               gchar **version)
{
  if (length < 8)
    return 0;
  if (memcmp (data, "HTTP/1.0", 8) != 0 &&
      memcmp (data, "HTTP/1.1", 8) != 0)
    return 0;
  if (version)
    *version = g_strndup (data, 8);
  return 8;
}

gboolean
_web_socket_util_parse_url (const gchar *url,
                            gchar **out_scheme,
                            gchar **out_host,
                            gchar **out_path,
                            GError **error)
{
  const gchar *colon;
  const gchar *host;
  const gchar *path;

  colon = strchr (url, ':');
  if (colon == NULL ||
      (colon[1] != '/' && colon[2] != '/'))
    {
      /* The same error as g_network_address_parse_uri() */
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT,
                   "Invalid URI '%s'", url);
      return FALSE;
    }
  path = strchr (colon + 3, '/');
  host = strchr (colon + 3, '@');
  if (host && (!path || host < path))
    {
      host++;
    }
  else
    {
      host = colon + 3;
      path = strchr (host, '/');
    }

  if (host[0] == '\0' || host == path)
    {
      /* The same error as g_network_address_parse_uri() */
      g_set_error (error, G_IO_ERROR, G_IO_ERROR_INVALID_ARGUMENT,
                   "Invalid URI '%s'", url);
      return FALSE;
    }

  if (out_scheme)
      *out_scheme = g_strndup (url, colon - url);
  if (out_host)
    {
      if (path)
        *out_host = g_strndup (host, path - host);
      else
        *out_host = g_strdup (host);
    }

  if (out_path)
    {
      if (!path)
        path = "/";
      *out_path = g_strdup (path);
    }

  return TRUE;
}

static gboolean
is_valid_line (const gchar *string,
               gssize length)
{
  gint i;

  if (length < 0)
    length = strlen (string);

  for (i = 0; i < length; i++)
    {
      if (string[i] != '\t')
        {
          if (string[i] < ' ' || string[i] & 0x80)
            return FALSE;
        }
    }

  return TRUE;
}

/**
 * web_socket_util_parse_req_line:
 * @data: (array length=length): the input data
 * @length: length of data
 * @method: (out): location to place HTTP method, or %NULL
 * @resource: (out): location to place HTTP resource path, or %NULL
 *
 * Parse an HTTP request line.
 *
 * The number of bytes parsed will be returned if parsing succeeds, including
 * the new line at the end of the request line. A negative value will be
 * returned if parsing fails.
 *
 * If the HTTP request line was truncated (ie: not all of it was present
 * within @length) then zero will be returned.
 *
 * The @method and @resource should point to string pointers. The values
 * returned should be freed by the caller using g_free().
 *
 * Return value: zero if truncated, negative if fails, or number of
 *               characters parsed
 */
gssize
web_socket_util_parse_req_line (const gchar *data,
                                gsize length,
                                gchar **method,
                                gchar **resource)
{
  const gchar *end;
  const gchar *method_end;
  const gchar *path_beg;
  const gchar *path_end;
  const gchar *version;
  const gchar *last;
  gsize n;

  /*
   * Here we parse a line like:
   *
   * GET /path/to/file HTTP/1.1
   */

  g_return_val_if_fail (data != NULL || length == 0, -1);

  if (length == 0)
    return 0;

  end = memchr (data, '\n', length);
  if (end == NULL)
    return 0; /* need more data */

  if (data[0] == ' ')
    return -1;

  method_end = memchr (data, ' ', (end - data));
  if (method_end == NULL)
    return -1;

  path_beg = strskip (method_end + 1, ' ', end);
  path_end = memchr (path_beg, ' ', (end - path_beg));
  if (path_end == NULL)
    return -1;

  version = strskip (path_end + 1, ' ', end);

  /* Returns number of characters consumed */
  n = parse_version (version, (end - version), NULL);
  if (n == 0)
    return -1;

  last = version + n;
  while (last != end)
    {
      /* Acceptable trailing characters */
      if (!strchr ("\r ", last[0]))
        return -1;
      last++;
    }

  if (!is_valid_line (data, (method_end - data)) ||
      !is_valid_line (data, (path_end - path_beg)))
    return -1;

  if (method)
    *method = g_strndup (data, (method_end - data));
  if (resource)
    *resource = g_strndup (path_beg, (path_end - path_beg));
  return (end - data) + 1;
}

static guint
str_case_hash (gconstpointer v)
{
  /* A case agnostic version of g_str_hash */
  const signed char *p;
  guint32 h = 5381;
  for (p = v; *p != '\0'; p++)
    h = (h << 5) + h + g_ascii_tolower (*p);
  return h;
}

static gboolean
str_case_equal (gconstpointer v1,
                gconstpointer v2)
{
  /* A case agnostic version of g_str_equal */
  return g_ascii_strcasecmp (v1, v2) == 0;
}

/**
 * web_socket_util_new_headers:
 *
 * Create a new hashtable for HTTP headers.
 *
 * The GHashTable contains allocated null-terminated strings, as would
 * be returned by g_strdup(). The headers are indexed by the header names
 * in a case insensitive way.
 *
 * It is not necessary to worry about case headers in this GHashTable.
 *
 * Return value: (transfer full): a new header hashtable
 */
GHashTable *
web_socket_util_new_headers (void)
{
  return g_hash_table_new_full (str_case_hash, str_case_equal, g_free, g_free);
}

/**
 * web_socket_util_parse_headers:
 * @data: (array length=length): the input data
 * @length: length of data
 * @headers: (out): location to place HTTP header hash table
 *
 * Parse HTTP headers.
 *
 * The number of bytes parsed will be returned if parsing succeeds, including
 * the new line at the end of the request line. A negative value will be
 * returned if parsing fails.
 *
 * If the HTTP request line was truncated (ie: not all of it was present
 * within @length) then zero will be returned.
 *
 * The @headers returned will be allocated using web_socket_util_new_headers(),
 * and should be freed by the caller using g_free().
 *
 * Return value: zero if truncated, negative if fails, or number of
 *               characters parsed
 */
gssize
web_socket_util_parse_headers (const gchar *data,
                               gsize length,
                               GHashTable **headers)
{
  GHashTable *parsed_headers;
  const gchar *line;
  const gchar *colon;
  gsize consumed = 0;
  gboolean end = FALSE;
  gsize line_len;

  parsed_headers = web_socket_util_new_headers ();

  while (!end)
    {
      line = memchr (data, '\n', length);

      /* No line ending: need more data */
      if (line == NULL)
        {
          consumed = 0;
          break;
        }

      line++;
      line_len = (line - data);

      /* An empty line, all done */
      if ((data[0] == '\r' && data[1] == '\n') || data[0] == '\n')
        {
          end = TRUE;
        }

      /* A header line */
      else
        {
          colon = memchr (data, ':', length);
          if (!colon || colon >= line)
            {
              g_debug ("received invalid header line: %.*s", (gint)line_len, data);
              consumed = -1;
              break;
            }

          g_autofree gchar *name = g_strndup (data, colon - data);
          g_strstrip (name);
          g_autofree gchar *value = g_strndup (colon + 1, line - (colon + 1));
          g_strstrip (value);

          if (!is_valid_line (name, -1) || !g_utf8_validate (value, -1, NULL))
            {
              g_debug ("received invalid header");
              consumed = -1;
              break;
            }
          g_hash_table_insert (parsed_headers, g_steal_pointer (&name), g_steal_pointer (&value));
        }

      consumed += line_len;
      data += line_len;
      length -= line_len;
    }

  if (consumed > 0)
    {
      if (headers)
          *headers = g_hash_table_ref (parsed_headers);
    }

  g_hash_table_unref (parsed_headers);

  return consumed;
}

gboolean
_web_socket_util_header_equals (GHashTable *headers,
                                const gchar *name,
                                const gchar *want)
{
  const gchar *value;

  value = g_hash_table_lookup (headers, name);
  if (value != NULL && g_ascii_strcasecmp (value, want) == 0)
    return TRUE;

  g_message ("received invalid or missing %s header: %s", name, value);
  return FALSE;
}

gboolean
_web_socket_util_header_contains (GHashTable *headers,
                                  const gchar *name,
                                  const gchar *word)
{
  const gchar *value;
  const gchar *at;

  value = g_hash_table_lookup (headers, name);
  if (value != NULL)
    {
      /* The word must be present, and not part of another word */
      at = strcasestr (value, word);
      if (at != NULL &&
          (at == value || !g_ascii_isalnum (*(at - 1))) &&
          !g_ascii_isalnum (at[strlen (word)]))
        return TRUE;
    }

  g_message ("received invalid or missing %s header: %s", name, value);
  return FALSE;
}

gboolean
_web_socket_util_header_empty (GHashTable *headers,
                               const gchar *name)
{
  const gchar *value;

  value = g_hash_table_lookup (headers, name);
  if (value == NULL || value[0] == '\0')
    return TRUE;

  g_message ("received unsupported %s header: %s", name, value);
  return FALSE;
}

/**
 * web_socket_util_parse_status_line:
 * @data: (array length=length): the input data
 * @length: length of data
 * @version: (out): location to place HTTP version, or %NULL
 * @status: (out): location to place HTTP status, or %NULL
 * @reason: (out): location to place HTTP message, or %NULL
 *
 * Parse an HTTP status line.
 *
 * The number of bytes parsed will be returned if parsing succeeds, including
 * the new line at the end of the status line. A negative value will be
 * returned if parsing fails.
 *
 * If the HTTP request line was truncated (ie: not all of it was present
 * within @length) then zero will be returned.
 *
 * @reason should point to a string pointer. The value
 * returned should be freed by the caller using g_free().
 *
 * Return value: zero if truncated, negative if fails, or number of
 *               characters parsed
 */
gssize
web_socket_util_parse_status_line (const gchar *data,
                                   gsize length,
                                   gchar **version,
                                   guint *status,
                                   gchar **reason)
{
  const gchar *at;
  const gchar *end;
  gsize n;
  guint64 num;
  gchar *ep;

  /*
   * Here we parse a line like:
   *
   * HTTP/1.1 101 Switching protocols
   */

  at = data;
  end = memchr (at, '\n', length);
  if (end == NULL)
    return 0; /* need more data */

  n = parse_version (at, (end - at), version);
  if (n == 0 || at[n] != ' ')
    return -1;
  at += n;

  /* Extra spaces */
  at = strskip (at, ' ', end);

  /* First check for space after status */
  if (memchr (at, ' ', (end - at)) == NULL)
    return -1;

  /* This will stop at above space */
  num =  g_ascii_strtoull (at, &ep, 10);
  if (num == 0 || num > G_MAXUINT || *ep != ' ')
    return -1;

  at = strskip (ep, ' ', end);

  if (reason)
    {
      *reason = g_strndup (at, (end - at));
      g_strstrip (*reason);
    }
  if (status)
    *status = (guint)num;
  return (end - data) + 1;
}
