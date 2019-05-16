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
import {
    ADD_UI_VM,
    DELETE_UI_VM,
    DELETE_UNLISTED_VMS,
    SET_HYPERVISOR_MAX_VCPU,
    SET_NODE_MAX_MEMORY,
    SET_LOGGED_IN_USER,
    SET_PROVIDER,
    UNDEFINE_NETWORK,
    UNDEFINE_STORAGE_POOL,
    UNDEFINE_VM,
    UPDATE_ADD_NETWORK,
    UPDATE_ADD_NODE_DEVICE,
    UPDATE_ADD_STORAGE_POOL,
    UPDATE_ADD_VM,
    UPDATE_LIBVIRT_STATE,
    UPDATE_LIBVIRT_VERSION,
    UPDATE_OS_INFO_LIST,
    UPDATE_STORAGE_VOLUMES,
    UPDATE_UI_VM,
    UPDATE_VM,
} from '../constants/store-action-types.js';

/**
 * All actions dispatchable by in the application
 */

/** --- Store action creators -----------------------------------------
 *
 *  The naming convention for action creator names is: <verb><Noun>
 *  with the present tense.
 */
export function addUiVm(vm) {
    return {
        type: ADD_UI_VM,
        vm,
    };
}

export function deleteUiVm(vm) {
    return {
        type: DELETE_UI_VM,
        vm,
    };
}

export function deleteUnlistedVMs(connectionName, vmNames, vmIds) {
    return {
        type: DELETE_UNLISTED_VMS,
        vmNames,
        vmIds,
        connectionName,
    };
}

export function setHypervisorMaxVCPU({ count, connectionName }) {
    return {
        type: SET_HYPERVISOR_MAX_VCPU,
        payload: {
            count,
            connectionName,
        }
    };
}

export function setNodeMaxMemory({ memory }) {
    return {
        type: SET_NODE_MAX_MEMORY,
        payload: { memory }
    };
}

export function setLoggedInUser({ loggedUser }) {
    return {
        type: SET_LOGGED_IN_USER,
        payload: {
            loggedUser
        }
    };
}

export function setProvider(provider) {
    return {
        type: SET_PROVIDER,
        provider,
    };
}

export function undefineNetwork({ connectionName, id }) {
    return {
        type: UNDEFINE_NETWORK,
        payload: {
            connectionName,
            id,
        }
    };
}

export function undefineStoragePool({ connectionName, id }) {
    return {
        type: UNDEFINE_STORAGE_POOL,
        payload: {
            connectionName,
            id,
        }
    };
}

export function undefineVm({ connectionName, name, id, transientOnly }) {
    return {
        type: UNDEFINE_VM,
        name,
        id,
        connectionName,
        transientOnly,
    };
}

export function updateLibvirtState(state) {
    return {
        type: UPDATE_LIBVIRT_STATE,
        state,
    };
}

export function updateLibvirtVersion({ libvirtVersion }) {
    return {
        type: UPDATE_LIBVIRT_VERSION,
        libvirtVersion,
    };
}

export function updateOrAddNetwork(props, updateOnly) {
    return {
        type: UPDATE_ADD_NETWORK,
        payload: { network: props, updateOnly },
    };
}

export function updateOrAddNodeDevice(props) {
    return {
        type: UPDATE_ADD_NODE_DEVICE,
        payload: { nodedev: props },
    };
}

export function updateOrAddStoragePool(props, updateOnly) {
    return {
        type: UPDATE_ADD_STORAGE_POOL,
        payload: { storagePool: props, updateOnly },
    };
}

export function updateOrAddVm(props) {
    return {
        type: UPDATE_ADD_VM,
        vm: props,
    };
}

export function updateOsInfoList(osInfoList) {
    return {
        type: UPDATE_OS_INFO_LIST,
        osInfoList,
    };
}

export function updateStorageVolumes({ connectionName, poolName, volumes }) {
    return {
        type: UPDATE_STORAGE_VOLUMES,
        payload: {
            connectionName,
            poolName,
            volumes,
        },
    };
}

export function updateUiVm(vm) {
    return {
        type: UPDATE_UI_VM,
        vm,
    };
}

export function updateVm(props) {
    return {
        type: UPDATE_VM,
        vm: props,
    };
}
