/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import { combineReducers } from 'redux';

import * as actionTypes from './action-types.jsx';
import { createReducer } from './reducers/utils.es6';

import vmsUiReducer from './reducers/vmsUi.es6';
import vmisUiReducer from './reducers/vmisUi.es6';

/**
 * state = [
 *  { ... } : Vmi
 * ]
 */
const vmisReducer = createReducer([], {
    [actionTypes.SET_VMIS]: (state = [], { payload }) => payload || []
});

const vmsReducer = createReducer([], {
    [actionTypes.SET_VMS]: (state = [], { payload }) => payload || []
});

const pvsReducer = createReducer([], {
    [actionTypes.SET_PVS]: (state = [], { payload }) => payload || []
});

const podsReducer = createReducer([], {
    [actionTypes.SET_PODS]: (state = [], { payload }) => payload || []
});

/**
 * state = [
 *   {...}
 * ]
 */
const settingsReducer = createReducer([], {
    [actionTypes.SET_SETTINGS]: (state = [], { payload }) => payload || {}
});

const nodeMetricsReducer = createReducer({}, {
    [actionTypes.SET_NODE_METRICS]: (state = {}, { payload }) => {
        return payload.node ? Object.assign({}, state, { [payload.node.nodeName]: payload }) : state;
    },
});

const rootReducer = combineReducers({
    vmis: vmisReducer, // VirtualMachineInstances from API
    vms: vmsReducer, // VirtualMachines from API
    pvs: pvsReducer, // PersistenVolumes from API
    pods: podsReducer, // Pods from API
    nodeMetrics: nodeMetricsReducer, // metrics of all VM's nodes
    vmsUi: vmsUiReducer, // various VM UI-state descriptions (i.e. to restore UI after back-button, messages related to a VM)
    vmisUi: vmisUiReducer, // also
    settings: settingsReducer, // settings gathered at run-time
});

export default rootReducer;
