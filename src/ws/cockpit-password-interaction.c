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

#include "cockpit-password-interaction.h"

#include <string.h>

struct _CockpitPasswordInteraction
{
  GTlsInteraction parent_instance;

  char *password;
};

struct _CockpitPasswordInteractionClass
{
  GTlsInteractionClass parent_class;
};

G_DEFINE_TYPE (CockpitPasswordInteraction, cockpit_password_interaction, G_TYPE_TLS_INTERACTION);

static GTlsInteractionResult
cockpit_password_interaction_ask_password (GTlsInteraction *interaction,
                                           GTlsPassword *password,
                                           GCancellable *cancellable,
                                           GError **error)
{
  CockpitPasswordInteraction *self = (CockpitPasswordInteraction*)interaction;
  if (g_cancellable_set_error_if_cancelled (cancellable, error))
    return G_TLS_INTERACTION_FAILED;

  g_tls_password_set_value (password, (guchar*)self->password, strlen (self->password));
  return G_TLS_INTERACTION_HANDLED;
}

static void
cockpit_password_interaction_init (CockpitPasswordInteraction *interaction)
{
}

static void
cockpit_password_interaction_finalize (GObject *object)
{
  CockpitPasswordInteraction *self = (CockpitPasswordInteraction*)object;

  g_free (self->password);

  G_OBJECT_CLASS (cockpit_password_interaction_parent_class)->finalize (object);
}

static void
cockpit_password_interaction_class_init (CockpitPasswordInteractionClass *klass)
{
  GTlsInteractionClass *interaction_class = G_TLS_INTERACTION_CLASS (klass);
  interaction_class->ask_password = cockpit_password_interaction_ask_password;
  G_OBJECT_CLASS (interaction_class)->finalize = cockpit_password_interaction_finalize;
}

GTlsInteraction *
cockpit_password_interaction_new (const char *password)
{
  CockpitPasswordInteraction *self = g_object_new (COCKPIT_TYPE_PASSWORD_INTERACTION, NULL);
  self->password = g_strdup (password);
  return G_TLS_INTERACTION (self);
}
