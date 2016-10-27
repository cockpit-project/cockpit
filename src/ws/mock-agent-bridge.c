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

#include "bridge/cockpitchannel.h"
#include "bridge/cockpitpipechannel.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipetransport.h"

#include <gio/gunixsocketaddress.h>
#include <glib/gstdio.h>
#include <glib-unix.h>

#include <signal.h>
#include <string.h>
#include <stdio.h>

/*
 * The bridge implements a stream channel for proxing ssh-agent.
 *
 */

static GHashTable *channels;
static gboolean init_received;

static void
on_channel_closed (CockpitChannel *channel,
                   const gchar *problem,
                   gpointer user_data)
{
  g_hash_table_remove (channels, cockpit_channel_get_id (channel));
}

static void
process_init (CockpitTransport *transport,
              JsonObject *options)
{
  gint64 version = -1;

  if (!cockpit_json_get_int (options, "version", -1, &version))
    {
      g_warning ("invalid version field in init message");
      cockpit_transport_close (transport, "protocol-error");
    }

  if (version == 1)
    {
      g_debug ("received init message");
      init_received = TRUE;
    }
  else
    {
      g_message ("unsupported version of cockpit protocol: %" G_GINT64_FORMAT, version);
      cockpit_transport_close (transport, "not-supported");
    }
}

static void
process_open (CockpitTransport *transport,
              const gchar *channel_id,
              JsonObject *options)
{
  CockpitChannel *channel;
  GType channel_type;
  const gchar *payload;
  const gchar *internal;

  if (!channel_id)
    {
      g_warning ("Caller tried to open channel with invalid id");
      cockpit_transport_close (transport, "protocol-error");
    }
  else if (g_hash_table_lookup (channels, channel_id))
    {
      g_warning ("Caller tried to reuse a channel that's already in use");
      cockpit_transport_close (transport, "protocol-error");
    }
  else
    {
      if (!cockpit_json_get_string (options, "payload", NULL, &payload))
        payload = NULL;

      if (!cockpit_json_get_string (options, "internal", NULL, &internal))
        internal = NULL;

      /* This will close with "not-supported" */
      channel_type = COCKPIT_TYPE_CHANNEL;

      if (g_strcmp0 (payload, "stream") == 0 &&
          g_strcmp0 (internal, "ssh-agent") == 0)
        channel_type = COCKPIT_TYPE_PIPE_CHANNEL;

      channel = g_object_new (channel_type,
                              "transport", transport,
                              "id", channel_id,
                              "options", options,
                              NULL);

      g_hash_table_insert (channels, g_strdup (channel_id), channel);
      g_signal_connect (channel, "closed", G_CALLBACK (on_channel_closed), NULL);

  }
}

static gboolean
on_transport_control (CockpitTransport *transport,
                      const char *command,
                      const gchar *channel_id,
                      JsonObject *options,
                      GBytes *message,
                      gpointer user_data)
{
  if (g_str_equal (command, "init"))
    {
      process_init (transport, options);
      return TRUE;
    }
  else if (!init_received)
    {
      g_warning ("caller did not send 'init' message first");
      cockpit_transport_close (transport, "protocol-error");
      return TRUE;
    }
  else if (g_str_equal (command, "open"))
    {
      process_open (transport, channel_id, options);
      return TRUE;
    }
  return FALSE;
}

static void
on_closed_set_flag (CockpitTransport *transport,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

static void
send_init_command (CockpitTransport *transport)
{
  JsonObject *object;
  GBytes *bytes;

  object = json_object_new ();
  json_object_set_string_member (object, "command", "init");
  json_object_set_int_member (object, "version", 1);

  bytes = cockpit_json_write_bytes (object);
  cockpit_transport_send (transport, NULL, bytes);
  g_bytes_unref (bytes);
}

static gboolean
on_signal_done (gpointer data)
{
  gboolean *closed = data;
  *closed = TRUE;
  return TRUE;
}

int
main (int argc,
      char **argv)
{
  CockpitTransport *transport;
  gboolean terminated = FALSE;
  gboolean interupted = FALSE;
  gboolean closed = FALSE;
  GError *error = NULL;
  guint sig_term;
  guint sig_int;
  int ret = 0;
  int outfd;

  gchar *ssh_auth_sock = g_strdup (BUILDDIR "/test-agent.XXXXXX");
  gint ssh_auth_fd = -1;

  int agent = 0;
  gchar *agent_output = NULL;
  gchar *agent_error = NULL;
  gchar *pid_line = NULL;
  gint status = 0;

  const gchar *agent_argv[] = {
      "/usr/bin/ssh-agent",
      "-a", ssh_auth_sock,
      NULL
  };

  signal (SIGPIPE, SIG_IGN);

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      outfd = 1;
    }

  ssh_auth_fd = g_mkstemp (ssh_auth_sock);
  if (ssh_auth_fd < 0)
    {
      g_warning ("couldn't create ssh agent socket filename: %s", g_strerror (errno));
      ret = 1;
      goto out;
    }
  else
    {
      if (g_unlink (ssh_auth_sock) < 0)
        g_warning ("couldn't unlink ssh agent socket: %s", g_strerror (errno));
      close (ssh_auth_fd);
    }

  g_setenv ("SSH_AUTH_SOCK", ssh_auth_sock, TRUE);
  if (!g_spawn_sync (BUILDDIR, (gchar **)agent_argv, NULL,
                G_SPAWN_DEFAULT, NULL, NULL,
                &agent_output, &agent_error,
                &status, &error))
    {
      g_warning ("bridge couldn't spawn agent %s\n", error->message);
      ret = 1;
      goto out;
    }

  if (!g_spawn_check_exit_status (status, &error))
    {
      g_warning ("bridge couldn't spawn agent %s: %s\n", error->message, agent_error);
      ret = 1;
      goto out;
    }

  pid_line = strstr(agent_output, "SSH_AGENT_PID=");
  if (pid_line)
    {
      if (sscanf (pid_line, "SSH_AGENT_PID=%d;", &agent) != 1)
        g_warning ("couldn't find pid in %s", pid_line);
    }

  if (agent < 1)
    {
      g_warning ("couldn't get agent pid: %s", agent_output);
      ret = 1;
      goto out;
    }


  if (argc > 1)
    {
      const gchar *agent_add_argv[] = {
          "/usr/bin/ssh-add", argv[1],
          NULL
      };

      gchar **agent_add_env = g_get_environ ();
      agent_add_env = g_environ_setenv (agent_add_env,
                                        "SSH_AUTH_SOCK",
                                         g_strdup (ssh_auth_sock),
                                         TRUE);

      g_spawn_sync (BUILDDIR, (gchar **)agent_add_argv,
                    agent_add_env, G_SPAWN_DEFAULT,
                    NULL, NULL, NULL, NULL, NULL, &error);

      g_strfreev (agent_add_env);

      if (error)
        {
          g_warning ("couldn't add key %s\n", error->message);
          ret = 1;
          goto out;
        }
    }

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, &terminated);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, &interupted);

  g_type_init ();

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);

  g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);

  send_init_command (transport);

  while (!terminated && !closed && !interupted)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);
  g_hash_table_destroy (channels);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

out:
  g_free (agent_output);
  g_free (agent_error);
  if (error)
    g_error_free (error);

  if (agent)
    kill (agent, SIGTERM);

  /* So the caller gets the right signal */
  if (terminated)
    raise (SIGTERM);

  return ret;
}
