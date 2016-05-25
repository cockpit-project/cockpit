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
import cockpit from 'cockpit';
import Libvirt from './libvirt.es6';
import { getRefreshInterval } from './selectors.es6';
import VMS_CONFIG from "./config.es6";
import { logDebug } from './helpers.es6';

/**
 * All actions dispatchable by in the application
 */

// --- Provider actions -----------------------------------------
export function getAllVms() {
    return virt('GET_ALL_VMS');
}

export function getVm(lookupId) {
    return virt('GET_VM', {lookupId}); // provider-specific (i.e. libvirt uses vm_name)
}

export function shutdownVm(name) {
    return virt('SHUTDOWN_VM', {name});
}

export function forceVmOff(name) {
    return virt('FORCEOFF_VM', {name});
}

export function rebootVm(name) {
    return virt('REBOOT_VM', {name});
}

export function forceRebootVm(name) {
    return virt('FORCEREBOOT_VM', {name});
}

export function startVm(name) {
    return virt('START_VM', {name});
}

/**
 * Helper for dispatching virt provider methods.
 *
 * Lazily initializes the virt provider and dispatches given method on it.
 */
function virt(method, action) {
    return (dispatch, getState) => getVirtProvider({dispatch, getState}).then(provider => {
        if (method in provider) {
            logDebug(`Calling ${provider.name}.${method}(${JSON.stringify(action)})`);
            return dispatch(provider[method](action));
        } else {
            console.warn(`method: '${method}' is not supported by provider: '${provider.name}'`);
        }
    }).catch(err => {
        console.error('could not detect any virt provider');
    });
}

function getVirtProvider(store) {
    const state = store.getState();
    if (state.config.provider) {
        return cockpit.resolve(state.config.provider);
    } else {
        const deferred = cockpit.defer();
        logDebug('Discovering provider');
        /* TODO: discover host capabilities
         systemctl is-active vdsmd
         active
         unknown
         */
        let provider = null;
        if (false /*TODO: Detect VDSM*/) {
            // TODO: dispatch/resolve VDSM provider
        } else if (true /* TODO: detect libvirt */) {
            logDebug('Selecting Libvirt as the VIRT provider.');
            provider = Libvirt;
        }

        if (!provider) { //  no provider available
            deferred.reject();
        } else {
            store.dispatch(setProvider(provider));

            // Skip the initialization if provider does not define the `init` hook.
            if (!provider.init) {
                deferred.resolve(provider);
            } else {
                // Providers are expected to return promise as a part of initialization
                // so we can resolve only after the provider had time to properly initialize.
                store
                    .dispatch(provider.init())
                    .then(() => deferred.resolve(provider))
                    .catch(deferred.reject);
            }
        }

        return deferred.promise;
    }
}

/**
 * Delay call of polling action.
 *
 * To avoid execution overlap, the setTimeout() is used instead of setInterval().
 *
 * The delayPolling() function is called after previous execution is finished so
 * the refresh interval starts counting since that moment.
 *
 * If the application is not visible, the polling action execution is skipped
 * and scheduled on later.
 *
 * @param action I.e. getAllVms()
 */
export function delayPolling(action, timeout) {
    return (dispatch, getState) => {
        timeout = timeout || getRefreshInterval(getState());

        if (timeout > 0 && !cockpit.hidden) {
            logDebug(`Scheduling ${timeout} ms delayed action`);
            window.setTimeout(() => {
                logDebug('Executing delayed action');
                dispatch(action);
            }, timeout);
        } else {
            // logDebug(`Skipping delayed action since refreshing is switched off`);
            window.setTimeout(() => dispatch(delayPolling(action, timeout)), VMS_CONFIG.DefaultRefreshInterval);
        }
    };
}

// --- Store actions --------------------------------------------
export function setProvider(provider) {
    return {
        type: 'SET_PROVIDER',
        provider
    };
}

export function setRefreshInterval(refreshInterval) {
    return {
        type: 'SET_REFRESH_INTERVAL',
        refreshInterval
    };
}

export function updateOrAddVm({ id, name, state, osType, fqdn, uptime, currentMemory, rssMemory, vcpus, autostart,
    actualTimeInMs, cpuTime }) {
    let vm = {};

    if (id !== undefined) vm.id = id;
    if (name !== undefined) vm.name = name;
    if (state !== undefined) vm.state = state;
    if (osType !== undefined) vm.osType = osType;
    if (currentMemory !== undefined) vm.currentMemory = currentMemory;
    if (rssMemory !== undefined) vm.rssMemory = rssMemory;
    if (vcpus !== undefined) vm.vcpus = vcpus;
    if (fqdn !== undefined) vm.fqdn = fqdn;
    if (uptime !== undefined) vm.uptime = uptime;
    if (autostart !== undefined) vm.autostart = autostart;

    if (actualTimeInMs !== undefined) vm.actualTimeInMs = actualTimeInMs;
    if (cpuTime !== undefined) vm.cpuTime = cpuTime;

    return {
        type: 'UPDATE_ADD_VM',
        vm
    };
}

export function deleteUnlistedVMs(vmNames) {
    return {
        type: 'DELETE_UNLISTED_VMS',
        vmNames
    };
}

export function hostVmsListToggleVmExpand({name}) { // VM name has ben clicked in a list
    return {
        type: 'HOSTVMSLIST_TOGGLE_VM_EXPAND',
        name
    };
}

export function hostVmsListShowSubtab({name, order}) { // VM subtab has been clicked
    return {
        type: 'HOSTVMSLIST_SHOW_VM_SUBTAB',
        name,
        order
    };
}
