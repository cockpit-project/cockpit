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

#ifndef COCKPIT_CONF_H__
#define COCKPIT_CONF_H__

#include <glib.h>

G_BEGIN_DECLS

const gchar *   cockpit_conf_string           (const gchar *section,
                                               const gchar *field);


const gchar **  cockpit_conf_strv             (const gchar *section,
                                               const gchar *field,
                                               gchar delimiter);

gboolean        cockpit_conf_bool             (const gchar *section,
                                               const gchar *field,
                                               gboolean defawlt);

guint           cockpit_conf_guint            (const gchar *section,
                                               const gchar *field,
                                               guint default_value,
                                               guint64 max,
                                               guint64 min);

const gchar * const * cockpit_conf_get_dirs   (void);

void            cockpit_conf_cleanup          (void);

void            cockpit_conf_init             (void);

#endif /* COCKPIT_CONF_H__ */
