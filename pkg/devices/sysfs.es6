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
import { logDebug, logError, spawnScript } from './helpers.es6';
import { updatePciDevices, addPciDrivers, pciDeviceActionFailed, fullRefreshAction, monitorUdevAction,
    updatePciDeviceIommuGroupAction, addUsbDevice } from './actions.es6';

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

function refreshPci ({ dispatch }) {
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

function parseUsbDeviceUdevadmDetails (usbDev, output) {
    const validKeys = ['BUSNUM', 'DEVNAME', 'DEVNUM', 'DEVPATH', 'DRIVER', 'ID_MODEL', 'ID_MODEL_ID', 'ID_REVISION',
        'ID_SERIAL', 'ID_VENDOR_FROM_DATABASE', 'ID_VENDOR_ID' ];

    const parsed = {
        name: usbDev
    };

    output.split('\n').forEach(line => {
        if (line) { // format: 'prefex: key=value'
            const afterPrefix = line.substr(line.indexOf(':') + 1);
            if (afterPrefix) {
                if (line[0] === 'E') {
                    const attr = afterPrefix.trim().split('=');
                    if (attr[0] && attr[1]) {
                        if (validKeys.indexOf(attr[0]) >= 0) {
                            parsed[attr[0]] = attr[1];
                        }
                    } else {
                        logDebug(`Unexpected udevadm info format (key=value): ${afterPrefix}`);
                    }
                }
            } else {
                logDebug(`Unexpected udevadm info format (prefix): ${line}`);
            }
        }
    });

    return parsed;
}

function refreshUsbDevice ({ usbDev, parent, children, prefix, dispatch }) {
    // udevadm takes care of HW DB and wraps access to multiple files
    // naming: root_hub-hub_port:config.interface
    spawnScript(`udevadm info -p ${CONFIG.directories.usbDevs}/${usbDev}`).then( output => {
        const device = parseUsbDeviceUdevadmDetails(usbDev, output);
        dispatch(addUsbDevice({ device, parent }));

        const directChildren = children.filter( dev => dev.substring(prefix.length).indexOf('.') === -1 ); // of same level, example: 2-3, 2-6, not 2-3.1
        directChildren.forEach( child => {
            const newPrefix = `${child}.`;
            const grandChildren = children.filter( dev => dev.indexOf(newPrefix) >= 0 );
            refreshUsbDevice({ usbDev: child, parent: usbDev, children: grandChildren, prefix: newPrefix, dispatch});
        });
    });
}

function refreshUsb ({ dispatch }) {
    // list of all usb devices (without interfaces)
    spawnScript(`ls -1 ${CONFIG.directories.usbDevs} | grep -v ':'`).then( output => {
        const allDevs = output.split('\n').filter(dev => dev); // non-empty only
        const rootHubs = allDevs.filter(dev => dev.indexOf('usb') === 0);
        logDebug(`refreshUsb: root hubs found: ${JSON.stringify(rootHubs)}`);

        rootHubs.forEach( rootHub => { // example: usb1
            const busNum = rootHub.substring('usb'.length);
            const children = allDevs.filter(dev => dev.indexOf(busNum) === 0);// example: all '1-.*' devices
            logDebug(`children for busNum=${busNum}: ${JSON.stringify(children)}`);

            refreshUsbDevice({ usbDev: rootHub, parent: null, children, prefix: `${busNum}-`, dispatch });
        });
    });

}

function fullRefresh({ dispatch }) {
    logDebug('Sysfs.FULL_REFRESH() called');
    refreshPci({ dispatch });
    refreshUsb({ dispatch });
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
    if (refreshRequested && !cockpit.hidden) { // TODO: is the plugin rendered?
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
