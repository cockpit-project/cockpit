/*
 * Copyright (C) 2017 Red Hat, Inc.
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General
 * Public License along with this library; if not, write to the
 * Free Software Foundation, Inc., 59 Temple Place, Suite 330,
 * Boston, MA 02111-1307, USA.
 *
 * Author: Stef Walter <stefw@redhat.com>
 */

#include "config.h"

#include "common/cockpitframe.h"
#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpittransport.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

static void
byte_array_clear_and_free (gpointer data)
{
  GByteArray *buffer = data;
  cockpit_memory_clear (buffer->data, buffer->len);
  g_byte_array_free (buffer, TRUE);
}

static JsonObject *
read_control_message (int fd)
{
  JsonObject *options = NULL;
  GBytes *payload = NULL;
  GBytes *bytes = NULL;
  gchar *channel = NULL;
  guchar *data = NULL;
  gssize length = 0;

  length = cockpit_frame_read (fd, &data);
  if (length < 0)
    {
      g_message ("couldn't read askpass authorize message: %s", g_strerror (errno));
      length = 0;
    }
  else if (length > 0)
    {
      /* This could have a password, so clear it when freeing */
      bytes = g_bytes_new_with_free_func (data, length, byte_array_clear_and_free,
                                          g_byte_array_new_take (data, length));
      payload = cockpit_transport_parse_frame (bytes, &channel);
      data = NULL;
    }

  if (payload == NULL)
    {
      if (length > 0)
        g_message ("askpass did not receive valid message");
    }
  else if (channel != NULL)
    {
      g_message ("askpass did not receive a control message");
    }
  else if (!cockpit_transport_parse_command (payload, NULL, NULL, &options))
    {
      g_message ("askpass did not receive a valid control message");
    }

  g_free (channel);

  if (bytes)
    g_bytes_unref (bytes);
  if (payload)
    g_bytes_unref (payload);
  free (data);
  return options;
}

static gboolean
write_all (int fd,
           const char *data,
           gssize len)
{
  gssize res;
  if (len < 0)
    len = strlen (data);
  res = cockpit_fd_write_all (fd, (guchar *)data, len);
  if (res < 0)
    {
      g_message ("couldn't write in askpass: %s", g_strerror (errno));
      return FALSE;
    }
  g_debug ("askpass wrote %d bytes", (gint)res);
  return TRUE;
}

static gboolean
write_control_message (int fd,
                       JsonObject *options)
{
  gboolean ret = TRUE;
  gchar *payload;
  gchar *prefixed;
  gsize length;

  payload = cockpit_json_write_object (options, &length);
  prefixed = g_strdup_printf ("\n%s", payload);
  if (cockpit_frame_write (fd, (unsigned char *)prefixed, length + 1) < 0)
    {
      g_message ("couldn't write authorize message: %s", g_strerror (errno));
      ret = FALSE;
    }
  g_free (prefixed);
  g_free (payload);

  return ret;
}

int
main (int argc,
      char *argv[])
{
  GOptionContext *context;
  JsonObject *request = NULL;
  JsonObject *reply = NULL;
  GError *error = NULL;
  const gchar *env;
  const gchar *command = NULL;
  const gchar *field = NULL;
  const gchar *response = NULL;
  char *user = NULL;
  gchar *cookie = NULL;
  gchar *challenge = NULL;
  gint ret = 1;

  static GOptionEntry entries[] = {
    { NULL }
  };

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_description (context, "cockpit-bridge uses cockpit-askpass during password prompts.\n");

  g_option_context_parse (context, &argc, &argv, &error);
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("cockpit-askpass: %s\n", error->message);
      g_error_free (error);
      return 1;
    }

  if (isatty (0))
    {
      g_printerr ("cockpit-askpass: this command is not meant to be run directly\n");
      return 2;
    }

  /*
   * We don't send an init message. This is meant to be used either after an
   * "init" message has been sent, or with a caller that makes an exception for
   * the "authorize" command message.
   */
  env = g_getenv ("USER");
  user = cockpit_hex_encode (env ? env : "", -1);
  challenge = g_strdup_printf ("plain1:%s:", user);
  cookie = g_strdup_printf ("askpass%u%u", (unsigned int)getpid (), (unsigned int)time (NULL));

  request = cockpit_transport_build_json ("command", "authorize",
                                          "challenge", challenge,
                                          "cookie", cookie,
                                          "prompt", argv[1],
                                          NULL);

  /* Yes, we write to stdin which we expect to be a socketpair() */
  if (write_control_message (STDIN_FILENO, request))
    {
      reply = read_control_message (STDIN_FILENO);
      if (reply)
        {
          if (cockpit_json_get_string (reply, "command", "", &command) &&
              cockpit_json_get_string (reply, "cookie", "", &field) &&
              cockpit_json_get_string (reply, "response", "", &response))
            {
              if (g_str_equal (field, cookie) && g_str_equal (command, "authorize"))
                {
                  /* The password is written back on stdout */
                  if (write_all (STDOUT_FILENO, response, -1) && write_all (STDOUT_FILENO, "\n", 1))
                    ret = 0;
                }
              else
                {
                  g_message ("askpass received unexpected %s control message", command);
                }
            }
          else
            {
              g_message ("askpass response has invalid control message authorize fields");
            }
        }
    }

  g_free (cookie);
  g_free (challenge);
  free (user);

  /* Clear the password memory owned by JsonObject */
  if (response)
    cockpit_memory_clear ((gchar *)response, -1);

  if (request)
    json_object_unref (request);
  if (reply)
    json_object_unref (reply);

  return ret;
}
