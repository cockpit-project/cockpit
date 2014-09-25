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

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "config.h"

#include "cockpitwebresponse.h"

#include "common/cockpiterror.h"

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
  gchar *path;

  /* The output queue */
  GPollableOutputStream *out;
  GQueue *queue;
  gsize partial_offset;
  GSource *source;

  /* Status flags */
  guint count;
  gboolean complete;
  gboolean failed;
  gboolean done;
  gboolean chunked;
  gboolean keep_alive;
};

typedef struct {
  GObjectClass parent;
} CockpitWebResponseClass;

static guint signal__done;

G_DEFINE_TYPE (CockpitWebResponse, cockpit_web_response, G_TYPE_OBJECT);

static void
cockpit_web_response_init (CockpitWebResponse *self)
{
  self->queue = g_queue_new ();
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

  G_OBJECT_CLASS (cockpit_web_response_parent_class)->dispose (object);
}

static void
cockpit_web_response_finalize (GObject *object)
{
  CockpitWebResponse *self = COCKPIT_WEB_RESPONSE (object);

  g_free (self->path);
  g_assert (self->io == NULL);
  g_assert (self->out == NULL);
  g_queue_free_full (self->queue, (GDestroyNotify)g_bytes_unref);

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
                          const gchar *path,
                          GHashTable *in_headers)
{
  CockpitWebResponse *self;
  GOutputStream *out;
  const gchar *connection;

  /* Trying to be a somewhat performant here, avoiding properties */
  self = g_object_new (COCKPIT_TYPE_WEB_RESPONSE, NULL);
  self->io = g_object_ref (io);

  out = g_io_stream_get_output_stream (io);
  if (G_IS_POLLABLE_OUTPUT_STREAM (out))
    {
      self->out = (GPollableOutputStream *)out;
    }
  else
    {
      g_critical ("Cannot send web response over non-pollable output stream: %s",
                  G_OBJECT_TYPE_NAME (out));
    }

  self->path = g_strdup (path);
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
    }

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
  return self->path;
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
  return self->io;
}

static gboolean
should_suppress_output_error (CockpitWebResponse *self,
                              GError *error)
{
  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_BROKEN_PIPE))
    {
      g_debug ("%s: output error: %s", self->logname, error->message);
      return TRUE;
    }

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
      if (!should_suppress_output_error (self, error))
        g_warning ("%s: couldn't flush web output: %s", self->logname, error->message);
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
  gsize len;

  block = g_queue_peek_head (self->queue);
  if (block)
    {
      data = g_bytes_get_data (block, &len);
      g_assert (len == 0 || self->partial_offset < len);
      data += self->partial_offset;
      len -= self->partial_offset;

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

          if (!should_suppress_output_error (self, error))
            g_warning ("%s: couldn't write web output: %s", self->logname, error->message);

          self->failed = TRUE;
          cockpit_web_response_done (self);

          g_error_free (error);
          return FALSE;
        }

      if (count == len)
        {
          g_debug ("%s: sent %d bytes", self->logname, (int)len);
          self->partial_offset = 0;
          g_queue_pop_head (self->queue);
          g_bytes_unref (block);
        }
      else
        {
          g_debug ("%s: sent %d partial", self->logname, (int)count);
          g_assert (count < len);
          self->partial_offset += count;
        }
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
  g_queue_push_tail (self->queue, g_bytes_ref (block));

  self->count++;

  if (!self->source)
    {
      self->source = g_pollable_output_stream_create_source (self->out, NULL);
      g_source_set_callback (self->source, (GSourceFunc)on_response_output, self, NULL);
      g_source_attach (self->source, NULL);
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
  gchar *data;
  GBytes *bytes;

  g_return_val_if_fail (block != NULL, FALSE);
  g_return_val_if_fail (self->complete == FALSE, FALSE);

  if (self->failed)
    {
      g_debug ("%s: ignoring queued block after failure", self->logname);
      return FALSE;
    }

  g_debug ("%s: queued %d bytes", self->logname, (int)g_bytes_get_size (block));

  if (!self->chunked)
    {
      queue_bytes (self, block);
    }
  else
    {
      /* Required for chunked transfer encoding. */
      data = g_strdup_printf ("%x\r\n", (unsigned int)g_bytes_get_size (block));
      bytes = g_bytes_new_take (data, strlen (data));
      queue_bytes (self, bytes);
      g_bytes_unref (bytes);

      queue_bytes (self, block);

      bytes = g_bytes_new_static ("\r\n", 2);
      queue_bytes (self, bytes);
      g_bytes_unref (bytes);
    }

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
  if (self->done)
    return COCKPIT_WEB_RESPONSE_SENT;
  else if (self->complete)
    return COCKPIT_WEB_RESPONSE_COMPLETE;
  else if (self->count == 0)
    return COCKPIT_WEB_RESPONSE_READY;
  else
    return COCKPIT_WEB_RESPONSE_QUEUING;
}

enum {
    HEADER_CONTENT_TYPE = 1 << 0,
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
      g_return_val_if_fail (strchr (name, '\n') == NULL, 0);
      g_return_val_if_fail (strchr (value, '\n') == NULL, 0);
      g_string_append_printf (string, "%s: %s\r\n", name, value);
    }
  if (g_ascii_strcasecmp ("Content-Type", name) == 0)
    return HEADER_CONTENT_TYPE;
  else if (g_ascii_strcasecmp ("Content-Length", name) == 0)
    g_critical ("Don't set Content-Length manually. This is a programmer error.");
  else if (g_ascii_strcasecmp ("Connection", name) == 0)
    g_critical ("Don't set Connection header manually. This is a programmer error.");
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
                gboolean success,
                guint seen)
{
  gint i;

  static const struct {
    const gchar *extension;
    const gchar *content_type;
  } content_types[] = {
    { ".css", "text/css" },
    { ".gif", "image/gif" },
    { ".eot", "application/vnd.ms-fontobject" },
    { ".html", "text/html" },
    { ".ico", "image/vnd.microsoft.icon" },
    { ".jpg", "image/jpg" },
    { ".js", "application/javascript" },
    { ".otf", "font/opentype" },
    { ".png", "image/png" },
    { ".svg", "image/svg+xml" },
    { ".ttf", "application/octet-stream" }, /* unassigned */
    { ".woff", "application/font-woff" },
    { ".xml", "text/xml" },
  };

  /* Automatically figure out content type */
  if ((seen & HEADER_CONTENT_TYPE) == 0 &&
      self->path != NULL && success)
    {
      for (i = 0; i < G_N_ELEMENTS (content_types); i++)
        {
          if (g_str_has_suffix (self->path, content_types[i].extension))
            {
              g_string_append_printf (string, "Content-Type: %s\r\n", content_types[i].content_type);
              break;
            }
        }
    }

  if (length >= 0)
    {
      self->chunked = FALSE;
      g_string_append_printf (string, "Content-Length: %" G_GSSIZE_FORMAT "\r\n", length);
    }
  else
    {
      self->chunked = TRUE;
      g_string_append_printf (string, "Transfer-Encoding: chunked\r\n");
    }
  if (!self->keep_alive)
    g_string_append (string, "Connection: close\r\n");
  g_string_append (string, "\r\n");

  return g_string_free_to_bytes (string);
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

  if (self->count > 0)
    {
      g_critical ("Headers should be sent first. This is a programmer error.");
      return;
    }

  string = begin_headers (self, status, reason);

  va_start (va, length);
  block = finish_headers (self, string, length,
                          status >= 200 && status <= 299,
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

  if (self->count > 0)
    {
      g_critical ("Headers should be sent first. This is a programmer error.");
      return;
    }

  string = begin_headers (self, status, reason);

  block = finish_headers (self, string, length,
                          status >= 200 && status <= 299,
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
  gchar *body = NULL;
  va_list var_args;
  gchar *reason = NULL;
  const gchar *message;
  GBytes *content;
  gsize length;

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

  body = g_strdup_printf ("<html><head><title>%u %s</title></head>"
                          "<body>%s</body></html>",
                          code, message, message);

  g_debug ("%s: returning error: %u %s", self->logname, code, message);

  length = strlen (body);
  content = g_bytes_new_take (body, length);
  cockpit_web_response_headers_full (self, code, message, length, headers);
  if (cockpit_web_response_queue (self, content))
    cockpit_web_response_complete (self);
  g_bytes_unref (content);

  g_free (reason);
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

  if (g_error_matches (error,
                       COCKPIT_ERROR, COCKPIT_ERROR_AUTHENTICATION_FAILED))
    code = 401;
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
  gsize len = strlen (prefix);
  if (len == 0)
    return FALSE;
  if (!g_str_has_prefix (path, prefix))
    return FALSE;
  if (prefix[len - 1] == '/' ||
      path[len] == '/')
    return TRUE;
  return FALSE;
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
                           gboolean cache_forever,
                           const gchar **roots)
{
  const gchar *cache_control;
  GError *error = NULL;
  gchar *unescaped;
  char *path = NULL;
  gchar *built = NULL;
  GMappedFile *file = NULL;
  const gchar *root;
  GBytes *body;

  if (!escaped)
    escaped = cockpit_web_response_get_path (response);

  g_return_if_fail (escaped != NULL);

again:
  root = *(roots++);
  if (root == NULL)
    {
      cockpit_web_response_error (response, 404, NULL, "Not Found");
      goto out;
    }

  unescaped = g_uri_unescape_string (escaped, NULL);
  built = g_build_filename (root, unescaped, NULL);
  g_free (unescaped);

  path = realpath (built, NULL);
  g_free (built);

  if (path == NULL)
    {
      if (errno == ENOENT || errno == ENOTDIR || errno == ELOOP || errno == ENAMETOOLONG)
        {
          g_debug ("%s: file not found in root: %s", escaped, root);
          goto again;
        }
      else if (errno == EACCES)
        {
          cockpit_web_response_error (response, 403, NULL, "Access Denied");
          goto out;
        }
      else
        {
          g_warning ("%s: resolving path failed: %m", escaped);
          cockpit_web_response_error (response, 500, NULL, "Internal Server Error");
          goto out;
        }
    }

  /* Double check that realpath() did the right thing */
  g_return_if_fail (strstr (path, "../") == NULL);
  g_return_if_fail (!g_str_has_suffix (path, "/.."));

  /* Someone is trying to escape the root directory */
  if (!path_has_prefix (path, root))
    {
      g_debug ("%s: request tried to escape the root directory: %s: %s", escaped, root, path);
      cockpit_web_response_error (response, 404, NULL, "Not Found");
      goto out;
    }

  if (g_file_test (path, G_FILE_TEST_IS_DIR))
    {
      cockpit_web_response_error (response, 403, NULL, "Directory Listing Denied");
      goto out;
    }

  file = g_mapped_file_new (path, FALSE, &error);
  if (file == NULL)
    {
      if (g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_PERM) ||
          g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ACCES) ||
          g_error_matches (error, G_FILE_ERROR, G_FILE_ERROR_ISDIR))
        {
          cockpit_web_response_error (response, 403, NULL, "Access denied");
          g_clear_error (&error);
          goto out;
        }
      else
        {
          g_warning ("%s: %s", path, error->message);
          cockpit_web_response_error (response, 500, NULL, "Internal server error");
          g_clear_error (&error);
          goto out;
        }
    }

  body = g_mapped_file_get_bytes (file);

  cache_control = cache_forever ? "max-age=31556926, public" : NULL;
  cockpit_web_response_headers (response, 200, "OK", g_bytes_get_size (body),
                                "Cache-Control", cache_control,
                                NULL);

  if (cockpit_web_response_queue (response, body))
    cockpit_web_response_complete (response);

  g_bytes_unref (body);

out:
  free (path);
  if (file)
    g_mapped_file_unref (file);
}
