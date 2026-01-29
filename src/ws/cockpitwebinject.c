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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitwebinject.h"

#include <string.h>

/**
 * CockpitWebInject
 *
 * This is a CockpitWebFilter which looks for a marker data
 * and inject additional data after that point. The data is
 * not injected more than the specified number of times.
 */
struct _CockpitWebInject {
  GObject parent;
  /* partial_matches stores the lengths of partial matches, size is (marker length) - 1
   * e.g. "ABA" with marker "ABAC" will result in [TRUE, FALSE, TRUE]
   */
  GArray *partial_matches;
  GBytes *marker;
  GBytes *inject;

  guint maximum;
  guint injected;
};

static void cockpit_web_filter_inject_iface (CockpitWebFilterInterface *iface);

G_DEFINE_TYPE_WITH_CODE (CockpitWebInject, cockpit_web_inject, G_TYPE_OBJECT,
                         G_IMPLEMENT_INTERFACE (COCKPIT_TYPE_WEB_FILTER, cockpit_web_filter_inject_iface)
)

static void
cockpit_web_inject_init (CockpitWebInject *self)
{

}

static void
cockpit_web_inject_finalize (GObject *object)
{
  CockpitWebInject *self = COCKPIT_WEB_INJECT (object);

  if (self->partial_matches)
    g_array_unref (self->partial_matches);
  if (self->marker)
    g_bytes_unref (self->marker);
  if (self->inject)
    g_bytes_unref (self->inject);

  G_OBJECT_CLASS (cockpit_web_inject_parent_class)->finalize (object);
}

static void
cockpit_web_inject_class_init (CockpitWebInjectClass *klass)
{
  GObjectClass *gobject_class = G_OBJECT_CLASS (klass);

  gobject_class->finalize = cockpit_web_inject_finalize;
}

static void
cockpit_web_inject_push (CockpitWebFilter *filter,
                         GBytes *block,
                         void (* function) (gpointer, GBytes *),
                         gpointer func_data)
{
  CockpitWebInject *self = (CockpitWebInject *)filter;
  const gchar *mark, *data, *pos = NULL;
  gsize mark_len, data_len, at;
  GBytes *bytes;
  gsize written;
  gint partial_len, remaining_len;

  mark = g_bytes_get_data (self->marker, &mark_len);
  data = g_bytes_get_data (block, &data_len);

  if (data_len == 0)
    return;

  written = at = 0;

  /* look at our partial matches first
   * longest partial matches have precedence (they either get longer or don't pan out)
   * only do this if we haven't reached the maximum yet
   */
  if (self->injected < self->maximum)
    {
      for (partial_len = self->partial_matches->len - 1; partial_len >= 0; --partial_len)
        {
          if (g_array_index (self->partial_matches, gboolean, partial_len))
            {
              /* our match can only grow longer */
              g_array_index (self->partial_matches, gboolean, partial_len) = FALSE;
              remaining_len = mark_len - partial_len;
              /* our current block might be too short */
              if (remaining_len > data_len)
                {
                  if (memcmp (mark + partial_len, data, data_len) == 0)
                    g_array_index (self->partial_matches, gboolean, partial_len + data_len) = TRUE;
                }
              else if (memcmp (mark + partial_len, data, remaining_len) == 0)
                {
                  /* we have a match */
                  at = remaining_len;
                  pos = data + at;
                  /* reset partials */
                  g_array_set_size(self->partial_matches, 0);
                  g_array_set_size(self->partial_matches, mark_len);
                  break;
                }
            }
        }
    }

  /* keep searching until we have found the maximum number of allowed matches or reached the end */
  for(;;)
  {
    if (at != written)
    {
      bytes = g_bytes_new_from_bytes (block, written, at - written);
      function (func_data, bytes);
      g_bytes_unref (bytes);
      written = at;

      /* did we have a match? */
      if (pos == (data + at) && self->injected < self->maximum)
        {
          function (func_data, self->inject);
          self->injected++;
        }
    }

    if (at >= data_len)
      break;

    /* if there are enough chars left, try to find a complete match */
    if (self->injected < self->maximum &&
        data_len >= (at + mark_len) &&
        (pos = memmem (data + at, data_len - at, mark, mark_len)))
      {
        /* we found a match, but we want to write out the mark also before we inject */
        pos += mark_len;
        at = pos - data;
      }
    else
      {
        /* nothing found, forward */
        at = data_len;
        pos = NULL;
      }
  }

  /* if we haven't reached our max number of injections, look for partial matches at the end */
  partial_len = mark_len - 1;
  if (partial_len > data_len)
    partial_len = data_len;
  while (partial_len > 0)
    {
      if (memcmp (mark, data + data_len - partial_len, partial_len) == 0)
        g_array_index (self->partial_matches, gboolean, partial_len) = TRUE;
      partial_len--;
    }
}

static void
cockpit_web_filter_inject_iface (CockpitWebFilterInterface *iface)
{
  iface->push = cockpit_web_inject_push;
}

/**
 * cockpit_web_filter_new:
 * @marker: marker to search for
 * @inject: bytes to inject after marker
 * @count: number of times to inject
 *
 * Create a new CockpitWebFilter which injects @inject bytes
 * after the @marker. It injects the data once.
 *
 * Returns: A new CockpitWebFilter
 */
CockpitWebFilter *
cockpit_web_inject_new (const gchar *marker,
                        GBytes *inject,
                        guint count)
{
  CockpitWebInject *self;
  gsize len;

  g_return_val_if_fail (marker != NULL, NULL);
  g_return_val_if_fail (inject != NULL, NULL);

  len = strlen (marker);
  g_return_val_if_fail (len > 0, NULL);

  self = g_object_new (COCKPIT_TYPE_WEB_INJECT, NULL);
  self->marker = g_bytes_new (marker, len);
  self->partial_matches = g_array_sized_new(FALSE, TRUE, sizeof(gboolean), len);
  g_array_set_size(self->partial_matches, len);
  self->inject = g_bytes_ref (inject);
  self->maximum = count;

  return COCKPIT_WEB_FILTER (self);
}
