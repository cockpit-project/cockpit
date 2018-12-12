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

import * as Select from 'cockpit-components-select.jsx';
import { LIBVIRT_SYSTEM_CONNECTION, LIBVIRT_SESSION_CONNECTION } from '../helpers.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const MachinesConnectionSelector = ({ onValueChanged, dialogValues, loggedUser, id }) => {
    let connectionUris = [
        <Select.SelectEntry data={LIBVIRT_SYSTEM_CONNECTION}
                            key={LIBVIRT_SYSTEM_CONNECTION}>{_("QEMU/KVM System connection")}
        </Select.SelectEntry>,
    ];

    // Root user should not be presented the session connection
    if (loggedUser.id != 0)
        connectionUris.push(
            <Select.SelectEntry data={LIBVIRT_SESSION_CONNECTION}
                key={LIBVIRT_SESSION_CONNECTION}>{_("QEMU/KVM User connection")}
            </Select.SelectEntry>
        );

    return (
        <Select.Select id={id}
                       initial={dialogValues.connectionName}
                       onChange={value => onValueChanged('connectionName', value)}>
            {connectionUris}
        </Select.Select>
    );
};
