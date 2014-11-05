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

#ifndef __COCKPIT_MEMORY_H__
#define __COCKPIT_MEMORY_H__

#include <glib.h>
#include <glib-object.h>

G_BEGIN_DECLS

void     cockpit_secclear                (gpointer data,
                                          gssize length);

#define DEFINE_CLEANUP_FUNCTION(Type, name, func) \
  static inline void name (void *v) \
  { \
    func (*(Type*)v); \
  }

#define DEFINE_CLEANUP_FUNCTION0(Type, name, func) \
  static inline void name (void *v) \
  { \
    if (*(Type*)v) \
      func (*(Type*)v); \
  }

/* These functions shouldn't be invoked directly;
 * they are stubs that:
 * 1) Take a pointer to the location (typically itself a pointer).
 * 2) Provide %NULL-safety where it doesn't exist already (e.g. g_object_unref)
 */
DEFINE_CLEANUP_FUNCTION0(GHashTable*, local_hashtable_unref, g_hash_table_unref)
DEFINE_CLEANUP_FUNCTION0(GObject*, local_obj_unref, g_object_unref)
DEFINE_CLEANUP_FUNCTION0(GVariant*, local_variant_unref, g_variant_unref)
DEFINE_CLEANUP_FUNCTION0(GVariantIter*, local_variant_iter_free, g_variant_iter_free)

DEFINE_CLEANUP_FUNCTION(char**, local_strfreev, g_strfreev)
DEFINE_CLEANUP_FUNCTION(void*, local_free, g_free)

#define cleanup_free __attribute__ ((cleanup(local_free)))
#define cleanup_unref_object __attribute__ ((cleanup(local_obj_unref)))
#define cleanup_unref_variant __attribute__ ((cleanup(local_variant_unref)))
#define cleanup_free_variant_iter __attribute__ ((cleanup(local_variant_iter_free)))
#define cleanup_unref_hashtable __attribute__ ((cleanup(local_hashtable_unref)))
#define cleanup_strfreev __attribute__ ((cleanup(local_strfreev)))

G_END_DECLS

#endif /* __COCKPIT_MEMORY_H__ */
