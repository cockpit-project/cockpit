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

#pragma once

#include "common/cockpitchannel.h"

#define COCKPIT_TYPE_METRICS (cockpit_metrics_get_type ())
G_DECLARE_DERIVABLE_TYPE(CockpitMetrics, cockpit_metrics, COCKPIT, METRICS, CockpitChannel)

struct _CockpitMetricsBuffer {
  int n_elements;
  double *data;
};

struct _CockpitMetricsClass {
  CockpitChannelClass parent_class;

  void        (* tick)         (CockpitMetrics *metrics,
                                gint64 current_monotic_time);

};

GType              cockpit_metrics_get_type     (void) G_GNUC_CONST;

void               cockpit_metrics_set_interpolate (CockpitMetrics *self,
                                                    gboolean interpolate);

void               cockpit_metrics_set_compress    (CockpitMetrics *self,
                                                    gboolean compress);

void               cockpit_metrics_metronome    (CockpitMetrics *self,
                                                 gint64 interval);

/* Sending samples
 *
 * Derived classes need to call the following functions in a carefully
 * orchestrated way in order to send out 'meta' and 'data' messages on
 * the channel.
 *
 * The CockpitMetrics class inspects the 'meta' messages and adjusts
 * its behavior and data structures to it.  Derived classes then fill
 * the 'data buffer' and the CockpitMetrics will post-process it as
 * requested in the 'meta' message.
 */

/* - cockpit_metrics_send_meta (self, meta, reset)
 *
 * Send a 'meta' message.  When 'reset' is TRUE, the next data message
 * is treated as if it were the first on the channel: No compression,
 * derivation, or interpolation is done for it.
 *
 * - buffer = cockpit_metrics_get_data_buffer (self)
 *
 * Returns a buffer for depositing sample values.  The value for
 * instance J of metric I should be placed into 'buffer[i][j]'.  The
 * number of metrics and the number of instances of each metric is
 * determined by the "metrics" member of the meta object passed to the
 * most recent call to cockpit_metrics_send_meta.
 *
 * - cockpit_metrics_send_data (self, timestamp)
 *
 * Post-processes the samples in the buffer and queues them for
 * sending.  The 'timestamp' is the number of milliseconds since an
 * arbitrary epoch.  If it is not exactly one interval later than the
 * value in the previous call to this function, the sample values are
 * 'warped' in time via linear interpolation.  The expected interval
 * is taken from the most recent 'meta' message.
 *
 * - cockpit_metrics_flush_data (self)
 *
 * Actually send out all queued samples in a 'data' message.
 */

void               cockpit_metrics_send_meta    (CockpitMetrics *self,
                                                 JsonObject *meta,
                                                 gboolean reset);

double           **cockpit_metrics_get_data_buffer (CockpitMetrics *self);
void               cockpit_metrics_send_data    (CockpitMetrics *self, gint64 timestamp);
void               cockpit_metrics_flush_data   (CockpitMetrics *self);
