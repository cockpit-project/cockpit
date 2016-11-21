/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#ifndef __COCKPIT_LOCALE_H__
#define __COCKPIT_LOCALE_H__

#include <glib.h>

G_BEGIN_DECLS

gchar *               cockpit_locale_from_language       (const gchar *language,
                                                          const gchar *encoding,
                                                          gchar **shorter);

void                  cockpit_locale_set_language        (const gchar *language);

G_END_DECLS

#endif /* __COCKPIT_LOCALE_H__ */
