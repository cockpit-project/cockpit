/*
 * Copyright (C) 2013 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#include "config.h"

/* This gets logged as part of the (more verbose) protocol logging */
#ifdef G_LOG_DOMAIN
#undef G_LOG_DOMAIN
#endif
#define G_LOG_DOMAIN "cockpit-protocol"

#include "cockpiterror.h"

/**
 * SECTION:cockpiterror
 * @title: CockpitError
 * @short_description: Possible errors that can be returned
 *
 * Error codes.
 */

G_DEFINE_QUARK(cockpit-error, cockpit_error)
