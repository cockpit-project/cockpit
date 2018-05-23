import cockpit from 'cockpit';

import {
    vmActionFailed
} from './actions.es6';

import {
    logDebug,
    rephraseUI,
} from './helpers.es6';

const _ = cockpit.gettext;

/**
 * Returns a function handling VM action failures.
 */
export function buildFailHandler({ dispatch, name, connectionName, message, extraPayload }) {
    return ({ exception, data }) =>
        dispatch(vmActionFailed({
            name,
            connectionName,
            message,
            detail: {
                exception,
                data,
            },
            extraPayload,
        }));
}

export function buildScriptTimeoutFailHandler(args, delay) {
    let handler = buildFailHandler(args);
    return ({ message, exception }) => {
        window.setTimeout(() => {
            handler({
                exception: exception || message,
            });
        }, delay);
    };
}

function getBootableDeviceType(device) {
    const tagName = device.tagName;
    let type = _("other");
    switch (tagName) {
    case 'disk':
        type = rephraseUI('bootableDisk', device.getAttribute('device')); // Example: disk, cdrom
        break;
    case 'interface':
        type = rephraseUI('bootableDisk', 'interface');
        break;
    default:
        console.info(`Unrecognized type of bootable device: ${tagName}`);
    }
    return type;
}

export function getSingleOptionalElem(parent, name) {
    const subElems = parent.getElementsByTagName(name);
    return subElems.length > 0 ? subElems[0] : undefined; // optional
}

export function parseDumpxmlForBootOrder(osElem, devicesElem) {
    const bootOrder = {
        devices: [],
    };

    // Prefer boot order defined in domain/os element
    const osBootElems = osElem.getElementsByTagName('boot');
    if (osBootElems.length > 0) {
        for (let bootNum = 0; bootNum < osBootElems.length; bootNum++) {
            const bootElem = osBootElems[bootNum];
            const dev = bootElem.getAttribute('dev');
            if (dev) {
                bootOrder.devices.push({
                    order: bootNum,
                    type: rephraseUI('bootableDisk', dev) // Example: hd, network, fd, cdrom
                });
            }
        }
        return bootOrder; // already sorted
    }

    // domain/os/boot elements not found, decide from device's boot elements
    // VM can be theoretically booted from any device.
    const bootableDevices = [];
    for (let devNum = 0; devNum < devicesElem.childNodes.length; devNum++) {
        const deviceElem = devicesElem.childNodes[devNum];
        if (deviceElem.nodeType === 1) { // XML elements only
            const bootElem = getSingleOptionalElem(deviceElem, 'boot');
            if (bootElem && bootElem.getAttribute('order')) {
                bootableDevices.push({
                    // so far just the 'type' is rendered, skipping redundant attributes
                    order: parseInt(bootElem.getAttribute('order')),
                    type: getBootableDeviceType(deviceElem),
                });
            }
        }
    }
    bootOrder.devices = bootableDevices.sort((devA, devB) => devA.order - devB.order);
    return bootOrder;
}

export function parseDumpxmlForConsoles(devicesElem) {
    const displays = {};
    const graphicsElems = devicesElem.getElementsByTagName("graphics");
    if (graphicsElems) {
        for (let i = 0; i < graphicsElems.length; i++) {
            const graphicsElem = graphicsElems[i];
            const display = {
                type: graphicsElem.getAttribute('type'),
                port: graphicsElem.getAttribute('port'),
                tlsPort: graphicsElem.getAttribute('tlsPort'),
                address: graphicsElem.getAttribute('listen'),
                autoport: graphicsElem.getAttribute('autoport'),
            };
            if (display.type &&
                (display.autoport ||
                (display.address && (display.port || display.tlsPort)))) {
                displays[display.type] = display;
                logDebug(`parseDumpxmlForConsoles(): graphics device found: ${JSON.stringify(display)}`);
            } else {
                console.warn(`parseDumpxmlForConsoles(): mandatory properties are missing in dumpxml, found: ${JSON.stringify(display)}`);
            }
        }
    }

    // console type='pty'
    const consoleElems = devicesElem.getElementsByTagName("console");
    if (consoleElems) {
        for (let i = 0; i < consoleElems.length; i++) {
            const consoleElem = consoleElems[i];
            if (consoleElem.getAttribute('type') === 'pty') {
                // Definition of serial console is detected.
                // So far no additional details needs to be parsed since the console is accessed via 'virsh console'.
                displays['pty'] = {};
            }
        }
    }

    return displays;
}

export function parseDumpxmlForDisks(devicesElem) {
    const disks = {};
    const diskElems = devicesElem.getElementsByTagName('disk');
    if (diskElems) {
        for (let i = 0; i < diskElems.length; i++) {
            const diskElem = diskElems[i];

            const targetElem = diskElem.getElementsByTagName('target')[0];

            const driverElem = getSingleOptionalElem(diskElem, 'driver');
            const sourceElem = getSingleOptionalElem(diskElem, 'source');
            const serialElem = getSingleOptionalElem(diskElem, 'serial');
            const aliasElem = getSingleOptionalElem(diskElem, 'alias');
            const readonlyElem = getSingleOptionalElem(diskElem, 'readonly');
            const shareableElem = getSingleOptionalElem(diskElem, 'shareable');
            const bootElem = getSingleOptionalElem(diskElem, 'boot');

            const sourceHostElem = sourceElem ? getSingleOptionalElem(sourceElem, 'host') : undefined;

            const disk = { // see https://libvirt.org/formatdomain.html#elementsDisks
                target: targetElem.getAttribute('dev'), // identifier of the disk, i.e. sda, hdc
                driver: {
                    name: driverElem ? driverElem.getAttribute('name') : undefined, // optional
                    type: driverElem ? driverElem.getAttribute('type') : undefined,
                    cache: driverElem ? driverElem.getAttribute('cache') : undefined, // optional
                    discard: driverElem ? driverElem.getAttribute('discard') : undefined, // optional
                    io: driverElem ? driverElem.getAttribute('io') : undefined, // optional
                    errorPolicy: driverElem ? driverElem.getAttribute('error_policy') : undefined, // optional
                },
                bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                type: diskElem.getAttribute('type'), // i.e.: file
                device: diskElem.getAttribute('device'), // i.e. cdrom, disk
                source: {
                    file: sourceElem ? sourceElem.getAttribute('file') : undefined, // optional file name of the disk
                    dev: sourceElem ? sourceElem.getAttribute('dev') : undefined,
                    pool: sourceElem ? sourceElem.getAttribute('pool') : undefined,
                    volume: sourceElem ? sourceElem.getAttribute('volumne') : undefined,
                    protocol: sourceElem ? sourceElem.getAttribute('protocol') : undefined,
                    host: {
                        name: sourceHostElem ? sourceHostElem.getAttribute('name') : undefined,
                        port: sourceHostElem ? sourceHostElem.getAttribute('port') : undefined,
                    },
                    startupPolicy: sourceElem ? sourceElem.getAttribute('startupPolicy') : undefined, // optional startupPolicy of the disk

                },
                bus: targetElem.getAttribute('bus'), // i.e. scsi, ide
                serial: serialElem ? serialElem.getAttribute('serial') : undefined, // optional serial number
                aliasName: aliasElem ? aliasElem.getAttribute('name') : undefined, // i.e. scsi0-0-0-0, ide0-1-0
                readonly: !!readonlyElem,
                shareable: !!shareableElem,
                removable: targetElem.getAttribute('removable'),
            };

            if (disk.target) {
                disks[disk.target] = disk;
                logDebug(`parseDumpxmlForDisks(): disk device found: ${JSON.stringify(disk)}`);
            } else {
                console.warn(`parseDumpxmlForDisks(): mandatory properties are missing in dumpxml, found: ${JSON.stringify(disk)}`);
            }
        }
    }

    return disks;
}
