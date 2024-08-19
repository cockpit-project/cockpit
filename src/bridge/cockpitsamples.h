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

#ifndef COCKPIT_SAMPLES_H__
#define COCKPIT_SAMPLES_H__

#include <glib-object.h>

G_BEGIN_DECLS

#define COCKPIT_TYPE_SAMPLES            (cockpit_samples_get_type ())
#define COCKPIT_SAMPLES(inst)            (G_TYPE_CHECK_INSTANCE_CAST ((inst), COCKPIT_TYPE_SAMPLES, CockpitSamples))
#define COCKPIT_IS_SAMPLES(inst)         (G_TYPE_CHECK_INSTANCE_TYPE ((inst), COCKPIT_TYPE_SAMPLES))
#define COCKPIT_SAMPLES_GET_IFACE(inst)  (G_TYPE_INSTANCE_GET_INTERFACE ((inst), COCKPIT_TYPE_SAMPLES, CockpitSamplesInterface))

typedef struct _CockpitSamples CockpitSamples;
typedef struct _CockpitSamplesInterface CockpitSamplesInterface;

struct _CockpitSamplesInterface {
  GTypeInterface parent_iface;

  void       (* sample)           (CockpitSamples *samples,
                                   const gchar *metric,
                                   const gchar *instance,
                                   gint64 value);
};

GType               cockpit_samples_get_type        (void) G_GNUC_CONST;

void                cockpit_samples_sample          (CockpitSamples *self,
                                                     const gchar *metric,
                                                     const gchar *instance,
                                                     gint64 value);

G_END_DECLS

#endif /* COCKPIT_SAMPLES_H__ */
