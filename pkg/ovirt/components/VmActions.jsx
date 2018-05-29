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
import cockpit from 'cockpit';
import React from "react";

import { suspendVm } from '../actions.es6';
import { vmId } from '../../machines/helpers.es6';

const _ = cockpit.gettext;

const VmActions = ({ vm, providerState, dispatch }) => {
    const clusterVm = providerState.vms[vm.id];
    if (!clusterVm) { // not an oVirt-managed VM
        return null;
    }

    const idPrefix = `${vmId(vm.name)}-ovirt`;

    // TODO: add user confirmation
    return (
        <div className='btn-group' key='action-suspend-group'>
            <button key='action-suspend' className='btn btn-default' id={`${idPrefix}-suspendbutton`}
                    onClick={() => dispatch(suspendVm({ id: clusterVm.id, name: clusterVm.name, connectionName: vm.connectionName }))}>
                {_("Suspend")}
            </button>
        </div>
    );
};

export default VmActions;
