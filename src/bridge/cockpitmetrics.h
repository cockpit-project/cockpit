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

#ifndef COCKPIT_METRICS_H__
#define COCKPIT_METRICS_H__

#include "cockpitchannel.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_METRICS         (cockpit_metrics_get_type ())
#define COCKPIT_METRICS(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_METRICS, CockpitMetrics))
#define COCKPIT_IS_METRICS(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_METRICS))
#define COCKPIT_METRICS_CLASS(k)     (G_TYPE_CHECK_CLASS_CAST((k), COCKPIT_TYPE_METRICS, CockpitMetricsClass))
#define COCKPIT_METRICS_GET_CLASS(o) (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_METRICS, CockpitMetricsClass))

typedef struct _CockpitMetricsPrivate CockpitMetricsPrivate;

typedef struct {
  CockpitChannel parent;
  CockpitMetricsPrivate *priv;
} CockpitMetrics;

typedef struct {
  CockpitChannelClass parent_class;

  void        (* tick)         (CockpitMetrics *metrics,
                                gint64 current_monotic_time);

} CockpitMetricsClass;

GType              cockpit_metrics_get_type     (void) G_GNUC_CONST;

CockpitChannel *   cockpit_metrics_open         (CockpitTransport *transport,
                                                 const gchar *id,
                                                 JsonObject *options);

void               cockpit_metrics_metronome    (CockpitMetrics *self,
                                                 gint64 interval);

typedef struct {
  JsonArray *array;
  int n_skip;
} CockpitCompressedArrayBuilder;

void cockpit_compressed_array_builder_init              (CockpitCompressedArrayBuilder *compr);

void cockpit_compressed_array_builder_add               (CockpitCompressedArrayBuilder *compr,
                                                         JsonNode *element);

void cockpit_compressed_array_builder_take_and_add_array (CockpitCompressedArrayBuilder *compr,
                                                          JsonArray *array);

JsonArray *cockpit_compressed_array_builder_finish      (CockpitCompressedArrayBuilder *compr);

#endif /* COCKPIT_METRICS_H__ */
