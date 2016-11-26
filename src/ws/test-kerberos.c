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

#include "cockpitauth.h"
#include "cockpitws.h"

#include "common/cockpittest.h"
#include "common/cockpitwebserver.h"

#include <krb5/krb5.h>
#include <gssapi/gssapi_krb5.h>

#include <sys/prctl.h>
#include <sys/types.h>
#include <sys/wait.h>

#include <errno.h>
#include <stdlib.h>
#include <string.h>

static gboolean mock_kdc_available;

static void   mock_kdc_up     (void);

static void   mock_kdc_down   (void);

typedef struct {
    CockpitAuth *auth;
    krb5_context krb;
    krb5_ccache ccache;
    char *ccache_name;
} TestCase;

static void
setup (TestCase *test,
       gconstpointer data)
{
  krb5_get_init_creds_opt *opt;
  krb5_principal principal;
  krb5_error_code code;
  krb5_creds creds;
  OM_uint32 status;
  OM_uint32 minor;
  gchar *name;

  if (!mock_kdc_available)
    return;

  test->auth = cockpit_auth_new (FALSE);

  mock_kdc_up ();

  code = krb5_init_context (&test->krb);
  g_assert (code != ENOMEM);
  if (code != 0)
    {
      g_critical ("couldn't create krb context: %s", krb5_get_error_message (NULL, code));
      return;
    }

  /* Initialize the client credential cache */
  if (krb5_cc_new_unique (test->krb, "MEMORY", NULL, &test->ccache) != 0)
    g_assert_not_reached ();

  name = g_strdup_printf ("%s@COCKPIT.MOCK", g_get_user_name ());

  /* Do a kerberos authentication */
  if (krb5_parse_name (test->krb, name, &principal))
    g_assert_not_reached ();
  if (krb5_get_init_creds_opt_alloc (test->krb, &opt))
    g_assert_not_reached ();
  if (krb5_get_init_creds_opt_set_out_ccache (test->krb, opt, test->ccache))
    g_assert_not_reached ();

  code = krb5_get_init_creds_password (test->krb, &creds, principal, "marmalade",
                                       NULL, NULL, 0, NULL, opt);

  krb5_free_principal (test->krb, principal);
  krb5_get_init_creds_opt_free (test->krb, opt);

  g_assert (code != ENOMEM);
  if (code != 0)
    {
      g_critical ("couldn't kinit for %s: %s", name, krb5_get_error_message (test->krb, code));
      return;
    }

  krb5_free_cred_contents (test->krb, &creds);
  g_free (name);

  if (krb5_cc_get_full_name (test->krb, test->ccache, &test->ccache_name) != 0)
    g_assert_not_reached ();

  /* Sets the credential cache GSSAPI to use (for this thread) */
  status = gss_krb5_ccache_name (&minor, test->ccache_name, NULL);
  g_assert_cmpint (status, ==, 0);
}

static void
teardown (TestCase *test,
          gconstpointer data)
{
  if (!mock_kdc_available)
    return;

  if (test->ccache)
    krb5_cc_close (test->krb, test->ccache);
  if (test->ccache_name)
    krb5_free_string (test->krb, test->ccache_name);
  if (test->krb)
    krb5_free_context (test->krb);

  mock_kdc_down ();

  g_clear_object (&test->auth);
}

static void
on_ready_get_result (GObject *source,
                     GAsyncResult *result,
                     gpointer user_data)
{
  GAsyncResult **retval = user_data;
  g_assert (retval != NULL);
  g_assert (*retval == NULL);
  *retval = g_object_ref (result);
}

static void
assert_gss_status_msg (const gchar *domain,
                       const gchar *file,
                       gint line,
                       const gchar *func,
                       const gchar *expr,
                       const gchar *cmp,
                       OM_uint32 expected,
                       OM_uint32 major_status,
                       OM_uint32 minor_status)
{
   OM_uint32 major, minor;
   OM_uint32 ctx = 0;
   gss_buffer_desc status;
   gboolean had_minor;
   GString *result;

   result = g_string_new ("");
   g_string_printf (result, "assertion failed (%s): (%u %s %u)",
                    expr, (guint)expected, cmp, (guint)major_status);

   for (;;)
     {
       major = gss_display_status (&minor, major_status, GSS_C_GSS_CODE,
                                   GSS_C_NO_OID, &ctx, &status);
       if (GSS_ERROR (major))
         break;

       if (result->len > 0)
         g_string_append (result, ": ");

       g_string_append_len (result, status.value, status.length);
       gss_release_buffer (&minor, &status);

       if (!ctx)
         break;
     }

   ctx = 0;
   had_minor = FALSE;
   for (;;)
     {
       major = gss_display_status (&minor, minor_status, GSS_C_MECH_CODE,
                                   GSS_C_NULL_OID, &ctx, &status);
       if (GSS_ERROR (major))
         break;

       if (status.length)
         {
           if (!had_minor)
             g_string_append (result, " (");
           else
             g_string_append (result, ", ");
           had_minor = TRUE;
           g_string_append_len (result, status.value, status.length);
         }

       gss_release_buffer (&minor, &status);

       if (!ctx)
         break;
     }

   if (had_minor)
     g_string_append (result, ")");

   g_assertion_message (domain, file ,line, func, result->str);
   g_string_free (result, TRUE);
}

#define assert_gss_status(status, cmp, expect, minor) \
  do { OM_uint32 __st = (status); OM_uint32 __ex = (expect); \
       if (__st cmp __ex) ; else \
         assert_gss_status_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, \
                                #expect " " #cmp " " #status, #cmp, (__ex), (__st), (minor)); \
  } while (0);

static void
build_authorization_header (GHashTable *headers,
                            gss_buffer_desc *buffer)
{
  gchar *encoded;
  gchar *value;

  if (buffer->length)
    {
      encoded = g_base64_encode (buffer->value, buffer->length);
      value = g_strdup_printf ("Negotiate %s", encoded);
      g_free (encoded);
    }
  else
    {
      value = g_strdup ("Negotiate");
    }

  g_hash_table_replace (headers, g_strdup ("Authorization"), value);
}

static void
parse_authenticate_header (GHashTable *headers,
                           gss_buffer_desc *buffer)
{
  const gchar *value = NULL;
  GHashTableIter iter;
  gpointer k, v;

  g_hash_table_iter_init (&iter, headers);
  while (g_hash_table_iter_next (&iter, &k, &v))
    {
      if (g_ascii_strcasecmp (k, "WWW-Authenticate") == 0 &&
          g_ascii_strncasecmp (v, "Negotiate", 9) == 0)
        {
          value = (gchar *)v + 9;
          break;
        }
    }

  if (value)
    buffer->value = g_base64_decode (value, &buffer->length);
  else
    {
      buffer->value = NULL;
      buffer->length = 0;
    }
}

static void
include_cookie_as_if_client (GHashTable *resp_headers,
                             GHashTable *req_headers)
{
  gchar *cookie;
  gchar *end;

  cookie = g_strdup (g_hash_table_lookup (resp_headers, "Set-Cookie"));
  g_assert (cookie != NULL);
  end = strchr (cookie, ';');
  g_assert (end != NULL);
  end[0] = '\0';

  g_hash_table_insert (req_headers, g_strdup ("Cookie"), cookie);
}

static void
test_authenticate (TestCase *test,
                   gconstpointer data)
{
  GHashTable *in_headers;
  GHashTable *out_headers;
  GAsyncResult *result = NULL;
  gss_ctx_id_t ctx = GSS_C_NO_CONTEXT;
  OM_uint32 status;
  OM_uint32 minor;
  gss_buffer_desc input = GSS_C_EMPTY_BUFFER;
  gss_buffer_desc output = GSS_C_EMPTY_BUFFER;
  gss_name_t name = GSS_C_NO_NAME;
  OM_uint32 flags = 0;
  CockpitCreds *creds;
  CockpitWebService *service;
  JsonObject *response;
  GError *error = NULL;

  if (!mock_kdc_available)
    {
      cockpit_test_skip ("mock kdc not available to test against");
      return;
    }

  in_headers = cockpit_web_server_new_table ();
  out_headers = cockpit_web_server_new_table ();

  input.value = "host@localhost";
  input.length = strlen (input.value) + 1;
  status = gss_import_name (&minor, &input, GSS_C_NT_HOSTBASED_SERVICE, &name);
  assert_gss_status (status, ==, GSS_S_COMPLETE, minor);

  input.length = 0;
  status = gss_init_sec_context (&minor, GSS_C_NO_CREDENTIAL, &ctx, name, GSS_C_NO_OID,
                                 GSS_C_MUTUAL_FLAG, GSS_C_INDEFINITE, GSS_C_NO_CHANNEL_BINDINGS,
                                 &input, NULL, &output, &flags, NULL);
  assert_gss_status (status, ==, GSS_S_CONTINUE_NEEDED, minor);

  build_authorization_header (in_headers, &output);
  gss_release_buffer (&minor, &output);

  cockpit_auth_login_async (test->auth, "/cockpit+test", NULL, in_headers, on_ready_get_result, &result);
  g_hash_table_unref (in_headers);

  while (result == NULL)
    g_main_context_iteration (NULL, TRUE);

  response = cockpit_auth_login_finish (test->auth, result, NULL, out_headers, &error);
  g_object_unref (result);
  g_assert_no_error (error);
  g_assert (response != NULL);
  json_object_unref (response);

  parse_authenticate_header (out_headers, &input);
  memset (&output, 0, sizeof (output));

  status = gss_init_sec_context (&minor, GSS_C_NO_CREDENTIAL, &ctx, name, GSS_C_NO_OID,
                                 GSS_C_MUTUAL_FLAG, GSS_C_INDEFINITE, GSS_C_NO_CHANNEL_BINDINGS,
                                 &input, NULL, &output, &flags, NULL);
  assert_gss_status (status, ==, GSS_S_COMPLETE, minor);

  g_free (input.value);
  gss_release_buffer (&minor, &output);
  gss_release_name (&minor, &name);

  status = gss_delete_sec_context (&minor, &ctx, &output);
  assert_gss_status (status, ==, GSS_S_COMPLETE, minor);
  gss_release_buffer (&minor, &output);

  include_cookie_as_if_client (out_headers, out_headers);

  service = cockpit_auth_check_cookie (test->auth, "/cockpit+test", out_headers);
  g_assert (service != NULL);

  creds = cockpit_web_service_get_creds (service);
  g_assert_cmpstr (g_get_user_name (), ==, cockpit_creds_get_user (creds));
  g_assert_cmpstr ("cockpit+test", ==, cockpit_creds_get_application (creds));
  g_assert_cmpstr (NULL, ==, cockpit_creds_get_password (creds));

  g_hash_table_unref (out_headers);
  g_object_unref (service);
}

struct {
    GHashTable *environ;
    gboolean stopped;
    GPid pid;
} mock_kdc;

static void
on_kdc_child (GPid pid,
              gint status,
              gpointer user_data)
{
  GError *error = NULL;

  mock_kdc_available = FALSE;
  if (!mock_kdc.stopped)
    {
      g_spawn_check_exit_status (status, &error);
      g_assert_no_error (error);
      g_critical ("mock-kdc exited prematurely");
    }
}

static void
on_kdc_setup (gpointer user_data)
{
  /* Kill all sub processes when this process exits */
  if (prctl (PR_SET_PDEATHSIG, SIGTERM) < 0)
    g_critical ("prctl failed: %s", g_strerror (errno));

  /* Start a new session for this process */
  setsid ();
}

static void
mock_kdc_start (void)
{
  GString *input;
  GError *error = NULL;
  gint out_fd;
  gsize len;
  gssize ret;
  gchar **vars;
  gchar *pos;
  gint i;

  const gchar *argv[] = {
      SRCDIR "/src/ws/mock-kdc",
      NULL
  };

  mock_kdc_available = FALSE;

  g_spawn_async_with_pipes (BUILDDIR, (gchar **)argv, NULL, G_SPAWN_DO_NOT_REAP_CHILD,
                            on_kdc_setup, NULL, &mock_kdc.pid, NULL, &out_fd, NULL, &error);
  g_assert_no_error (error);

  g_child_watch_add (mock_kdc.pid, on_kdc_child, NULL);

  /*
   * mock-kdc prints environment vars on stdout, and then closes stdout
   * This also lets us know when it has initialized.
   */
  input = g_string_new ("");
  for (;;)
    {
      len = input->len;
      g_string_set_size (input, len + 256);
      ret = read (out_fd, input->str + len, 256);
      if (ret < 0)
        {
          if (errno != EAGAIN && errno != EINTR)
            g_error ("couldn't read from mock-kdc: %s", g_strerror (errno));
            break;
        }
      else
        {
          g_string_set_size (input, len + ret);
          if (strstr (input->str, "starting..."))
            {
              mock_kdc_available = TRUE;
              break;
            }
          else if (ret == 0)
            {
              break;
            }
        }
    }

  /* Parse into a table of environment variables */
  mock_kdc.environ = g_hash_table_new_full (g_str_hash, g_str_equal, g_free, NULL);
  vars = g_strsplit (input->str, "\n", -1);
  for (i = 0; vars[i] != NULL; i++)
    {
      pos = strchr (vars[i], '=');
      if (pos)
        {
          *pos = '\0';
          g_hash_table_replace (mock_kdc.environ, vars[i], pos + 1);
        }
      else
        {
          g_free (vars[i]);
        }
    }

  g_string_free (input, TRUE);
  g_free (vars);
}

static void
mock_kdc_up (void)
{
  GHashTableIter iter;
  const gchar *name;
  const gchar *value;
  g_hash_table_iter_init (&iter, mock_kdc.environ);
  while (g_hash_table_iter_next (&iter, (gpointer *)&name, (gpointer *)&value))
    g_setenv (name, value, TRUE);

  /* Explicitly tell server side of GSSAPI about our keytab */
  value = g_hash_table_lookup (mock_kdc.environ, "KRB5_KTNAME");
  if (value)
    g_setenv ("KRB5_KTNAME", value, TRUE);
}

static void
mock_kdc_down (void)
{
  GHashTableIter iter;
  const gchar *name;
  g_hash_table_iter_init (&iter, mock_kdc.environ);
  while (g_hash_table_iter_next (&iter, (gpointer *)&name, NULL))
    g_unsetenv (name);
}

static void
mock_kdc_stop (void)
{
  mock_kdc.stopped = TRUE;
  if (mock_kdc_available)
    {
      if (kill (-mock_kdc.pid, SIGTERM) < 0)
        g_error ("couldn't kill mock-kdc: %s", g_strerror (errno));
    }
  if (mock_kdc.environ)
    g_hash_table_destroy (mock_kdc.environ);
}

int
main (int argc,
      char *argv[])
{
  int ret;

  cockpit_ws_session_program = BUILDDIR "/cockpit-session";

  cockpit_test_init (&argc, &argv);

  /* Try to debug crashing during tests */
  signal (SIGABRT, cockpit_test_signal_backtrace);

  if (g_strcmp0 (g_get_user_name (), "root") != 0)
    mock_kdc_start ();

  g_test_add ("/kerberos/authenticate", TestCase, NULL,
              setup, test_authenticate, teardown);

  ret = g_test_run ();

  mock_kdc_stop ();

  return ret;
}
