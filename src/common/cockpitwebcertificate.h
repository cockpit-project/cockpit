/*
 * Copyright (C) 2014 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_WEBCERTIFICATE_H__
#define __COCKPIT_WEBCERTIFICATE_H__

#include <stdbool.h>

char *  cockpit_certificate_locate   (bool missing_ok, char **error);
char *  cockpit_certificate_key_path (const char *certfile);

#endif /* __COCKPIT_WEBCERTIFICATE_H__ */
