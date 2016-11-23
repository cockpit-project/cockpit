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

#ifndef __COCKPIT_CHANNEL_H__
#define __COCKPIT_CHANNEL_H__

#include <glib-object.h>
#include <json-glib/json-glib.h>

#include "cockpitconnect.h"

#include "common/cockpittransport.h"

G_BEGIN_DECLS

#define COCKPIT_TYPE_CHANNEL            (cockpit_channel_get_type ())
#define COCKPIT_CHANNEL(o)              (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_CHANNEL, CockpitChannel))
#define COCKPIT_IS_CHANNEL(o)           (G_TYPE_CHECK_INSTANCE_TYPE ((o), COCKPIT_TYPE_CHANNEL))
#define COCKPIT_CHANNEL_CLASS(k)        (G_TYPE_CHECK_CLASS_CAST((k), COCKPIT_TYPE_CHANNEL, CockpitChannelClass))
#define COCKPIT_CHANNEL_GET_CLASS(o)    (G_TYPE_INSTANCE_GET_CLASS ((o), COCKPIT_TYPE_CHANNEL, CockpitChannelClass))

typedef struct _CockpitChannel        CockpitChannel;
typedef struct _CockpitChannelClass   CockpitChannelClass;
typedef struct _CockpitChannelPrivate CockpitChannelPrivate;

struct _CockpitChannel
{
  GObject parent;
  CockpitChannelPrivate *priv;
};

struct _CockpitChannelClass
{
  GObjectClass parent_class;

  /* signal */

  void        (* closed)      (CockpitChannel *channel,
                               const gchar *problem);

  /* vfuncs */

  void        (* prepare)     (CockpitChannel *channel);

  void        (* recv)        (CockpitChannel *channel,
                               GBytes *message);

  gboolean    (* control)     (CockpitChannel *channel,
                               const gchar *command,
                               JsonObject *options);

  void        (* close)       (CockpitChannel *channel,
                               const gchar *problem);
};

GType               cockpit_channel_get_type          (void) G_GNUC_CONST;

void                cockpit_channel_close             (CockpitChannel *self,
                                                       const gchar *problem);

void                cockpit_channel_fail              (CockpitChannel *self,
                                                       const gchar *problem,
                                                       const gchar *format,
                                                       ...) G_GNUC_PRINTF(3, 4);

const gchar *       cockpit_channel_get_id            (CockpitChannel *self);

/* Used by implementations */

void                cockpit_channel_prepare           (CockpitChannel *self);

void                cockpit_channel_control           (CockpitChannel *self,
                                                       const gchar *command,
                                                       JsonObject *message);

void                cockpit_channel_ready             (CockpitChannel *self,
                                                       JsonObject *message);

void                cockpit_channel_send              (CockpitChannel *self,
                                                       GBytes *payload,
                                                       gboolean valid_utf8);

JsonObject *        cockpit_channel_get_options       (CockpitChannel *self);

JsonObject *        cockpit_channel_close_options     (CockpitChannel *self);

GSocketAddress *    cockpit_channel_parse_address     (CockpitChannel *self,
                                                       gchar **possible_name);

void                cockpit_channel_internal_address  (const gchar *name,
                                                       GSocketAddress *address);

gboolean            cockpit_channel_remove_internal_address (const gchar *name);

CockpitConnectable * cockpit_channel_parse_stream     (CockpitChannel *self);

G_END_DECLS

#endif /* __COCKPIT_CHANNEL_H__ */
