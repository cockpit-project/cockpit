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

#include "cockpitsamples.h"

G_DEFINE_INTERFACE (CockpitSamples, cockpit_samples, 0);

static void
cockpit_samples_default_init (CockpitSamplesInterface *iface)
{

}

void
cockpit_samples_sample (CockpitSamples *self,
                        const gchar *metric,
                        const gchar *instance,
                        gint64 value)
{
  CockpitSamplesInterface *iface;

  iface = COCKPIT_SAMPLES_GET_IFACE (self);
  g_return_if_fail (iface != NULL);

  g_assert (iface->sample);
  (iface->sample) (self, metric, instance, value);
}
