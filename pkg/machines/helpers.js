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
import VMS_CONFIG from './config.js';

const _ = cockpit.gettext;

export const LIBVIRT_SESSION_CONNECTION = 'session';
export const LIBVIRT_SYSTEM_CONNECTION = 'system';

export function toReadableNumber(number) {
    if (number < 1) {
        return number.toFixed(2);
    } else {
        const fixed1 = number.toFixed(1);
        return (number - fixed1 === 0) ? number.toFixed(0) : fixed1;
    }
}

export const units = {
    B: {
        name: "B",
        base1024Exponent: 0,
    },
    KiB: {
        name: "KiB",
        base1024Exponent: 1,
    },
    MiB: {
        name: "MiB",
        base1024Exponent: 2,
    },
    GiB: {
        name: "GiB",
        base1024Exponent: 3,
    },
    TiB: {
        name: "TiB",
        base1024Exponent: 4,
    },
    PiB: {
        name: "PiB",
        base1024Exponent: 5,
    },
    EiB: {
        name: "EiB",
        base1024Exponent: 6,
    },
};

const logUnitMap = {
    '0': units.B,
    '1': units.KiB,
    '2': units.MiB,
    '3': units.GiB,
    '4': units.TiB,
    '5': units.PiB,
    '6': units.EiB,
};

function getPowerOf1024(exponent) {
    return exponent === 0 ? 1 : Math.pow(1024, exponent);
}

function getLogarithmOfBase1024(value) {
    return value > 0 ? (Math.floor(Math.log(value) / Math.log(1024))) : 0;
}

export function convertToBestUnit(input, inputUnit) {
    return convertToUnitVerbose(input, inputUnit,
                                logUnitMap[getLogarithmOfBase1024(convertToUnitVerbose(input, inputUnit, units.B).value)]);
}

export function convertToUnit(input, inputUnit, outputUnit) {
    return convertToUnitVerbose(input, inputUnit, outputUnit).value;
}

export function convertToUnitVerbose(input, inputUnit, outputUnit) {
    let result = {
        value: 0,
        unit: units.B.name,
    };

    input = Number(input);
    if (isNaN(input)) {
        console.error('input is not a number');
        return result;
    }

    if (input < 0) {
        console.error(`input == ${input} cannot be less than zero`);
        return result;
    }

    let inUnit = units[(typeof inputUnit === 'string' ? inputUnit : inputUnit.name)];
    let outUnit = units[(typeof outputUnit === 'string' ? outputUnit : outputUnit.name)];

    if (!inUnit || !outUnit) {
        console.error(`unknown unit ${!inUnit ? inputUnit : outputUnit}`);
        return result;
    }

    let exponentDiff = inUnit.base1024Exponent - outUnit.base1024Exponent;
    if (exponentDiff < 0) {
        result.value = input / getPowerOf1024(-1 * exponentDiff);
    } else {
        result.value = input * getPowerOf1024(exponentDiff);
    }
    result.unit = outUnit.name;

    return result;
}

export function isEmpty(str) {
    return (!str || str.length === 0);
}

export function arrayEquals(arr1, arr2) {
    if (arr1.length !== arr2.length) {
        return false;
    }

    const diff = arr1.filter((v, index) => {
        return v !== arr2[index];
    });
    return diff.length === 0;
}

export function logDebug(msg, ...params) {
    if (VMS_CONFIG.isDev) {
        console.log(msg, ...params);
    }
}

export function logError(msg, ...params) {
    console.error(msg, ...params);
}

export function digitFilter(event, allowDots = false) {
    let accept = (allowDots && event.key === '.') || (event.key >= '0' && event.key <= '9') ||
                 event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Tab' ||
                 event.key === 'ArrowLeft' || event.key === 'ArrowRight' ||
                 event.key === 'ArrowUp' || event.key === 'ArrowDown' ||
                 (event.key === 'a' && event.ctrlKey) ||
                 event.key === 'Home' || event.key === 'End';

    if (!accept)
        event.preventDefault();

    return accept;
}

export function getTodayYearShifted(yearDifference) {
    const result = new Date();
    result.setFullYear(result.getFullYear() + yearDifference);
    return result;
}

const transform = {
    'autostart': {
        'disable': _("disabled"),
        'enable': _("enabled"),
        /* The following keys are used in LibvirtDBus provider */
        false: _("disabled"),
        true: _("enabled"),
    },
    'connections': {
        'system': _("System"),
        'session': _("Session"),
    },
    'vmStates': {
        'running': _("running"),
        'idle': _("idle"),
        'paused': _("paused"),
        'shutdown': _("shutdown"),
        'shut off': _("shut off"),
        'crashed': _("crashed"),
        'dying': _("dying"),
        'pmsuspended': _("suspended (PM)"),
    },
    'bootableDisk': {
        'disk': _("disk"),
        'cdrom': _("cdrom"),
        'interface': _("network"),
        'hd': _("disk"),
        'redirdev': _("redirected device"),
        'hostdev': _("host device"),
    },
    'cpuMode': {
        'custom': _("custom"),
        'host-model': _("host"),
    },
    'networkType': {
        'direct': _("direct"),
        'network': _("network"),
        'bridge': _("bridge"),
        'user': _("user"),
        'ethernet': _("ethernet"),
        'hostdev': _("hostdev"),
        'mcast': _("mcast"),
        'server': _("server"),
        'udp': _("udp"),
        'vhostuser': _("vhostuser"),
    },
    'networkForward': {
        'open': _("Open"),
        'nat': "NAT",
        'none': _("None (Isolated Network)"),
        'route': "Routed",
        'bridge': "Bridge",
        'private': _("Private"),
        'vepa': "VEPA",
        'passthrough': "Passthrough",
        'hostdev': "Hostdev",
    },
    'networkManaged': {
        'yes': _("yes"),
        'no': _("no"),
    },
    'networkState': {
        'up': _("up"),
        'down': _("down"),
    },
};

export function rephraseUI(key, original) {
    if (!(key in transform)) {
        logDebug(`rephraseUI(key='${key}', original='${original}'): unknown key`);
        return original;
    }

    if (!(original in transform[key])) {
        logDebug(`rephraseUI(key='${key}', original='${original}'): unknown original value`);
        return original;
    }

    return transform[key][original];
}

export function toFixedPrecision(value, precision) {
    precision = precision || 0;
    const power = Math.pow(10, precision);
    const absValue = Math.abs(Math.round(value * power));
    let result = (value < 0 ? '-' : '') + String(Math.floor(absValue / power));

    if (precision > 0) {
        const fraction = String(absValue % power);
        const padding = new Array(Math.max(precision - fraction.length, 0) + 1).join('0');
        result += '.' + padding + fraction;
    }
    return result;
}

/**
 * Download given content as a file in the browser
 *
 * @param data Content of the file
 * @param fileName
 * @param mimeType
 * @returns {*}
 */
export function fileDownload({ data, fileName = 'myFile.dat', mimeType = 'application/octet-stream' }) {
    if (!data) {
        console.error('fileDownload(): no data to download');
        return false;
    }

    const a = document.createElement('a');
    a.id = 'dynamically-generated-file';
    a.href = `data:${mimeType},${encodeURIComponent(data)}`;
    document.body.appendChild(a); // if not used further then at least within integration tests

    // Workaround since I can't get CSP working for this
    /*
    if ('download' in a) { // html5 A[download]
        logDebug('fileDownload() is using A.HREF');
        a.setAttribute('download', fileName);
        a.click();
    } else */ { // do iframe dataURL download
        logDebug('fileDownload() is using IFRAME');
        const f = document.createElement('iframe');
        f.width = '1';
        f.height = '1';
        document.body.appendChild(f);
        const nicerText = '\n[...............................GraphicsConsole]\n';
        f.src = `data:${mimeType},${encodeURIComponent(data + nicerText)}`;
        window.setTimeout(() => document.body.removeChild(f), 333);
    }

    window.setTimeout(() => { // give test browser some time ...
        logDebug('removing temporary A.HREF for filedownload');
        document.body.removeChild(a);
    }, 5000);
    return true;
}

export function vmId(vmName) {
    return `vm-${vmName}`;
}

export function networkId(poolName, connectionName) {
    return `network-${poolName}-${connectionName}`;
}

export function storagePoolId(poolName, connectionName) {
    return `pool-${poolName}-${connectionName}`;
}

export function mouseClick(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.preventDefault();
        return fun(event);
    };
}

/**
 * Let promise resolve itself in specified delay or force resolve it with 0 arguments
 *
 * @param promise
 * @param delay of timeout in ms
 * @param afterTimeoutHandler called if promise succeeded before timeout expired
 * or timeout expired before promise returned
 * @param afterTimeoutFailHandler called only if promise failed after timeout
 * @returns new promise
 */
export function timeoutedPromise(promise, delay, afterTimeoutHandler, afterTimeoutFailHandler) {
    const deferred = cockpit.defer();
    let done = false;

    let timer = window.setTimeout(() => {
        if (!done) {
            deferred.resolve();
            done = true;
            afterTimeoutHandler();
        }
    }, delay);

    promise.then(function(/* ... */) {
        if (!done) {
            done = true;
            window.clearTimeout(timer);
            deferred.resolve.apply(deferred, arguments);
        }
        if (typeof afterTimeoutHandler === 'function') {
            afterTimeoutHandler.apply(afterTimeoutFailHandler, arguments);
        }
    });

    promise.catch(function(/* ... */) {
        if (!done) {
            done = true;
            window.clearTimeout(timer);
            deferred.reject.apply(deferred, arguments);
        }
        if (typeof afterTimeoutFailHandler === 'function') {
            afterTimeoutFailHandler.apply(afterTimeoutFailHandler, arguments);
        }
    });

    return deferred.promise;
}

export function findHostNodeDevice(hostdev, nodeDevices) {
    let nodeDev;
    switch (hostdev.type) {
    case "usb": {
        const vendorId = hostdev.source.vendor.id;
        const productId = hostdev.source.product.id;

        nodeDev = nodeDevices.find(d => {
            if (vendorId &&
                productId &&
                d.capability.vendor &&
                d.capability.product &&
                d.capability.vendor.id == vendorId &&
                d.capability.product.id == productId)
                return true;
        });
        break;
    }
    case "pci": {
        // convert hexadecimal number in string to decimal number in string
        const domain = parseInt(hostdev.source.address.domain, 16).toString();
        const bus = parseInt(hostdev.source.address.bus, 16).toString();
        const slot = parseInt(hostdev.source.address.slot, 16).toString();
        const func = parseInt(hostdev.source.address.func, 16).toString();

        nodeDev = nodeDevices.find(d => {
            if ((domain && bus && slot && func) &&
                d.capability.domain &&
                d.capability.bus &&
                d.capability.slot &&
                d.capability.function &&
                d.capability.domain._value == domain &&
                d.capability.bus._value == bus &&
                d.capability.slot._value == slot &&
                d.capability.function._value == func)
                return true;
        });
        break;
    }
    case "scsi": {
        const bus = hostdev.source.address.bus;
        const target = hostdev.source.address.target;
        const unit = hostdev.source.address.unit;

        nodeDev = nodeDevices.find(d => {
            if ((bus && target && unit) &&
                d.capability.bus &&
                d.capability.lun &&
                d.capability.target &&
                d.capability.bus._value == bus &&
                d.capability.lun._value == unit &&
                d.capability.target._value == target)
                return true;
        });
        break;
    }
    case "scsi_host": {
        // TODO add scsi_host
        nodeDev = undefined;
        break;
    }
    case "mdev": {
        const uuid = hostdev.source.address.uuid;

        nodeDev = nodeDevices.find(d => {
            if (d.path &&
                d.path._value.contains(uuid))
                return true;
        });
        break;
    }
    }
    return nodeDev;
}

/**
 * Return and array of all devices which can possibly be assigned boot order:
 * disks, interfaces, redirected devices, host devices
 *
 * @param {object} vm
 * @returns {array}
 */
export function getBootOrderDevices(vm) {
    let devices = [];

    // Create temporary arrays of devices
    const disks = Object.values(vm.disks);
    const ifaces = Object.values(vm.interfaces);

    // Some disks and interfaces may have boot order in vm's XML os->boot (legacy)
    if (vm.osBoot) {
        for (let i = 0; i < vm.osBoot.length; i++) {
            const boot = vm.osBoot[i];

            if (boot.type === "disk" || boot.type === "fd" || boot.type === "cdrom") {
                // Find specific device, and remove it from array, only devices without boot order stay
                const dev = disks.find(disk => {
                    // Disk is default value, if device property is not defined
                    // See: www.libvirt.org/formatdomain.html#elementsDisks
                    const type = disk.device ? disk.device : "disk";
                    return disk.device == type || !disk.device;
                });

                if (dev) {
                    disks.splice(disks.indexOf(dev), 1);
                    devices.push({
                        device: dev,
                        bootOrder: i + 1, // bootOrder begins at 1
                        type: "disk"
                    });
                }
            } else if (boot.type === "network") {
                const dev = ifaces[0];
                if (dev) {
                    ifaces.splice(0, 1);
                    devices.push({
                        device: dev,
                        bootOrder: i + 1, // bootOrder begins at 1
                        type: "network"
                    });
                }
            }
        }
    }

    // if boot order was defined in os->boot (old way), array contains only devices without boot order
    // in case of boot order devined in devices->boot (new way), array contains all devices
    for (let i = 0; i < disks.length; i++) {
        const disk = disks[i];

        devices.push({
            device: disk,
            bootOrder: disk.bootOrder,
            type: "disk"
        });
    }

    // if boot order was defined in os->boot (old way), array contains only devices without boot order
    // in case of boot order devined in devices->boot (new way), array contains all devices
    for (let i = 0; i < ifaces.length; i++) {
        const iface = ifaces[i];

        devices.push({
            device: iface,
            bootOrder: iface.bootOrder,
            type: "network"
        });
    }

    // redirected devices cannot have boot order defined in os->boot
    Object.values(vm.redirectedDevices)
            .forEach(redirdev => {
                devices.push({
                    device: redirdev,
                    bootOrder: redirdev.bootOrder,
                    type: "redirdev"
                });
            });

    // host devices cannot have boot order defined in os->boot
    Object.values(vm.hostDevices)
            .forEach(hostdev => {
                devices.push({
                    device: hostdev,
                    bootOrder: hostdev.bootOrder,
                    type: "hostdev"
                });
            });

    return devices;
}

/**
 * Sorts all devices according to their boot order ascending. Devices with no boot order
 * will be at the end of the array.
 *
 * @param {object} vm
 * @returns {array} = sorted array
 */
export function getSortedBootOrderDevices(vm) {
    const devices = getBootOrderDevices(vm);

    devices.sort((a, b) => {
        // If both devices have boot order, sort them by value of their boot order
        if (typeof a.bootOrder !== 'undefined' && typeof b.bootOrder !== 'undefined')
            return a.bootOrder - b.bootOrder;
        // If device A doesn't have boot order and device B has boot order, B must come before A
        else if (typeof a.bootOrder === 'undefined' && typeof b.bootOrder !== 'undefined')
            return 1;
        // If device A has boot order and device B doesn't have boot order, A must come before B
        else if (typeof a.bootOrder !== 'undefined' && typeof b.bootOrder === 'undefined')
            return -1;
        else
        // If both devices don't have boot order, don't sort them
            return 0;
    });

    return devices;
}

function getVmDisksMap(vms, connectionName) {
    let vmDisksMap = {};

    for (let vm of vms) {
        if (vm.connectionName != connectionName)
            continue;

        if (!(vm.name in vmDisksMap))
            vmDisksMap[vm.name] = [];

        for (let disk in vm.disks) {
            const diskProps = vm.disks[disk];

            if (diskProps.type == 'volume')
                vmDisksMap[vm.name].push({ 'type': 'volume', 'pool': diskProps.source.pool, 'volume': diskProps.source.volume });
            else if (diskProps.type == 'file')
                vmDisksMap[vm.name].push({ 'type': 'file', 'source': diskProps.source.file });
            /* Other disk types should be handled as well when we allow their creation from cockpit UI */
        }
    }
    return vmDisksMap;
}

/**
 * Returns a object of key-value pairs of Storage Volume names mapping
 * to arrays of VM names using the relevant Storage Volume
 *
 * @param {object} vms
 * @param {object} storagePool
 * @returns {object}
 */
export function getStorageVolumesUsage(vms, storagePool) {
    // Get a dictionary of vmName -> disks for a specific connection
    const vmDisksMap = getVmDisksMap(vms, storagePool.connectionName);
    const volumes = storagePool.volumes || [];

    // And make it a dictionary of volumeName -> array of Domains using volume
    let isVolumeUsed = {};
    for (let i in volumes) {
        let volumeName = volumes[i].name;
        const targetPath = storagePool.target ? storagePool.target.path : '';
        const volumePath = [targetPath, volumeName].join('/');
        isVolumeUsed[volumeName] = [];

        for (let vmName in vmDisksMap) {
            const disks = vmDisksMap[vmName];

            for (let i in disks) {
                let disk = disks[i];
                if (disk.type == 'volume' && disk.volume == volumeName && disk.pool == storagePool.name)
                    isVolumeUsed[volumeName].push(vmName);

                if (disk.type == 'file' && disk.source == volumePath)
                    isVolumeUsed[volumeName].push(vmName);
            }
        }
    }

    return isVolumeUsed;
}
