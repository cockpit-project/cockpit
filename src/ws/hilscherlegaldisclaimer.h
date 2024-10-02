/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

#ifndef __HILSCHER_LEGAL_DISCLAIMER_H__
#define __HILSCHER_LEGAL_DISCLAIMER_H__

#include <glib.h>

#include "common/cockpitwebresponse.h"

/**
 * Enum defining the state of the disclaimer cookie
 */
typedef enum 
{
    DISCLAIMER_COOKIE_NOT_SET,   /*!< The cookie is not set in the header */
    DISCLAIMER_COOKIE_SET_FALSE, /*!< The cookie is set to false */
    DISCLAIMER_COOKIE_SET_TRUE,  /*!< The cookie is set to true */
    DISCLAIMER_COOKIE_ERROR      /*!< Something went wrong */
} DISCLAIMER_COOKIE_STATE_E;

gboolean                  hilscher_legalDisclaimerAccepted  (void);

DISCLAIMER_COOKIE_STATE_E hilscher_getDisclaimerCookieState (GHashTable *headers);

void                      hilscher_sendErrorResponse        (CockpitWebResponse *response);

gboolean                  hilscher_acceptLegalDisclaimer    (void);

#endif /* __HILSCHER_LEGAL_DISCLAIMER_H__ */