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

#include "config.h"

#include "cockpitpaths.h"

#include <string.h>

gboolean
cockpit_path_has_parent (const gchar *path,
                         const gchar *parent)
{
  gsize length = strlen (parent);
  const gchar *last;

  if (length == 1 && parent[0] == '/' && path[0])
    last = path + 1;

  else if (strncmp (path, parent, length) == 0 && path[length] == '/')
    last = path + length + 1;

  else
    return FALSE;

  return strchr (last, '/') == NULL;
}

gboolean
cockpit_path_equal_or_ancestor (const gchar *path,
                                const gchar *ancestor)
{
  gsize length = strlen (ancestor);
  if (length == 1 && ancestor[0] == '/')
    return TRUE;

  if (strncmp (path, ancestor, length) == 0 &&
      (path[length] == '/' || path[length] == '\0'))
    return TRUE;

  return FALSE;
}

gboolean
cockpit_path_has_ancestor (const gchar *path,
                           const gchar *ancestor)
{
  gsize length = strlen (ancestor);
  if (length == 1 && ancestor[0] == '/')
    return TRUE;

  if (strncmp (path, ancestor, length) == 0 &&
      path[length] == '/')
    return TRUE;

  return FALSE;
}

typedef struct {
  gsize len;
  const gchar *data;
} PathData;

static gint
tree_path_cmp (gconstpointer a,
               gconstpointer b,
               gpointer user_data)
{
  const PathData *pa = a;
  const PathData *pb = b;
  gsize la = pa->len;
  gsize lb = pb->len;
  gint ret;

  ret = memcmp (pa->data, pb->data, MIN (la, lb));
  if (ret == 0 && la != lb)
    ret = (la < lb) ? -1 : 1;

  return ret;
}

static gint
tree_prefix_search (gconstpointer a,
                    gconstpointer b)
{
  const PathData *pa = a;
  const PathData *pb = b;
  gsize la = pa->len;
  gsize lb = pb->len;
  gint ret;

  /* Yes, g_tree_search() means this is backwards */
  ret = memcmp (pb->data, pa->data, MIN (la, lb));
  if (ret == 0 && la != lb)
    {
      if (la > lb)
        {
          if ((lb == 1 && pb->data[0] == '/') || pa->data[lb] == '/')
            ret = 0;
          else
            ret = -1;
        }
      else
        {
            ret = 1;
        }
    }
  return ret;
}

GTree *
cockpit_paths_new (void)
{
  return g_tree_new_full (tree_path_cmp, NULL, g_free, NULL);
}

/*
 * cockpit_paths_add:
 * @tree: The tree to add to
 * @path: The path to add
 *
 * Adds the path if this path or a parent is not already
 * in the tree. Will return %NULL if the path is already
 * in the tree ... otherwise will return the internally
 * reallocated path.
 */
const gchar *
cockpit_paths_add (GTree *tree,
                   const gchar *path)
{
  PathData key = { strlen (path), path };
  PathData *pd = g_tree_lookup (tree, &key);

  if (!pd)
    {
      pd = g_malloc (sizeof (PathData) + key.len + 1);
      pd->len = key.len;
      pd->data = (gchar *)(pd + 1);
      memcpy ((gchar *)pd->data, path, key.len + 1);
      g_tree_replace (tree, pd, pd);
      return pd->data;
    }

  return NULL;
}

gboolean
cockpit_paths_remove (GTree *tree,
                      const gchar *path)
{
  PathData key = { strlen (path), path };
  return g_tree_remove (tree, &key);
}

const gchar *
cockpit_paths_contain (GTree *tree,
                       const gchar *path)
{
  PathData key = { strlen(path), path };
  PathData *pd = g_tree_lookup (tree, &key);
  return pd ? pd->data : NULL;
}

gboolean
cockpit_paths_contain_or_descendant (GTree *tree,
                                     const gchar *path)
{
  PathData key = { strlen (path), path };
  PathData *pd = g_tree_search (tree, tree_prefix_search, &key);
  return pd != NULL;
}

const gchar *
cockpit_paths_contain_or_ancestor (GTree *tree,
                                   const gchar *path)
{
  PathData key = { strlen (path), path };
  gboolean last = FALSE;
  const gchar *pos;
  PathData *pd;

  for (;;)
    {
      pd = g_tree_lookup (tree, &key);
      if (pd)
        return pd->data;
      if (last)
        return NULL;
      pos = memrchr (path, '/', key.len);
      if (!pos)
        return NULL;
      if (path == pos)
        {
          key.len = 1;
          last = TRUE;
        }
      else
        {
          key.len = (pos - path);
        }
    }
}
