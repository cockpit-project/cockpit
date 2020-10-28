/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import React from 'react';

import { LIBVIRT_SYSTEM_CONNECTION, LIBVIRT_SESSION_CONNECTION } from '../helpers.js';
import { FormGroup, Radio } from '@patternfly/react-core';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const MachinesConnectionSelector = ({ onValueChanged, loggedUser, connectionName, id }) => {
    if (loggedUser.id == 0)
        return null;

    return (
        <FormGroup label={_("Connection")} isInline id={id} className="machines-connection-selector">
            <Radio isChecked={connectionName === LIBVIRT_SYSTEM_CONNECTION}
                   onChange={() => onValueChanged('connectionName', LIBVIRT_SYSTEM_CONNECTION)}
                   name="connectionName"
                   id="connectionName-system"
                   label={_("System")} />
            <Radio isChecked={connectionName == LIBVIRT_SESSION_CONNECTION}
                   onChange={() => onValueChanged('connectionName', LIBVIRT_SESSION_CONNECTION)}
                   name="connectionName"
                   id="connectionName-session"
                   label={_("Session")} />
        </FormGroup>
    );
};
