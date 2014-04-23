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

#include "cockpitdbusjson.h"
#include "cockpit/mock-service.h"
#include "cockpit/cockpitpipetransport.h"
#include "cockpit/cockpittest.h"

#include <json-glib/json-glib.h>

#include <sys/socket.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  int fd;
  GThread *thread;
  JsonParser *parser;
} TestCase;

static void
on_closed_set_flag (CockpitChannel *channel,
                    const gchar *problem,
                    gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
}

static gpointer
dbus_server_thread (gpointer data)
{
  CockpitTransport *transport;
  int fd = GPOINTER_TO_INT (data);
  CockpitChannel *channel;
  GMainContext *ctx;
  gboolean closed = FALSE;

  ctx = g_main_context_new ();
  g_main_context_push_thread_default (ctx);

  transport = cockpit_pipe_transport_new_fds ("mock", fd, fd);

  channel = cockpit_dbus_json_open (transport, 444,
                                    "com.redhat.Cockpit.DBusTests.Test", "/otree");
  g_signal_connect (channel, "closed", G_CALLBACK (on_closed_set_flag), &closed);

  /* Channel keeps itself alive until done */
  while (!closed)
    g_main_context_iteration (ctx, TRUE);

  g_object_unref (channel);
  g_object_unref (transport);
  g_main_context_pop_thread_default (ctx);
  g_main_context_unref (ctx);
  return NULL;
}

static void
setup_dbus_server(TestCase *tc,
                  gconstpointer unused)
{
  int fds[2];

  if (socketpair (PF_LOCAL, SOCK_STREAM, 0, fds) < 0)
    g_error ("socketpair() failed: %s", g_strerror (errno));

  tc->fd = fds[0];
  tc->thread = g_thread_new ("dbus-server", dbus_server_thread, GINT_TO_POINTER(fds[1]));

  tc->parser = json_parser_new ();
}

static void
teardown_dbus_server(TestCase *tc,
                     gconstpointer unused)
{
  shutdown (tc->fd, SHUT_WR);
  g_thread_join (tc->thread);
  close (tc->fd);
  g_object_unref (tc->parser);
}

static void
read_all (int fd,
          gchar *data,
          gsize len)
{
  gssize ret;
  gsize off = 0;

  while (off < len)
    {
      ret = read(fd, data + off, len - off);
      if (ret < 0)
        g_error ("read() failed: %s", g_strerror (errno));
      else if (ret == 0)
        g_error ("short read in test: %u != %u", (guint)len, (guint)off);
      else
        off += len;
    }
}

static JsonObject *
read_message (TestCase *tc)
{
  GError *error = NULL;
  JsonNode *node;
  gchar *message;
  gchar *line;
  guint32 size;

  read_all (tc->fd, (gchar *)&size, sizeof (size));
  size = GUINT32_FROM_BE (size);

  message = g_malloc (size + 1);
  read_all (tc->fd, message, size);
  message[size] = 0;

  line = strchr (message, '\n');
  g_assert (line != NULL);

  json_parser_load_from_data (tc->parser, line, size, &error);
  g_assert_no_error (error);

  g_free (message);
  node = json_parser_get_root (tc->parser);

  g_assert_cmpint (JSON_NODE_TYPE (node), ==, JSON_NODE_OBJECT);
  return json_node_get_object (node);
}

static void
test_seed (TestCase *tc,
           gconstpointer unused)
{
  JsonObject *msg;
  JsonObject *data;
  JsonObject *object;
  JsonObject *ifaces;
  JsonObject *frobber;

  msg = read_message (tc);

  g_assert_cmpstr (json_object_get_string_member (msg, "command"), ==, "seed");

  data = json_object_get_object_member (msg, "data");
  g_assert (data != NULL);

  object = json_object_get_object_member (data, "/otree/frobber");
  g_assert (object != NULL);

  g_assert_cmpstr (json_object_get_string_member (object, "objpath"), ==, "/otree/frobber");

  ifaces = json_object_get_object_member (object, "ifaces");
  g_assert (ifaces != NULL);

  frobber = json_object_get_object_member (ifaces, "com.redhat.Cockpit.DBusTests.Frobber");
  g_assert (frobber != NULL);

  g_assert_cmpstr (json_object_get_string_member (frobber, "dbus_prop_FinallyNormalName"), ==, "There aint no place like home");
  g_assert_cmpstr (json_object_get_string_member (frobber, "dbus_prop_ReadonlyProperty"), ==, "blah");
}

int
main (int argc,
      char *argv[])
{
  GTestDBus *bus;
  gint ret;

  cockpit_test_init (&argc, &argv);

  g_test_add ("/dbus-server/seed", TestCase, NULL, setup_dbus_server, test_seed, teardown_dbus_server);

  /* This isolates us from affecting other processes during tests */
  bus = g_test_dbus_new (G_TEST_DBUS_NONE);
  g_test_dbus_up (bus);

  /* Use the above test session bus as a system bus */
  g_setenv ("DBUS_SYSTEM_BUS_ADDRESS", g_getenv ("DBUS_SESSION_BUS_ADDRESS"), TRUE);

  mock_service_start ();

  ret = g_test_run ();

  mock_service_stop ();
  g_unsetenv ("DBUS_SYSTEM_BUS_ADDRESS");
  g_test_dbus_down (bus);

  return ret;
}
