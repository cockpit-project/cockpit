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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#include "config.h"

#include "cockpitenvironment.h"

#include "common/cockpitjson.h"

/**
 * CockpitEnvironment:
 *
 * A #CockpitChannel that returns values for environment variables.
 *
 * The payload type for this channel is 'environment-json'.
 */

#define COCKPIT_ENVIRONMENT(o)    (G_TYPE_CHECK_INSTANCE_CAST ((o), COCKPIT_TYPE_ENVIRONMENT, CockpitEnvironment))

typedef struct {
  CockpitChannel parent;
} CockpitEnvironment;

typedef struct {
  CockpitChannelClass parent_class;
} CockpitEnvironmentClass;

G_DEFINE_TYPE (CockpitEnvironment, cockpit_environment, COCKPIT_TYPE_CHANNEL);

static void
cockpit_environment_recv (CockpitChannel *channel,
                          GBytes *message)
{
  g_warning ("received unexpected message in environment channel");
  cockpit_channel_close (channel, "protocol-error");
}

static void
cockpit_environment_init (CockpitEnvironment *self)
{
}


static void
cockpit_environment_prepare (CockpitChannel *channel)
{
  CockpitEnvironment *self = COCKPIT_ENVIRONMENT (channel);
  const gchar *problem = "protocol-error";
  JsonObject *options;
  GBytes *msg_bytes;
  gchar **envreq = NULL;
  JsonObject *result;
  gint i;

  COCKPIT_CHANNEL_CLASS (cockpit_environment_parent_class)->prepare (channel);

  result = json_object_new ();
  options = cockpit_channel_get_options (channel);
  if (!cockpit_json_get_strv (options, "vars", NULL, &envreq))
    {
      g_warning ("invalid \"vars\" option for environment channel");
      goto out;
    }

  for (i = 0; envreq && envreq[i] != NULL; i++)
    {
      const gchar *v = g_getenv (envreq[i]);
      if (v)
        json_object_set_string_member (result, envreq[i], v);
      else
        json_object_set_null_member (result, envreq[i]);
    }

  msg_bytes = cockpit_json_write_bytes (result);
  cockpit_channel_send (COCKPIT_CHANNEL(self), msg_bytes, FALSE);
  g_bytes_unref (msg_bytes);
  problem = NULL;

out:
  g_free (envreq);
  json_object_unref (result);
  cockpit_channel_close (channel, problem);
}

static void
cockpit_environment_class_init (CockpitEnvironmentClass *klass)
{
  CockpitChannelClass *channel_class = COCKPIT_CHANNEL_CLASS (klass);

  channel_class->prepare = cockpit_environment_prepare;
  channel_class->recv = cockpit_environment_recv;
}
