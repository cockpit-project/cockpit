/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

#include "cockpitnetworksamples.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* TODO: this should be optimized so we don't allocate network and call open()/close() all the time */

void
cockpit_network_samples (CockpitSamples *samples)
{
  gchar *contents = NULL;
  GError *error = NULL;
  gchar **lines = NULL;
  gsize len;
  guint n;

  guint64 total_rx = 0;
  guint64 total_tx = 0;

  if (!g_file_get_contents ("/proc/net/dev", &contents, &len, &error))
    {
      g_warning ("error loading contents /proc/net/dev: %s", error->message);
      g_error_free (error);
      goto out;
    }

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      gchar iface_name[64]; /* guaranteed to be max 16 chars */
      guint64 bytes_rx, packets_rx, errors_rx, dropped_rx, fifo_rx, frame_rx, compressed_rx, multicast_rx;
      guint64 bytes_tx, packets_tx, errors_tx, dropped_tx, fifo_tx, frame_tx, compressed_tx, multicast_tx;
      gint num_parsed;
      gchar *ptr;

      /* Format is
       *
       * Inter-|   Receive                                                |  Transmit
       * face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
       * lo: 2776770   11307    0    0    0     0          0         0  2776770   11307    0    0    0     0       0          0
       * eth0: 1215645    2751    0    0    0     0          0         0  1782404    4324    0    0    0   427       0          0
       * ppp0: 1622270    5552    1    0    0     0          0         0   354130    5669    0    0    0     0       0          0
       * tap0:    7714      81    0    0    0     0          0         0     7714      81    0    0    0     0       0          0
       */

      if (n < 2 || strlen (line) == 0)
        continue;

      num_parsed = sscanf (line,
                           "%s %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT,
                           iface_name,
                           &bytes_rx, &packets_rx, &errors_rx, &dropped_rx,
                           &fifo_rx, &frame_rx, &compressed_rx, &multicast_rx,
                           &bytes_tx, &packets_tx, &errors_tx, &dropped_tx,
                           &fifo_tx, &frame_tx, &compressed_tx, &multicast_tx);
      if (num_parsed != 17)
        {
          g_warning ("Error parsing line %d of file /proc/net/dev (num_parsed=%d): `%s'", n, num_parsed, line);
          continue;
        }

      /* remove trailing ':' from interface name */
      ptr = strrchr (iface_name, ':');
      if (ptr)
        *ptr = '\0';

      cockpit_samples_sample (samples, "network.interface.rx", iface_name, bytes_rx);
      cockpit_samples_sample (samples, "network.interface.tx", iface_name, bytes_tx);

      total_rx += bytes_rx;
      total_tx += bytes_tx;
    }

  cockpit_samples_sample (samples, "network.all.rx", NULL, total_rx);
  cockpit_samples_sample (samples, "network.all.tx", NULL, total_tx);

out:
  g_strfreev (lines);
  g_free (contents);
}
