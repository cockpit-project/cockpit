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
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export const MachinesConnectionSelector = ({ onValueChanged, loggedUser, connectionName, id }) => {
    if (loggedUser.id == 0)
        return null;

    return (
        <>
            <label className="control-label" htmlFor={id}>
                {_("Connection")}
            </label>
            <fieldset className='form-inline' id={id}>
                <div className='radio'>
                    <label>
                        <input type="radio"
                               checked={connectionName === LIBVIRT_SYSTEM_CONNECTION}
                               onChange={() => onValueChanged('connectionName', LIBVIRT_SYSTEM_CONNECTION)}
                               className={connectionName === LIBVIRT_SYSTEM_CONNECTION ? "active" : ''} />
                        {_("System")}
                    </label>
                    <label>
                        <input type="radio"
                               checked={connectionName == LIBVIRT_SESSION_CONNECTION}
                               onChange={() => onValueChanged('connectionName', LIBVIRT_SESSION_CONNECTION)}
                               className={connectionName == LIBVIRT_SESSION_CONNECTION ? "active" : ''} />
                        {_("Session")}
                    </label>
                </div>
            </fieldset>
        </>
    );
};
