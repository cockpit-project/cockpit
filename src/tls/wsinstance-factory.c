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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#include "config.h"

#include <assert.h>
#include <err.h>
#include <stdio.h>
#include <stdlib.h>

#include <systemd/sd-bus.h>
#include <systemd/sd-daemon.h>

#include "socket-io.h"
#include "utils.h"

#define UNIT_MAX 256

static int
match_job_removed (sd_bus_message *message,
                   void           *user_data,
                   sd_bus_error   *error)
{
  const char **job_path = user_data;
  const char *result;
  const char *path;

  debug (FACTORY, "Received JobRemoved signal:");

  if (sd_bus_message_read (message, "uoss", NULL, &path, NULL, &result) < 0)
    return 0;

  debug (FACTORY, "  -> path: %s, result: %s", path, result);

  if (!*job_path || strcmp (path, *job_path) != 0)
    return 0;

  /* This is our job. */
  debug (FACTORY, "  -> sending result.");
  send_all (SD_LISTEN_FDS_START, result, strlen (result), 5 * 1000000);
  *job_path = NULL;

  return 0;
}

int
main (void)
{
  char instance[WSINSTANCE_MAX];
  sd_bus_error error = SD_BUS_ERROR_NULL;
  sd_bus *bus = NULL;
  char unit[UNIT_MAX + 1];
  sd_bus_message *reply = NULL;
  const char *job_path = NULL;
  char **fdnames;
  int r;

  if (sd_listen_fds_with_names (false, &fdnames) != 1 || strcmp (fdnames[0], "connection") != 0)
    errx (EXIT_FAILURE, "Must be spawned from a systemd service on a socket with Accept=yes %s", fdnames[0]);

  if (!recv_alnum (SD_LISTEN_FDS_START, instance, sizeof instance, 10 * 1000000))
    errx (EXIT_FAILURE, "Didn't receive fingerprint");

  r = sd_bus_open_system (&bus);
  if (r < 0)
    errx (EXIT_FAILURE, "Failed to connect to system bus: %s", strerror (-r));

  /* We use the job_path variable to communicate with the match function
   * in two ways:
   *
   *  - we set it to the path of the job that we're waiting to exit so
   *    that the match function knows which signal is for us
   *
   *  - once the job is removed, the match function clears the variable
   *    back to NULL.  that's how we know when to stop waiting.
   *
   * In effect, the duration of job_path being set to non-NULL is more
   * or less equal to the duration of the existence of a job object at
   * that path.
   */
  r = sd_bus_match_signal_async (bus, NULL,
                                 "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
                                 "org.freedesktop.systemd1.Manager", "JobRemoved",
                                 match_job_removed, NULL, &job_path);
  if (r < 0)
    errx (EXIT_FAILURE, "Failed to install match rule: %s", strerror (-r));

  /* can't fail, because instance is small */
  r = snprintf (unit, sizeof unit, "cockpit-wsinstance-https@%s.socket", instance);
  assert (0 < r && r < sizeof unit);

  debug (FACTORY, "Requesting start of unit %s", unit);
  r = sd_bus_call_method (bus,
                          "org.freedesktop.systemd1", "/org/freedesktop/systemd1",
                          "org.freedesktop.systemd1.Manager", "StartUnit",
                          &error, &reply, "ss", unit, "replace");
  if (r < 0)
    errx (EXIT_FAILURE, "Method call failed: %s", error.message);

  r = sd_bus_message_read (reply, "o", &job_path);
  if (r < 0)
    errx (EXIT_FAILURE, "Invalid message response: %s", strerror (-r));

  debug (FACTORY, "  -> job is %s", job_path);
  debug (FACTORY, "Waiting for signal.");

  do
    r = sd_bus_process (bus, NULL);
  while (r > 0);
  if (r < 0)
    errx (EXIT_FAILURE, "sd_bus_process() failed: %s", strerror (-r));

  struct timespec start = { 0, 0 };
  uint64_t remaining;
  while (job_path && get_remaining_timeout (&start, &remaining, 20 * 1000000))
    {
      debug (FACTORY, "sd_bus_wait(%llu)", (long long) remaining);
      r = sd_bus_wait (bus, remaining);
      if (r < 0)
        errx (EXIT_FAILURE, "Error while waiting for bus: %s", strerror (-r));

      debug (FACTORY, "sd_bus_process():");
      do
        r = sd_bus_process (bus, NULL);
      while (r > 0);
      if (r < 0)
        errx (EXIT_FAILURE, "sd_bus_process() failed: %s", strerror (-r));
      debug (FACTORY, "  -> done.");
    }

  sd_bus_message_unref (reply);
  sd_bus_close (bus);
  sd_bus_unref (bus);

  return 0;
}
