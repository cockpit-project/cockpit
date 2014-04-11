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

#include <glib.h>

#ifndef __COCKPIT_TEST_H__
#define __COCKPIT_TEST_H__

G_BEGIN_DECLS

void     cockpit_test_init                  (int *argc,
                                             char ***argv);

void     _cockpit_expect_logged_msg         (const char *domain,
                                             const char *file,
                                             int line,
                                             const char *func,
                                             GLogLevelFlags log_level,
                                             const gchar *pattern);

#define cockpit_expect_log(domain, level, pattern) \
  (_cockpit_expect_logged_msg ((domain), __FILE__, __LINE__, G_STRFUNC, (level), (pattern)))

#define cockpit_expect_warning(pattern) \
  (_cockpit_expect_logged_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, G_LOG_LEVEL_WARNING, (pattern)))

#define cockpit_expect_critical(pattern) \
  (_cockpit_expect_logged_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, G_LOG_LEVEL_CRITICAL, (pattern)))

#define cockpit_expect_message(pattern) \
  (_cockpit_expect_logged_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, G_LOG_LEVEL_MESSAGE, (pattern)))

#define cockpit_expect_info(pattern) \
  (_cockpit_expect_logged_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, G_LOG_LEVEL_INFO, (pattern)))

void     cockpit_assert_expected            (void);

void     _cockpit_assert_strmatch_msg       (const char *domain,
                                             const char *file,
                                             int line,
                                             const char *func,
                                             const gchar *string,
                                             const gchar *pattern);

#define cockpit_assert_strmatch(str, pattern) \
  (_cockpit_assert_strmatch_msg (G_LOG_DOMAIN, __FILE__, __LINE__, G_STRFUNC, (str), (pattern)))

G_END_DECLS

#endif /* __COCKPIT_TEST_H__ */
