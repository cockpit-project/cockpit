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

#ifndef COCKPIT_ACCOUNT_H_D8EF239444F34BEBAC3B5E06F157EF63
#define COCKPIT_ACCOUNT_H_D8EF239444F34BEBAC3B5E06F157EF63

#include <act/act.h>

#include "types.h"

G_BEGIN_DECLS

#define TYPE_ACCOUNT   (account_get_type ())
#define ACCOUNT(o)     (G_TYPE_CHECK_INSTANCE_CAST ((o), TYPE_ACCOUNT, Account))
#define IS_ACCOUNT(o)  (G_TYPE_CHECK_INSTANCE_TYPE ((o), TYPE_ACCOUNT))

GType              account_get_type          (void) G_GNUC_CONST;

CockpitAccount *   account_new               (void);

void               account_update            (Account *acc,
                                              ActUser *user);

G_END_DECLS

#endif /* COCKPIT_ACCOUNT_H__ */
