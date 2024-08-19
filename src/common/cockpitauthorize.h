/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2014 Red Hat, Inc.
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

#ifndef COCKPIT_AUTHORIZE_H__
#define COCKPIT_AUTHORIZE_H__

#include <sys/types.h>

void          cockpit_authorize_logger                    (void (* func) (const char *data),
                                                           int verbose);

void *        cockpit_authorize_nonce                     (size_t length);

const char *  cockpit_authorize_type                      (const char *challenge,
                                                           char **type);

const char *  cockpit_authorize_subject                   (const char *challenge,
                                                           char **subject);

char *        cockpit_authorize_parse_basic               (const char *challenge,
                                                           char **user);

char *        cockpit_authorize_build_basic               (const char *user,
                                                           const char *password);

void *        cockpit_authorize_parse_negotiate           (const char *challenge,
                                                           size_t *length);

char *        cockpit_authorize_build_negotiate           (const void *input,
                                                           size_t length);

char *        cockpit_authorize_parse_x_conversation      (const char *challenge,
                                                           char **conversation);

char *        cockpit_authorize_build_x_conversation      (const char *prompt,
                                                           char **conversation);

#endif /* COCKPIT_AUTHORIZE_H__ */
