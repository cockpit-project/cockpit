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

static WebSocketConnection *web_socket = NULL;
static GString *buffer = NULL;
static GMainLoop *loop = NULL;

static void
on_release_buffer (gpointer user_data)
{
  if (buffer == NULL)
    buffer = user_data;
  else
    g_string_free (user_data, TRUE);
}

static gboolean
on_input_data (GIOChannel *channel,
               GIOCondition cond,
               gpointer user_data)
{
  GError *error = NULL;
  GIOStatus status;
  GBytes *msg;
  gsize line;

  if (buffer == NULL)
    buffer = g_string_sized_new (1024);
  status = g_io_channel_read_line_string (channel, buffer, &line, &error);
  switch (status)
    {
    case G_IO_STATUS_ERROR:
      g_critical ("Failed to read input: %s", error->message);
      g_error_free (error);
      g_main_loop_quit (loop);
      return FALSE;
    case G_IO_STATUS_EOF:
      web_socket_connection_close (web_socket, WEB_SOCKET_CLOSE_GOING_AWAY, "going away");
      return FALSE;
    case G_IO_STATUS_AGAIN:
      return TRUE;
    case G_IO_STATUS_NORMAL:
      msg = g_bytes_new_with_free_func (buffer->str, line, on_release_buffer, buffer);
      buffer = NULL;
      web_socket_connection_send (web_socket, WEB_SOCKET_DATA_TEXT, NULL, msg);
      g_bytes_unref (msg);
      return TRUE;
    default:
      g_assert_not_reached ();
    }
}

static void
on_web_socket_open (WebSocketConnection *ws,
                    gpointer unused)
{
  GIOChannel *channel;

  g_printerr ("WebSocket: opened %s with %s\n",
              web_socket_connection_get_protocol (ws),
              web_socket_connection_get_url (ws));

  channel = g_io_channel_unix_new (0);
  g_io_add_watch (channel, G_IO_IN, on_input_data, NULL);
  g_io_channel_unref (channel);
}

static void
on_web_socket_message (WebSocketConnection *ws,
                       WebSocketDataType type,
                       GBytes *message)
{
  const gchar *data;
  gsize len;

  g_printerr ("WebSocket: message 0x%x\n", (int)type);

  data = g_bytes_get_data (message, &len);
  g_print ("%.*s\n", (int)len, data);
}

static void
on_web_socket_close (WebSocketConnection *ws)
{
  gushort code;

  code = web_socket_connection_get_close_code (ws);
  if (code != 0)
    g_printerr ("WebSocket: close: %d %s\n", code,
                web_socket_connection_get_close_data (ws));
  else
    g_printerr ("WebSocket: close\n");

  g_main_loop_quit (loop);
}

int
main (int argc,
      char *argv[])
{
  GOptionContext *options;
  gchar **protocols = NULL;
  gchar *origin = NULL;
  GError *error = NULL;

  GOptionEntry entries[] = {
    { "origin", 0, 0, G_OPTION_ARG_STRING, &origin, "Web Socket Origin", "url" },
    { "protocol", 0, 0, G_OPTION_ARG_STRING_ARRAY, &protocols, "Web Socket Protocols", "proto" },
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);
  options = g_option_context_new ("URL");
  g_option_context_add_main_entries (options, entries, NULL);
  if (!g_option_context_parse (options, &argc, &argv, &error))
    {
      g_printerr ("frob-websocket: %s\n", error->message);
      return 2;
    }

  if (argc != 2)
    {
      g_printerr ("frob-websocket: specify the url to connect to\n");
      return 2;
    }

  loop = g_main_loop_new (NULL, FALSE);

  web_socket = web_socket_client_new (argv[1], origin, (const gchar **)protocols);
  g_signal_connect (web_socket, "open", G_CALLBACK (on_web_socket_open), NULL);
  g_signal_connect (web_socket, "message", G_CALLBACK (on_web_socket_message), NULL);
  g_signal_connect (web_socket, "close", G_CALLBACK (on_web_socket_close), NULL);

  g_main_loop_run (loop);

  g_option_context_free (options);
  g_object_unref (web_socket);
  g_free (origin);
  if (buffer)
    g_string_free (buffer, TRUE);
  g_strfreev (protocols);

  return 0;
}
