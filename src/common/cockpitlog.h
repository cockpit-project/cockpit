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

#ifndef __COCKPIT_LOG_H__
#define __COCKPIT_LOG_H__

G_BEGIN_DECLS

void     cockpit_null_log_handler       (const gchar *log_domain,
                                         GLogLevelFlags log_level,
                                         const gchar *message,
                                         gpointer user_data);

void     cockpit_journal_log_handler    (const gchar *log_domain,
                                         GLogLevelFlags log_level,
                                         const gchar *message,
                                         gpointer user_data);

void     cockpit_set_journal_logging    (const gchar *stderr_domain,
                                         gboolean only);

/*
 * GLib doesn't have g_info() yet:
 * https://bugzilla.gnome.org/show_bug.cgi?id=711103
 */
#ifndef g_info

#if defined(G_HAVE_ISO_VARARGS)

#define g_info(...)     g_log (G_LOG_DOMAIN,         \
                               G_LOG_LEVEL_INFO,     \
                               __VA_ARGS__)

#elif defined (G_HAVE_GNUC_VARARGS)

#define g_info(format...)       g_log (G_LOG_DOMAIN,         \
                                       G_LOG_LEVEL_INFO,     \
                                       format)

#else

static void
g_info (const gchar *format,
        ...)
{
  va_list args;
  va_start (args, format);
  g_logv (G_LOG_DOMAIN, G_LOG_LEVEL_INFO, format, args);
  va_end (args);
}

#endif /* no varargs */

#endif /* g_info */

G_END_DECLS

#endif /* __COCKPIT_LOG_H__ */
