/*
 * Copyright (C) 2016 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

#ifndef __COCKPIT_LOCALE_H__
#define __COCKPIT_LOCALE_H__

#include <glib.h>

G_BEGIN_DECLS

gchar *               cockpit_locale_from_language       (const gchar *language,
                                                          const gchar *encoding,
                                                          gchar **shorter);

G_END_DECLS

#endif /* __COCKPIT_LOCALE_H__ */
