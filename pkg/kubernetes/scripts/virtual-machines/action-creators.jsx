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

import * as actionConstants from './action-types.jsx'

export function setVms(vms) {
    return {
        type: actionConstants.SET_VMS,
        payload: vms
    }
}

export function setPVs(pvs) {
    return {
        type: actionConstants.SET_PVS,
        payload: pvs
    }
}

export function setSettings(settings) {
    return {
        type: actionConstants.SET_SETTINGS,
        payload: settings
    }
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

export function setPods(pods) {
    return {
        type: actionConstants.SET_PODS,
        payload: pods
    };
}

export function vmExpanded({ vm, isExpanded }) {
    return {
        type: actionConstants.VM_EXPANDED,
        payload: {
            vm,
            isExpanded
        }
    };
}
