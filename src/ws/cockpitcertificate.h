/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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
#include <gio/gio.h>

#ifndef __COCKPIT_CERTIFICATE_H__
#define __COCKPIT_CERTIFICATE_H__

G_BEGIN_DECLS

gchar *             cockpit_certificate_locate   (gboolean create_if_necessary,
                                                  GError **error);

GTlsCertificate *   cockpit_certificate_load     (const gchar *path,
                                                  GError **error);

G_END_DECLS

#endif /* __COCKPIT_CERTIFICATE_H__ */
