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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

#ifndef COCKPIT_AUTHORIZE_H__
#define COCKPIT_AUTHORIZE_H__

void    cockpit_authorize_logger     (void (* func) (const char *data),
                                      int verbose);

int     cockpit_authorize_type       (const char *challenge,
                                      char **type);

int     cockpit_authorize_user       (const char *challenge,
                                      char **user);

int     cockpit_authorize_crypt1     (const char *challenge,
                                      const char *password,
                                      char **response);

int     cockpit_authorize_plain1     (const char *challenge,
                                      const char *password,
                                      char **response);

#endif /* COCKPIT_AUTHORIZE_H__ */
