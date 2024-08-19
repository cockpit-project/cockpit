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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_PATHS_H
#define COCKPIT_PATHS_H

#include <glib.h>

/*
 * These paths operate on normalized paths. Nothing relative, no
 * .. or anything like that. Each path must start with '/' and the
 * only path that can end with '/' is the root path.
 */

gboolean       cockpit_path_has_ancestor           (const gchar *path,
                                                    const gchar *ancestor);

gboolean       cockpit_path_has_parent             (const gchar *path,
                                                    const gchar *parent);

gboolean       cockpit_path_equal_or_ancestor      (const gchar *path,
                                                    const gchar *ancestor);

GTree *        cockpit_paths_new                   (void);

const gchar *  cockpit_paths_add                   (GTree *paths,
                                                    const gchar *path);

gboolean       cockpit_paths_remove                (GTree *paths,
                                                    const gchar *path);

const gchar *  cockpit_paths_contain               (GTree *paths,
                                                    const gchar *path);

/* path is in paths or a descendant of path is in paths */
gboolean       cockpit_paths_contain_or_descendant (GTree *paths,
                                                    const gchar *path);

/* path is in paths or an ancestor of path is in paths */
const gchar *  cockpit_paths_contain_or_ancestor   (GTree *paths,
                                                    const gchar *path);

#endif /* COCKPIT_PATHS_H */
