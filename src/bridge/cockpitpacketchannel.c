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

#include "cockpitpacketchannel.h"

#include "cockpitconnect.h"

#include "common/cockpitflow.h"
#include "common/cockpitjson.h"
#include "common/cockpitunicode.h"

#include <gio/gunixsocketaddress.h>
#include <glib-unix.h>

#include <sys/types.h>
#include <sys/socket.h>
#include <string.h>
#include <errno.h>

/**
 * CockpitPacketChannel:
 *
 * A #CockpitChannel that sends messages from a regular seqpacket socket.
 * Support for dgram sockets should also fit in here rather well, but is
 * not implemented at the current time.
 *
 * The payload type for this channel is 'stream'.
 */

#define DEF_PACKET_SIZE  (64UL * 1024UL)

/* Sadly this is limited by the max size of our WebSocket payload */
#define MAX_PACKET_SIZE  (128UL * 1024UL)

/* Several megabytes is when we start to consider queue full enough */
#define QUEUE_PRESSURE   (128UL * DEF_PACKET_SIZE)

enum {
    CREATED = 0,
    CONNECTING,
    RELAYING,
    CLOSED
};

typedef struct {
  CockpitChannel parent;
  GMainContext *context;
  gchar *name;
  gint state;
  gsize max_size;

  int fd;
  GSource *in_source;
  gboolean in_done;
  GSource *out_source;
  GQueue *out_queue;
  gboolean out_done;
  gsize out_queued;

  /* Pressure which throttles input on this pipe */
  CockpitFlow *pressure;
  gulong pressure_sig;
} CockpitPacketChannel;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitPacketChannelClass;

static void  start_input         (CockpitPacketChannel *self);

static void  start_output        (CockpitPacketChannel *self);

static void  cockpit_packet_channel_flow_iface (CockpitFlowInterface *iface);

#define COCKPIT_PACKET_CHANNEL(o) (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_PACKET_CHANNEL, \
                                   CockpitPacketChannel))

G_DEFINE_TYPE_WITH_CODE (CockpitPacketChannel, cockpit_packet_channel, COCKPIT_TYPE_CHANNEL,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_FLOW, cockpit_packet_channel_flow_iface));

static void
stop_output (CockpitPacketChannel *self)
{
  g_assert (self->out_source != NULL);
  g_source_destroy (self->out_source);
  g_source_unref (self->out_source);
  self->out_source = NULL;
}

static void
stop_input (CockpitPacketChannel *self)
{
  g_assert (self->in_source != NULL);
  g_source_destroy (self->in_source);
  g_source_unref (self->in_source);
  self->in_source = NULL;
}

static void
close_with_errno (CockpitPacketChannel *self,
                  const gchar *message,
                  int errn)
{
  const gchar *problem = NULL;

  if (errn == EPERM || errn == EACCES)
    problem = "access-denied";
  else if (errn == ENOENT || errn == ECONNREFUSED)
    problem = "not-found";

  if (problem)
    {
      g_message ("%s: %s: %s", self->name, message, g_strerror (errn));
    }
  else
    {
      g_warning ("%s: %s: %s", self->name, message, g_strerror (errn));
      problem = "internal-error";
    }

  cockpit_channel_close (COCKPIT_CHANNEL (self), problem);
}

static void
close_maybe (CockpitPacketChannel *self)
{
  if (self->state < CLOSED)
    {
      if (self->in_done && self->out_done)
        {
          g_debug ("%s: input and output done", self->name);
          cockpit_channel_close (COCKPIT_CHANNEL (self), NULL);
        }
    }
}

static gboolean
dispatch_input (gint fd,
                GIOCondition cond,
                gpointer user_data)
{
  CockpitPacketChannel *self = (CockpitPacketChannel *)user_data;
  GByteArray *buffer;
  GBytes *message;
  gssize ret = 0;
  int errn;

  g_return_val_if_fail (self->in_source, FALSE);

  buffer = g_byte_array_new ();

  /*
   * Enable clean shutdown by not reading when we just get
   * G_IO_HUP. Note that when we get G_IO_ERR we do want to read
   * just so we can get the appropriate detailed error message.
   */
  if (cond != G_IO_HUP)
    {
      g_byte_array_set_size (buffer, self->max_size);
      g_debug ("%s: reading input %x", self->name, cond);
      ret = recv (self->fd, buffer->data, buffer->len, 0);

      errn = errno;
      if (ret < 0)
        {
          if (errn == EAGAIN || errn == EINTR)
            {
              g_byte_array_free (buffer, TRUE);
              return TRUE;
            }
          else if (errn == ECONNRESET)
            {
              g_debug ("couldn't read: %s", g_strerror (errn));
              ret = 0;
            }
          else
            {
              g_byte_array_free (buffer, TRUE);
              close_with_errno (self, "couldn't read", errn);
              return FALSE;
            }
        }

      g_byte_array_set_size (buffer, ret);
    }

  if (ret == 0)
    {
      g_debug ("%s: end of input", self->name);
      cockpit_channel_control (COCKPIT_CHANNEL (self), "done", NULL);
      self->in_done = TRUE;
      stop_input (self);
    }

  g_object_ref (self);

  message = g_byte_array_free_to_bytes (buffer);
  cockpit_channel_send (COCKPIT_CHANNEL (self), message, FALSE);
  g_bytes_unref (message);

  if (self->in_done)
    close_maybe (self);

  g_object_unref (self);
  return TRUE;
}

static gboolean
dispatch_connect (CockpitPacketChannel *self)
{
  socklen_t slen;
  int error;

  slen = sizeof (error);
  if (getsockopt (self->fd, SOL_SOCKET, SO_ERROR, &error, &slen) != 0)
    {
      g_warning ("%s: couldn't get connection result", self->name);
      cockpit_channel_close (COCKPIT_CHANNEL (self), "internal-error");
    }
  else if (error == EINPROGRESS)
    {
      /* keep connecting */
    }
  else if (error != 0)
    {
      close_with_errno (self, "couldn't connect", error);
    }
  else
    {
      self->state = RELAYING;
      return TRUE;
    }

  return FALSE;
}

static gboolean
dispatch_output (gint fd,
                 GIOCondition cond,
                 gpointer user_data)
{
  CockpitPacketChannel *self = (CockpitPacketChannel *)user_data;
  gconstpointer data;
  gsize before, size;
  gssize ret;

  /* A non-blocking connect is processed here */
  if (self->state == CONNECTING && !dispatch_connect (self))
    return TRUE;

  g_return_val_if_fail (self->out_source, FALSE);

  before = self->out_queued;

  while (self->out_queue->head)
    {
      data = g_bytes_get_data (self->out_queue->head->data, &size);
      ret = send (self->fd, data, size, 0);

      if (ret < 0)
        {
          if (errno == EAGAIN || errno == EINTR || errno == ENOBUFS)
            {
              break;
            }
          else
            {
              close_with_errno (self, "couldn't write", errno);
              return FALSE;
            }
        }
      else
        {
          g_bytes_unref (g_queue_pop_head (self->out_queue));
          g_assert (size <= self->out_queued);
          self->out_queued -= size;
        }
    }

  /*
   * If we're controlling another flow, turn it on again when our output
   * buffer size becomes less than the low mark.
   */
  if (before >= QUEUE_PRESSURE && self->out_queued < QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), FALSE);

  if (self->out_queue->head)
    return TRUE;

  g_debug ("%s: output queue empty", self->name);

  /* If all messages are done, then stop polling out fd */
  stop_output (self);

  if (self->out_done)
    {
      g_debug ("%s: end of output", self->name);

      /* And if closing, then we need to shutdown the output fd */
      if (shutdown (self->fd, SHUT_WR) < 0)
        close_with_errno (self, "couldn't shutdown fd", errno);
    }

  close_maybe (self);

  return TRUE;
}

static void
cockpit_packet_channel_recv (CockpitChannel *channel,
                             GBytes *message)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (channel);
  gsize before, size;

  if (self->state >= CLOSED)
    return;

  size = g_bytes_get_size (message);
  before = self->out_queued;
  g_return_if_fail (G_MAXSIZE - size > self->out_queued);
  self->out_queued += size;
  g_queue_push_tail (self->out_queue, g_bytes_ref (message));

  /*
   * If we have too much data queued, and are controlling another flow
   * tell it to stop sending data, each time we cross over the high bound.
   */
  if (before < QUEUE_PRESSURE && self->out_queued >= QUEUE_PRESSURE)
    cockpit_flow_emit_pressure (COCKPIT_FLOW (self), TRUE);

  if (!self->out_source && self->fd >= 0)
    start_output (self);
}

static gboolean
cockpit_packet_channel_control (CockpitChannel *channel,
                                const gchar *command,
                                JsonObject *message)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (channel);
  gboolean ret = TRUE;
  gint64 size = 0;

  /* New set of options for channel */
  if (g_str_equal (command, "options"))
    {
      if (!cockpit_json_get_int (message, "max-size", self->max_size, &size) ||
          size < 1 || size > MAX_PACKET_SIZE)
        {
          cockpit_channel_fail (channel, "protocol-error",
                                "invalid \"max-size\" option for channel");
          goto out;
        }

      self->max_size = size;
    }

  /* Channel input from frontend is done */
  else if (g_str_equal (command, "done"))
    {
      self->out_done = TRUE;
      if (!self->out_source)
        start_output (self);
    }

  else
    {
      ret = FALSE;
    }

out:
  return ret;
}

static void
cockpit_packet_channel_close (CockpitChannel *channel,
                              const gchar *problem)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (channel);

  if (self->state >= CLOSED)
    return;

  self->state = CLOSED;

  if (self->in_source)
    stop_input (self);
  self->in_done = TRUE;
  if (self->out_source)
    stop_output (self);
  self->out_done = TRUE;

  if (self->fd != -1)
    {
      close (self->fd);
      self->fd = -1;
    }

  COCKPIT_CHANNEL_CLASS (cockpit_packet_channel_parent_class)->close (channel, problem);
}

static void
cockpit_packet_channel_init (CockpitPacketChannel *self)
{
  self->fd = -1;
  self->state = CREATED;
  self->max_size = DEF_PACKET_SIZE;
  self->out_queue = g_queue_new ();
  self->context = g_main_context_ref_thread_default ();
}

static int
packet_channel_connect (CockpitPacketChannel *self,
                        GSocketAddress *address)
{
  gsize native_len;
  gpointer native;
  int sock = -1;

  g_return_val_if_fail (G_IS_SOCKET_ADDRESS (address), -1);

  sock = socket (g_socket_address_get_family (address), SOCK_SEQPACKET, 0);
  if (sock < 0)
    {
      close_with_errno (self, "couldn't open socket", errno);
    }
  else
    {
      if (!g_unix_set_fd_nonblocking (sock, TRUE, NULL))
        {
          close (sock);
          g_return_val_if_reached (-1);
        }

      native_len = g_socket_address_get_native_size (address);
      native = g_malloc (native_len);
      if (!g_socket_address_to_native (address, native, native_len, NULL))
        {
          close (sock);
          g_return_val_if_reached (-1);
        }
      if (connect (sock, native, native_len) < 0)
        {
          if (errno == EINPROGRESS)
            {
              self->state = CONNECTING;
            }
          else
            {
              close_with_errno (self, "couldn't connect", errno);
              close (sock);
              sock = -1;
            }
        }
      else
        {
          self->state = RELAYING;
        }
      g_free (native);
    }

  return sock;
}

static void
start_output (CockpitPacketChannel *self)
{
  g_assert (self->out_source == NULL);
  self->out_source = g_unix_fd_source_new (self->fd, G_IO_OUT);
  g_source_set_name (self->out_source, "packet-output");
  g_source_set_callback (self->out_source, (GSourceFunc)dispatch_output, self, NULL);
  g_source_attach (self->out_source, self->context);
}

static void
start_input (CockpitPacketChannel *self)
{
  g_assert (self->in_source == NULL);
  self->in_source = g_unix_fd_source_new (self->fd, G_IO_IN);
  g_source_set_name (self->in_source, "packet-input");
  g_source_set_callback (self->in_source, (GSourceFunc)dispatch_input, self, NULL);
  g_source_attach (self->in_source, self->context);
}

static void
on_throttle_pressure (GObject *object,
                      gboolean throttle,
                      gpointer user_data)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (user_data);
  if (throttle)
    {
      if (self->in_source != NULL)
        {
          g_debug ("%s: applying back pressure in pipe", self->name);
          stop_input (self);
        }
    }
  else
    {
      if (self->in_source == NULL && !self->in_done)
        {
          g_debug ("%s: relieving back pressure in pipe", self->name);
          start_input (self);
        }
    }
}

static void
cockpit_packet_channel_throttle (CockpitFlow *flow,
                                 CockpitFlow *controlling)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (flow);

  if (self->pressure)
    {
      g_signal_handler_disconnect (self->pressure, self->pressure_sig);
      g_object_remove_weak_pointer (G_OBJECT (self->pressure), (gpointer *)&self->pressure);
      self->pressure = NULL;
    }

  if (controlling)
    {
      self->pressure = controlling;
      g_object_add_weak_pointer (G_OBJECT (self->pressure), (gpointer *)&self->pressure);
      self->pressure_sig = g_signal_connect (controlling, "pressure", G_CALLBACK (on_throttle_pressure), self);
    }
}

static void
cockpit_packet_channel_flow_iface (CockpitFlowInterface *iface)
{
  iface->throttle = cockpit_packet_channel_throttle;
}

static void
cockpit_packet_channel_prepare (CockpitChannel *channel)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (channel);
  GSocketAddress *address;
  JsonObject *options;
  int sock;

  COCKPIT_CHANNEL_CLASS (cockpit_packet_channel_parent_class)->prepare (channel);
  options = cockpit_channel_get_options (channel);

  /* Support our options in the open message too */
  cockpit_packet_channel_control (channel, "options", options);
  if (self->state >= CLOSED)
    return;

  address = cockpit_connect_parse_address (channel, &self->name);
  if (!address)
    {
      cockpit_channel_close (channel, "internal-error");
      return;
    }

  sock = packet_channel_connect (self, address);
  g_object_unref (address);

  if (sock < 0)
    {
      cockpit_channel_close (channel, "internal-error");
      return;
    }
  else
    {
      self->fd = sock;
      start_input (self);
      start_output (self);
    }

  cockpit_channel_ready (channel, NULL);
}

static void
cockpit_packet_channel_dispose (GObject *object)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (object);

  cockpit_packet_channel_throttle (COCKPIT_FLOW (self), NULL);
  g_assert (self->pressure == NULL);

  if (self->state < CLOSED)
    cockpit_channel_close (COCKPIT_CHANNEL (self), "terminated");

  while (self->out_queue->head)
    g_bytes_unref (g_queue_pop_head (self->out_queue));
  self->out_queued = 0;

  G_OBJECT_CLASS (cockpit_packet_channel_parent_class)->dispose (object);
}

static void
cockpit_packet_channel_finalize (GObject *object)
{
  CockpitPacketChannel *self = COCKPIT_PACKET_CHANNEL (object);
  g_assert (self->state == CLOSED);
  g_assert (self->fd < 0);
  g_assert (!self->in_source);
  g_assert (!self->out_source);
  g_queue_free (self->out_queue);
  g_free (self->name);

  if (self->context)
    g_main_context_unref (self->context);

  G_OBJECT_CLASS (cockpit_packet_channel_parent_class)->finalize (object);
}

static void
cockpit_packet_channel_class_init (CockpitPacketChannelClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  gobject_class->dispose = cockpit_packet_channel_dispose;
  gobject_class->finalize = cockpit_packet_channel_finalize;

  channel_class->prepare = cockpit_packet_channel_prepare;
  channel_class->control = cockpit_packet_channel_control;
  channel_class->recv = cockpit_packet_channel_recv;
  channel_class->close = cockpit_packet_channel_close;
}

/**
 * cockpit_packet_channel_open:
 * @transport: the transport to send/receive messages on
 * @channel_id: the channel id
 * @unix_path: the UNIX socket path to communicate with
 *
 * This function is mainly used by tests. The usual way
 * to get a #CockpitPacketChannel is via cockpit_channel_open()
 *
 * Returns: (transfer full): the new channel
 */
CockpitChannel *
cockpit_packet_channel_open (CockpitTransport *transport,
                             const gchar *channel_id,
                             const gchar *unix_path)
{
  CockpitChannel *channel;
  JsonObject *options;

  g_return_val_if_fail (channel_id != NULL, NULL);

  options = json_object_new ();
  json_object_set_string_member (options, "unix", unix_path);
  json_object_set_string_member (options, "payload", "packet");

  channel = g_object_new (COCKPIT_TYPE_PACKET_CHANNEL,
                          "transport", transport,
                          "id", channel_id,
                          "options", options,
                          NULL);

  json_object_unref (options);
  return channel;
}
