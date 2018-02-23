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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitdisksamples.h"

#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* TODO: this should be optimized so we don't allocate network and call open()/close() all the time */

void
cockpit_disk_samples (CockpitSamples *samples)
{
  gchar *contents = NULL;
  GError *error = NULL;
  gchar **lines = NULL;
  guint64 bytes_read;
  guint64 bytes_written;
  guint64 num_ops;
  gsize len;
  guint n;
  static gboolean not_supported = FALSE;

  if (not_supported)
      goto out;

  if (!g_file_get_contents ("/proc/diskstats", &contents, &len, &error))
    {
      g_message ("error loading contents /proc/diskstats: %s", error->message);
      g_error_free (error);
      not_supported = TRUE;
      goto out;
    }

  bytes_read = 0;
  bytes_written = 0;
  num_ops = 0;

  lines = g_strsplit (contents, "\n", -1);
  for (n = 0; lines != NULL && lines[n] != NULL; n++)
    {
      const gchar *line = lines[n];
      guint num_parsed;
      gint dev_major, dev_minor;
      gchar dev_name[128];
      guint64 num_reads,  num_reads_merged,  num_sectors_read,    num_msec_reading;
      guint64 num_writes, num_writes_merged, num_sectors_written, num_msec_writing;
      guint64 num_io_in_progress, num_msec_doing_io, weighted_num_msec_doing_io;

      if (strlen (line) == 0)
        continue;

      /* From http://www.kernel.org/doc/Documentation/iostats.txt
       *
       * Field  1 -- # of reads completed
       *     This is the total number of reads completed successfully.
       * Field  2 -- # of reads merged, field 6 -- # of writes merged
       *     Reads and writes which are adjacent to each other may be merged for
       *     efficiency.  Thus two 4K reads may become one 8K read before it is
       *     ultimately handed to the disk, and so it will be counted (and queued)
       *     as only one I/O.  This field lets you know how often this was done.
       * Field  3 -- # of sectors read
       *     This is the total number of sectors read successfully.
       * Field  4 -- # of milliseconds spent reading
       *     This is the total number of milliseconds spent by all reads (as
       *     measured from __make_request() to end_that_request_last()).
       * Field  5 -- # of writes completed
       *     This is the total number of writes completed successfully.
       * Field  7 -- # of sectors written
       *     This is the total number of sectors written successfully.
       * Field  8 -- # of milliseconds spent writing
       *     This is the total number of milliseconds spent by all writes (as
       *     measured from __make_request() to end_that_request_last()).
       * Field  9 -- # of I/Os currently in progress
       *     The only field that should go to zero. Incremented as requests are
       *     given to appropriate struct request_queue and decremented as they finish.
       * Field 10 -- # of milliseconds spent doing I/Os
       *     This field increases so long as field 9 is nonzero.
       * Field 11 -- weighted # of milliseconds spent doing I/Os
       *     This field is incremented at each I/O start, I/O completion, I/O
       *     merge, or read of these stats by the number of I/Os in progress
       *     (field 9) times the number of milliseconds spent doing I/O since the
       *     last update of this field.  This can provide an easy measure of both
       *     I/O completion time and the backlog that may be accumulating.
       */

      num_parsed = sscanf (line,
                           "%d %d %127s"
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT
                           " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT " %" G_GUINT64_FORMAT,
                           &dev_major, &dev_minor, dev_name,
                           &num_reads,  &num_reads_merged, &num_sectors_read, &num_msec_reading,
                           &num_writes, &num_writes_merged, &num_sectors_written, &num_msec_writing,
                           &num_io_in_progress, &num_msec_doing_io, &weighted_num_msec_doing_io);
      if (num_parsed != 14)
        {
          g_warning ("Error parsing line %d of file /proc/diskstats (num_parsed=%d): `%s'", n, num_parsed, line);
          continue;
        }

      /* skip mapped devices and partitions... otherwise we'll count their
       * I/O more than once
       *
       * TODO: the way we identify dm devices and partitions is not
       * very elegant... we should consult sysfs via libgudev1
       * instead.
       */
      if (dev_major == 253     /* device-mapper */
          || dev_major == 9)   /* md */
        continue;

      if ((g_str_has_prefix (dev_name, "sd")
           || g_str_has_prefix (dev_name, "hd")
           || g_str_has_prefix (dev_name, "vd"))
          && g_ascii_isdigit (dev_name[strlen (dev_name) - 1]))
        continue;

      bytes_read += num_sectors_read * 512;
      bytes_written += num_sectors_written * 512;
      num_ops += num_reads_merged + num_writes_merged;
    }

  cockpit_samples_sample (samples, "disk.all.read", NULL, bytes_read);
  cockpit_samples_sample (samples, "disk.all.written", NULL, bytes_written);
  cockpit_samples_sample (samples, "disk.all.ops", NULL, num_ops);

out:
  g_strfreev (lines);
  g_free (contents);
}
