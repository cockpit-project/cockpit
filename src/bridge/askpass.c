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

#include "common/cockpithex.h"
#include "common/cockpitjson.h"
#include "common/cockpitmemory.h"
#include "common/cockpitpipe.h"
#include "common/cockpittransport.h"

#include <errno.h>
#include <string.h>

static void
byte_array_clear_and_free (gpointer data)
{
  GByteArray *buffer = data;
  cockpit_secclear (buffer->data, buffer->len);
  g_byte_array_free (buffer, TRUE);
}

static JsonObject *
read_control_message (int fd)
{
  JsonObject *options = NULL;
  GBytes *payload = NULL;
  GBytes *bytes = NULL;
  GByteArray *buffer;
  gchar *channel = NULL;
  gssize length = 0;
  gsize skip;
  guint8 ch;
  ssize_t res;

  buffer = g_byte_array_new ();

  while (length == 0 || buffer->len < length)
    {
      res = read (fd, &ch, 1);
      if (res < 0)
        {
          if (errno != EINTR || errno != EAGAIN)
            {
              g_message ("couldn't read askpass authorize message: %s", g_strerror (errno));
              break;
            }
        }
      else if (res == 0)
        {
          break;
        }
      else if (res > 0)
        {
          g_byte_array_append (buffer, &ch, res);
        }

      /* Parse the length if necessary */
      if (length == 0)
        {
          length = cockpit_pipe_parse_length (buffer, &skip);
          if (length > 0)
            cockpit_pipe_skip (buffer, skip);
        }

      if (length < 0)
        break;
    }

  if (buffer->len > 0 && length == buffer->len)
    {
      /* This could have a password, so clear it when freeing */
      bytes = g_bytes_new_with_free_func (buffer->data, buffer->len,
                                          byte_array_clear_and_free, buffer);
      buffer = NULL;
      payload = cockpit_transport_parse_frame (bytes, &channel);
    }

  if (payload == NULL)
    {
      if (buffer->len > 0)
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
  if (buffer)
    g_byte_array_free (buffer, TRUE);
  return options;
}

static gboolean
write_all (int fd,
           const char *data,
           ssize_t len)
{
  ssize_t res;

  if (len < 0)
    len = strlen (data);

  while (len > 0)
    {
      res = write (fd, data, len);
      if (res < 0)
        {
          if (errno == EPIPE)
            {
              g_message ("couldn't write in askpass: closed connection");
              return FALSE;
            }
          else if (errno != EAGAIN && errno != EINTR)
            {
              g_message ("couldn't write in askpass: %d %s", (int)errno, g_strerror (errno));
              return FALSE;
            }
        }
      else
        {
          g_debug ("askpass wrote %d bytes", (gint)res);
          data += res;
          len -= res;
        }
    }

  return TRUE;
}

static gboolean
write_control_message (int fd,
                       JsonObject *options)
{
  gchar *payload;
  gchar *prefix;
  gsize length;
  gboolean ret;

  payload = cockpit_json_write_object (options, &length);
  prefix = g_strdup_printf ("%" G_GSIZE_FORMAT "\n\n", 1 + length);
  ret = write_all (fd, prefix, -1) && write_all (fd, payload, length);
  g_free (prefix);
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
  gchar *user = NULL;
  gchar *cookie = NULL;
  gchar *challenge = NULL;
  gint ret = 1;

  static GOptionEntry entries[] = {
    { NULL }
  };

  /* Debugging issues during testing */
#if WITH_DEBUG
  signal (SIGABRT, cockpit_test_signal_backtrace);
  signal (SIGSEGV, cockpit_test_signal_backtrace);
#endif

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
  cookie = g_strdup_printf ("askpass%u", (unsigned int)getpid ());

  request = cockpit_transport_build_json ("command", "authorize",
                                          "challenge", challenge,
                                          "cookie", cookie,
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
  g_free (user);

  /* Clear the password memory owned by JsonObject */
  if (response)
    cockpit_secclear ((gchar *)response, -1);

  if (request)
    json_object_unref (request);
  if (reply)
    json_object_unref (reply);

  return ret;
}
