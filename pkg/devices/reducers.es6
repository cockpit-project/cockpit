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
import { combineReducers } from 'redux';
import { logDebug, logError } from './helpers.es6';

// --- compatibility hack for PhantomJS
if (typeof Object.assign != 'function') {
    Object.assign = function (target) {
        if (target === null) {
            throw new TypeError('Cannot convert undefined or null to object');
        }

        target = Object(target);
        for (var index = 1; index < arguments.length; index++) {
            var source = arguments[index];
            if (source !== null) {
                for (var key in source) {
                    if (Object.prototype.hasOwnProperty.call(source, key)) {
                        target[key] = source[key];
                    }
                }
            }
        }
        return target;
    };
}

// --- reducers ------------------
// TODO: remove if really no more needed
function config(state, action) {
    state = state ? state : { };

    switch (action.type) {
        default:
            return state;
    }
}

function pciDevices (state, action) {
    state = state ? state : {};
    logDebug(`pci reducer: action = ${JSON.stringify(action)}`);

    switch (action.type) {
        case 'UPDATE_PCI_DEVICES': // action.payload.devicesMap is a map of device.Slot and device
        {
            const newState = Object.assign({}, action.payload.devicesMap); // implement real update when needed, so far replace is enough

            // Reuse IOMMU Groups if they are missing
            // A device's Iommu Group is not change once set in the system
            Object.getOwnPropertyNames(newState).forEach(slot => {
                newState[slot].Iommu = newState[slot].Iommu || (state[slot] ? state[slot].Iommu : undefined);
            });

            return newState;
        }
        case 'PCI_ACTION_FAILED':
        {
            if (state[action.payload.busId]) {
                const newState = Object.assign({}, state);
                newState[action.payload.busId] = Object.assign({}, newState[action.payload.busId], {msg: action.payload.msg});
                return newState;
            }
            return state;
        }
        case 'UPDATE_PCI_DEVICE_IOMMUGROUP':
        {
            if (state[action.payload.slot]) {
                const newState = Object.assign({}, state);
                newState[action.payload.slot] = Object.assign({}, newState[action.payload.slot], {Iommu: action.payload.iommuGroup});
                return newState;
            }
            logError(`UPDATE_PCI_DEVICE_IOMMUGROUP reducer: slot not found: '${action.payload.slot}'`);
            return state;
        }
        default:
            return state;
    }
}

function pciDrivers (state, action) {
    /* State is an 'array' of unique driver names.
     Workaround since 'new Set()' is not supported in PhantomJS (ECMAScript 2015)
     */
    state = state ? state : [];

    switch (action.type) {
        case 'ADD_PCI_DRIVERS':
        { // action.payload.driverNames is an array of strings
            const newState = state.slice();
            action.payload.driverNames.forEach(driverName => {
                if (newState.indexOf(driverName) < 0) {
                    newState.push(driverName);
                }
            });
            return newState;
        }
        default:
            return state;
    }
}

function addToUsbParent(state, {device, parent}) {
    if (state[parent]) { // parent found
        state[parent][usbDeviceKey(device)] = { device };
        return state;
    } else { // parent not at this level, search the children
        return Object.getOwnPropertyNames(state)
            .findIndex(
                child => child === 'device' ? false : addToUsbParent(state[child], {device, parent})
            ) >= 0 ? state : null;
    }
}

/**
 * Example: usb1, 1-1, 1-3.4.2
 * identification (name) of the device in the tree.
 */
function usbDeviceKey (device) {
    return device.name;
}

function usbDevices (state, action) {
    state = state ? state : { };
    switch (action.type) {
        case 'ADD_USB_DEVICE':
        {
            const newState = JSON.parse(JSON.stringify(state)); // TODO: introduce immutable.js
            if (!action.payload.parent) { // root_hub
                newState[usbDeviceKey(action.payload.device)] = { device: action.payload.device };
            } else {
                addToUsbParent(newState, action.payload);
            }
            return newState;
        }
        default:
            return state;
    }
}

function visibility(state, action) {
    state = state ? state : { bus: 'pci', // [pci | usb]
        groupBy: 'class', // for bus = pci: [class | numa | iommu | list | driver]
        selectedGroup: undefined, // group to be expanded
        usbExpandedDevices: {} // booleans of 3 states: if undefined, use default - expanded up to level X by default
    };

    switch (action.type) {
        case 'SELECT_PCI_GROUP_BY':
            return Object.assign({}, state, { bus: 'pci', groupBy: action.payload.groupBy,
                selectedGroup: action.payload.selectedGroup === undefined ? null : action.payload.selectedGroup });
        case 'SELECT_USB':
            return Object.assign({}, state, { bus: 'usb' });
        case 'SET_USB_DEV_EXPAND':
        {
            const newState = Object.assign({}, state);
            newState.usbExpandedDevices = Object.assign({}, newState.usbExpandedDevices);
            newState.usbExpandedDevices[action.payload.name] = action.payload.expanded;
            return newState;
        }
        default:
            return state;
    }
}

export default combineReducers({
    config,
    visibility,
    pciDevices,
    pciDrivers,
    usbDevices,
});
