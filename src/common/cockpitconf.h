/*
 * Copyright (C) 2015 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
