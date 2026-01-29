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

#include "cockpitwebfilter.h"

/**
 * CockpitWebFilter
 *
 * A filter used to filter the output of a CockpitWebResponse.
 */

G_DEFINE_INTERFACE (CockpitWebFilter, cockpit_web_filter, 0);

static void
cockpit_web_filter_default_init (CockpitWebFilterInterface *iface)
{

}

/**
 * cockpit_web_filter_push:
 * @filter: filter to push a block of bytes into
 * @queue: block of bytes to filter
 * @function: filter calls this function with bytes generated
 * @data: value to pass to function
 *
 * Called to send data through a filter. The filter should call
 * the @function with any data it generates. If the filter wants
 * to pass through the @queue data, then it needs to call @function
 * with it.
 */
void
cockpit_web_filter_push (CockpitWebFilter *filter,
                         GBytes *queue,
                         void (* function) (gpointer, GBytes *),
                         gpointer data)
{
  CockpitWebFilterInterface *iface;

  iface = COCKPIT_WEB_FILTER_GET_IFACE (filter);
  g_return_if_fail (iface != NULL);

  g_assert (iface->push);
  (iface->push) (filter, queue, function, data);
}
