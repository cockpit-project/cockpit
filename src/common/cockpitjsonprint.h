/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#pragma once

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>

bool
cockpit_json_print_string_property (FILE *stream,
                                    const char *key,
                                    const char *value,
                                    ssize_t maxlen);

bool
cockpit_json_print_bool_property (FILE *stream,
                                  const char *key,
                                  bool value);

bool
cockpit_json_print_integer_property (FILE *stream,
                                     const char *key,
                                     uint64_t value);

FILE *
cockpit_json_print_open_memfd (const char *name,
                               int         version);

int
cockpit_json_print_finish_memfd (FILE **stream);
