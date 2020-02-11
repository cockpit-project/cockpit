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
import { getLibvirtServiceState, getRefreshInterval } from '../selectors.js';
import VMS_CONFIG from "../config.js";
import { logDebug } from '../helpers.js';
import { virt } from '../provider.js';
import {
    ATTACH_DISK,
    CHANGE_BOOT_ORDER,
    CHANGE_NETWORK_SETTINGS,
    CHANGE_NETWORK_STATE,
    CHANGE_VM_AUTOSTART,
    CHECK_LIBVIRT_STATUS,
    CONSOLE_VM,
    CREATE_AND_ATTACH_VOLUME,
    CREATE_STORAGE_POOL,
    CREATE_VM,
    DELETE_VM,
    DETACH_DISK,
    ENABLE_LIBVIRT,
    FORCEOFF_VM,
    FORCEREBOOT_VM,
    GET_ALL_NETWORKS,
    GET_ALL_NODE_DEVICES,
    GET_ALL_STORAGE_POOLS,
    GET_ALL_VMS,
    GET_API_DATA,
    GET_HYPERVISOR_MAX_VCPU,
    GET_INTERFACE,
    GET_LOGGED_IN_USER,
    GET_OS_INFO_LIST,
    GET_NETWORK,
    GET_NODE_MAX_MEMORY,
    GET_NODE_DEVICE,
    GET_STORAGE_POOL,
    GET_STORAGE_VOLUMES,
    GET_VM,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    PAUSE_VM,
    REBOOT_VM,
    RESUME_VM,
    SENDNMI_VM,
    SET_VCPU_SETTINGS,
    SET_MEMORY,
    SET_MAX_MEMORY,
    SHUTDOWN_VM,
    START_LIBVIRT,
    START_VM,
    USAGE_START_POLLING,
    USAGE_STOP_POLLING,
} from '../constants/provider-action-types.js';

/**
 * All actions dispatchable by in the application
 */

/** --- Provider action creators -----------------------------------------
 *
 *  The naming convention for action creator names is: <verb><Noun>
 *  with the present tense.
 */
export function attachDisk({ connectionName, poolName, volumeName, format, target, permanent, hotplug, cacheMode, vmName, vmId, shareable, busType }) {
    return virt(ATTACH_DISK, { connectionName, poolName, volumeName, format, target, permanent, hotplug, cacheMode, vmName, vmId, shareable, busType });
}

export function changeBootOrder({ vm, devices }) {
    return virt(CHANGE_BOOT_ORDER, {
        id: vm.id,
        connectionName: vm.connectionName,
        devices,
    });
}

export function changeNetworkSettings({ vm, macAddress, networkType, networkSource, networkModel }) {
    return virt(CHANGE_NETWORK_SETTINGS, {
        id: vm.id,
        name: vm.name,
        connectionName: vm.connectionName,
        networkType,
        networkSource,
        networkModel,
        macAddress,
        isRunning: vm.state == 'running'
    });
}

export function changeNetworkState(vm, networkMac, state) {
    return virt(CHANGE_NETWORK_STATE, { name: vm.name, id: vm.id, networkMac, state, connectionName: vm.connectionName });
}

export function changeVmAutostart({ vm, autostart }) {
    return virt(CHANGE_VM_AUTOSTART, { connectionName: vm.connectionName, vmName: vm.name, autostart: autostart });
}

export function checkLibvirtStatus(serviceName) {
    return virt(CHECK_LIBVIRT_STATUS, { serviceName });
}

export function createStoragePool({ connectionName, name, type, source, target, autostart }) {
    return virt(CREATE_STORAGE_POOL, { connectionName, name, type, source, target, autostart });
}

export function createVm(vmParams) {
    return virt(CREATE_VM, vmParams);
}

export function deleteVm(vm, options, storagePools) {
    return virt(DELETE_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName, options, storagePools });
}

export function detachDisk({ connectionName, target, name, id, live = false, persistent }) {
    return virt(DETACH_DISK, { connectionName, target, name, id, live, persistent });
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

export function getAllNetworks(connectionName) {
    return virt(GET_ALL_NETWORKS, { connectionName });
}

export function getAllNodeDevices(connectionName) {
    return virt(GET_ALL_NODE_DEVICES, { connectionName });
}

export function getAllStoragePools(connectionName) {
    return virt(GET_ALL_STORAGE_POOLS, { connectionName });
}

export function getAllVms(connectionName) {
    return virt(GET_ALL_VMS, { connectionName });
}

/**
 *
 * @param connectionName optional - if `undefined` then for all connections
 * @param libvirtServiceName
 */
export function getApiData(connectionName, libvirtServiceName) {
    return virt(GET_API_DATA, { connectionName, libvirtServiceName });
}

export function getHypervisorMaxVCPU(connectionName) {
    return virt(GET_HYPERVISOR_MAX_VCPU, { connectionName });
}

export function getLoggedInUser() {
    return virt(GET_LOGGED_IN_USER);
}

export function getOsInfoList() {
    return virt(GET_OS_INFO_LIST);
}

export function getNetwork({ connectionName, id, name }) {
    return virt(GET_NETWORK, { connectionName, id, name });
}

export function getInterface({ connectionName, id }) {
    return virt(GET_INTERFACE, { connectionName, id });
}

export function getNodeDevice({ connectionName, id }) {
    return virt(GET_NODE_DEVICE, { connectionName, id });
}

export function getNodeMaxMemory(connectionName) {
    return virt(GET_NODE_MAX_MEMORY, { connectionName });
}

export function getStoragePool({ connectionName, id, name, updateOnly }) {
    return virt(GET_STORAGE_POOL, { connectionName, id, name, updateOnly });
}

export function getStorageVolumes({ connectionName, poolName }) {
    return virt(GET_STORAGE_VOLUMES, { connectionName, poolName });
}

export function getVm({ connectionName, name, id, updateOnly = false }) {
    return virt(GET_VM, {
        connectionName,
        name,
        id,
        updateOnly,
    });
}

export function initDataRetrieval() {
    return virt(INIT_DATA_RETRIEVAL);
}

export function installVm(vm, addErrorNotifications) {
    return virt(INSTALL_VM, Object.assign({}, vm, { addErrorNotifications }));
}

export function pauseVm(vm) {
    return virt(PAUSE_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function rebootVm(vm) {
    return virt(REBOOT_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
}

export function resumeVm(vm) {
    return virt(RESUME_VM, { name: vm.name, id: vm.id, connectionName: vm.connectionName });
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

export function setMemory(vm, memory) {
    return virt(SET_MEMORY, {
        id: vm.id,
        connectionName: vm.connectionName,
        memory,
        isRunning: vm.state == 'running'
    });
}

export function setMaxMemory(vm, maxMemory) {
    return virt(SET_MAX_MEMORY, {
        id: vm.id,
        connectionName: vm.connectionName,
        maxMemory
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

export function volumeCreateAndAttach({ connectionName, poolName, volumeName, size, format, target, permanent, hotplug, cacheMode, vmName, vmId, busType }) {
    return virt(CREATE_AND_ATTACH_VOLUME, { connectionName, poolName, volumeName, size, format, target, permanent, hotplug, cacheMode, vmName, vmId, busType });
}

function delayPollingHelper(action, timeout) {
    return (dispatch, getState) => {
        window.setTimeout(() => {
            const libvirtState = getLibvirtServiceState(getState());
            if (libvirtState !== "running")
                return dispatch(delayPollingHelper(action, timeout));

            logDebug('Executing delayed action');
            dispatch(action);
        }, timeout);
    };
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
            dispatch(delayPollingHelper(action, timeout));
        } else {
            // logDebug(`Skipping delayed action since refreshing is switched off`);
            window.setTimeout(() => dispatch(delayPolling(action, timeout)), VMS_CONFIG.DefaultRefreshInterval);
        }
    };
}
