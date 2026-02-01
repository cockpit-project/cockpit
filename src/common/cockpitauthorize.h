/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
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
