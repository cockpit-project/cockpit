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
import VMS_CONFIG from "./config.js";
import { logDebug, isObjectEmpty } from './helpers.js';
import {
    ADD_UI_VM,
    DELETE_UI_VM,
    DELETE_UNLISTED_VMS,
    SET_NODE_MAX_MEMORY,
    SET_LOGGED_IN_USER,
    UNDEFINE_NETWORK,
    UNDEFINE_STORAGE_POOL,
    UNDEFINE_VM,
    UPDATE_ADD_INTERFACE,
    UPDATE_ADD_NETWORK,
    UPDATE_ADD_NODE_DEVICE,
    UPDATE_ADD_VM,
    UPDATE_ADD_STORAGE_POOL,
    UPDATE_LIBVIRT_STATE,
    UPDATE_LIBVIRT_VERSION,
    UPDATE_DOMAIN_SNAPSHOTS,
    UPDATE_OS_INFO_LIST,
    UPDATE_STORAGE_VOLUMES,
    UPDATE_UI_VM,
    UPDATE_VM,
} from './constants/store-action-types.js';

// --- helpers -------------------
function getFirstIndexOfResource(state, field, value, connectionName) {
    return state.findIndex(e => {
        return e && e.connectionName === connectionName && e[field] === value;
    });
}

function replaceResource({ state, updatedResource, index }) {
    return state.slice(0, index)
            .concat(updatedResource)
            .concat(state.slice(index + 1));
}

// --- reducers ------------------
function config(state, action) {
    state = state || {
        refreshInterval: VMS_CONFIG.DefaultRefreshInterval,
    };

    switch (action.type) {
    case SET_NODE_MAX_MEMORY: {
        const newState = Object.assign({}, state);
        newState.nodeMaxMemory = action.payload.memory;
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

function interfaces(state, action) {
    state = state || [];

    switch (action.type) {
    case UPDATE_ADD_INTERFACE: {
        const { iface } = action.payload;

        if (isObjectEmpty(iface))
            return [...state, iface]; // initialize iface to empty object

        const connectionName = iface.connectionName;
        const index = getFirstIndexOfResource(state, 'name', iface.name, connectionName);
        if (index < 0) { // add
            const initObjIndex = state.findIndex(obj => isObjectEmpty(obj));
            if (initObjIndex >= 0)
                state.splice(initObjIndex, 1); // remove empty initial object
            return [...state, iface];
        }

        const updatedIface = Object.assign({}, state[index], iface);
        return replaceResource({ state, updatedIface, index });
    }
    default:
        return state;
    }
}

function networks(state, action) {
    state = state || [];

    switch (action.type) {
    case UNDEFINE_NETWORK: {
        const { connectionName, id } = action.payload;

        return state
                .filter(network => (connectionName !== network.connectionName || id != network.id));
    }
    case UPDATE_ADD_NETWORK: {
        const { network, updateOnly } = action.payload;

        if (isObjectEmpty(network))
            return [...state, network]; // initialize network to empty object

        const connectionName = network.connectionName;
        const index = network.id ? getFirstIndexOfResource(state, 'id', network.id, connectionName)
            : getFirstIndexOfResource(state, 'name', network.name, connectionName);
        if (index < 0) {
            if (!updateOnly) {
                const initObjIndex = state.findIndex(obj => isObjectEmpty(obj));
                if (initObjIndex >= 0)
                    state.splice(initObjIndex, 1); // remove empty initial object
                return [...state, network];
            } else {
                return state;
            }
        }

        const updatedNetwork = Object.assign({}, state[index], network);
        return replaceResource({ state, updatedResource: updatedNetwork, index });
    }
    default:
        return state;
    }
}

function nodeDevices(state, action) {
    state = state || [];

    switch (action.type) {
    case UPDATE_ADD_NODE_DEVICE: {
        const { nodedev } = action.payload;

        if (isObjectEmpty(nodedev))
            return [...state, nodedev]; // initialize nodedev to empty object

        const connectionName = nodedev.connectionName;
        const index = getFirstIndexOfResource(state, 'name', nodedev.name, connectionName);
        if (index < 0) { // add
            const initObjIndex = state.findIndex(obj => isObjectEmpty(obj));
            if (initObjIndex >= 0)
                state.splice(initObjIndex, 1); // remove empty initial object
            return [...state, nodedev];
        }

        const updatedNodedev = Object.assign({}, state[index], nodedev);
        return replaceResource({ state, updatedNodedev, index });
    }
    default:
        return state;
    }
}

function vms(state, action) {
    state = state || [];

    logDebug('reducer vms: action=' + JSON.stringify(action));

    function findVmToUpdate(state, { connectionName, id, name }) {
        const index = id ? getFirstIndexOfResource(state, 'id', id, connectionName)
            : getFirstIndexOfResource(state, 'name', name, connectionName);
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

    switch (action.type) {
    case UPDATE_ADD_VM: {
        if (isObjectEmpty(action.vm))
            return [...state, action.vm]; // initialize vm to empty object

        const connectionName = action.vm.connectionName;
        const index = action.vm.id ? getFirstIndexOfResource(state, 'id', action.vm.id, connectionName)
            : getFirstIndexOfResource(state, 'name', action.vm.name, connectionName);
        if (index < 0) { // add
            const initObjIndex = state.findIndex(obj => isObjectEmpty(obj));
            if (initObjIndex >= 0)
                state.splice(initObjIndex, 1); // remove empty initial object
            return [...state, action.vm];
        }

        const updatedVm = Object.assign({}, state[index], action.vm);
        return replaceResource({ state, updatedResource: updatedVm, index });
    }
    case UPDATE_VM: {
        const indexedVm = findVmToUpdate(state, action.vm);
        if (!indexedVm) {
            return state;
        }

        let updatedVm;
        if (action.vm.actualTimeInMs < 0) { // clear the usage data (i.e. VM went down)
            logDebug(`Clearing usage data for vm '${action.vm.name}'`);
            updatedVm = Object.assign(indexedVm.vmCopy, action.vm);
            clearUsageData(updatedVm);
        } else {
            timeSampleUsageData(action.vm, indexedVm.vmCopy);
            updatedVm = Object.assign(indexedVm.vmCopy, action.vm);
        }

        // replace whole object
        return replaceResource({ state, updatedResource: updatedVm, index: indexedVm.index });
    }
    case UPDATE_DOMAIN_SNAPSHOTS: {
        const { connectionName, domainPath, snaps } = action.payload;
        const index = getFirstIndexOfResource(state, 'id', domainPath, connectionName);
        const indexedVm = findVmToUpdate(state, { connectionName, id: domainPath });

        if (index < 0 || !indexedVm)
            return state;

        const updatedVm = Object.assign({}, state[index]);

        updatedVm.snapshots = snaps;

        return replaceResource({ state, updatedResource: updatedVm, index: indexedVm.index });
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
        libvirtVersion: 0,
        osInfoList: null,
        loggedUser: null,
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
    case UPDATE_LIBVIRT_VERSION: {
        return Object.assign({}, state, { libvirtVersion:  action.libvirtVersion });
    }
    case SET_LOGGED_IN_USER: {
        return Object.assign({}, state, { loggedUser: action.payload.loggedUser });
    }
    default: // by default all reducers should return initial state on unknown actions
        return state;
    }
}

function storagePools(state, action) {
    state = state || [];

    function findStoragePoolToUpdate(state, { connectionName, id, name }) {
        const index = id ? getFirstIndexOfResource(state, 'id', id, connectionName)
            : getFirstIndexOfResource(state, 'name', name, connectionName);
        if (index < 0) {
            return null;
        }
        return {
            index,
            storagePoolCopy: Object.assign({}, state[index]),
        };
    }

    switch (action.type) {
    case UNDEFINE_STORAGE_POOL: {
        const { connectionName, id } = action.payload;

        return state
                .filter(storagePool => (connectionName !== storagePool.connectionName || id != storagePool.id));
    }
    case UPDATE_ADD_STORAGE_POOL: {
        const { storagePool, updateOnly, } = action.payload;

        if (isObjectEmpty(storagePool))
            return [...state, storagePool]; // initialize pool to empty object

        const connectionName = storagePool.connectionName;
        const index = storagePool.id ? getFirstIndexOfResource(state, 'id', storagePool.id, connectionName)
            : getFirstIndexOfResource(state, 'name', storagePool.name, connectionName);
        if (index < 0) {
            if (!updateOnly) {
                const initObjIndex = state.findIndex(obj => isObjectEmpty(obj));
                if (initObjIndex >= 0)
                    state.splice(initObjIndex, 1); // remove empty initial object
                return [...state, storagePool];
            } else {
                return state;
            }
        }

        const updatedStoragePool = Object.assign({}, state[index], storagePool);
        return replaceResource({ state, updatedResource: updatedStoragePool, index });
    }
    case UPDATE_STORAGE_VOLUMES: {
        const { connectionName, poolName, volumes } = action.payload;
        const index = getFirstIndexOfResource(state, 'name', poolName, connectionName);

        if (index < 0) {
            return state;
        }

        const indexedStoragePool = findStoragePoolToUpdate(state, { connectionName, name: poolName });
        const updatedStoragePool = Object.assign({}, state[index]);

        updatedStoragePool.volumes = volumes;

        return replaceResource({ state, updatedResource: updatedStoragePool, index: indexedStoragePool.index });
    }
    default:
        return state;
    }
}

function ui(state, action) {
    // transient properties
    state = state || {
        notifications: [],
        vms: [], // transient property
    };
    const addVm = () => {
        const existingVm = state.vms.find(vm => vm.name == action.vm.name && vm.connectionName == action.vm.connectionName);
        if (existingVm === undefined) {
            return {
                ...state,
                vms: [...state.vms, action.vm]
            };
        } else {
            if (existingVm.isUi) {
                const updatedVm = Object.assign(existingVm, action.vm);
                return {
                    ...state,
                    vms: [...state.vms.filter(vm => !(vm.name == action.vm.name && vm.connectionName == action.vm.connectionName)), updatedVm]
                };
            }
        }
    };

    switch (action.type) {
    case ADD_UI_VM:
    case UPDATE_UI_VM:
        return addVm();
    case DELETE_UI_VM: {
        return { ...state, vms: state.vms.filter(vm => !(vm.name == action.vm.name && vm.connectionName == action.vm.connectionName)) };
    }
    default:
        return state;
    }
}

function clearUsageData(updatedVm) {
    updatedVm.actualTimeInMs = undefined;
    updatedVm.cpuTime = undefined;
    updatedVm.cpuUsage = undefined;

    updatedVm.rssMemory = undefined;
}

function timeSampleUsageData(newVmRecord, previousVmRecord) {
    if (newVmRecord.actualTimeInMs) { // new usage data are provided
        if (previousVmRecord.actualTimeInMs) { // diff can be computed
            const timeDiff = (newVmRecord.actualTimeInMs - previousVmRecord.actualTimeInMs) * 1000000; // in nanosecs
            if (timeDiff <= 0) {
                logDebug(`-- timeSampleUsageData(): no time difference`);
                return;
            }
            const cpuTimeDiff = newVmRecord.cpuTime - previousVmRecord.cpuTime; // in nanosecs

            // store computed actual usage stats
            newVmRecord.cpuUsage = (100 * cpuTimeDiff / timeDiff);
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
    interfaces,
    networks,
    nodeDevices,
    vms,
    systemInfo,
    storagePools,
    ui,
});
