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
import Sysfs from './sysfs.es6';
import { logDebug } from './helpers.es6';

/**
 * All actions dispatchable by the application
 */

// --- Provider actions -----------------------------------------
export function monitorUdevAction () {
    return middleware('MONITOR_UDEV');
}

export function fullRefreshAction () {
    return middleware('FULL_REFRESH');
}

export function unbindPciDevice ({ busId }) {
    return middleware('UNBIND_PCI_DRIVER', { busId });
}

export function bindPciDevice ({ busId, driverName }) {
    return middleware('BIND_PCI_DRIVER', { busId, driverName });
}

/**
 * Helper for dispatching middleware related actions which
 *   - read data from external source (sysfs)
 *   - implement non-trivial data manipulation, usually by dispatching subactions
 */

function middleware(method, payload) {
    return dispatch => {
        if (method in Sysfs) {
            logDebug(`Calling Middleware.${method}(${JSON.stringify(payload)})`);
            return dispatch(Sysfs[method](payload));
        } else {
            console.warn(`method: '${method}' is not supported by Middleware`);
        }
    };
}

export function updatePciDevices ({ devicesMap }) {
    return {
        type: 'UPDATE_PCI_DEVICES',
        payload: {
            devicesMap
        }
    };
}

export function updatePciDeviceIommuGroupAction ({ slot, iommuGroup }) {
    return {
        type: 'UPDATE_PCI_DEVICE_IOMMUGROUP',
        payload: {
            slot,
            iommuGroup
        }
    };
}

export function addPciDrivers ({ driverNames }) {
    return {
        type: 'ADD_PCI_DRIVERS',
        payload: {
            driverNames
        }
    };
}

export function selectPciGroupBy ({ groupBy, selectedGroup }) {
    return {
        type: 'SELECT_PCI_GROUP_BY',
        payload: {
            groupBy,
            selectedGroup
        }
    };
}

export function pciDeviceActionFailed ({ busId, msg }) {
    return {
        type: 'PCI_ACTION_FAILED',
        payload: {
            busId,
            msg
        }
    };
}

export function selectUsb () {
    return {
        type: 'SELECT_USB',
        payload: {}
    };
}

export function setUsbDeviceExpand ({ name, expanded }) {
    return {
        type: 'SET_USB_DEV_EXPAND',
        payload: {
            name,
            expanded
        }
    };

}

export function addUsbDevice ({ device, parent }) {
    return {
      type: 'ADD_USB_DEVICE',
      payload: {
          device,
          parent
      }
    };
}
