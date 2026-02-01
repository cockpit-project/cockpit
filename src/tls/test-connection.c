/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

#include "testlib/cockpittest.h"

int
main (int argc,
      char *argv[])
{
  cockpit_test_init (&argc, &argv);

  return g_test_run ();
}
