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
} from "../../helpers.es6";

import StateIcon from './stateIcon.jsx';

/** One Ui Dummy VM in the list (a row)
 */
const DummyVm = ({ vm }) => {
    let state = null;

    if (vm.installInProgress) {
        state = 'creating VM installation';
    } else if (vm.createInProgress) {
        state = 'creating VM';
    } else {
        state = 'in transition'; // install script finished and new vm is expected to appear any moment
    }

    const stateIcon = (<StateIcon state={state} valueId={`${vmId(vm.name)}-state`} />);

    const name = (<span id={`${vmId(vm.name)}-row`}>{vm.name}</span>);

    return (<ListingRow
        columns={[
            { name, 'header': true },
            rephraseUI('connections', null),
            stateIcon,
        ]}
        rowId={`${vmId(vm.name)}`}
    />);
};

DummyVm.propTypes = {
    vm: PropTypes.object.isRequired,
};

export default DummyVm;
