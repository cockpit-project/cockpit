/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpitcontrolmessages.h"

#include <gio/gunixfdmessage.h>

void
cockpit_control_messages_clear (CockpitControlMessages *ccm)
{
  for (gint i = 0; i < ccm->n_messages; i++)
    g_object_unref (ccm->messages[i]);
  g_free (ccm->messages);

  ccm->messages = NULL;
  ccm->n_messages = 0;
}

gboolean
cockpit_control_messages_empty (CockpitControlMessages *ccm)
{
  return ccm->n_messages == 0;
}

gpointer
cockpit_control_messages_get_single_message (CockpitControlMessages  *ccm,
                                             GType                    message_type,
                                             GError                 **error)
{
  if (ccm->n_messages != 1)
    {
      g_set_error (error, G_FILE_ERROR, G_FILE_ERROR_INVAL,
                   "Unexpectedly received %d control messages (one message of type %s expected)",
                   ccm->n_messages, g_type_name (message_type));
      return NULL;
    }

  if (!G_TYPE_CHECK_INSTANCE_TYPE (ccm->messages[0], message_type))
    {
      g_set_error (error, G_FILE_ERROR, G_FILE_ERROR_INVAL,
                   "Unexpectedly received control message of type %s (type %s expected)",
                   G_OBJECT_TYPE_NAME (ccm->messages[0]), g_type_name (message_type));
      return NULL;
    }

  return ccm->messages[0];
}

const gint *
cockpit_control_messages_peek_fd_list (CockpitControlMessages  *ccm,
                                       gint                    *n_fds,
                                       GError                 **error)
{
  GUnixFDMessage *message = cockpit_control_messages_get_single_message (ccm, G_TYPE_UNIX_FD_MESSAGE, error);

  if (message == NULL)
    return NULL;

  return g_unix_fd_list_peek_fds (g_unix_fd_message_get_fd_list (message), n_fds);
}

gint
cockpit_control_messages_peek_single_fd (CockpitControlMessages  *ccm,
                                         GError                **error)
{
  int n_fds;
  const gint *fds = cockpit_control_messages_peek_fd_list (ccm, &n_fds, error);

  if (fds == NULL)
    return -1;

  if (n_fds != 1)
    {
      g_set_error (error, G_FILE_ERROR, G_FILE_ERROR_INVAL,
                   "Unexpectedly received %d file descriptors (1 expected)", n_fds);
      return -1;
    }

  return fds[0];
}
