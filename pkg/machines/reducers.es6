/*jshint esversion: 6 */
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
import { combineReducers } from 'redux/dist/redux';
import VMS_CONFIG from "./config.es6";
import { logDebug } from './helpers.es6';

// --- compatibility hack for IE
if (!Array.prototype.findIndex) {
    Array.prototype.findIndex = function (predicate) {
        if (this === null) {
            throw new TypeError('Array.prototype.findIndex called on null or undefined');
        }
        if (typeof predicate !== 'function') {
            throw new TypeError('predicate must be a function');
        }
        var list = Object(this);
        var length = list.length >>> 0;
        var thisArg = arguments[1];
        var value;

        for (var i = 0; i < length; i++) {
            value = list[i];
            if (predicate.call(thisArg, value, i, list)) {
                return i;
            }
        }
        return -1;
    };
}

// --- helpers -------------------
function getFirstIndexOfVm(state, field, value, connectionName) {
    return state.findIndex(e => {
        return e.connectionName === connectionName && e[field] === value;
    });
}

// --- reducers ------------------
function config(state, action) {
    state = state ? state : {
        provider: null,
        providerState: null,
        refreshInterval: VMS_CONFIG.DefaultRefreshInterval
    };

    switch (action.type) {
        case 'SET_PROVIDER':
            return Object.assign({}, state, {provider: action.provider});
        case 'SET_REFRESH_INTERVAL':
            const newState = Object.assign({}, state);
            newState.refreshInterval = action.refreshInterval;
            return newState;
        default:
            return state;
    }
}

/**
 * Provider might optionally extend the reducer tree (see state.provider.reducer() function)
 */
function lazyComposedReducer({ parentReducer, getSubreducer, getSubstate, setSubstate }) {
    return (state, action) => {
        let newState = parentReducer(state, action);
        const subreducer = getSubreducer(newState);
        if (subreducer) {
            const newSubstate = subreducer(getSubstate(newState), action);
            if (newSubstate !== getSubstate(newState)) {
                newState = setSubstate(newState, newSubstate);
            }
        }
        return newState;
    };
}

function vms(state, action) {
    state = state ? state : [];

    logDebug('reducer vms: action=' + JSON.stringify(action));

    function findVmToUpdate(state, { connectionName, id, name }) {
        const index = id ? getFirstIndexOfVm(state, 'id', id, connectionName)
            : getFirstIndexOfVm(state, 'name', name, connectionName);
        if (index < 0) {
            logDebug(`vms reducer: vm (name='${name}', connectionName='${connectionName}') not found, skipping`);
            return null;
        }
        return { // return object of {index, copyOfVm}
            index,
            vmCopy: Object.assign({}, state[index]), // TODO: consider immutableJs
        };
    }
    function replaceVm({ state, updatedVm, index }) {
        return state.slice(0, index)
            .concat(updatedVm)
            .concat(state.slice(index + 1));
    }

    switch (action.type) {
        case 'UPDATE_ADD_VM':
        {
            const connectionName = action.vm.connectionName;
            const index = action.vm.id ? getFirstIndexOfVm(state, 'id', action.vm.id, connectionName)
                                       : getFirstIndexOfVm(state, 'name', action.vm.name, connectionName);
            if (index < 0) { // add
                return [...state, action.vm];
            }

            const updatedVm = Object.assign({}, state[index], action.vm);
            return replaceVm({ state, updatedVm, index });
        }
        case 'UPDATE_VM':
        {
            const indexedVm = findVmToUpdate(state, action.vm);
            if (!indexedVm) {
                return state;
            }

            let updatedVm;
            if (action.vm['actualTimeInMs'] < 0) { // clear the usage data (i.e. VM went down)
                logDebug(`Clearing usage data for vm '${action.vm.name}'`);
                updatedVm = Object.assign(indexedVm.vmCopy, action.vm);
                clearUsageData(updatedVm);
            } else {
                timeSampleUsageData(action.vm, indexedVm.vmCopy);
                updatedVm = Object.assign(indexedVm.vmCopy, action.vm);
            }

            // replace whole object
            return replaceVm({ state, updatedVm, index: indexedVm.index });
        }
        case 'VM_ACTION_FAILED': {
            const indexedVm = findVmToUpdate(state, action.payload);
            if (!indexedVm) { // already logged
                return state;
            }
            const updatedVm = Object.assign(indexedVm.vmCopy, {
                lastMessage: action.payload.message,
                lastMessageDetail: action.payload.detail,
            });

            return replaceVm({ state, updatedVm, index: indexedVm.index });
        }
        case 'UNDEFINE_VM':
        {
            return state
                .filter(vm => (action.connectionName !== vm.connectionName || action.name != vm.name ||
                               (action.transientOnly && vm.persistent)));
        }
        case 'DELETE_UNLISTED_VMS':
        {
            return state
                .filter(vm => (action.connectionName !== vm.connectionName || action.vmNames.indexOf(vm.name) >= 0) );
        }
        default: // by default all reducers should return initial state on unknown actions
            return state;
    }
}

function clearUsageData(updatedVm) {
    updatedVm['actualTimeInMs'] = undefined;
    updatedVm['cpuTime'] = undefined;
    updatedVm['cpuUsage'] = undefined;

    updatedVm['rssMemory'] = undefined;
}

function timeSampleUsageData(newVmRecord, previousVmRecord) {
    if (newVmRecord['actualTimeInMs']) { // new usage data are provided
        if (previousVmRecord['actualTimeInMs']) { // diff can be computed
            const timeDiff = (newVmRecord.actualTimeInMs - previousVmRecord.actualTimeInMs) * 1000000; // in nanosecs
            if (timeDiff <= 0) {
                logDebug(`-- timeSampleUsageData(): no time difference`);
                return;
            }
            const cpuTimeDiff = newVmRecord.cpuTime - previousVmRecord.cpuTime; // in nanosecs

            // store computed actual usage stats
            newVmRecord.cpuUsage = (100 * cpuTimeDiff / timeDiff).toFixed(1);

            return;
        } else {
            logDebug(`timeSampleUsageData(): can't compute diff - missing previous record`);
            newVmRecord.cpuUsage = 0;
        }
    }
}

export default combineReducers({
    config: lazyComposedReducer({
        parentReducer: config,
        getSubreducer: (state) => (state.provider && state.provider.reducer) ? state.provider.reducer : undefined,
        getSubstate: (state) => state.providerState,
        setSubstate: (state, subState) => Object.assign({}, state, {providerState: subState})
    } ),
    vms
});
