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
    ADD_NOTIFICATION,
    ADD_UI_VM,
    CLEAR_NOTIFICATION,
    CLEAR_NOTIFICATIONS,
    DELETE_UI_VM,
    DELETE_UNLISTED_VMS,
    SET_HYPERVISOR_MAX_VCPU,
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
} from '../constants/store-action-types.es6';

/**
 * All actions dispatchable by in the application
 */

/** --- Store action creators -----------------------------------------
 *
 *  The naming convention for action creator names is: <verb><Noun>
 *  with the present tense.
 */

export function addErrorNotification(notification) {
    if (typeof notification === 'string') {
        notification = { message: notification };
    }
    notification.type = 'error';

    return {
        type: ADD_NOTIFICATION,
        notification,
    };
}

export function addNotification(notification) {
    return {
        type: ADD_NOTIFICATION,
        notification,
    };
}

export function addUiVm(vm) {
    return {
        type: ADD_UI_VM,
        vm,
    };
}

export function clearNotification(id) {
    return {
        type: CLEAR_NOTIFICATION,
        id,

    };
}

export function clearNotifications() {
    return {
        type: CLEAR_NOTIFICATIONS,
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

export function deleteVmMessage({ name, connectionName }) {
    // recently there's just the last error message kept so we can reuse the code
    return vmActionFailed({ name, connectionName, message: null, detail: null, extraPayload: null });
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

export function setProvider(provider) {
    return {
        type: SET_PROVIDER,
        provider,
    };
}

export function undefineVm({connectionName, name, id, transientOnly}) {
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

export function updateStoragePools({ connectionName, pools }) {
    return {
        type: UPDATE_STORAGE_POOLS,
        payload: {
            connectionName,
            pools,
        }
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

export function vmActionFailed({ name, connectionName, message, detail, extraPayload }) {
    return {
        type: VM_ACTION_FAILED,
        payload: {
            name,
            connectionName,
            message,
            detail,
            extraPayload,
        },
    };
}
