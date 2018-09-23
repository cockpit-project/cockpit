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
import {
    ADD_NOTIFICATION,
    ADD_UI_VM,
    CLEAR_NOTIFICATION,
    CLEAR_NOTIFICATIONS,
    DELETE_UI_VM,
    DELETE_UNLISTED_VMS,
    SET_PROVIDER,
    UNDEFINE_VM,
    UPDATE_ADD_VM,
    UPDATE_LIBVIRT_STATE,
    UPDATE_OS_INFO_LIST,
    UPDATE_STORAGE_POOLS,
    UPDATE_STORAGE_VOLUMES,
    UPDATE_UI_VM,
    UPDATE_VM,
    VM_ACTION_FAILED,
} from './constants/store-action-types.es6';

// --- helpers -------------------
function getFirstIndexOfVm(state, field, value, connectionName) {
    return state.findIndex(e => {
        return e.connectionName === connectionName && e[field] === value;
    });
}

// --- reducers ------------------
function config(state, action) {
    state = state || {
        provider: null,
        providerState: null,
        refreshInterval: VMS_CONFIG.DefaultRefreshInterval,
    };

    switch (action.type) {
    case SET_PROVIDER:
        return Object.assign({}, state, { provider: action.provider });
    case 'SET_HYPERVISOR_MAX_VCPU': {
        const newState = Object.assign({}, state);
        newState.hypervisorMaxVCPU = Object.assign({}, newState.hypervisorMaxVCPU, { [action.payload.connectionName]: action.payload.count });
        return newState;
    }
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
    state = state || [];

    logDebug('reducer vms: action=' + JSON.stringify(action));

    function findVmToUpdate(state, { connectionName, id, name }) {
        const index = id ? getFirstIndexOfVm(state, 'id', id, connectionName)
            : getFirstIndexOfVm(state, 'name', name, connectionName);
        if (index < 0) {
            if (id)
                logDebug(`vms reducer: vm (id='${id}', connectionName='${connectionName}') not found, skipping`);
            else
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
    case UPDATE_ADD_VM: {
        const connectionName = action.vm.connectionName;
        const index = action.vm.id ? getFirstIndexOfVm(state, 'id', action.vm.id, connectionName)
            : getFirstIndexOfVm(state, 'name', action.vm.name, connectionName);
        if (index < 0) { // add
            return [...state, action.vm];
        }

        const updatedVm = Object.assign({}, state[index], action.vm);
        return replaceVm({ state, updatedVm, index });
    }
    case UPDATE_VM: {
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
    case VM_ACTION_FAILED: {
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
    case UNDEFINE_VM: {
        if (action.id)
            return state
                    .filter(vm => (action.connectionName !== vm.connectionName || action.id != vm.id ||
                        (action.transientOnly && vm.persistent)));
        else
            return state
                    .filter(vm => (action.connectionName !== vm.connectionName || action.name != vm.name ||
                        (action.transientOnly && vm.persistent)));
    }
    case DELETE_UNLISTED_VMS: {
        if (action.vmIDs)
            return state
                    .filter(vm => (action.connectionName !== vm.connectionName || action.vmIDs.indexOf(vm.id) >= 0));
        else
            return state
                    .filter(vm => (action.connectionName !== vm.connectionName || action.vmNames.indexOf(vm.name) >= 0));
    }
    default: // by default all reducers should return initial state on unknown actions
        return state;
    }
}

function systemInfo(state, action) {
    state = state || {
        libvirtService: {
            name: 'unknown',
            activeState: 'unknown',
            unitState: 'unknown',
        },
        osInfoList: [],
    };

    switch (action.type) {
    case UPDATE_OS_INFO_LIST: {
        if (action.osInfoList instanceof Array) {
            return Object.assign({}, state, { osInfoList: action.osInfoList });
        }
        return state;
    }
    case UPDATE_LIBVIRT_STATE: {
        return Object.assign({}, state, { libvirtService:  Object.assign({}, state.libvirtService, action.state) });
    }
    default: // by default all reducers should return initial state on unknown actions
        return state;
    }
}

function storagePools(state, action) {
    state = state || { };
    /* Example:
    state = { "connectionNameA": {
            "poolNameA": [
                {name, path},
                {name, path},
            ],
            "poolNameB": []
            },
            "connectionNameB": {}
       }
    */
    switch (action.type) {
    case UPDATE_STORAGE_POOLS: {
        const { connectionName, pools } = action.payload;

        const newState = Object.assign({}, state);
        if (!(connectionName in newState))
            newState[connectionName] = {};
        else
            newState[connectionName] = Object.assign({}, state[connectionName]);

        // Delete pools from state that are not in the payload
        for (var poolCurrent in newState[connectionName]) {
            if (!pools.includes(poolCurrent)) {
                delete newState[connectionName][poolCurrent];
            }
        }

        // Add new pools to state
        for (var i in pools) {
            let poolName = pools[i];
            if (!(poolName in newState[connectionName])) {
                newState[connectionName][poolName] = [];
            }
        }

        return newState;
    }
    case UPDATE_STORAGE_VOLUMES: {
        const { connectionName, poolName, volumes } = action.payload;

        const newState = Object.assign({}, state);
        newState[connectionName] = Object.assign({}, newState[connectionName]);
        newState[connectionName][poolName] = volumes;
        return newState;
    }
    default: // by default all reducers should return initial state on unknown actions
        return state;
    }
}

function ui(state, action) {
    // transient properties
    state = state || {
        notifications: [],
        vms: {}, // transient property
    };
    const addVm = () => {
        let newState = Object.assign({}, state);
        newState.vms = Object.assign({}, state.vms);
        const oldVm = newState.vms[action.vm.name];
        const vm = Object.assign({}, oldVm, action.vm);

        newState.vms = Object.assign({}, newState.vms, {
            [action.vm.name]: vm,
        });
        return newState;
    };

    switch (action.type) {
    case ADD_UI_VM: {
        return addVm();
    }
    case UPDATE_UI_VM: {
        if (state.vms[action.vm.name] && state.vms[action.vm.name].isUi) {
            return addVm();
        }
        return state;
    }
    case DELETE_UI_VM: {
        let newState = Object.assign({}, state);
        newState.vms = Object.assign({}, state.vms);
        delete newState.vms[action.vm.name];
        return newState;
    }
    case ADD_NOTIFICATION: {
        const notification = typeof action.notification === 'string' ? { message: action.notification } : action.notification;
        const notifs = state.notifications;
        notification.id = notifs.length > 0 ? notifs[notifs.length - 1].id + 1 : 1;

        if (!notification.type) {
            notification.type = 'info';
        }

        state.notifications = [...notifs, notification];
        return state;
    }
    case CLEAR_NOTIFICATION: {
        state.notifications = state.notifications.filter(error => error.id !== action.id);
        return state;
    }
    case CLEAR_NOTIFICATIONS: {
        state.notifications = [];
        return state;
    }
    default:
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
        setSubstate: (state, subState) => Object.assign({}, state, { providerState: subState }),
    }),
    vms,
    systemInfo,
    storagePools,
    ui,
});
