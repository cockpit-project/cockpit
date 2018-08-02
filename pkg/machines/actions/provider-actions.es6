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
import { getRefreshInterval } from '../selectors.es6';
import VMS_CONFIG from "../config.es6";
import { logDebug } from '../helpers.es6';
import { virt } from '../provider.es6';
import {
    ATTACH_DISK,
    CHANGE_NETWORK_STATE,
    CHECK_LIBVIRT_STATUS,
    CONSOLE_VM,
    CREATE_AND_ATTACH_VOLUME,
    CREATE_VM,
    DELETE_VM,
    DETACH_DISK,
    ENABLE_LIBVIRT,
    FORCEOFF_VM,
    FORCEREBOOT_VM,
    GET_ALL_VMS,
    GET_HYPERVISOR_MAX_VCPU,
    GET_OS_INFO_LIST,
    GET_STORAGE_POOLS,
    GET_STORAGE_VOLUMES,
    GET_VM,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    REBOOT_VM,
    SENDNMI_VM,
    SET_VCPU_SETTINGS,
    SHUTDOWN_VM,
    START_LIBVIRT,
    START_VM,
    USAGE_START_POLLING,
    USAGE_STOP_POLLING,
} from '../constants/provider-action-types.es6';

/**
 * All actions dispatchable by in the application
 */

/** --- Provider action creators -----------------------------------------
 *
 *  The naming convention for action creator names is: <verb><Noun>
 *  with the present tense.
 */
export function attachDisk({ connectionName, diskFileName, target, permanent, hotplug, vmName, vmId }) {
    return virt(ATTACH_DISK, { connectionName, diskFileName, target, permanent, hotplug, vmName, vmId });
}

export function changeNetworkState(vm, networkMac, state) {
    return virt(CHANGE_NETWORK_STATE, { name: vm.name, id: vm.id, networkMac, state, connectionName: vm.connectionName });
}

export function checkLibvirtStatus(serviceName) {
    return virt(CHECK_LIBVIRT_STATUS, { serviceName });
}

export function createVm(vmParams) {
    return virt(CREATE_VM, vmParams);
}

export function deleteVm(vm, options) {
    return virt(DELETE_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName, options: options });
}

export function detachDisk({ connectionName, target, name, id, live = false }) {
    return virt(DETACH_DISK, { connectionName, target, name, id, live });
}

export function enableLibvirt(enable, serviceName) {
    return virt(ENABLE_LIBVIRT, { enable, serviceName });
}

export function forceRebootVm(vm) {
    return virt(FORCEREBOOT_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function forceVmOff(vm) {
    return virt(FORCEOFF_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

/**
 *
 * @param connectionName optional - if `undefined` then for all connections
 * @param libvirtServiceName
 */
export function getAllVms(connectionName, libvirtServiceName) {
    return virt(GET_ALL_VMS, { connectionName, libvirtServiceName });
}

export function getHypervisorMaxVCPU(connectionName) {
    return virt(GET_HYPERVISOR_MAX_VCPU, { connectionName });
}

export function getOsInfoList() {
    return virt(GET_OS_INFO_LIST);
}

export function getStoragePools(connectionName) {
    return virt(GET_STORAGE_POOLS, { connectionName });
}

export function getStorageVolumes(connectionName, poolName) {
    return virt(GET_STORAGE_VOLUMES, { connectionName, poolName });
}

export function getVm({connectionName, name, id}) {
    return virt(GET_VM, {
        connectionName,
        name,
        id
    });
}

export function initDataRetrieval() {
    return virt(INIT_DATA_RETRIEVAL);
}

export function installVm(vm) {
    return virt(INSTALL_VM, vm);
}

export function rebootVm(vm) {
    return virt(REBOOT_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function sendNMI(vm) {
    return virt(SENDNMI_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function setVCPUSettings(vm, max, count, sockets, threads, cores) {
    return virt(SET_VCPU_SETTINGS, {
        id: vm.id,
        name: vm.name,
        connectionName: vm.connectionName,
        max,
        count,
        sockets,
        threads,
        cores,
        isRunning: vm.state == 'running'
    });
}

export function shutdownVm(vm) {
    return virt(SHUTDOWN_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function startLibvirt(serviceName) {
    return virt(START_LIBVIRT, { serviceName });
}

export function startVm(vm) {
    return virt(START_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function usageStartPolling(vm) {
    return virt(USAGE_START_POLLING, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function usageStopPolling(vm) {
    return virt(USAGE_STOP_POLLING, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function vmDesktopConsole(vm, consoleDetail) {
    return virt(CONSOLE_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName, consoleDetail });
}

export function volumeCreateAndAttach({ connectionName, poolName, volumeName, size, format, target, permanent, hotplug, vmName, vmId }) {
    return virt(CREATE_AND_ATTACH_VOLUME, { connectionName, poolName, volumeName, size, format, target, permanent, hotplug, vmName, vmId });
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
 * @param timeout Non-default timeout
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
