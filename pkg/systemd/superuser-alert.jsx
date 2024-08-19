/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from 'react';

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";

import { LockIcon } from '@patternfly/react-icons';

import { SuperuserButton } from "../shell/superuser.jsx";
import { superuser } from "superuser.js";

const _ = cockpit.gettext;

export const SuperuserAlert = () => {
    if (superuser.allowed)
        return null;

    return <Alert className="ct-limited-access-alert"
                  variant="warning" isInline
                  customIcon={<LockIcon />}
                  actionClose={<SuperuserButton />}
                  title={_("Web console is running in limited access mode.")} />;
};
