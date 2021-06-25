/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

#include "cockpit-session-client-certificate.h"

#include <assert.h>
#include <err.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <syslog.h>
#include <unistd.h>

#include <systemd/sd-bus.h>

#include "session-utils.h"

#include "cockpitwsinstancecert.h"

/* This is a bit lame, but having a hard limit on peer certificates is
 * desirable: Let's not get DoSed by huge certs */
#define MAX_PEER_CERT_SIZE 100000

static bool
sssd_map_certificate (const char *certificate, char** username)
{
  int result = false;
  sd_bus_error err = SD_BUS_ERROR_NULL;
  sd_bus *bus = NULL;
  sd_bus_message *user_obj_msg = NULL;
  const char *user_obj_path = NULL;
  int r;

  assert (username);
  assert (!*username);

  r = sd_bus_open_system (&bus);
  if (r < 0)
    {
      warnx ("Failed to connect to system bus: %s", strerror (-r));
      goto out;
    }

  r = sd_bus_call_method (bus,
                          "org.freedesktop.sssd.infopipe",
                          "/org/freedesktop/sssd/infopipe/Users",
                          "org.freedesktop.sssd.infopipe.Users",
                          "FindByCertificate",
                          &err,
                          &user_obj_msg,
                          "s",
                          certificate);

  if (r < 0)
    {
      /* The error name is a bit confusing, and this is the common case; translate to readable error */
      if (sd_bus_error_has_name (&err, "sbus.Error.NotFound"))
        {
          warnx ("No matching user for certificate");
          goto out;
        }

      warnx ("Failed to map certificate to user: [%s] %s", err.name, err.message);
      goto out;
    }

  assert (user_obj_msg);

  r = sd_bus_message_read (user_obj_msg, "o", &user_obj_path);
  if (r < 0)
    {
      warnx ("Failed to parse response message: %s", strerror (-r));
      goto out;
    }

  debug ("certificate mapped to user object path %s", user_obj_path);

  r = sd_bus_get_property_string (bus,
                                  "org.freedesktop.sssd.infopipe",
                                  user_obj_path,
                                  "org.freedesktop.sssd.infopipe.Users.User",
                                  "name",
                                  &err,
                                  username);

  if (r < 0)
    {
      warnx ("Failed to map user object to name: [%s] %s", err.name, err.message);
      goto out;
    }

  assert (*username);
  debug ("mapped certificate to user %s", *username);
  result = true;

out:
  sd_bus_error_free (&err);
  sd_bus_message_unref (user_obj_msg);
  sd_bus_unref (bus);
  return result;
}

char *
cockpit_session_client_certificate_map_user (void)
{
  char cert_pem[MAX_PEER_CERT_SIZE];
  char *sssd_user = NULL;

  /* read the certificate file from disk */
  if (https_instance_has_certificate_file (cert_pem, sizeof cert_pem) < 0)
    {
      warnx ("No https instance certificate present");
      return NULL;
    }

  /* ask sssd to map cert to a user */
  if (!sssd_map_certificate (cert_pem, &sssd_user))
    return NULL;

  return sssd_user;
}
