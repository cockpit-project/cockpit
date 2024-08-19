/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
