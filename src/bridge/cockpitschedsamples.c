/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
#include "cockpitschedsamples.h"

#include <stdlib.h>
#include <stdbool.h>

void
cockpit_sched_samples (CockpitSamples *samples)
{
  /* exactly like pcp's kernel.load.all metric */
  const char * const instances[] = { "1min", "5min", "15min" };
  double loadavg[3];
  int count;
  static bool logged_failure = false;

  count = getloadavg(loadavg, 3);
  if (count < 0) {
      /* only log this once, chance is that it fails every time */
      if (!logged_failure)
        {
          g_message ("getloadavg() failed: %m");
          logged_failure = true;
        }
      return;
    }

  /* samples are guint64, so multiply by 100 to get two fractional digits */
  for (int i = 0; i < count; ++i)
    cockpit_samples_sample (samples, "sched.loadavg", instances[i], (gint64) (loadavg[i] * 100 + 0.5));
}
