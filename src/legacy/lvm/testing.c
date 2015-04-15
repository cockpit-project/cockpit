/* -*- mode: C; c-file-style: "gnu"; indent-tabs-mode: nil; -*-
 *
 * Copyright (C) 2007-2010 David Zeuthen <zeuthen@gmail.com>
 * Copyright (C) 2013-2014 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin St, Fifth Floor, Boston, MA  02110-1301  USA
 *
 */

#include "config.h"

#include "testing.h"

#include "util.h"

#include <glib/gstdio.h>
#include <gio/gunixinputstream.h>
#include <gio/gunixoutputstream.h>

#include <sys/prctl.h>
#include <sys/wait.h>
#include <errno.h>
#include <stdlib.h>
#include <string.h>

/*
 * The goal of all of this is to be able to:
 *  a) Run commands on a remote machine
 *  b) Make a connection to system bus on remote machine
 *
 * GDBusConnection is pretty brittle when it comes to sending credentials.
 * It only uses the EXTERNAL mechanism if the connection is a unix socket.
 *
 * We don't care about unix socket credentials whihle testing, since we run on
 * a modern OS. If we connect via ssh and then into the unix socket on the other
 * end, the dbus-daemon will be able to get the unix credentials of our sshd
 * subprocess whether we send them or not.
 *
 * In addition we need to send an EXTERNAL auth command with the uid of the
 * user on the remote system that we're connecting to. This stuff is locked
 * away inside of GDBusAuth. Anyway, we reimplement simple dbus EXTERNAL
 * authentication here because of these things.
 *
 * So that all these ssh connections proceed without hiccups, we use a
 * SSH ControlMaster connection, and have the other ssh commands initiate
 * channels over that one.
 */

/* Global setup by testing_target_init() */
const gchar *testing_target_name = NULL;
const gint testing_timeout = 10;
static GPid control_master_pid = 0;
static gchar control_path_arg[256];
static const gchar *control_path_prefix = "ControlPath=";
static const gint control_path_prefix_len = 12;
static uid_t remote_target_uid = -1;

static GDBusConnection *testing_bus = NULL;

static void
on_child_setup_lifetime (gpointer user_data)
{
  /*
   * We want lifetime of our child process limited to the parent. So
   * this function is run after the fork() but before exec() for
   * each child.
   */
  prctl (PR_SET_PDEATHSIG, SIGHUP);
}

static void
control_master_stop (void)
{
  GError *error = NULL;
  gint exit_status;
  gchar *err_output;
  gchar *cmd;

  /*
   * This tells the control master (listening at control_path_arg) to quit
   * The '-O exit' is documented in ssh(1) or ssh_config(5).
   */

  const gchar *args[] = {
      "ssh",
      "-o", control_path_arg,
      "-O", "exit",
      testing_target_name,
      NULL,
  };

  /* Just do local */
  if (testing_target_name == NULL)
    return;

  if (g_test_verbose ())
    {
      cmd = g_strjoinv (" ", (gchar **)args);
      g_printerr ("Stop master: %s\n", cmd);
      g_free (cmd);
    }

  g_spawn_sync (NULL, (gchar **)args, NULL, G_SPAWN_SEARCH_PATH,
                NULL, NULL, NULL, &err_output, &exit_status, &error);
  g_assert_no_error (error);

  if (exit_status != 0)
    g_printerr ("%s", err_output);
  g_assert_cmpint (exit_status, ==, 0);

  waitpid (control_master_pid, NULL, 0);
}

static void
testing_target_cleanup (void)
{
  /*
   * Run from atexit(), because we can't be bothered to do this in
   * each test main() function.
   */

  g_clear_object (&testing_bus);
  control_master_stop ();
  g_unlink (control_path_arg + control_path_prefix_len);
}

static gboolean
write_all (int fd,
           const gchar *data,
           gsize len)
{
  gssize ret;

  while (len != 0)
    {
      ret = write (fd, data, len);
      if (ret < 0)
        {
          if (errno != EAGAIN && errno != EINTR)
            {
              g_critical ("couldn't write out: %s", g_strerror (errno));
              return FALSE;
            }
        }
      else
        {
          data += ret;
          len -= ret;
        }
    }

  return TRUE;
}

static gpointer
drain_thread (gpointer data)
{
  gint fd = GPOINTER_TO_INT (data);
  gchar buf[256];
  const gchar *env;
  gssize ret;
  gboolean echo;

  env = g_getenv ("G_MESSAGES_DEBUG");
  echo = (env && strstr (env, "all"));

  for (;;)
    {
      ret = read (fd, buf, sizeof (buf));
      if (ret < 0)
        {
          if (errno != EAGAIN)
            {
              g_critical ("couldn't splice: %s", g_strerror (errno));
              break;
            }
        }
      else if (ret == 0)
        {
          break;
        }
      else if (ret > 0)
        {
          if (echo)
            {
              if (!write_all (1, buf, ret))
                break;
            }
        }
    }

  close (fd);
  return NULL;
}

static gboolean
read_until_end_or_matches (int fd,
                           const gchar *pattern,
                           GString *data)
{
  GPatternSpec *spec = NULL;
  GString *input = NULL;
  gboolean rval = FALSE;
  const gchar *env;
  gboolean echo;
  gsize len;
  gssize ret;

  if (pattern)
    spec = g_pattern_spec_new (pattern);
  if (!data)
    input = data = g_string_new ("");

  env = g_getenv ("G_MESSAGES_DEBUG");
  echo = (env && strstr (env, "all"));

  for (;;)
    {
      len = data->len;
      g_string_set_size (data, len + 256);
      ret = read (fd, data->str + len, 256);
      if (ret < 0)
        {
          if (errno != EAGAIN)
            {
              g_critical ("couldn't read: %s", g_strerror (errno));
              break;
            }
        }
      else if (ret == 0)
        {
          data->len = len;
          rval = (spec == NULL);
          break;
        }
      else if (ret > 0)
        {
          if (echo)
            write_all (1, data->str + len, ret);

          data->len = len + ret;
          data->str[data->len] = '\0';

          if (spec && g_pattern_match (spec, data->len, data->str, NULL))
            {
              rval = TRUE;
              break;
            }
        }
    }

  if (input)
    g_string_free (input, TRUE);
  if (spec)
    g_pattern_spec_free (spec);
  return rval;
}

static void
control_master_start (void)
{
  GError *error = NULL;
  GString *userid;
  gchar *endptr;
  gint tempfd;
  gint outfd;
  gint64 uid;

  /*
   * Here we start the control master. It needs a command to run, so the
   * simplest one is 'true', but because that command quits right away,
   * we use ControlPersist=yes to keep the master around until we stop
   * it with an '-O exit' command (above).
   */

  const gchar *args[] = {
      "ssh", "-T",
      "-o", "ControlMaster=yes",
      "-o", control_path_arg,
      "-o", "ControlPersist=yes",
      testing_target_name,
      "id", "--user",
      NULL,
  };

  /* Just do local */
  if (testing_target_name == NULL)
    return;

  /* Choose a unique path name */
  g_snprintf (control_path_arg, sizeof (control_path_arg),
              "%s%s/storaged-test-ctrl.XXXXXX",
              control_path_prefix, g_get_user_runtime_dir ());
  tempfd = g_mkstemp (control_path_arg + control_path_prefix_len);
  if (tempfd < 0)
    {
      g_error ("Couldn't open temp path at: %s: %s", control_path_arg, g_strerror (errno));
    }
  else
    {
      close (tempfd);
      g_unlink (control_path_arg + control_path_prefix_len);
    }

  /* And run the ssh control master */
  g_spawn_async_with_pipes (NULL, (gchar **)args, NULL,
                            G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                            on_child_setup_lifetime, NULL, &control_master_pid,
                            NULL, &outfd, NULL, &error);
  if (error)
    {
      gchar *cmd = g_strjoinv (" ", (gchar **)args);
      g_prefix_error (&error, "Couldn't run: %s: ", cmd);
      g_free (cmd);
      g_assert_no_error (error);
    }

  /* Read the stdout of the id command */
  userid = g_string_new ("");
  if (!read_until_end_or_matches (outfd, NULL, userid))
    g_assert_not_reached ();
  close (outfd);

  /* Parse the output into a uid */
  g_strstrip (userid->str);
  uid = g_ascii_strtoull (userid->str, &endptr, 10);
  if (!endptr || *endptr != '\0' || uid > G_MAXUINT)
      g_critical ("invalid user id printed by id command: %s", userid->str);

  remote_target_uid = (uid_t) uid;
  g_string_free (userid, TRUE);
}

gboolean
testing_target_init (void)
{
  testing_target_name = g_getenv ("TEST_TARGET");

  if (!testing_target_name || !testing_target_name[0])
    {
      g_printerr ("%s: skipping tests due to lack of $TEST_TARGET\n", g_get_prgname ());
      return FALSE;
    }

  if (g_str_equal (testing_target_name, "abuse-my-build-computer"))
    {
      testing_target_name = NULL;
      if (g_test_verbose ())
        g_printerr ("%s: abusing local computer, as desired\n", g_get_prgname ());
    }
  else
    {
      control_master_start ();
    }

  atexit (testing_target_cleanup);
  return TRUE;
}

GDBusConnection *
testing_target_connect (void)
{
  const gchar *bus_path = "/var/run/dbus/system_bus_socket";
  GDBusConnection *connection;
  GInputStream *input;
  GOutputStream *output;
  GIOStream *iostream;
  GError *error = NULL;
  GString *req;
  GString *resp;
  gint infd;
  gint outfd;
  gchar *user;
  gchar *p;

  const gchar *args[] = {
      "ssh", "-T",
      "-o", "ControlMaster=no",
      "-o", control_path_arg,
      testing_target_name,
      "nc", "-U", bus_path,
      NULL,
  };

  /* Just do local */
  if (testing_target_name == NULL)
    {
      connection = g_bus_get_sync (G_BUS_TYPE_SYSTEM, NULL, &error);
      if (error != NULL)
        {
          g_critical ("Couldn't get local system bus: %s", error->message);
          g_clear_error (&error);
        }
      return connection;
    }

  if (testing_bus)
    return g_object_ref (testing_bus);

  g_spawn_async_with_pipes (NULL, (gchar **)args, NULL,
                            G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                            on_child_setup_lifetime, NULL, NULL,
                            &infd, &outfd, NULL, &error);

  if (error)
    {
      gchar *cmd = g_strjoinv (" ", (gchar **)args);
      g_prefix_error (&error, "Couldn't run: %s: ", cmd);
      g_free (cmd);
      g_assert_no_error (error);
    }

  output = g_unix_output_stream_new (infd, TRUE);

  /*
   * GDBusConnection is really brittle in it's authentication, so
   * do it here. We don't send credentials, because they wouldn't get to
   * the other machine anyway, but assume that we're on Linux where
   * credentials can be read without being sent.
   */

  req = g_string_new ("");
  g_string_append_c (req, '\0');
  g_string_append (req, "AUTH EXTERNAL ");
  user = g_strdup_printf ("%d", (gint)remote_target_uid);
  for (p = user; *p != '\0'; p++)
    g_string_append_printf (req, "%02x", (gint)*p);
  g_free (user);
  g_string_append (req, "\r\n");
  g_output_stream_write_all (output, req->str, req->len, NULL, NULL, &error);
  g_assert_no_error (error);
  g_string_free (req, TRUE);

  /*
   * The newline should be the last character of a write from the daemon,
   * so this is safe enough for testing
   */
  resp = g_string_new ("");
  if (!read_until_end_or_matches (outfd, "*\n", resp))
    g_assert_not_reached ();
  g_strstrip (resp->str);
  if (!g_str_has_prefix (resp->str, "OK "))
      g_critical ("Unexpected response to AUTH EXTERNAL command: %s", resp->str);
  g_string_erase (resp, 0, 3);

  g_output_stream_write_all (output, "BEGIN\r\n", 7, NULL, NULL, &error);
  g_assert_no_error (error);

  input = g_unix_input_stream_new (outfd, TRUE);
  iostream = testing_io_stream_new (input, output);

  connection = g_dbus_connection_new_sync (iostream, resp->str,
                                           G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION,
                                           NULL, NULL, &error);
  g_assert_no_error (error);

  g_string_free (resp, TRUE);
  g_object_unref (input);
  g_object_unref (output);
  g_object_unref (iostream);

  testing_bus = connection;
  g_object_add_weak_pointer (G_OBJECT (connection), (gpointer *)&testing_bus);

  return connection;
}

static GPtrArray *
prepare_target_command (const gchar *prog,
                        va_list va)
{
  GPtrArray *array;
  gchar *cmd;
  gint i = 0;

  const gchar * argv[] = {
      "ssh", "-T",
      "-o", "ControlMaster=no",
      "-o", control_path_arg,
      testing_target_name,
      "--", NULL,
  };

  array = g_ptr_array_new ();

  /* Just do local */
  if (testing_target_name)
    {
      for (i = 0; argv[i] != NULL; i++)
        g_ptr_array_add (array, (gchar *)argv[i]);
    }

  while (prog != NULL)
    {
      g_ptr_array_add (array, (gchar *)prog);
      prog = va_arg (va, const gchar *);
    }

  g_ptr_array_add (array, NULL);

  if (g_test_verbose ())
    {
      cmd = g_strjoinv (" ", (gchar **)(array->pdata + i));
      g_printerr ("+ %s\n", cmd);
      g_free (cmd);
    }

  return array;
}

void
testing_target_execute (gchar **output,
                        const gchar *prog,
                        ...)
{
  GPtrArray *array;
  GError *error = NULL;
  gint exit_status;
  va_list va;

  va_start (va, prog);
  array = prepare_target_command (prog, va);
  va_end (va);

  if (!g_spawn_sync (NULL, (gchar **)array->pdata, NULL, G_SPAWN_SEARCH_PATH,
                     on_child_setup_lifetime, NULL, output, NULL,
                     &exit_status, &error)
      || !g_spawn_check_exit_status (exit_status, &error))
    {
      gchar *cmd = g_strjoinv (" ", (gchar **)array->pdata);
      g_prefix_error (&error, "Couldn't run: %s: ", cmd);
      g_free (cmd);
      g_assert_no_error (error);
    }

  g_assert_cmpint (exit_status, ==, 0);
}

typedef struct {
  GPid pid;
  GThread *drain;
  gint infd;
} Launched;

gpointer
testing_target_launch (const gchar *wait_until,
                       const gchar *prog,
                       ...)
{
  Launched *launched;
  GPtrArray *array;
  GError *error = NULL;
  gint outfd;
  va_list va;

  va_start (va, prog);
  array = prepare_target_command (prog, va);
  va_end (va);

  launched = g_new0 (Launched, 1);

  g_spawn_async_with_pipes (NULL, (gchar **)array->pdata, NULL,
                            G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD,
                            on_child_setup_lifetime, NULL, &launched->pid,
                            &launched->infd, &outfd, NULL, &error);

  g_assert_no_error (error);
  g_ptr_array_free (array, TRUE);

  /*
   * Wait until the output matches the pattern spec, and then since we grabbed
   * the output, need to continue to splice it so it doesn't jam up
   */

  if (wait_until)
    read_until_end_or_matches (outfd, wait_until, NULL);

  launched->drain = g_thread_new ("drain-thread", drain_thread, GINT_TO_POINTER (outfd));

  return launched;
}

gint
testing_target_wait (gpointer launch)
{
  Launched *launched = launch;
  gint exit_status;

  g_warn_if_fail (close (launched->infd) >= 0);
  g_thread_join (launched->drain);
  g_warn_if_fail (waitpid (launched->pid, &exit_status, 0) >= 0);

  g_free (launched);
  return exit_status;
}

static void
unbreak_object_manager_added (GDBusObjectManager *udisks_object_manager,
                              GDBusObject *object,
                              gpointer user_data)
{
  GList *interfaces, *l;

  /* Yes, GDBusObjectManager really is this awkward */
  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = g_list_next (l))
    g_signal_emit_by_name (udisks_object_manager, "interface-added", object, l->data);
  g_list_free_full (interfaces, g_object_unref);
}

static void
unbreak_object_manager_removed (GDBusObjectManager *udisks_object_manager,
                                GDBusObject *object,
                                gpointer user_data)
{
  GList *interfaces, *l;

  /* Yes, GDBusObjectManager really is this awkward */
  interfaces = g_dbus_object_get_interfaces (object);
  for (l = interfaces; l != NULL; l = g_list_next (l))
    g_signal_emit_by_name (udisks_object_manager, "interface-removed", object, l->data);
  g_list_free_full (interfaces, g_object_unref);
}

void
testing_target_setup (GDBusConnection **connection,
                      GDBusObjectManager **objman,
                      gpointer *daemon)
{
  GError *error = NULL;

  *connection = testing_target_connect ();

  if (testing_target_name)
    {
      *daemon = testing_target_launch ("*Acquired*on the system message bus*",
                                       BUILDDIR "/src/storaged",
                                       "--resource-dir=" BUILDDIR "/src",
                                       "--replace", "--debug",
                                       NULL);
    }

  *objman = g_dbus_object_manager_client_new_sync (*connection,
                                                   G_DBUS_OBJECT_MANAGER_CLIENT_FLAGS_DO_NOT_AUTO_START,
                                                   "com.redhat.Cockpit.LVM",
                                                   "/org/freedesktop/UDisks2",
                                                   NULL, NULL, NULL, NULL, &error);
  g_assert_no_error (error);

  /* Groan */
  g_signal_connect (*objman, "object-added", G_CALLBACK (unbreak_object_manager_added), NULL);
  g_signal_connect (*objman, "object-removed", G_CALLBACK (unbreak_object_manager_removed), NULL);
}

gchar *
testing_target_vgname (void)
{
  gchar *vgdisplay;
  gchar *vgname;
  gint i;

  /*
   * Free up any unused devices, and make sure any remaining
   * vgs (or stragglers) get listed
   */

  testing_target_execute (&vgdisplay, "/bin/sh", "-c",
                          "losetup -D; pvscan --cache; vgdisplay --short; ls /dev",
                          NULL);

  /* Choose a volume group name that doesn't exist in listed */
  for (i = 0; i < 512; i++)
    {
      vgname = g_strdup_printf ("test-storaged-%d", i);
      if (!strstr (vgdisplay, vgname))
        break;
      g_free (vgname);
      vgname = NULL;
    }

  g_free (vgdisplay);
  g_assert (vgname != NULL);

  return vgname;
}

typedef struct {
  const gchar *interface;
  const gchar *name;
  GDBusProxy **location;
  gulong sig;
} WantProxy;

static void
on_proxy_added (GDBusObjectManager *objman,
                GDBusObject *make_it_stop,
                GDBusInterface *interface,
                gpointer user_data)
{
  WantProxy *want = user_data;
  GDBusProxy *proxy = G_DBUS_PROXY (interface);

  if (g_str_equal (g_dbus_proxy_get_interface_name (proxy), want->interface) &&
      (!want->name || g_strcmp0 (testing_proxy_string (proxy, "Name"), want->name) == 0))
    {
      g_assert (*want->location == NULL);
      *want->location = g_object_ref (proxy);
      g_signal_handler_disconnect (objman, want->sig);
      g_free (want);
    }
}

void
testing_want_added (GDBusObjectManager *objman,
                    const gchar *interface,
                    const gchar *name,
                    GDBusProxy **location)
{
  WantProxy *want;

  g_assert (location != NULL);
  g_assert (*location == NULL);

  want = g_new (WantProxy, 1);
  want->interface = interface;
  want->name = name;
  want->location = location;
  want->sig = g_signal_connect (objman, "interface-added", G_CALLBACK (on_proxy_added), want);
}

static void
on_proxy_removed (GDBusObjectManager *objman,
                  GDBusObject *make_it_stop,
                  GDBusInterface *interface,
                  gpointer user_data)
{
  WantProxy *want = user_data;
  if (*want->location == G_DBUS_PROXY (interface))
    {
      g_clear_object (want->location);
      g_signal_handler_disconnect (objman, want->sig);
      g_free (want);
    }
}

void
testing_want_removed (GDBusObjectManager *objman,
                      GDBusProxy **proxy)
{
  WantProxy *want;

  g_assert (proxy != NULL);
  g_assert (G_IS_DBUS_PROXY (*proxy));

  want = g_new (WantProxy, 1);
  want->location = proxy;
  want->sig = g_signal_connect (objman, "interface-removed", G_CALLBACK (on_proxy_removed), want);
}

void
testing_target_teardown (GDBusConnection **connection,
                         GDBusObjectManager **objman,
                         gpointer *daemon)
{
  GError *error = NULL;
  gint status;

  g_clear_object (objman);

  g_dbus_connection_flush_sync (*connection, NULL, &error);
  g_assert_no_error (error);
  g_clear_object (connection);

  if (testing_target_name)
    {
      status = testing_target_wait (*daemon);
      g_assert_cmpint (status, ==, 0);
      *daemon = NULL;
    }

  testing_target_execute (NULL, "losetup", "-D", NULL);
}

void
testing_assertion_message (const gchar *log_domain,
                           const gchar *file,
                           gint line,
                           const gchar *func,
                           const gchar *format,
                           ...)
{
  gchar *message;
  va_list va;

  va_start (va, format);
  message = g_strdup_vprintf (format, va);
  va_end (va);

  g_assertion_message (log_domain, file, line, func, message);
  g_free (message);
}

gboolean
testing_callback_set_flag (gpointer user_data)
{
  gboolean *flag = user_data;
  *flag = TRUE;
  return FALSE;
}

const gchar *
testing_proxy_string (GDBusProxy *proxy,
                      const gchar *property)
{
  GVariant *value;
  const gchar *ret = NULL;

  value = g_dbus_proxy_get_cached_property (proxy, property);
  if (value)
    {
      ret = g_variant_get_string (value, NULL);
      g_variant_unref (value);
    }

  return ret;
}


struct _TestingIOStream {
  GIOStream parent;
  GInputStream *input_stream;
  GOutputStream *output_stream;
};

typedef struct _GIOStreamClass TestingIOStreamClass;

G_DEFINE_TYPE (TestingIOStream, testing_io_stream, G_TYPE_IO_STREAM)

static void
testing_io_stream_finalize (GObject *object)
{
  TestingIOStream *stream = TESTING_IO_STREAM (object);

  /* strictly speaking we should unref these in dispose, but
   * g_io_stream_dispose() wants them to still exist
   */
  g_clear_object (&stream->input_stream);
  g_clear_object (&stream->output_stream);

  G_OBJECT_CLASS (testing_io_stream_parent_class)->finalize (object);
}

static void
testing_io_stream_init (TestingIOStream *stream)
{
}

static GInputStream *
testing_io_stream_get_input_stream (GIOStream *_stream)
{
  TestingIOStream *stream = TESTING_IO_STREAM (_stream);

  return stream->input_stream;
}

static GOutputStream *
testing_io_stream_get_output_stream (GIOStream *_stream)
{
  TestingIOStream *stream = TESTING_IO_STREAM (_stream);

  return stream->output_stream;
}

static void
testing_io_stream_class_init (TestingIOStreamClass *klass)
{
  GObjectClass *gobject_class;
  GIOStreamClass *giostream_class;

  gobject_class = G_OBJECT_CLASS (klass);
  gobject_class->finalize = testing_io_stream_finalize;

  giostream_class = G_IO_STREAM_CLASS (klass);
  giostream_class->get_input_stream  = testing_io_stream_get_input_stream;
  giostream_class->get_output_stream = testing_io_stream_get_output_stream;
}

GIOStream *
testing_io_stream_new (GInputStream  *input_stream,
                       GOutputStream *output_stream)
{
  TestingIOStream *stream;

  g_return_val_if_fail (G_IS_INPUT_STREAM (input_stream), NULL);
  g_return_val_if_fail (G_IS_OUTPUT_STREAM (output_stream), NULL);
  stream = TESTING_IO_STREAM (g_object_new (TESTING_TYPE_IO_STREAM, NULL));
  stream->input_stream = g_object_ref (input_stream);
  stream->output_stream = g_object_ref (output_stream);
  return G_IO_STREAM (stream);
}
