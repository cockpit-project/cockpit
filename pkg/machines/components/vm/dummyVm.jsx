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
import React from 'react';
import PropTypes from 'prop-types';

import { ListingRow } from "cockpit-components-listing.jsx";

import {
    rephraseUI,
    vmId,
} from "../../helpers.js";

import StateIcon from './stateIcon.jsx';

/** One Ui Dummy VM in the list (a row)
 */
export const DummyVm = ({ vm }) => {
    let state = null;

    if (vm.installInProgress) {
        state = 'creating VM installation';
    } else if (vm.createInProgress) {
        state = 'creating VM';
    } else {
        return null;
    }

    const stateIcon = (<StateIcon state={state} valueId={`${vmId(vm.name)}-state`} />);

    const name = (<span id={`${vmId(vm.name)}-${vm.connectionName}-row`}>{vm.name}</span>);

    return (<ListingRow
        columns={[
            { name, header: true },
            rephraseUI('connections', vm.connectionName),
            stateIcon,
        ]}
        rowId={`${vmId(vm.name)}`}
    />);
};

DummyVm.propTypes = {
    vm: PropTypes.object.isRequired,
};

export function dummyVmsConvert(vms, uiVms) {
    return uiVms.filter(uiVm => vms.find(vm => vm.name == uiVm.name && vm.connectionName == uiVm.connectionName) === undefined);
}
