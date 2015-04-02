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

#ifndef __TESTING_IO_STREAM_H__
#define __TESTING_IO_STREAM_H__

#include <gio/gio.h>

#include <string.h>

extern const gchar * testing_target_name;

extern const gint testing_timeout;

gboolean             testing_target_init            (void);

GDBusConnection *    testing_target_connect         (void);

void                 testing_target_execute         (gchar **output,
                                                     const gchar *prog,
                                                     ...) G_GNUC_NULL_TERMINATED;

gpointer             testing_target_launch          (const gchar *wait_until,
                                                     const gchar *prog,
                                                     ...) G_GNUC_NULL_TERMINATED;

gint                 testing_target_wait            (gpointer launched);

void                 testing_target_setup           (GDBusConnection **connection,
                                                     GDBusObjectManager **objman,
                                                     gpointer *daemon);

void                 testing_target_teardown        (GDBusConnection **connection,
                                                     GDBusObjectManager **objman,
                                                     gpointer *daemon);

gchar *              testing_target_vgname          (void);

#define TESTING_TYPE_IO_STREAM    (testing_io_stream_get_type ())
#define TESTING_IO_STREAM(o)      (G_TYPE_CHECK_INSTANCE_CAST ((o), TESTING_TYPE_IO_STREAM, TestingIOStream))
#define TESTING_IS_IO_STREAM(o)   (G_TYPE_CHECK_INSTANCE_TYPE ((o), TESTING_TYPE_IO_STREAM))

typedef struct _TestingIOStream TestingIOStream;

GType            testing_io_stream_get_type       (void);

GIOStream *      testing_io_stream_new            (GInputStream *input,
                                                   GOutputStream *output);

#ifndef g_assert_str_contains
#define g_assert_str_contains(s1, s2) G_STMT_START { \
  const char *__s1 = (s1), *__s2 = (s2); \
  if (strstr (__s1, __s2) != NULL) ; else \
    testing_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, \
                               "assertion failed (%s): (\"%s\", \"%s\")", \
                               #s1 " does not contain " #s2, __s1, __s2); \
} G_STMT_END
#endif

#ifndef g_assert_str_matches
#define g_assert_str_matches(s1, s2) G_STMT_START { \
  const char *__s1 = (s1), *__s2 = (s2); \
  if (g_pattern_match_simple (__s2, __s1)) ; else \
    testing_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, \
                               "assertion failed (%s): (\"%s\", \"%s\")", \
                               #s1 " does not match " #s2, __s1, __s2); \
  } G_STMT_END
#endif

#ifndef g_assert_str_prefix
#define g_assert_str_prefix(s1, s2) G_STMT_START { \
  const char *__s1 = (s1), *__s2 = (s2); \
  if (g_str_has_prefix (__s1, __s2)) ; else \
    testing_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, \
                               "assertion failed (%s): (\"%s\", \"%s\")", \
                               #s1 " does not have prefix " #s2, __s1, __s2); \
  } G_STMT_END
#endif

void             testing_assertion_message        (const gchar *log_domain,
                                                   const gchar *file,
                                                   gint line,
                                                   const gchar *func,
                                                   const gchar *format,
                                                   ...) G_GNUC_PRINTF (5, 6);

gboolean         testing_callback_set_flag        (gpointer user_data);

#define testing_wait_until(cond) G_STMT_START { \
  GSource *__source = g_timeout_source_new_seconds (testing_timeout); \
  gboolean __timeout = FALSE; \
  g_source_set_callback (__source, testing_callback_set_flag, &__timeout, NULL); \
  g_source_attach (__source, NULL); \
  while (!(cond) && !__timeout) \
    g_main_context_iteration (NULL, TRUE); \
  g_source_destroy (__source); \
  g_source_unref (__source); \
  if (__timeout) \
    { \
      testing_assertion_message (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, \
                                 "condition failed: (%s)", #cond); \
    } \
} G_STMT_END

#define testing_wait_idle() \
  do { } while (g_main_context_iteration (NULL, FALSE))

const gchar *    testing_proxy_string             (GDBusProxy *proxy,
                                                   const gchar *property);

void             testing_want_added               (GDBusObjectManager *objman,
                                                   const gchar *interface,
                                                   const gchar *name,
                                                   GDBusProxy **location);

void             testing_want_removed             (GDBusObjectManager *objman,
                                                   GDBusProxy **proxy);

#endif /* __TESTING_IO_STREAM_H__ */
