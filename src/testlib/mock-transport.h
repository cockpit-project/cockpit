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

#ifndef MOCK_TRANSPORT_H
#define MOCK_TRANSPORT_H

#include "common/cockpittransport.h"

#include <gio/gio.h>

#define MOCK_TYPE_TRANSPORT         (mock_transport_get_type ())
#define MOCK_TRANSPORT(o)           (G_TYPE_CHECK_INSTANCE_CAST ((o), MOCK_TYPE_TRANSPORT, MockTransport))
#define MOCK_IS_TRANSPORT(o)        (G_TYPE_CHECK_INSTANCE_TYPE ((o), MOCK_TYPE_TRANSPORT))

typedef struct {
  CockpitTransport parent;
  gboolean closed;
  gchar *problem;
  guint count;
  GQueue *control;
  GHashTable *channels;
  GList *trash;
} MockTransport;

GType                mock_transport_get_type      (void);

MockTransport *      mock_transport_new           (void);

guint                mock_transport_count_sent    (MockTransport *mock);

JsonObject *         mock_transport_pop_control   (MockTransport *mock);

GBytes *             mock_transport_pop_channel   (MockTransport *mock,
                                                   const gchar *channel);

GBytes *             mock_transport_combine_output (MockTransport *transport,
                                                    const gchar *channel_id,
                                                    guint *count);

#endif /* MOCK_TRANSPORT_H */
