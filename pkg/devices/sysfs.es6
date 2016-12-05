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
import CONFIG from './config.es6';
import { logDebug, logError, spawnScript, getRandomInt } from './helpers.es6';
import { updatePciDevices, addPciDrivers, pciDeviceActionFailed, fullRefreshAction, monitorUdevAction, updatePciDeviceIommuGroupAction } from './actions.es6';
/*
function readFile({ path, mustExist = false, doneCallback = content => {}}) {
    const file = cockpit.file(path, {superuser: 'try'});
    file.read()
        .done(content => {
            if (content) { // null if file does not exist
                doneCallback(content);
            } else if (mustExist) {
                logError(`Content of ${path} cannot be read`);
            }
        }).fail(error => {
            logError(`File '${path}' read error: ${error}`);
        }).always(() => {
            file.close();
        });
}
*/

/**
 * Same as readFile() but avoids 'mmap() failed' on '/sys/...' files by using 'cat'.
 *
 * @param path
 * @param mustExist
 * @param doneCallback
 */
/*function readSysfsFile({ path, mustExist = false, doneCallback = content => {}}) {
    // TODO: LC_ALL=C
    cockpit.script(`cat ${path}`, [], {superuser: 'try', err: 'out'})
        .done( content => {
            if (content) {
                doneCallback(content);
            }
        }).fail(() => {
            if (mustExist) {
                logError(`Content of ${path} cannot be read`);
            }
        } );
}

function refreshPciDevice({ pciAddr, dispatch }) {
    logDebug(`refreshPciDevice: ${pciAddr}`);
    const DEVDIR = `${CONFIG.directories.pciDevs}/${pciAddr}`;

    readSysfsFile({path: `${DEVDIR}/vendor`, mustExist: true, doneCallback: vendor => {
        readSysfsFile({path: `${DEVDIR}/class`, mustExist: true, doneCallback: devClass => {
            readSysfsFile({path: `${DEVDIR}/device`, mustExist: true, doneCallback: device => {
// TODO:                dispatch(updatePciDevice({pciAddr, vendor, devClass, device}));
            }});
        }});
    }});
}

function fullRefreshFromFS(dispatch) {
    logDebug('Sysfs.FULL_REFRESH() called');

    // Potential optimization: prepare shell script gathering all data at once
    spawnScript(`ls -1 ${CONFIG.directories.pciDevs}`).then( output => { // result of 'ls'
        output.split('\n').forEach( pciAddr => {
            if (pciAddr) { // non-empty only
                refreshPciDevice({ pciAddr, dispatch });
            }
        });
    });
}
*/

function parseKeyValuePair(line) {
    const chunks = line.split(':');
    return {
        key: chunks[0],
        value: chunks.slice(1).join(':').trim()
    };
}

function checkMandatoryDeviceProps (device) {
    return device.Device && device.Slot && device.Class;
}

function fullRefresh({ dispatch }) {
    logDebug('Sysfs.FULL_REFRESH() called');

    // TODO: check whether lspci is locale-specific; if so set to english - translation is done at rendering
    spawnScript(`lspci -vmmkD`).then( output => { // output of 'lspci' with human readable vendor/devices codes
        const devicesMap = {};

        output.split('\n\n').forEach( deviceOutput => {
            if (deviceOutput) {
                const device = {};
                deviceOutput.split('\n').forEach( line => {
                    const keyValue = parseKeyValuePair(line);
                    /* Example:
                     Slot:	0000:03:00.0
                     Class:	Network controller
                     Vendor:	Intel Corporation
                     Device:	Wireless 7265
                     SVendor:	Intel Corporation
                     SDevice:	Dual Band Wireless-AC 7265
                     Rev:	59
                     Driver:	iwlwifi
                     Module:	iwlwifi
                     */
                    device[keyValue.key] = keyValue.value;
                });

                if (checkMandatoryDeviceProps(device)) {
                    devicesMap[device.Slot] = device;
                } else {
                    logError(`PCI device does not contain all mandatory properties: ${JSON.stringify(device)}`);
                }
            }
        });

        spawnScript(`lspci -vmmDn`).then( output => { // output of 'lspci' with vendor/device codes - second call for error-prone parsing
            output.split('\n\n').forEach( deviceOutput => {
                if (deviceOutput) {
                    const deviceCodes = {};
                    deviceOutput.split('\n').forEach( line => {
                        const keyValue = parseKeyValuePair(line);
                        /* Example:
                         Slot:	0000:03:00.0
                         Class:	0280
                         Vendor:	8086
                         Device:	095b
                         SVendor:	8086
                         SDevice:	5210
                         Rev:	59
                         */
                        deviceCodes[keyValue.key] = keyValue.value;
                    });

                    if (checkMandatoryDeviceProps(deviceCodes)) {
                        // update previously stored device
                        devicesMap[deviceCodes.Slot].ClassCode = deviceCodes.Class;
                        devicesMap[deviceCodes.Slot].VendorCode = deviceCodes.Vendor;
                        devicesMap[deviceCodes.Slot].DeviceCode = deviceCodes.Device;
                        devicesMap[deviceCodes.Slot].SVendorCode = deviceCodes.SVendor;
                        devicesMap[deviceCodes.Slot].SDeviceCode = deviceCodes.SDevice;
                    } else {
                        logError(`PCI device does not contain all mandatory properties: ${JSON.stringify(deviceCodes)}`);
                    }
                }
            });

            dispatch(updatePciDevices({ devicesMap }));

            readIommuGroups({ dispatch, devicesMap });
        });
    });

    spawnScript(`ls -1 /sys/bus/pci/drivers`).then( output => { // all pci driver names
        const driverNames = [];
        output.split('\n').forEach(driverName => {
            const val = driverName.trim();
            if (val) {
                driverNames.push(val);
            }
        });
        dispatch(addPciDrivers({ driverNames }));
    });
}

function readIommuGroups ({ dispatch, devicesMap }) {
    spawnScript(`ls /sys/kernel/iommu_groups`)
        .then( ls => {
            if (ls.trim().length > 0) { // IOMMU Groups are configured on this system, let's read them
                logDebug(`IOMMU Groups are configured on this system`);
                Object.getOwnPropertyNames(devicesMap).forEach(slot => {
                    const iommuPath = `/sys/bus/pci/devices/${slot}/iommu_group`;
                    spawnScript(`readlink -en ${iommuPath}`)
                        .then(groupPath => { // Example: /sys/kernel/iommu_groups/2
                            const iommuGroup = groupPath.substring(groupPath.lastIndexOf('/') + 1);
                            dispatch(updatePciDeviceIommuGroupAction({slot, iommuGroup}));
                        });
                });
            } else {
                logDebug('IOMMU Groups are not configured on this system');
            }});
}

function unbindPciDriver ({ dispatch, payload: { busId } }) {
    logDebug(`calling unbindPciDriver() for busId '${busId}'`);
    const unbindPath = `/sys/bus/pci/devices/${busId}/driver/unbind`;

    spawnScript(`echo '${busId}' > ${unbindPath}`,
        () => dispatch(pciDeviceActionFailed({busId, msg: 'Failed to unbind the driver'}))).then(output => {
            logDebug('Write to unbindfile succeeded');
            dispatch(fullRefreshAction());  // this call is not needed but improves user experience
        });
}

function bindPciDriver ({ dispatch, payload: { busId, driverName } }) {
    logDebug(`calling bindPciDriver() for busId '${busId}' and driverName '${driverName}'`);
    const bindPath = `/sys/bus/pci/drivers/${driverName}/bind`;

    spawnScript(`echo '${busId}' > ${bindPath}`,
        () => dispatch(pciDeviceActionFailed({busId, msg: `Failed to bind the '${driverName}' driver`}))).then( output => {
        logDebug('Write to driver bind file succeeded');
        dispatch(fullRefreshAction()); // this call is not needed but improves user experience
    });
}

let udevMonitorInterval; // set in monitorUdev() after app init and with the dispatch function
let refreshRequested = false; // if true, the fullRefreshAction() will be called in next monitoring interval

function refreshIfNeeded ({ dispatch }) {
    logDebug('refreshIfNeeded called');
    if (refreshRequested) { // TODO: is the plugin rendered?
        refreshRequested = false;
        dispatch(fullRefreshAction());
    }
}

/**
 * Start monitoring of UDEV once per application execution
 */
function monitorUdev ({ dispatch }) {
    logDebug(`Staring UDEV monitoring`);

    dispatch(fullRefreshAction()); // for the beginning ...

    if (udevMonitorInterval === undefined) {
        udevMonitorInterval = window.setInterval(() => refreshIfNeeded({ dispatch }), CONFIG.refreshPeriod);
    }

    cockpit.spawn(['udevadm', 'monitor', '-u'], { pty: true, environ: ['LC_ALL=C'] })
        .stream(chunk => { // UDEV changed
            // Handling every message type would significantly increase complexity of this code and since lspci|lsusb
            // are used for data retrieval and especially wrapping manipulation with the hardware databases, parsing
            // the output and reaction on partial hardware changes would bring almost no benefit.
            // Call of fullRefresh() function is not expensive when performed with reasonable delay.
            // So let's do full refresh - no more than once per time period (CONFIG.refreshPeriod)
            logDebug(`UDEV change`);
            refreshRequested = true;
        })
        .always(() => { // this should better not to happen
            logError(`UDEV monitoring process exited! Will be restarted in ${CONFIG.udevMonitoringRestartDelay} ms`);
            window.setTimeout(() => {dispatch(monitorUdevAction());}, CONFIG.udevMonitoringRestartDelay);
        });
}

const Sysfs = {
    FULL_REFRESH () {
        return dispatch => fullRefresh({ dispatch });
    },
    UNBIND_PCI_DRIVER (payload) {
        return dispatch => unbindPciDriver({ dispatch, payload });
    },
    BIND_PCI_DRIVER (payload) {
        return dispatch => bindPciDriver({ dispatch, payload });
    },
    MONITOR_UDEV () {
        return dispatch => monitorUdev({ dispatch });
    }
};

export default Sysfs;
