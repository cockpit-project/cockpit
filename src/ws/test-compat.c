/*
 * Copyright (c) 2014 Red Hat Inc.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 *     * Redistributions of source code must retain the above
 *       copyright notice, this list of conditions and the
 *       following disclaimer.
 *     * Redistributions in binary form must reproduce the
 *       above copyright notice, this list of conditions and
 *       the following disclaimer in the documentation and/or
 *       other materials provided with the distribution.
 *     * The names of contributors to this software may not be
 *       used to endorse or promote products derived from this
 *       software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
 * "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
 * LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
 * FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
 * BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS
 * OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED
 * AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
 * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF
 * THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH
 * DAMAGE.
 *
 * Author: Stef Walter <stefw@redhat.com>
 */

#define _GNU_SOURCE

#include "cockpitcompat.h"

#include "common/cockpitauthorize.h"
#include "common/cockpittest.h"

#include <sys/types.h>
#include <sys/wait.h>

#include <err.h>
#include <errno.h>
#include <pwd.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

typedef struct {
  const char *input;
  const char *password;
  const char *expected;
  int errn;
} CryptFixture;

static CryptFixture crypt1_fixtures[] = {
  { "crypt1:invalid", "password", NULL, EINVAL },
  { "crypt1:invalid:$1$0123456789abcdef$", "password", NULL, EINVAL },
  { "crypt1:invalid:$1$invalid:$1$invalid", "password", NULL, EINVAL },
  { "crypt1:invalid:1$0123456789abcdef$:$1$0123456789abcdef$", "password", NULL, EINVAL },
  { "crypt1:invalid:$10123456789abcdef:$1$0123456789abcdef$", "password", NULL, EINVAL },
  { "crypt1:73637275666679:$1$0123456789abcdef$:$1$0123456789abcdef$",
    "password", "crypt1:$1$01234567$mmR7jVZhYpBJ6s6uTlnIR0", 0 },
  { NULL },
};

static void
test_crypt1 (gconstpointer data)
{
  const CryptFixture *fix = data;
  char *response;

  if (fix->errn != 0)
    cockpit_expect_message ("*\"authorize\" message*");

  response = cockpit_compat_reply_crypt1 (fix->input, fix->password);
  g_assert_cmpstr (response, ==, fix->expected);
  if (fix->errn != 0)
    g_assert_cmpint (errno, ==, fix->errn);
  free (response);

  cockpit_assert_expected ();
}

static void
test_logger (const char *msg)
{
  g_assert (msg != NULL);
  g_message ("%s", msg);
}

int
main (int argc,
      char *argv[])
{
  gchar *name;
  gint i;

  cockpit_test_init (&argc, &argv);
  cockpit_authorize_logger (test_logger, 0);

  for (i = 0; crypt1_fixtures[i].input != NULL; i++)
    {
      name = g_strdup_printf ("/compat/crypt1/%s", crypt1_fixtures[i].input);
      g_test_add_data_func (name, crypt1_fixtures + i, test_crypt1);
      g_free (name);
    }

  return g_test_run ();
}
