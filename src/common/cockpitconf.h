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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_CONF_H__
#define COCKPIT_CONF_H__

#define COCKPIT_CONF_SSH_SECTION "Ssh-Login"

#include <stdbool.h>
#include <stdint.h>

const char *   cockpit_conf_string           (const char *section,
                                              const char *field);


const char * const *
               cockpit_conf_strv             (const char *section,
                                              const char *field,
                                              char delimiter);

bool           cockpit_conf_bool             (const char *section,
                                              const char *field,
                                              bool defawlt);

unsigned       cockpit_conf_uint             (const char *section,
                                              const char *field,
                                              unsigned default_value,
                                              unsigned max,
                                              unsigned min);

const char * const * cockpit_conf_get_dirs   (void);

void           cockpit_conf_cleanup          (void);

void           cockpit_conf_init             (void);

#endif /* COCKPIT_CONF_H__ */
