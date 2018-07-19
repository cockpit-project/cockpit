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

import * as actionConstants from './action-types.es6';

export function setVms(vms) {
    return {
        type: actionConstants.SET_VMS,
        payload: vms
    };
}

export function setVmis(vmis) {
    return {
        type: actionConstants.SET_VMIS,
        payload: vmis
    };
}

export function setPVs(pvs) {
    return {
        type: actionConstants.SET_PVS,
        payload: pvs
    };
}

export function setSettings(settings) {
    return {
        type: actionConstants.SET_SETTINGS,
        payload: settings
    };
}

export function vmActionFailed({ vm, message, detail }) {
    return {
        type: actionConstants.VM_ACTION_FAILED,
        payload: {
            vm,
            message,
            detail,
        }
    };
}

export function removeVmMessage({ vm }) {
    return {
        type: actionConstants.REMOVE_VM_MESSAGE,
        payload: {
            vm,
        }
    };
}

export function vmiActionFailed({ vmi, message, detail }) {
    return {
        type: actionConstants.VMI_ACTION_FAILED,
        payload: {
            vmi,
            message,
            detail,
        }
    };
}

export function removeVmiMessage({ vmi }) {
    return {
        type: actionConstants.REMOVE_VMI_MESSAGE,
        payload: {
            vmi,
        }
    };
}

export function setPods(pods) {
    return {
        type: actionConstants.SET_PODS,
        payload: pods
    };
}

export function setNodeMetrics(metrics) {
    return {
        type: actionConstants.SET_NODE_METRICS,
        payload: metrics,
    };
}

export function showVm({ vm, isVisible }) {
    return {
        type: actionConstants.SHOW_VM,
        payload: {
            vm,
            isVisible
        }
    };
}

export function showVmi({ vmi, isVisible }) {
    return {
        type: actionConstants.SHOW_VMI,
        payload: {
            vmi,
            isVisible
        }
    };
}
