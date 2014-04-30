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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitreauthorize.h"

#include "cockpit/cockpitjson.h"
#include "cockpit/cockpittest.h"

#include <json-glib/json-glib.h>

#include <gio/gio.h>

#include <keyutils.h>
#include <stdlib.h>
#include <string.h>

/* ----------------------------------------------------------------------------
 * Mock
 */

static GType mock_transport_get_type (void) G_GNUC_CONST;

typedef struct {
  CockpitTransport parent;
  gboolean closed;
  gchar *problem;
  guint channel_sent;
  GBytes *payload_sent;
  GBytes *control_sent;
} MockTransport;

typedef CockpitTransportClass MockTransportClass;

G_DEFINE_TYPE (MockTransport, mock_transport, COCKPIT_TYPE_TRANSPORT);

static void
mock_transport_init (MockTransport *self)
{
  self->channel_sent = G_MAXUINT;
}

static void
mock_transport_get_property (GObject *object,
                             guint prop_id,
                             GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      g_value_set_string (value, "mock-name");
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_set_property (GObject *object,
                             guint prop_id,
                             const GValue *value,
                             GParamSpec *pspec)
{
  switch (prop_id)
    {
    case 1:
      break;
    default:
      g_assert_not_reached ();
      break;
    }
}

static void
mock_transport_finalize (GObject *object)
{
  MockTransport *self = (MockTransport *)object;

  g_free (self->problem);
  if (self->payload_sent)
    g_bytes_unref (self->payload_sent);
  if (self->control_sent)
    g_bytes_unref (self->control_sent);

  G_OBJECT_CLASS (mock_transport_parent_class)->finalize (object);
}

static void
mock_transport_send (CockpitTransport *transport,
                     guint channel,
                     GBytes *data)
{
  MockTransport *self = (MockTransport *)transport;
  if (channel == 0)
    {
      g_assert (self->control_sent == NULL);
      self->control_sent = g_bytes_ref (data);
    }
  else
    {
      g_assert (self->channel_sent == G_MAXUINT);
      g_assert (self->payload_sent == NULL);
      self->channel_sent = channel;
      self->payload_sent = g_bytes_ref (data);
    }
}

static void
mock_transport_close (CockpitTransport *transport,
                      const gchar *problem)
{
  MockTransport *self = (MockTransport *)transport;
  g_assert (!self->closed);
  self->problem = g_strdup (problem);
  self->closed = TRUE;
  cockpit_transport_emit_closed (transport, problem);
}

static void
mock_transport_class_init (MockTransportClass *klass)
{
  GObjectClass *object_class = G_OBJECT_CLASS (klass);
  CockpitTransportClass *transport_class = COCKPIT_TRANSPORT_CLASS (klass);
  object_class->finalize = mock_transport_finalize;
  object_class->get_property = mock_transport_get_property;
  object_class->set_property = mock_transport_set_property;
  g_object_class_override_property (object_class, 1, "name");
  transport_class->send = mock_transport_send;
  transport_class->close = mock_transport_close;
}

/* ----------------------------------------------------------------------------
 * Testing
 */

typedef struct {
  MockTransport *transport;
  CockpitReauthorize *reauthorize;
  GSocket *client;
} TestCase;

static gboolean
on_socket_ready (gint fd,
                 GIOCondition cond,
                 gpointer data)
{
  gboolean *result = data;
  g_assert (result != NULL);
  g_assert (*result == FALSE);
  *result = TRUE;
  return FALSE;
}

static void
setup (TestCase *tc,
       gconstpointer unused)
{
  GSocketAddress *address;
  key_serial_t keyring;
  key_serial_t key;
  GError *error = NULL;
  struct sockaddr *addr;
  socklen_t addr_len;
  gboolean ready = FALSE;
  GSource *source;

  keyring = keyctl_join_session_keyring (NULL);
  g_assert (keyring >= 0);

  tc->transport = g_object_new (mock_transport_get_type (), NULL);
  tc->reauthorize = cockpit_reauthorize_new (COCKPIT_TRANSPORT (tc->transport));

  key = keyctl_search (KEY_SPEC_SESSION_KEYRING, "user", "reauthorize/socket", 0);
  g_assert_cmpint (key, >=, 0);
  addr_len = keyctl_read_alloc (key, (void *)&addr);
  address = g_socket_address_new_from_native (addr, addr_len);
  free (addr);

  tc->client = g_socket_new (G_SOCKET_FAMILY_UNIX, G_SOCKET_TYPE_SEQPACKET,
                             G_SOCKET_PROTOCOL_DEFAULT, &error);
  g_assert_no_error (error);

  g_socket_set_blocking (tc->client, FALSE);

  g_socket_connect (tc->client, address, NULL, &error);
  g_object_unref (address);

  if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_PENDING))
    {
      g_clear_error (&error);
      source = g_socket_create_source (tc->client, G_IO_IN, NULL);
      g_source_set_callback (source, (GSourceFunc)on_socket_ready, &ready, NULL);
      g_source_attach (source, NULL);
      g_source_unref (source);

      while (!ready)
        g_main_context_iteration (NULL, TRUE);

      g_socket_check_connect_result (tc->client, &error);
    }
  g_assert_no_error (error);
}

static void
teardown (TestCase *tc,
          gconstpointer unused)
{
  while (g_main_context_iteration (NULL, FALSE));

  g_object_add_weak_pointer (G_OBJECT (tc->reauthorize), (gpointer *)&tc->reauthorize);
  g_object_add_weak_pointer (G_OBJECT (tc->transport), (gpointer *)&tc->transport);
  g_object_unref (tc->reauthorize);
  g_object_unref (tc->transport);
  g_assert (tc->reauthorize == NULL);
  g_assert (tc->transport == NULL);
}

static void
test_receive_and_send (TestCase *tc,
                       gconstpointer unused)
{
  GError *error = NULL;
  gchar buffer[32];
  GBytes *bytes;
  const gchar *command;
  JsonObject *options;
  const gchar *response;
  guint channel;
  gssize ret;

  g_socket_send_with_blocking (tc->client, "test:test", 9, TRUE, NULL, &error);
  g_assert_no_error (error);

  while (!tc->transport->control_sent && !tc->transport->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert (tc->transport->control_sent != NULL);
  if (!cockpit_transport_parse_command (tc->transport->control_sent, &command, &channel, &options))
    g_assert_not_reached ();

  g_assert_cmpstr (command, ==, "authorize");
  g_assert_cmpuint (channel, ==, 0);
  g_assert_cmpstr (json_object_get_string_member (options, "challenge"), ==, "test:test");
  g_assert_cmpint (json_object_get_int_member (options, "cookie"), ==, 1);

  response = "{ \"command\": \"authorize\", \"cookie\": 1, \"response\": \"response:response\" }";
  bytes = g_bytes_new_static (response, strlen (response));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 0, bytes);
  g_bytes_unref (bytes);

  for (;;)
    {
      memset (buffer, 0, sizeof (buffer));
      ret = g_socket_receive_with_blocking (tc->client, buffer, sizeof (buffer), FALSE, NULL, &error);
      if (g_error_matches (error, G_IO_ERROR, G_IO_ERROR_WOULD_BLOCK))
        {
          g_clear_error (&error);
          g_main_context_iteration (NULL, FALSE);
          continue;
        }
      g_assert_no_error (error);
      break;
    }

  g_assert_cmpint (ret, ==, 17);
  g_assert_cmpstr (buffer, ==, "response:response");
}

static void
test_bad_authorize (TestCase *tc,
                    gconstpointer unused)
{
  GBytes *bytes;
  const gchar *response;

  cockpit_expect_warning ("got an invalid authorize*");

  /* Invalid authorize response */
  response = "{ \"command\": \"authorize\" }";
  bytes = g_bytes_new_static (response, strlen (response));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 0, bytes);
  g_bytes_unref (bytes);

  while (!tc->transport->closed)
    g_main_context_iteration (NULL, TRUE);

  g_assert_cmpstr (tc->transport->problem, ==, "protocol-error");
}

static void
test_gone_away (TestCase *tc,
                gconstpointer unused)
{
  GBytes *bytes;
  const gchar *response;

  /* Invalid authorize response */
  response = "{ \"command\": \"authorize\", \"cookie\": 444, \"response\": \"unused\" }";
  bytes = g_bytes_new_static (response, strlen (response));
  cockpit_transport_emit_recv (COCKPIT_TRANSPORT (tc->transport), 0, bytes);
  g_bytes_unref (bytes);

  while (g_main_context_iteration (NULL, FALSE));

  /* Just move along, no problem */
  g_assert_cmpstr (tc->transport->problem, ==, NULL);
  g_assert (!tc->transport->closed);
}

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  g_test_add ("/reauthagent/recv-and-send", TestCase, NULL,
              setup, test_receive_and_send, teardown);
  g_test_add ("/reauthagent/bad-authorize", TestCase, NULL,
              setup, test_bad_authorize, teardown);
  g_test_add ("/reauthagent/gone-away", TestCase, NULL,
              setup, test_gone_away, teardown);

  return g_test_run ();
}
