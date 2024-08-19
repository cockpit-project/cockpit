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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpitwebresponse.h"
#include "cockpitwebfilter.h"

#include "common/cockpitconf.h"
#include "common/cockpiterror.h"
#include "common/cockpitflow.h"
#include "common/cockpitlocale.h"
#include "common/cockpittemplate.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

/**
 * CockpitWebResponse:
 *
 * A response sent back to an HTTP client. You can use the high level one
 * shot APIs, like cockpit_web_response_content() and
 * cockpit_web_response_error() * or low level builder APIs:
 *
 * cockpit_web_response_headers() send the headers
 * cockpit_web_response_queue() send a block of data.
 * cockpit_web_response_complete() finish.
 */

struct _CockpitWebResponse {
  GObject parent;
  GIOStream *io;
  const gchar *logname;
  const gchar *path;
  gchar *full_path;
  gchar *url_root;
  gchar *method;
  gchar *origin;

  gchar *protocol;
  CockpitCacheType cache_type;

  /* The output queue */
  GPollableOutputStream *out;
  GQueue *queue;
  gsize out_queued;
  gsize out_queueable;
  gsize partial_offset;
  GSource *source;

  /* Status flags */
  guint count;
  gboolean complete;
  gboolean failed;
  gboolean done;
  gboolean chunked;
  gboolean keep_alive;

  GList *filters;
};

/* A megabyte is when we start to consider queue full enough */
#define QUEUE_PRESSURE 1024UL * 1024UL

static guint signal__done;

static void      cockpit_web_response_flow_iface_init      (CockpitFlowInterface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitWebResponse, cockpit_web_response, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, cockpit_web_response_flow_iface_init));

static void
cockpit_web_response_init (CockpitWebResponse *self)
{
  self->queue = g_queue_new ();
  self->out_queueable = G_MAXSIZE;
  self->cache_type = COCKPIT_WEB_RESPONSE_CACHE_UNSET;
}

static void
cockpit_web_response_done (CockpitWebResponse *self)
{
  gboolean reusable = FALSE;

  g_object_ref (self);

  g_assert (!self->done);
  self->done = TRUE;

  if (self->source)
    {
      g_source_destroy (self->source);
      g_source_unref (self->source);
      self->source = NULL;
    }

  if (self->complete)
    {
      reusable = !self->failed && self->keep_alive;
      g_object_unref (self);
    }
  else if (!self->failed)
    {
      g_critical ("A CockpitWebResponse was freed without being completed properly. "
                  "This is a programming error.");
    }

  g_signal_emit (self, signal__done, 0, reusable);

  g_object_unref (self->io);
  self->io = NULL;
  self->out = NULL;

  g_object_unref (self);
}

static void
cockpit_web_response_dispose (GObject *object)
{
  CockpitWebResponse *self = COCKPIT_WEB_RESPONSE (object);

  if (!self->done)
    cockpit_web_response_done (self);
  g_list_free_full (self->filters, g_object_unref);
  self->filters = NULL;

  G_OBJECT_CLASS (cockpit_web_response_parent_class)->dispose (object);
}

static void
cockpit_web_response_finalize (GObject *object)
{
  CockpitWebResponse *self = COCKPIT_WEB_RESPONSE (object);

  g_free (self->protocol);
  g_free (self->full_path);
  g_free (self->url_root);
  g_free (self->method);
  g_free (self->origin);
  g_assert (self->io == NULL);
  g_assert (self->out == NULL);
  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);
  self->out_queued = 0;

  G_OBJECT_CLASS (cockpit_web_response_parent_class)->finalize (object);
}

static void
cockpit_web_response_class_init (CockpitWebResponseClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->dispose = cockpit_web_response_dispose;
  gobject_class->finalize = cockpit_web_response_finalize;

  signal__done = g_signal_new ("done", COCKPIT_TYPE_WEB_RESPONSE,
                               G_SIGNAL_RUN_LAST,
                               0, NULL, NULL, NULL,
                               G_TYPE_NONE, 1, G_TYPE_BOOLEAN);
}

/**
 * cockpit_web_response_new:
 * @io: the stream to send on
 * @path: the path resource or NULL
 * @in_headers: input headers or NULL
 * @flags: in #COCKPIT_WEB_RESPONSE_FOR_TLS_PROXY mode, the origin is assumed to
 *         be https://<host> even for a non-HTTPS connection.
 *
 * Create a new web response.
 *
 * The returned reference belongs to the caller. Additionally
 * once cockpit_web_response_complete() is called, an additional
 * reference is held until the response is sent and flushed.
 *
 * Returns: (transfer full): the new response, unref when done with it
 */
CockpitWebResponse *
cockpit_web_response_new (GIOStream *io,
                          const gchar *original_path,
                          const gchar *path,
                          GHashTable *in_headers,
                          const gchar *method,
                          const gchar *protocol)
{
  CockpitWebResponse *self;
  GOutputStream *out;
  const gchar *connection;
  const gchar *host = NULL;
  gint offset;

  /* Trying to be a somewhat performant here, avoiding properties */
  self = g_object_new (COCKPIT_TYPE_WEB_RESPONSE, NULL);
  self->io = g_object_ref (io);

  out = g_io_stream_get_output_stream (io);
  if (G_IS_POLLABLE_OUTPUT_STREAM (out))
    {
      self->out = (GPollableOutputStream *)out;
    }
  else if (out)
    {
      g_critical ("Cannot send web response over non-pollable output stream: %s",
                  G_OBJECT_TYPE_NAME (out));
    }
  else
    {
      g_critical ("Cannot send web response: no output stream available");
    }

  self->url_root = NULL;
  self->full_path = g_strdup (path);
  self->path = self->full_path;

  g_assert (method != NULL);
  self->method = g_strdup (method);

  if (path && original_path)
    {
      offset = strlen (original_path) - strlen (path);
      if (offset > 0 && g_strcmp0 (original_path + offset, path) == 0)
        self->url_root = g_strndup (original_path, offset);
    }

  if (self->path)
    self->logname = self->path;
  else
    self->logname = "response";

  self->keep_alive = TRUE;
  if (in_headers)
    {
      connection = g_hash_table_lookup (in_headers, "Connection");
      if (connection)
        self->keep_alive = g_str_equal (connection, "keep-alive");
      host = g_hash_table_lookup (in_headers, "Host");
    }

  self->protocol = g_strdup (protocol ?: "http");
  if (host)
    self->origin = g_strdup_printf ("%s://%s", self->protocol, host);

  return self;
}

/**
 * cockpit_web_response_get_path:
 * @self: the response
 *
 * Returns: the resource path for response
 */
const gchar *
cockpit_web_response_get_path (CockpitWebResponse *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), NULL);
  return self->path;
}

/**
 * cockpit_web_response_get_url_root:
 * @self: the response
 *
 * Returns: The url root portion of the original path that was removed
 */
const gchar *
cockpit_web_response_get_url_root (CockpitWebResponse *self) {
  return self->url_root;
}

/**
 * cockpit_web_response_get_stream:
 * @self: the response
 *
 * Returns: the stream we're sending on
 */
GIOStream *
cockpit_web_response_get_stream  (CockpitWebResponse *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), NULL);
  return self->io;
}

#if !GLIB_CHECK_VERSION(2,43,2)
#define G_IO_ERROR_CONNECTION_CLOSED G_IO_ERROR_BROKEN_PIPE
#endif

gboolean
cockpit_web_should_suppress_output_error (const gchar *logname,
                                          GError *error)
{
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_CONNECTION_CLOSED) ||
      g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
    {
      g_debug ("%s: output error: %s", logname, error->message);
      return TRUE;
    }

#if !GLIB_CHECK_VERSION(2,43,2)
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_FAILED) &&
      strstr (error->message, g_strerror (ECONNRESET)))
    {
      g_debug ("%s: output error: %s", logname, error->message);
      return TRUE;
    }
#endif

  return FALSE;
}

static void
on_output_flushed (GObject *stream,
                   GAsyncResult *result,
                   gpointer user_data)
{
  CockpitWebResponse *self = COCKPIT_WEB_RESPONSE (user_data);
  GOutputStream *output = G_OUTPUT_STREAM (stream);
  GError *error = NULL;

  if (g_output_stream_flush_finish (output, result, &error))
    {
      g_debug ("%s: flushed output", self->logname);
    }
  else
    {
      if (!cockpit_web_should_suppress_output_error (self->logname, error))
        g_message ("%s: couldn't flush web output: %s", self->logname, error->message);
      self->failed = TRUE;
      g_error_free (error);
    }

  cockpit_web_response_done (self);
  g_object_unref (self);
}

static gboolean
on_response_output (GObject *pollable,
                    gpointer user_data)
{
  CockpitWebResponse *self = user_data;
  GError *error = NULL;
  const guint8 *data;
  GBytes *block;
  gssize count;
  gsize before, size, len;

  block = g_queue_peek_head (self->queue);
  if (block)
    {
      data = g_bytes_get_data (block, &len);
      g_assert (len == 0 || self->partial_offset < len);
      data += self->partial_offset;
      len -= self->partial_offset;

      before = self->out_queued;

      if (len > 0)
        {
          count = g_pollable_output_stream_write_nonblocking (self->out, data, len,
                                                              NULL, &error);
        }
      else
        {
          count = 0;
        }

      if (count < 0)
        {
          if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
            {
              g_error_free (error);
              return TRUE;
            }

          if (!cockpit_web_should_suppress_output_error (self->logname, error))
            g_message ("%s: couldn't write web output: %s", self->logname, error->message);

          self->failed = TRUE;
          cockpit_web_response_done (self);

          g_error_free (error);
          return FALSE;
        }

      if (count == len)
        {
          g_debug ("%s: sent %d bytes", self->logname, (int)len);
          self->partial_offset = 0;
          block = g_queue_pop_head (self->queue);
          size = g_bytes_get_size (block);
          g_assert (size <= self->out_queued);
          self->out_queued -= size;
          g_bytes_unref (block);
        }
      else
        {
          g_debug ("%s: sent %d partial", self->logname, (int)count);
          g_assert (count < len);
          self->partial_offset += count;
        }

      /*
       * If we're controlling another flow, turn it on again when our output
       * buffer size becomes less than the low mark.
       */
      if (before >= QUEUE_PRESSURE && self->out_queued < QUEUE_PRESSURE)
        cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);

      return TRUE;
    }
  else
    {
      g_source_destroy (self->source);
      g_source_unref (self->source);
      self->source = NULL;

      if (self->complete)
        {
          g_debug ("%s: complete flushing output", self->logname);
          g_output_stream_flush_async (G_OUTPUT_STREAM (self->out), G_PRIORITY_DEFAULT,
                                       NULL, on_output_flushed, g_object_ref (self));
        }

      return FALSE;
    }
}

static void
queue_bytes (CockpitWebResponse *self,
             GBytes *block)
{
  gsize size, before;

  size = g_bytes_get_size (block);
  before = self->out_queued;
  g_return_if_fail (G_MAXSIZE - size > self->out_queued);
  self->out_queued += size;

  g_queue_push_tail (self->queue, g_bytes_ref (block));

  self->count++;

  if (!self->source)
    {
      self->source = g_pollable_output_stream_create_source (self->out, NULL);
      g_source_set_callback (self->source, (GSourceFunc)on_response_output, self, NULL);
      g_source_attach (self->source, NULL);
    }

  if (before < QUEUE_PRESSURE && self->out_queued >= QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);
}

static void
queue_block (CockpitWebResponse *self,
             GBytes *block)
{
  gsize length = g_bytes_get_size (block);
  GBytes *bytes;
  gchar *data;

  /*
   * We cannot queue chunks of length zero. Besides being silly, this
   * messes with chunked encoding. The 0 length block means end of
   * response.
   */
  if (length == 0)
    return;

  if (self->out_queueable < length)
    {
      g_critical ("Too much data queuing in HTTP response. This is a programmer error.");
      return;
    }

  self->out_queueable -= length;
  g_debug ("%s: queued %d bytes", self->logname, (int)length);

  if (!self->chunked)
    {
      queue_bytes (self, block);
    }
  else
    {
      /* Required for chunked transfer encoding. */
      data = g_strdup_printf ("%x\r\n", (unsigned int)length);
      bytes = g_bytes_new_take (data, strlen (data));
      queue_bytes (self, bytes);
      g_bytes_unref (bytes);

      queue_bytes (self, block);

      bytes = g_bytes_new_static ("\r\n", 2);
      queue_bytes (self, bytes);
      g_bytes_unref (bytes);
    }
}

typedef struct {
  CockpitWebResponse *response;
  GList *filters;
} QueueStep;

static void
queue_filter (gpointer data,
              GBytes *bytes)
{
  QueueStep *qs = data;
  QueueStep qn = { .response = qs->response };

  g_return_if_fail (bytes != NULL);

  if (qs->filters)
    {
      qn.filters = qs->filters->next;
      cockpit_web_filter_push (qs->filters->data, bytes, queue_filter, &qn);
    }
  else
    {
      queue_block (qs->response, bytes);
    }
}

/**
 * cockpit_web_response_queue:
 * @self: the response
 * @block: the block of data to queue
 *
 * Queue a single block of data on the response. Will be sent
 * during the main loop.
 *
 * See cockpit_web_response_content() for a simple way to
 * avoid queueing individual blocks.
 *
 * If this function returns %FALSE, then the response has failed
 * or has been completed elsewhere. The block was ignored and
 * queuing more blocks doesn't makes sense.
 *
 * After done queuing all your blocks call
 * cockpit_web_response_complete().
*
 * Returns: Whether queuing more blocks makes sense
 */
gboolean
cockpit_web_response_queue (CockpitWebResponse *self,
                            GBytes *block)
{
  QueueStep qn = { .response = self };

  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), FALSE);
  g_return_val_if_fail (block != NULL, FALSE);
  g_return_val_if_fail (self->complete == FALSE, FALSE);

  if (self->failed)
    {
      g_debug ("%s: ignoring queued block after failure", self->logname);
      return FALSE;
    }

  if (g_str_equal (self->method, "HEAD"))
    {
      g_debug ("%s: ignoring queued block for method HEAD", self->logname);
      return TRUE;
    }

  qn.filters = self->filters;
  queue_filter (&qn, block);
  return TRUE;
}

/**
 * cockpit_web_response_complete:
 * @self: the response
 *
 * See cockpit_web_response_content() for easy to use stuff.
 *
 * Tell the response that all the data has been queued.
 * The response will hold a reference to itself until the
 * data is actually sent, so you can unref it.
 */
void
cockpit_web_response_complete (CockpitWebResponse *self)
{
  GBytes *bytes;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));
  g_return_if_fail (self->complete == FALSE);

  if (self->failed)
    return;

  /* Hold a reference until cockpit_web_response_done() */
  g_object_ref (self);
  self->complete = TRUE;

  if (self->chunked)
    {
      bytes = g_bytes_new_static ("0\r\n\r\n", 5);
      queue_bytes (self, bytes);
      g_bytes_unref (bytes);
    }

  if (self->source)
    {
      g_debug ("%s: queueing complete", self->logname);
    }
  else
    {
      g_debug ("%s: complete closing io", self->logname);
      g_output_stream_flush_async (G_OUTPUT_STREAM (self->out), G_PRIORITY_DEFAULT,
                                   NULL, on_output_flushed, g_object_ref (self));
    }
}

/**
 * cockpit_web_response_abort:
 * @self: the response
 *
 * This function is used when streaming content, and at
 * some point we can't provide the remainder of the content
 *
 * This completes the response and terminates the connection.
 */
void
cockpit_web_response_abort (CockpitWebResponse *self)
{
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));
  g_return_if_fail (self->complete == FALSE);

  if (self->failed)
    return;

  /* Hold a reference until cockpit_web_response_done() */
  g_object_ref (self);

  self->complete = TRUE;
  self->failed = TRUE;

  g_debug ("%s: aborted", self->logname);
  cockpit_web_response_done (self);
}

/**
 * CockpitWebResponding:
 * @COCKPIT_WEB_RESPONSE_READY: nothing queued or sent yet
 * @COCKPIT_WEB_RESPONSE_QUEUING: started and still queuing data on response
 * @COCKPIT_WEB_RESPONSE_COMPLETE: all data is queued or aborted
 * @COCKPIT_WEB_RESPONSE_SENT: data is completely sent
 *
 * Various states of the web response.
 */

/**
 * cockpit_web_response_get_state:
 * @self: the web response
 *
 * Return the state of the web response.
 */
CockpitWebResponding
cockpit_web_response_get_state (CockpitWebResponse *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), 0);

  if (self->done)
    return COCKPIT_WEB_RESPONSE_SENT;
  else if (self->complete)
    return COCKPIT_WEB_RESPONSE_COMPLETE;
  else if (self->count == 0)
    return COCKPIT_WEB_RESPONSE_READY;
  else
    return COCKPIT_WEB_RESPONSE_QUEUING;
}

gboolean
cockpit_web_response_is_simple_token (const gchar *string)
{
  string += strcspn (string, " \t\r\n\v");
  return string[0] == '\0';
}

gboolean
cockpit_web_response_is_header_value (const gchar *string)
{
  string += strcspn (string, "\r\n\v");
  return string[0] == '\0';
}

enum {
    HEADER_CONTENT_TYPE = 1 << 0,
    HEADER_CONTENT_ENCODING = 1 << 1,
    HEADER_VARY = 1 << 2,
    HEADER_CACHE_CONTROL = 1 << 3,
    HEADER_DNS_PREFETCH_CONTROL = 1 << 4,
    HEADER_REFERRER_POLICY = 1 << 5,
    HEADER_CONTENT_TYPE_OPTIONS = 1 << 6,
    HEADER_CROSS_ORIGIN_RESOURCE_POLICY = 1 << 7,
    HEADER_X_FRAME_OPTIONS = 1 << 8,
};

static GString *
begin_headers (CockpitWebResponse *response,
               guint status,
               const gchar *reason)
{
  GString *string;

  string = g_string_sized_new (1024);
  g_string_printf (string, "HTTP/1.1 %d %s\r\n", status, reason);

  return string;
}

static guint
append_header (GString *string,
               const gchar *name,
               const gchar *value)
{
  if (value)
    {
      g_return_val_if_fail (cockpit_web_response_is_simple_token (name), 0);
      g_return_val_if_fail (cockpit_web_response_is_header_value (value), 0);
      g_string_append_printf (string, "%s: %s\r\n", name, value);
    }
  if (g_ascii_strcasecmp ("Content-Type", name) == 0)
    return HEADER_CONTENT_TYPE;
  if (g_ascii_strcasecmp ("Cache-Control", name) == 0)
    return HEADER_CACHE_CONTROL;
  if (g_ascii_strcasecmp ("Vary", name) == 0)
    return HEADER_VARY;
  if (g_ascii_strcasecmp ("Content-Encoding", name) == 0)
    return HEADER_CONTENT_ENCODING;
  if (g_ascii_strcasecmp ("X-DNS-Prefetch-Control", name) == 0)
    return HEADER_DNS_PREFETCH_CONTROL;
  if (g_ascii_strcasecmp ("Referrer-Policy", name) == 0)
    return HEADER_REFERRER_POLICY;
  if (g_ascii_strcasecmp ("X-Content-Type-Options", name) == 0)
    return HEADER_CONTENT_TYPE_OPTIONS;
  if (g_ascii_strcasecmp ("Cross-Origin-Resource-Policy", name) == 0)
    return HEADER_CROSS_ORIGIN_RESOURCE_POLICY;
  if (g_ascii_strcasecmp ("X-Frame-Options", name) == 0)
    return HEADER_X_FRAME_OPTIONS;
  if (g_ascii_strcasecmp ("Content-Length", name) == 0 ||
      g_ascii_strcasecmp ("Transfer-Encoding", name) == 0 ||
      g_ascii_strcasecmp ("Connection", name) == 0)
    {
      g_critical ("Don't set %s header manually. This is a programmer error.", name);
    }
  return 0;
}

static guint
append_table (GString *string,
              GHashTable *headers)
{
  GHashTableIter iter;
  gpointer key;
  gpointer value;
  guint seen = 0;

  if (headers)
    {
      g_hash_table_iter_init (&iter, headers);
      while (g_hash_table_iter_next (&iter, &key, &value))
        seen |= append_header (string, key, value);
    }

  return seen;
}

static guint
append_va (GString *string,
           va_list va)
{
  const gchar *name;
  const gchar *value;
  guint seen = 0;

  for (;;)
    {
      name = va_arg (va, const gchar *);
      if (!name)
        break;
      value = va_arg (va, const gchar *);
      seen |= append_header (string, name, value);
    }

  return seen;
}

static GBytes *
finish_headers (CockpitWebResponse *self,
                GString *string,
                gssize length,
                gint status,
                guint seen)
{
  const gchar *content_type;

  /* Automatically figure out content type */
  if ((seen & HEADER_CONTENT_TYPE) == 0 &&
      self->full_path != NULL && status >= 200 && status <= 299)
    {
      content_type = cockpit_web_response_content_type (self->full_path);
      if (content_type)
        g_string_append_printf (string, "Content-Type: %s\r\n", content_type);
    }

  if (status != 304)
    {
      if (length < 0 || seen & HEADER_CONTENT_ENCODING || self->filters)
        {
          self->chunked = TRUE;
          g_string_append_printf (string, "Transfer-Encoding: chunked\r\n");
        }
      else
        {
          self->chunked = FALSE;
          g_string_append_printf (string, "Content-Length: %" G_GSSIZE_FORMAT "\r\n", length);
          self->out_queueable = length;
        }
    }

  if ((seen & HEADER_CACHE_CONTROL) == 0 && status >= 200 && status <= 299)
    {
      if (self->cache_type == COCKPIT_WEB_RESPONSE_NO_CACHE)
        g_string_append (string, "Cache-Control: no-cache, no-store\r\n");
      else if (self->cache_type == COCKPIT_WEB_RESPONSE_CACHE)
        g_string_append (string, "Cache-Control: max-age=86400, private\r\n");
    }

  if ((seen & HEADER_VARY) == 0 && status >= 200 && status <= 299 &&
      self->cache_type == COCKPIT_WEB_RESPONSE_CACHE)
    {
      g_string_append (string, "Vary: Cookie\r\n");
    }

  if (!self->keep_alive)
    g_string_append (string, "Connection: close\r\n");

  /* Some blanket security headers */
  if ((seen & HEADER_DNS_PREFETCH_CONTROL) == 0)
    g_string_append (string, "X-DNS-Prefetch-Control: off\r\n");
  if ((seen & HEADER_REFERRER_POLICY) == 0)
    g_string_append (string, "Referrer-Policy: no-referrer\r\n");
  if ((seen & HEADER_CONTENT_TYPE_OPTIONS) == 0)
    g_string_append (string, "X-Content-Type-Options: nosniff\r\n");
  /* Be very strict here -- there is no reason that external web sites should
   * be able to read any resource. This does *not* affect embedding with <iframe> */
  if ((seen & HEADER_CROSS_ORIGIN_RESOURCE_POLICY) == 0)
    g_string_append (string, "Cross-Origin-Resource-Policy: same-origin\r\n");
  /* This is the counterpart for iframe embedding, line of defence against clickjacking */
  if ((seen & HEADER_X_FRAME_OPTIONS) == 0)
    g_string_append (string, "X-Frame-Options: sameorigin\r\n");

  g_string_append (string, "\r\n");
  return g_string_free_to_bytes (string);
}

/**
 * cockpit_web_response_set_cache_type:
 * @self: the response
 * @cache_type: Ensures the appropriate cache headers are returned for
   the given cache type.
 */
void
cockpit_web_response_set_cache_type (CockpitWebResponse *self,
                                     CockpitCacheType cache_type)
{
  self->cache_type = cache_type;
}

/**
 * cockpit_web_response_headers:
 * @self: the response
 * @status: the HTTP status code
 * @reason: the HTTP reason
 * @length: the combined length of data blocks to follow, or -1
 *
 * See cockpit_web_response_content() for an easy to use function.
 *
 * Queue the headers of the response. No data blocks must yet be
 * queued on the response.
 *
 * Specify header name/value pairs in the var args, and end with
 * a NULL name. If value is NULL, then that header won't be sent.
 *
 * Don't specify Content-Length or Connection headers.
 *
 * If @length is zero or greater, then it must represent the
 * number of queued blocks to follow.
 */
void
cockpit_web_response_headers (CockpitWebResponse *self,
                              guint status,
                              const gchar *reason,
                              gssize length,
                              ...)
{
  GString *string;
  GBytes *block;
  va_list va;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));

  if (self->count > 0)
    {
      g_critical ("Headers should be sent first. This is a programmer error.");
      return;
    }

  string = begin_headers (self, status, reason);

  va_start (va, length);
  block = finish_headers (self, string, length, status,
                          append_va (string, va));
  va_end (va);

  queue_bytes (self, block);
  g_bytes_unref (block);
}

/**
 * cockpit_web_response_headers:
 * @self: the response
 * @status: the HTTP status code
 * @reason: the HTTP reason
 * @length: the combined length of data blocks to follow, or -1
 * @headers: headers to include or NULL
 *
 * See cockpit_web_response_content() for an easy to use function.
 *
 * Queue the headers of the response. No data blocks must yet be
 * queued on the response.
 *
 * Don't put Content-Length or Connection in @headers.
 *
 * If @length is zero or greater, then it must represent the
 * number of queued blocks to follow.
 */
void
cockpit_web_response_headers_full  (CockpitWebResponse *self,
                                    guint status,
                                    const gchar *reason,
                                    gssize length,
                                    GHashTable *headers)
{
  GString *string;
  GBytes *block;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));

  if (self->count > 0)
    {
      g_critical ("Headers should be sent first. This is a programmer error.");
      return;
    }

  string = begin_headers (self, status, reason);

  block = finish_headers (self, string, length, status,
                          append_table (string, headers));

  queue_bytes (self, block);
  g_bytes_unref (block);
}

/**
 * cockpit_web_response_content:
 * @self: the response
 * @headers: headers to include or NULL
 * @block: first block to send
 *
 * This is a simple way to send an HTTP response as a single
 * call. The response will be complete after this call, and will
 * send in the main-loop.
 *
 * The var args are additional GBytes* blocks to send, followed by
 * a trailing NULL.
 *
 * Don't include Content-Length or Connection in @headers.
 *
 * This calls cockpit_web_response_headers_full(),
 * cockpit_web_response_queue() and cockpit_web_response_complete()
 * internally.
 */
void
cockpit_web_response_content (CockpitWebResponse *self,
                              GHashTable *headers,
                              GBytes *block,
                              ...)
{
  GBytes *first;
  gsize length = 0;
  va_list va;
  va_list va2;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));

  first = block;
  va_start (va, block);
  va_copy (va2, va);

  while (block)
    {
      length += g_bytes_get_size (block);
      block = va_arg (va, GBytes *);
    }
  va_end (va);

  cockpit_web_response_headers_full (self, 200, "OK", length, headers);

  block = first;
  for (;;)
    {
      if (!block)
        {
          cockpit_web_response_complete (self);
          break;
        }
      if (!cockpit_web_response_queue (self, block))
        break;
      block = va_arg (va2, GBytes *);
    }
  va_end (va2);
}

static GBytes *
substitute_message (const gchar *variable,
                    gpointer user_data)
{
  const gchar *message = user_data;
  if (g_str_equal (variable, "message"))
    return g_bytes_new (message, strlen (message));
  return NULL;
}

static GBytes *
substitute_hash_value (const gchar *variable,
                       gpointer user_data)
{
  GHashTable *data = user_data;
  gchar *value = g_hash_table_lookup (data, variable);
  if (value)
    return g_bytes_new (value, strlen (value));
  return g_bytes_new ("", 0);
}

/**
 * cockpit_web_response_error:
 * @self: the response
 * @status: the HTTP status code
 * @headers: headers to include or NULL
 * @format: printf format of error message
 *
 * Send an error message with a basic HTML page containing
 * the error.
 */
void
cockpit_web_response_error (CockpitWebResponse *self,
                            guint code,
                            GHashTable *headers,
                            const gchar *format,
                            ...)
{
  va_list var_args;
  g_autofree gchar *reason = NULL;
  g_autofree gchar *escaped = NULL;
  const gchar *message;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));

  if (format)
    {
      va_start (var_args, format);
      reason = g_strdup_vprintf (format, var_args);
      va_end (var_args);
      message = reason;
    }
  else
    {
      switch (code)
        {
        case 400:
          message = "Bad request";
          break;
        case 401:
          message = "Not Authorized";
          break;
        case 403:
          message = "Forbidden";
          break;
        case 404:
          message = "Not Found";
          break;
        case 405:
          message = "Method Not Allowed";
          break;
        case 413:
          message = "Request Entity Too Large";
          break;
        case 502:
          message = "Remote Page is Unavailable";
          break;
        case 500:
          message = "Internal Server Error";
          break;
        default:
          if (code < 100)
            reason = g_strdup_printf ("%u Continue", code);
          else if (code < 200)
            reason = g_strdup_printf ("%u OK", code);
          else if (code < 300)
            reason = g_strdup_printf ("%u Moved", code);
          else
            reason = g_strdup_printf ("%u Failed", code);
          message = reason;
          break;
        }
    }

  g_debug ("%s: returning error: %u %s", self->logname, code, message);

  /* If sending arbitrary messages, make sure they're escaped */
  if (reason)
    {
      g_strstrip (reason);
      escaped = g_uri_escape_string (reason, " :", FALSE);
      message = escaped;
    }

  if (headers)
    {
      if (!g_hash_table_lookup (headers, "Content-Type"))
        g_hash_table_replace (headers, g_strdup ("Content-Type"), g_strdup ("text/html; charset=utf8"));
      cockpit_web_response_headers_full (self, code, message, -1, headers);
    }
  else
    {
      cockpit_web_response_headers (self, code, message, -1, "Content-Type", "text/html; charset=utf8", NULL);
    }

  if (!g_str_equal (self->method, "HEAD"))
    {
      extern const char *cockpit_webresponse_fail_html_text;
      g_autoptr(GBytes) input = g_bytes_new_static (cockpit_webresponse_fail_html_text, strlen (cockpit_webresponse_fail_html_text));
      g_autolist(GBytes) output = cockpit_template_expand (input, "@@", "@@", substitute_message, (gpointer) message);

      for (GList *l = output; l != NULL; l = g_list_next (l))
        {
          if (!cockpit_web_response_queue (self, l->data))
            /* error: early exit */
            return;
        }
    }

  cockpit_web_response_complete (self);
}

/**
 * cockpit_web_response_error:
 * @self: the response
 * @headers: headers to include or NULL
 * @error: the error
 *
 * Send an error message with a basic HTML page containing
 * the error.
 */
void
cockpit_web_response_gerror (CockpitWebResponse *self,
                             GHashTable *headers,
                             GError *error)
{
  int code;

  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));

  if (g_error_matches (error,
                       COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED))
    code = 401;
  else if (g_error_matches (error,
                       COCKPIT_ERROR, COCKPIT_ERROR_PERMISSION_DENIED))
    code = 403;
  else if (g_error_matches (error,
                            G_IO_ERROR, G_IO_ERROR_INVALID_DATA))
    code = 400;
  else if (g_error_matches (error,
                            G_IO_ERROR, G_IO_ERROR_NO_SPACE))
    code = 413;
  else
    code = 500;

  cockpit_web_response_error (self, code, headers, "%s", error->message);
}

static gboolean
path_has_prefix (const gchar *path,
                 const gchar *prefix)
{
  gsize len;
  if (prefix == NULL)
    return FALSE;
  len = strlen (prefix);
  if (len == 0)
    return FALSE;
  if (!g_str_has_prefix (path, prefix))
    return FALSE;
  if (prefix[len - 1] == '/' ||
      path[len] == '/')
    return TRUE;
  return FALSE;
}

gchar **
cockpit_web_response_resolve_roots (const gchar **input)
{
  GPtrArray *roots;
  char *path;
  gint i;

  roots = g_ptr_array_new ();
  for (i = 0; input && input[i]; i++)
    {
      path = realpath (input[i], NULL);
      if (path == NULL)
        g_debug ("couldn't resolve document root: %s: %m", input[i]);
      else
        g_ptr_array_add (roots, path);
    }
  g_ptr_array_add (roots, NULL);
  return (gchar **)g_ptr_array_free (roots, FALSE);
}

static void
web_response_file (CockpitWebResponse *response,
                   const gchar *escaped,
                   const gchar **roots,
                   gboolean search_gzip,
                   gboolean accept_gzip,
                   CockpitTemplateFunc template_func,
                   gpointer user_data)
{
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (response));

  if (!escaped)
    escaped = cockpit_web_response_get_path (response);

  g_return_if_fail (escaped != NULL);

  /* Someone is trying to escape the root directory, or access hidden files? */
  g_autofree gchar *unescaped = g_uri_unescape_string (escaped, "/");
  if (!unescaped || strstr (unescaped, "/.") || strstr (unescaped, "../") || strstr (unescaped, "//"))
    {
      g_debug ("%s: invalid path request", escaped);
      cockpit_web_response_error (response, 404, NULL, "Not Found");
      return;
    }

  gboolean is_gzip = FALSE;
  g_autoptr(GMappedFile) file = NULL;
  for (gint i = 0; roots[i]; i++)
    {
      const gchar *root = roots[i];
      g_autofree gchar *path = g_build_filename (root, unescaped, NULL);

      if (g_file_test (path, G_FILE_TEST_IS_DIR))
        {
          cockpit_web_response_error (response, 403, NULL, "Directory Listing Denied");
          return;
        }

      /* As a double check of above behavior */
      g_assert (path_has_prefix (path, root));

      g_autoptr(GError) error = NULL;
      file = g_mapped_file_new (path, FALSE, &error);

      if (file == NULL && search_gzip &&
          g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT))
        {
          g_debug ("%s: file not found in root: %s, looking for .gz", escaped, root);
          g_clear_error (&error);
          g_autofree gchar *old_path = g_steal_pointer (&path);
          path = g_strconcat (old_path, ".gz", NULL);
          file = g_mapped_file_new (path, FALSE, &error);
          is_gzip = file != NULL;
        }

      if (file != NULL)
        break;

      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NOENT) ||
          g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_NAMETOOLONG))
        {
          g_debug ("%s: file not found in root: %s", escaped, root);
        }
      else if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_PERM) ||
               g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ACCES) ||
               g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ISDIR))
        {
          cockpit_web_response_error (response, 403, NULL, "Access denied");
          return;
        }
      else
        {
          g_warning ("%s: %s", path, error->message);
          cockpit_web_response_error (response, 500, NULL, "Internal server error");
          return;
        }
    }

  if (file == NULL)
    {
      cockpit_web_response_error (response, 404, NULL, "Not Found");
      return;
    }

  g_autoptr(GBytes) body = g_mapped_file_get_bytes (file);

  if (is_gzip && (!accept_gzip || template_func))
    {
      /* We have gzipped content, but the client won't accept it, or
       * template expansion was requested.  Decompress.
       */
      g_autoptr(GError) error = NULL;
      g_autoptr(GBytes) body_gz = g_steal_pointer (&body);
      body = cockpit_web_response_gunzip (body_gz, &error);
      if (body == NULL)
        {
          g_warning ("%s", error->message);
          cockpit_web_response_error (response, 500, NULL, "Internal server error");
          return;
        }
      is_gzip = FALSE;
    }

  GList *output;
  gint content_length = -1;
  if (template_func)
    {
      output = cockpit_template_expand (body, "${", "}", template_func, user_data);
    }
  else
    {
      output = g_list_prepend (NULL, g_bytes_ref (body));
      content_length = g_bytes_get_size (body);
    }

  GString *string = begin_headers (response, 200, "OK");
  guint seen = 0;

  if (response->origin)
    seen |= append_header (string, "Access-Control-Allow-Origin", response->origin);

  /*
   * The default Content-Security-Policy for .html files allows
   * the site to have inline <script> and <style> tags. This code
   * is only used for static resources that do not use the session.
   */
  if (g_str_has_suffix (unescaped, ".html"))
    {
      const gchar *default_policy = "default-src 'self' 'unsafe-inline';";
      g_autofree gchar *policy = cockpit_web_response_security_policy (default_policy, response->origin);
      seen |= append_header (string, "Content-Security-Policy", policy);
    }

  if (is_gzip)
    seen |= append_header (string, "Content-Encoding", "gzip");

  g_autoptr(GBytes) headers_block = finish_headers (response, string, content_length, 200, seen);
  queue_bytes (response, headers_block);

  GList *l;
  for (l = output; l != NULL; l = g_list_next (l))
    {
      if (!cockpit_web_response_queue (response, l->data))
        break;
    }
  if (l == NULL)
    cockpit_web_response_complete (response);

  g_list_free_full (output, (GDestroyNotify)g_bytes_unref);
}

/**
 * cockpit_web_response_file:
 * @response: the response
 * @path: escaped path, or NULL to get from response
 * @roots: directories to look for file in
 *
 * Serve a file from disk as an HTTP response.
 */
void
cockpit_web_response_file (CockpitWebResponse *response,
                           const gchar *escaped,
                           const gchar **roots)
{
  web_response_file (response, escaped, roots, FALSE, FALSE, NULL, NULL);
}

void
cockpit_web_response_template (CockpitWebResponse *response,
                                   const gchar *escaped,
                                   const gchar **roots,
                                   GHashTable *values)
{
  web_response_file (response, escaped, roots, FALSE, FALSE, substitute_hash_value, values);
}

void
cockpit_web_response_file_or_gz (CockpitWebResponse *response,
                                 gboolean accepts_gzip,
                                 const gchar *escaped,
                                 const gchar **roots)
{
  web_response_file (response, escaped, roots, TRUE, accepts_gzip, NULL, NULL);
}

static gboolean
response_next_path (CockpitWebResponse *self,
                    gchar **component)
{
  const gchar *beg = NULL;
  const gchar *path;

  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), FALSE);

  path = self->path;

  if (path && path[0] == '/')
    {
      beg = path + 1;
      path = strchr (beg, '/');
    }
  else
    {
      path = NULL;
    }

  if (!beg || path == beg)
    return FALSE;

  self->path = path;

  if (self->path)
    {
      if (component)
        *component = g_strndup (beg, path - beg);
    }
  else if (beg && beg[0])
    {
      if (component)
        *component = g_strdup (beg);
    }
  else
    {
      return FALSE;
    }

  return TRUE;
}

gboolean
cockpit_web_response_skip_path (CockpitWebResponse *self)
{
  return response_next_path (self, NULL);
}

gchar *
cockpit_web_response_pop_path (CockpitWebResponse *self)
{
  gchar *component = NULL;
  if (!response_next_path (self, &component))
    return NULL;
  return component;
}

void
cockpit_web_response_add_filter (CockpitWebResponse *self,
                                 CockpitWebFilter *filter)
{
  g_return_if_fail (COCKPIT_IS_WEB_RESPONSE (self));
  g_return_if_fail (COCKPIT_IS_WEB_FILTER (filter));
  g_return_if_fail (self->count == 0);
  self->filters = g_list_append (self->filters, g_object_ref (filter));
}

/**
 * cockpit_web_response_gunzip:
 * @bytes: the compressed bytes
 * @error: place to put an error
 *
 * Perform gzip decompression on the @bytes.
 *
 * Returns: the uncompressed bytes, caller owns return value.
 */
GBytes *
cockpit_web_response_gunzip (GBytes *bytes,
                             GError **error)
{
  GConverter *converter;
  GConverterResult result;
  const guint8 *in;
  gsize inl, outl, read, written;
  GByteArray *out;

  converter = G_CONVERTER (g_zlib_decompressor_new (G_ZLIB_COMPRESSOR_FORMAT_GZIP));

  in = g_bytes_get_data (bytes, &inl);
  out = g_byte_array_new ();

  do
    {
      outl = out->len;
      g_byte_array_set_size (out, outl + inl);

      result = g_converter_convert (converter, in, inl, out->data + outl, inl,
                                    G_CONVERTER_INPUT_AT_END, &read, &written, error);
      if (result == G_CONVERTER_ERROR)
        break;

      g_byte_array_set_size (out, outl + written);
      in += read;
      inl -= read;
    }
  while (result != G_CONVERTER_FINISHED);

  g_object_unref (converter);

  if (result != G_CONVERTER_FINISHED)
    {
      g_byte_array_unref (out);
      return NULL;
    }
  else
    {
      return g_byte_array_free_to_bytes (out);
    }
}

static const gchar *
find_extension (const gchar *path)
{
  const gchar *dot;
  const gchar *slash;

  dot = strrchr (path, '.');
  slash = strrchr (path, '/');

  /* Dots before the last slash don't count */
  if (dot && slash && dot < slash)
    dot = NULL;

  /* Leading dots on the filename don't count */
  if (dot && (dot == path || dot == slash + 1))
    dot = NULL;

  return dot;
}

static GBytes *
load_file (const gchar *filename,
           GError **error)
{
  GError *local_error = NULL;

  g_autoptr(GMappedFile) mapped = g_mapped_file_new (filename, FALSE, &local_error);

  if (mapped)
    /* success! */
    return g_mapped_file_get_bytes (mapped);

  if (g_error_matches (local_error, G_FILE_ERROR, G_FILE_ERROR_NOENT) ||
      g_error_matches (local_error, G_FILE_ERROR, G_FILE_ERROR_ISDIR) ||
      g_error_matches (local_error, G_FILE_ERROR, G_FILE_ERROR_NAMETOOLONG) ||
      g_error_matches (local_error, G_FILE_ERROR, G_FILE_ERROR_LOOP) ||
      g_error_matches (local_error, G_FILE_ERROR, G_FILE_ERROR_INVAL))
    {
      g_clear_error (&local_error);
    }

  /* A real error to stop on */
  else
    {
      g_propagate_error (error, local_error);
    }

  return NULL;
}

/**
 * cockpit_web_response_negotiation:
 * @path: likely filesystem path
 * @existing: a table of existing files
 * @language: requested client language
 * @out_is_language_specific: a pointer to a gboolean whether the actual file is specific to @language
 * @out_is_compressed: a pointer to a gboolean whether the actual file is compressed
 * @error: a failure
 *
 * Find a file to serve based on the suffixes. We prune off extra
 * extensions while looking for a file that's present. We append
 * .min and .gz when looking for files. We also check for the language
 * before the extensions if set.
 *
 * The @existing may be NULL, if non-null it'll be used to check if
 * files exist.
 */
GBytes *
cockpit_web_response_negotiation (const gchar *path,
                                  GHashTable *existing,
                                  const gchar *language,
                                  gboolean *out_is_language_specific,
                                  gboolean *out_is_compressed,
                                  GError **error)
{
  gchar *base = NULL;
  const gchar *ext;
  gchar *dot;
  gchar *name = NULL;
  GBytes *bytes = NULL;
  GError *local_error = NULL;
  gchar *locale = NULL;
  gchar *shorter = NULL;
  gchar *lang = NULL;
  gchar *lang_region = NULL;
  gboolean is_language_specific, is_compressed;

  gint i;

  if (language)
      locale = cockpit_locale_from_language (language, NULL, &shorter);

  ext = find_extension (path);
  if (ext)
    {
      base = g_strndup (path, ext - path);
    }
  else
    {
      ext = "";
      base = g_strdup (path);
    }

  while (!bytes)
    {
      /* For a request for a file named "base.ext" and locale "lang_REGION", We try the following variants, in
         order, and serve the first that is found:

           base.lang_REGION.ext
           base.lang_REGION.ext.gz
           base.lang.ext
           base.lang.ext.gz
           base.ext
           base.min.ext
           base.ext.gz
           base.ext.min.gz

         If no locale is requested, or a locale without region, those variants are left out by starting
         further down in the list.

         If none of the variants are found, and the base of the file name has internal dots, these internal
         extensions are dropped one by one from the right.  For example, for a file named "foo.bar.js", we
         first try "foo.bar" with extension ".js", and then "foo" with extension ".js".
      */

      if (locale && shorter && g_strcmp0 (locale, shorter) != 0) {
        lang = shorter;
        lang_region = locale;
        i = 0;
      } else if (locale) {
        lang = locale;
        i = 2;
      } else {
        i = 4;
      }

      for (; i < 8; i++)
        {
          g_free (name);
          switch (i)
            {
            case 0:
              name = g_strconcat (base, ".", lang_region, ext, NULL);
              is_language_specific = TRUE;
              is_compressed = FALSE;
              break;
            case 1:
              name = g_strconcat (base, ".", lang_region, ext, ".gz", NULL);
              is_language_specific = TRUE;
              is_compressed = TRUE;
              break;
            case 2:
              name = g_strconcat (base, ".", lang, ext, NULL);
              is_language_specific = TRUE;
              is_compressed = FALSE;
              break;
            case 3:
              name = g_strconcat (base, ".", lang, ext, ".gz", NULL);
              is_language_specific = TRUE;
              is_compressed = TRUE;
              break;
            case 4:
              name = g_strconcat (base, ext, NULL);
              is_language_specific = FALSE;
              is_compressed = FALSE;
              break;
            case 5:
              name = g_strconcat (base, ".min", ext, NULL);
              is_language_specific = FALSE;
              is_compressed = FALSE;
              break;
            case 6:
              name = g_strconcat (base, ext, ".gz", NULL);
              is_language_specific = FALSE;
              is_compressed = TRUE;
              break;
            case 7:
              name = g_strconcat (base, ".min", ext, ".gz", NULL);
              is_language_specific = FALSE;
              is_compressed = TRUE;
              break;
            default:
              g_assert_not_reached ();
            }

          if (existing)
            {
              if (!g_hash_table_lookup (existing, name))
                continue;
            }

          bytes = load_file (name, &local_error);
          if (bytes)
            break;
          if (local_error)
            goto out;
        }

      /* Pop one level off the file name */
      dot = (gchar *)find_extension (base);
      if (!dot)
        break;

      dot[0] = '\0';
    }

out:
  if (local_error)
    g_propagate_error (error, local_error);
  if (bytes)
    {
      if (out_is_language_specific)
        *out_is_language_specific = is_language_specific;
      if (out_is_compressed)
        *out_is_compressed = is_compressed;
    }
  g_free (name);
  g_free (base);
  g_free (locale);
  g_free (shorter);
  return bytes;
}

const gchar *
cockpit_web_response_content_type (const gchar *path)
{
  static const struct {
    const gchar *extension;
    const gchar *content_type;
  } content_types[] = {
    { ".css", "text/css" },
    { ".gif", "image/gif" },
    { ".eot", "application/vnd.ms-fontobject" },
    { ".html", "text/html" },
    /* { ".ico", "image/vnd.microsoft.icon" }, */
    { ".jpg", "image/jpg" },
    { ".js", "application/javascript" },
    { ".json", "application/json" },
    { ".otf", "font/opentype" },
    { ".png", "image/png" },
    { ".svg", "image/svg+xml" },
    { ".ttf", "application/octet-stream" }, /* unassigned */
    { ".txt", "text/plain" },
    { ".wasm", "application/wasm" },
    { ".woff", "application/font-woff" },
    { ".xml", "text/xml" },
  };

  gint i;

  for (i = 0; i < G_N_ELEMENTS (content_types); i++)
    {
      if (g_str_has_suffix (path, content_types[i].extension))
          return content_types[i].content_type;
    }

  return NULL;
}

static gboolean
strv_have_prefix (gchar **strv,
                  const gchar *prefix)
{
  gint i;

  for (i = 0; strv && strv[i] != NULL; i++)
    {
      if (g_str_has_prefix (strv[i], prefix))
        return TRUE;
    }
  return FALSE;
}

static void
string_inject_origin (GString *string,
                      const gchar *origin)
{
  const gchar *found;
  gsize pos = 0;

  for (;;)
    {
      found = strstr (string->str + pos, "'self'");
      if (!found)
        break;

      pos = (found - string->str) + 6;
      g_string_insert (string, pos, " ");
      g_string_insert (string, pos + 1, origin);
      pos += strlen (origin) + 1;
    }
}

/**
 * cockpit_web_response_content_security_policy:
 * @content_security_policy: the raw security policy or %NULL for a default
 * @self_origin: our own web origin or %NULL
 *
 * Calculates the security policy.
 *
 * Returns: A calculated security policy, filled with defaults if necessary.
 */
gchar *
cockpit_web_response_security_policy (const gchar *content_security_policy,
                                      const gchar *self_origin)
{
  const gchar *default_src = "default-src 'self'";
  const gchar *form_action = "form-action 'self'";
  const gchar *base_uri = "base-uri 'self'";
  const gchar *object_src = "object-src 'none'";
  const gchar *font_src = "font-src 'self' data:";
  const gchar *img_src = "img-src 'self' data:";
  const gchar *block_all_mixed_content = "block-all-mixed-content";
  gchar **parts = NULL;
  GString *result;
  gint i;

  result = g_string_sized_new (128);

  /*
   * Note that browsers need to be explicitly told they can connect
   * to a WebSocket. This is non-obvious, but it stems from the fact
   * that some browsers treat 'https' and 'wss' as different protocols.
   *
   * Since each component could establish a WebSocket connection back to
   * cockpit-ws, we need to insert that into the policy.
   */

  if (content_security_policy)
    parts = g_strsplit (content_security_policy, ";", -1);

  for (i = 0; parts && parts[i] != NULL; i++)
    g_strstrip (parts[i]);

  if (!strv_have_prefix (parts, "default-src "))
    g_string_append_printf (result, "%s; ", default_src);
  if (!strv_have_prefix (parts, "connect-src "))
    {
      g_string_append (result, "connect-src 'self'");
      if (self_origin && g_str_has_prefix (self_origin, "http"))
        g_string_append_printf (result, " ws%s", self_origin + 4);
      g_string_append (result, "; ");
    }
  if (!strv_have_prefix (parts, "form-action "))
    g_string_append_printf (result, "%s; ", form_action);
  if (!strv_have_prefix (parts, "base-uri "))
    g_string_append_printf (result, "%s; ", base_uri);
  if (!strv_have_prefix (parts, "object-src "))
    g_string_append_printf (result, "%s; ", object_src);
  if (!strv_have_prefix (parts, "font-src "))
    g_string_append_printf (result, "%s; ", font_src);
  if (!strv_have_prefix (parts, "img-src "))
    g_string_append_printf (result, "%s; ", img_src);
  if (!strv_have_prefix (parts, "block-all-mixed-content"))
    g_string_append_printf (result, "%s; ", block_all_mixed_content);

  for (i = 0; parts && parts[i] != NULL; i++)
    g_string_append_printf (result, "%s; ", parts[i]);

  g_strfreev (parts);

  /* Remove trailing semicolon */
  g_string_set_size (result, result->len - 2);

  /* Put in our own origin */
  if (self_origin)
    string_inject_origin (result, self_origin);

  return g_string_free (result, FALSE);
}

const gchar *
cockpit_web_response_get_origin (CockpitWebResponse *self)
{
  g_return_val_if_fail (COCKPIT_IS_WEB_RESPONSE (self), NULL);
  return self->origin;
}

const gchar *
cockpit_web_response_get_protocol (CockpitWebResponse *self)
{
  return self->protocol;
}

static void
cockpit_web_response_flow_iface_init (CockpitFlowInterface *iface)
{
  /* No implementation */
}
