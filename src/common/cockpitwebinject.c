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

#include "config.h"

#include "cockpitwebinject.h"

#include <string.h>

/**
 * CockpitWebInject
 *
 * This is a CockpitWebFilter which looks for a marker data
 * and inject additional data after that point. The data is
 * not injected more than once.
 */
struct _CockpitWebInject {
  GObject parent;
  goffset partial;
  GBytes *marker;
  GBytes *inject;
};

typedef struct _CockpitInjectClass {
  GObjectClass parent_class;
} CockpitWebInjectClass;

static void cockpit_web_filter_inject_iface (CockpitWebFilterIface *iface);

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
  const gchar *mark, *data, *pos;
  gsize mark_len, data_len, at;
  GBytes *bytes;

  /* Stop searching once injected */
  if (self->inject)
    {
      mark = g_bytes_get_data (self->marker, &mark_len);
      data = g_bytes_get_data (block, &data_len);
      at = 0;

      while (at < data_len)
        {
          if (self->partial)
            pos = data + at;
          else
            pos = memchr (data + at, mark[0], data_len - at);

          /* Couldn't find the character anywhere? */
          if (!pos)
            break;

          for (at = (pos - data); self->partial < mark_len && at < data_len; self->partial++, at++)
            {
              if (mark[self->partial] != data[at])
                break;
            }

          /* Found a match */
          if (self->partial == mark_len)
            {
              self->partial = 0;

              bytes = g_bytes_new_from_bytes (block, 0, at);
              function (func_data, bytes);
              g_bytes_unref (bytes);

              function (func_data, self->inject);
              g_bytes_unref (self->inject);
              self->inject = NULL;

              bytes = g_bytes_new_from_bytes (block, at, data_len - at);
              function (func_data, bytes);
              g_bytes_unref (bytes);

              block = NULL;
              break;
            }

          /* Incomplete match, and more data */
          else if (at < data_len)
            {
              self->partial = 0;
            }
        }
    }

  if (block)
    function (func_data, block);
}

static void
cockpit_web_filter_inject_iface (CockpitWebFilterIface *iface)
{
  iface->push = cockpit_web_inject_push;
}

/**
 * cockpit_web_filter_new:
 * @marker: marker to search for
 * @inject: bytes to inject after marker
 *
 * Create a new CockpitWebFilter which injects @inject bytes
 * after the @marker. It injects the data once.
 *
 * Returns: A new CockpitWebFilter
 */
CockpitWebFilter *
cockpit_web_inject_new (const gchar *marker,
                        GBytes *inject)
{
  CockpitWebInject *self;
  gsize len;

  g_return_val_if_fail (marker != NULL, NULL);
  g_return_val_if_fail (inject != NULL, NULL);

  len = strlen (marker);
  g_return_val_if_fail (len > 0, NULL);

  self = g_object_new (COCKPIT_TYPE_WEB_INJECT, NULL);
  self->marker = g_bytes_new (marker, len);
  self->inject = g_bytes_ref (inject);

  return COCKPIT_WEB_FILTER (self);
}
