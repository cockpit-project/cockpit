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

#include "cockpitchannel.h"

#include "common/cockpitjson.h"
#include "common/cockpitpipetransport.h"

#include <glib-unix.h>

#include <signal.h>

/*
 * The bridge implements two channel types.
 *
 *  'uppercase': Make all data upper case
 *  'lowercase': Make all data lower case
 *
 * By default only the first one is available. If run with --lower
 * then the latter is available.
 */

static gboolean opt_lower;
static gboolean opt_upper;

static GType mock_case_channel_get_type (void) G_GNUC_CONST;

typedef struct {
    CockpitChannel parent;
    gchar (* function) (gchar);
} MockCaseChannel;

typedef CockpitChannelClass MockCaseChannelClass;

G_DEFINE_TYPE (MockCaseChannel, mock_case_channel, COCKPIT_TYPE_CHANNEL);

static void
mock_case_channel_recv (CockpitChannel *channel,
                        GBytes *message)
{
  MockCaseChannel *self = (MockCaseChannel *)channel;
  GByteArray *array = g_bytes_unref_to_array (g_bytes_ref (message));
  GBytes *bytes;
  gsize i;

  for (i = 0; i < array->len; i++)
    array->data[i] = self->function(array->data[i]);

  bytes = g_byte_array_free_to_bytes (array);
  cockpit_channel_send (channel, bytes, FALSE);
  g_bytes_unref (bytes);
}

static void
mock_case_channel_init (MockCaseChannel *self)
{

}

static void
mock_case_channel_constructed (GObject *obj)
{
  MockCaseChannel *self = (MockCaseChannel *)obj;
  const gchar *payload = NULL;
  JsonObject *options;

  G_OBJECT_CLASS (mock_case_channel_parent_class)->constructed (obj);

  options = cockpit_channel_get_options (COCKPIT_CHANNEL (obj));
  if (!cockpit_json_get_string (options, "payload", NULL, &payload))
    g_assert_not_reached ();

  if (g_strcmp0 (payload, "upper") == 0)
    self->function = g_ascii_toupper;
  else if (g_strcmp0 (payload, "lower") == 0)
    self->function = g_ascii_tolower;
  else
    g_assert_not_reached ();

  cockpit_channel_ready (COCKPIT_CHANNEL (self), NULL);
}

static void
mock_case_channel_class_init (MockCaseChannelClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);
  GObjectClass *object_class = G_OBJECT_CLASS (klass);

  object_class->constructed = mock_case_channel_constructed;
  channel_class->recv = mock_case_channel_recv;
}

static GHashTable *channels;
static gboolean init_received;
static gboolean opt_lower;

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

      /* This will close with "not-supported" */
      channel_type = COCKPIT_TYPE_CHANNEL;

      if ((opt_lower && g_strcmp0 (payload, "lower") == 0) ||
          (opt_upper && g_strcmp0 (payload, "upper") == 0))
        channel_type = mock_case_channel_get_type ();

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
  json_object_unref (object);

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
  GOptionContext *context;
  GError *error = NULL;
  guint sig_term;
  guint sig_int;
  int outfd;

  static GOptionEntry entries[] = {
    { "lower", 0, 0, G_OPTION_ARG_NONE, &opt_lower, "Lower case channel type", NULL },
    { "upper", 0, 0, G_OPTION_ARG_NONE, &opt_upper, "Upper case channel type", NULL },
    { NULL }
  };

  signal (SIGPIPE, SIG_IGN);

  g_setenv ("GSETTINGS_BACKEND", "memory", TRUE);
  g_setenv ("GIO_USE_PROXY_RESOLVER", "dummy", TRUE);
  g_setenv ("GIO_USE_VFS", "local", TRUE);

  context = g_option_context_new (NULL);
  g_option_context_add_main_entries (context, entries, NULL);
  g_option_context_set_description (context, "mock-bridge as used in tests\n");

  g_option_context_parse (context, &argc, &argv, &error);
  g_option_context_free (context);

  if (error)
    {
      g_printerr ("mock-bridge: %s\n", error->message);
      g_error_free (error);
      return 1;
    }

  outfd = dup (1);
  if (outfd < 0 || dup2 (2, 1) < 1)
    {
      g_warning ("bridge couldn't redirect stdout to stderr");
      outfd = 1;
    }

  sig_term = g_unix_signal_add (SIGTERM, on_signal_done, &terminated);
  sig_int = g_unix_signal_add (SIGINT, on_signal_done, &interupted);

  g_type_init ();

  transport = cockpit_pipe_transport_new_fds ("stdio", 0, outfd);

  g_signal_connect (transport, "control", G_CALLBACK (on_transport_control), NULL);
  g_signal_connect (transport, "closed", G_CALLBACK (on_closed_set_flag), &closed);
  send_init_command (transport);

  /* Owns the channels */
  channels = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, g_object_unref);

  while (!terminated && !closed && !interupted)
    g_main_context_iteration (NULL, TRUE);

  g_object_unref (transport);
  g_hash_table_destroy (channels);

  g_source_remove (sig_term);
  g_source_remove (sig_int);

  /* So the caller gets the right signal */
  if (terminated)
    raise (SIGTERM);

  return 0;
}
