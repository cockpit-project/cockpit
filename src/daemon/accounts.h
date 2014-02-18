/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_ACCOUNTS_H_8AFA1DF0486745E7B0A8F150B82A38A6
#define COCKPIT_ACCOUNTS_H_8AFA1DF0486745E7B0A8F150B82A38A6

#include "types.h"

G_BEGIN_DECLS

#define TYPE_ACCOUNTS   (accounts_get_type ())
#define ACCOUNTS(o)     (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_ACCOUNTS, Accounts))
#define IS_ACCOUNTS(o)  (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_ACCOUNTS))

GType             accounts_get_type          (void) G_GNUC_CONST;

CockpitAccounts * accounts_new               (void);

G_END_DECLS

#endif /* COCKPIT_ACCOUNTS_H__ */
