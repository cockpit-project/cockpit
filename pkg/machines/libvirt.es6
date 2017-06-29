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

/*
 * Provider for Libvirt
 */
import cockpit from 'cockpit';
import $ from 'jquery';

import { updateOrAddVm,
    updateVm,
    getVm,
    getAllVms,
    delayPolling,
    undefineVm,
    deleteUnlistedVMs,
    vmActionFailed,
} from './actions.es6';

import { usagePollingEnabled } from './selectors.es6';
import { spawnScript, spawnProcess } from './services.es6';
import {
    toKiloBytes,
    isEmpty,
    logDebug,
    rephraseUI,
    fileDownload,
} from './helpers.es6';

import VMS_CONFIG from './config.es6';

const _ = cockpit.gettext;

// --- compatibility hack
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function (searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

/**
 * Parse non-XML stdout of virsh.
 *
 * @param virshStdout
 * @returns {*}
 */
function parseLines(virshStdout) {
    return virshStdout.match(/[^\r\n]+/g);
}

/**
 * Parse format of:
 * Pattern: value
 * @param parsedLines
 * @param pattern
 */
function getValueFromLine(parsedLines, pattern) {
    const selectedLine = parsedLines.filter(line => {
        return line.trim().startsWith(pattern);
    });
    return isEmpty(selectedLine) ? undefined : selectedLine.toString().trim().substring(pattern.length).trim();
}

/**
 * Returns a function handling VM action failures.
 */
function buildFailHandler({ dispatch, name, connectionName, message }) {
    return ({ exception, data }) =>
        dispatch(vmActionFailed({name, connectionName, message, detail: {exception, data}}));
}

let LIBVIRT_PROVIDER = {};
LIBVIRT_PROVIDER = {
    name: 'Libvirt',

    /**
     * Initialize the provider.
     * Arguments are used for reference only, they are actually not needed for this Libvirt provider.
     *
     * @param providerContext - see `getProviderContext()` in provider.es6
     * @returns {boolean} - true, if initialization succeeded; or Promise
     */
    init(providerContext) {
        // This is default provider - the Libvirt, so we do not need to use the providerContext param.
        // The method is here for reference only.
        return true; // or Promise
    },

    canReset: (vmState) => vmState == 'running' || vmState == 'idle' || vmState == 'paused',
    canShutdown: (vmState) => LIBVIRT_PROVIDER.canReset(vmState),
    canDelete: (vmState) => true,
    isRunning: (vmState) => LIBVIRT_PROVIDER.canReset(vmState),
    canRun: (vmState) => vmState == 'shut off',
    canConsole: (vmState) => vmState == 'running',

    /**
     * Read VM properties of a single VM (virsh)
     *
     * @param VM name
     * @returns {Function}
     */
    GET_VM ({ lookupId: name, connectionName }) {
        logDebug(`${this.name}.GET_VM()`);

        return dispatch => {
            if (!isEmpty(name)) {
                return spawnVirshReadOnly({connectionName, method: 'dumpxml', name}).then(domXml => {
                    parseDumpxml(dispatch, connectionName, domXml);
                    return spawnVirshReadOnly({connectionName, method: 'dominfo', name});
                }).then(domInfo => {
                    parseDominfo(dispatch, connectionName, name, domInfo);
                }); // end of GET_VM return
            }
        };
    },

    /**
     * Initiate read of all VMs
     *
     * @returns {Function}
     */
    GET_ALL_VMS ({ connectionName }) {
        logDebug(`${this.name}.GET_ALL_VMS(connectionName='${connectionName}'):`);
        if (connectionName) {
            return dispatch => {
                startEventMonitor(dispatch, connectionName);
                doGetAllVms(dispatch, connectionName);
            };
        }

        return dispatch => { // for all connections
            return cockpit.user().done( loggedUser => {
                const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                    .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                        connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                    .map(connectionName => dispatch(getAllVms(connectionName)));

                return cockpit.all(promises);
            });
        };
    },

    SHUTDOWN_VM ({ name, connectionName }) {
        logDebug(`${this.name}.SHUTDOWN_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'SHUTDOWN_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM SHUT DOWN action failed")}),
            args: ['shutdown', name]
        });
    },

    FORCEOFF_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEOFF_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'FORCEOFF_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE OFF action failed")}),
            args: ['destroy', name]
        });
    },

    REBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.REBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'REBOOT_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM REBOOT action failed")}),
            args: ['reboot', name]
        });
    },

    FORCEREBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEREBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'FORCEREBOOT_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE REBOOT action failed")}),
            args: ['reset', name]
        });
    },

    START_VM ({ name, connectionName }) {
        logDebug(`${this.name}.START_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
            method: 'START_VM',
            failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM START action failed")}),
            args: ['start', name]
        });
    },

    DELETE_VM ({ name, connectionName, options }) {
        logDebug(`${this.name}.DELETE_VM(${name}, ${JSON.stringify(options)}):`);

        function destroy() {
            return spawnVirsh({ connectionName,
                                method: 'DELETE_VM',
                                args: [ 'destroy', name ]
                              });
        }

        function undefine() {
            let args = ['undefine', name, '--managed-save' ];
            if (options.storage) {
                args.push('--storage');
                args.push(options.storage.join(','));
            }
            return spawnVirsh({ connectionName,
                                method: 'DELETE_VM',
                                args: args
                              });
        }

        return dispatch => {
            if (options.destroy) {
                return destroy().then(undefine);
            } else {
                return undefine();
            }
        };
    },

    USAGE_START_POLLING ({ name, connectionName }) {
        logDebug(`${this.name}.USAGE_START_POLLING(${name}):`);
        return (dispatch => {
            dispatch(updateVm({ connectionName, name, usagePolling: true}));
            dispatch(doUsagePolling(name, connectionName));
        });
    },

    USAGE_STOP_POLLING ({ name, connectionName }) {
        logDebug(`${this.name}.USAGE_STOP_POLLING(${name}):`);
        return dispatch => dispatch(updateVm({ connectionName, name, usagePolling: false}));
    },


    /**
     * Basic, but working.
     * TODO: provide support for more complex scenarios, like with TLS or proxy
     *
     * To try with virt-install: --graphics spice,listen=[external host IP]
     */
    CONSOLE_VM ({ name, consoleDetail }) {
        logDebug(`${this.name}.CONSOLE_VM(name='${name}'), detail = `, consoleDetail);
        return dispatch => {
            fileDownload({
                data: buildConsoleVVFile(consoleDetail),
                fileName: 'console.vv',
                mimeType: 'application/x-virt-viewer'
            });
        };
    },
};

function canLoggedUserConnectSession (connectionName, loggedUser) {
    return connectionName !== 'session' || loggedUser.name !== 'root';
}

function doGetAllVms (dispatch, connectionName) {
    const connection = VMS_CONFIG.Virsh.connections[connectionName];

    return spawnScript({
        script: `virsh ${connection.params.join(' ')} -r list --all | awk '$1 == "-" || $1+0 > 0 { print $2 }'`
    }).then(output => {
        const vmNames = output.trim().split(/\r?\n/);
        vmNames.forEach((vmName, index) => {
            vmNames[index] = vmName.trim();
        });
        logDebug(`GET_ALL_VMS: vmNames: ${JSON.stringify(vmNames)}`);

        // remove undefined domains
        dispatch(deleteUnlistedVMs(connectionName, vmNames));

        // read VM details
        return cockpit.all(vmNames.map((name) => dispatch(getVm(connectionName, name))));
    });
}

// TODO: add configurable custom virsh attribs - i.e. libvirt user/pwd
function spawnVirsh({connectionName, method, failHandler, args}) {
    return spawnProcess({
        cmd: 'virsh',
        args: VMS_CONFIG.Virsh.connections[connectionName].params.concat(args),
        failHandler,
    }).fail((ex, data, output) => {
        const msg = `${method}() exception: '${ex}', data: '${data}', output: '${output}'`;
        if (failHandler) {
            logDebug(msg);
            return ;
        }
        console.warn(msg);
    });
}

function spawnVirshReadOnly({connectionName, method, name, failHandler}) {
    return spawnVirsh({connectionName, method, args: ['-r', method, name], failHandler});
}

function parseDumpxml(dispatch, connectionName, domXml) {
    const xmlDoc = $.parseXML(domXml);

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${domXml}"`);
        return ;
    }

    const domainElem = xmlDoc.getElementsByTagName("domain")[0];
    const osElem = domainElem.getElementsByTagName("os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
    const vcpuElem = domainElem.getElementsByTagName("vcpu")[0];
    const cpuElem = domainElem.getElementsByTagName("cpu")[0];
    const vcpuCurrentAttr = vcpuElem.attributes.getNamedItem('current');
    const devicesElem = domainElem.getElementsByTagName("devices")[0];
    const osTypeElem = osElem.getElementsByTagName("type")[0];

    const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const id = domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
    const osType = osTypeElem.nodeValue;
    const emulatedMachine = osTypeElem.getAttribute("machine");

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = toKiloBytes(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit);

    const vcpus = (vcpuCurrentAttr && vcpuCurrentAttr.value) ? vcpuCurrentAttr.value : vcpuElem.childNodes[0].nodeValue;

    const disks = parseDumpxmlForDisks(devicesElem);
    const bootOrder = parseDumpxmlForBootOrder(osElem, devicesElem);
    const cpuModel = parseDumpxmlForCpuModel(cpuElem);
    const displays = parseDumpxmlForConsoles(devicesElem);

    dispatch(updateOrAddVm({
        connectionName, name, id,
        osType,
        currentMemory,
        vcpus,
        disks,
        emulatedMachine,
        cpuModel,
        bootOrder,
        displays,
    }));
}

function getSingleOptionalElem(parent, name) {
    const subElems = parent.getElementsByTagName(name);
    return subElems.length > 0 ? subElems[0] : undefined; // optional
}

function parseDumpxmlForDisks(devicesElem) {
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
            const bootElem = getSingleOptionalElem(diskElem, 'boot');

            const sourceHostElem = sourceElem ? getSingleOptionalElem(sourceElem, 'host') : undefined;

            const disk = { // see https://libvirt.org/formatdomain.html#elementsDisks
                target: targetElem.getAttribute('dev'), // identifier of the disk, i.e. sda, hdc
                driver: {
                    name: driverElem ? driverElem.getAttribute('name') : undefined, // optional
                    type: driverElem ? driverElem.getAttribute('type') : undefined,
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
                },
                bus: targetElem.getAttribute('bus'), // i.e. scsi, ide
                serial: serialElem ? serialElem.getAttribute('serial') : undefined, // optional serial number
                aliasName: aliasElem ? aliasElem.getAttribute('name') : undefined, // i.e. scsi0-0-0-0, ide0-1-0
                readonly: readonlyElem ? true : false,
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

function parseDumpxmlForBootOrder(osElem, devicesElem) {
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
    bootOrder.devices = bootableDevices.sort( (devA, devB) => devA.order - devB.order );
    return bootOrder;
}

function parseDumpxmlForCpuModel(cpuElem) {
    if (!cpuElem) {
        return undefined;
    }

    const cpuMode = cpuElem.getAttribute('mode');
    let cpuModel = '';
    if (cpuMode && cpuMode === 'custom') {
        const modelElem = getSingleOptionalElem(cpuElem, 'model');
        if (modelElem) {
            cpuModel = modelElem.childNodes[0].nodeValue; // content of the domain/cpu/model element
        }
    }

    return rephraseUI('cpuMode', cpuMode) + (cpuModel ? ` (${cpuModel})` : '');
}

function parseDumpxmlForConsoles(devicesElem) {
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
                (display.address && (display.port || display.tlsPort)) )) {
                displays[display.type] = display;
                logDebug(`parseDumpxmlForConsoles(): graphics device found: ${JSON.stringify(display)}`);
            } else {
                console.warn(`parseDumpxmlForConsoles(): mandatory properties are missing in dumpxml, found: ${JSON.stringify(display)}`);
            }
        }
    }

    return displays;
}

function parseDominfo(dispatch, connectionName, name, domInfo) {
    const lines = parseLines(domInfo);
    const state = getValueFromLine(lines, 'State:');
    const autostart = getValueFromLine(lines, 'Autostart:');
    const persistent = getValueFromLine(lines, 'Persistent:') == 'yes';

    if (!LIBVIRT_PROVIDER.isRunning(state)) { // clean usage data
        dispatch(updateVm({connectionName, name, state, autostart, persistent, actualTimeInMs: -1}));
    } else {
        dispatch(updateVm({connectionName, name, state, persistent, autostart}));
    }

    return state;
}

function parseDommemstat(dispatch, connectionName, name, dommemstat) {
    const lines = parseLines(dommemstat);

    let rssMemory = getValueFromLine(lines, 'rss'); // in KiB

    if (rssMemory) {
        dispatch(updateVm({connectionName, name, rssMemory}));
    }
}

function parseDomstats(dispatch, connectionName, name, domstats) {
    const actualTimeInMs = Date.now();

    const lines = parseLines(domstats);

    const cpuTime = getValueFromLine(lines, 'cpu\.time=');
    // TODO: Add network usage statistics

    if (cpuTime) {
        dispatch(updateVm({connectionName, name, actualTimeInMs, cpuTime}));
    }

   dispatch(updateVm({connectionName, name, disksStats: parseDomstatsForDisks(lines)}));
}

function parseDomstatsForDisks(domstatsLines) {
    const count = getValueFromLine(domstatsLines, 'block\.count=');
    if (!count) {
        return ;
    }

    // Libvirt reports disk capacity since version 1.2.18 (year 2015)
    // TODO: If disk stats is required for old systems, find a way how to get it when 'block.X.capacity' is not present, consider various options for 'sources'
    const disksStats = {};
    for (let i=0; i<count; i++) {
        const target = getValueFromLine(domstatsLines, `block\.${i}\.name=`);
        const physical = getValueFromLine(domstatsLines, `block\.${i}\.physical=`) || NaN;
        const capacity = getValueFromLine(domstatsLines, `block\.${i}\.capacity=`) || NaN;
        const allocation = getValueFromLine(domstatsLines, `block\.${i}\.allocation=`) || NaN;

        if (target) {
            disksStats[target] = {
                physical,
                capacity,
                allocation,
            };
        } else {
            console.warn(`parseDomstatsForDisks(): mandatory property is missing in domstats (block\.${i}\.name)`);
        }
    }
    return disksStats;
}

function buildConsoleVVFile(consoleDetail) {
    return '[virt-viewer]\n' +
        `type=${consoleDetail.type}\n` +
        `host=${consoleDetail.address}\n` +
        `port=${consoleDetail.port}\n` +
        'delete-this-file=1\n' +
        'fullscreen=0\n';
}

function doUsagePolling (name, connectionName) {
    logDebug(`doUsagePolling(${name}, ${connectionName})`);

    const canFailHandler = ({exception, data}) => {
        console.info(`The 'virsh' command failed, as expected: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
        return cockpit.resolve();
    };

    return (dispatch, getState) => {
        if (!usagePollingEnabled(getState(), name, connectionName)) {
            logDebug(`doUsagePolling(${name}, ${connectionName}): usage polling disabled, stopping loop`);
            return;
        }

        return spawnVirshReadOnly({connectionName, method: 'dommemstat', name, failHandler: canFailHandler})
            .then(dommemstat => {
                if (dommemstat) { // is undefined if vm is not running
                    parseDommemstat(dispatch, connectionName, name, dommemstat);
                    return spawnVirshReadOnly({connectionName, method: 'domstats', name, failHandler: canFailHandler});
                }
            }).then(domstats => {
                if (domstats)
                    parseDomstats(dispatch, connectionName, name, domstats);
            }).then(() => dispatch(delayPolling(doUsagePolling(name, connectionName), null, name, connectionName)));
    };
}

function handleEvent(dispatch, connectionName, line) {
    // example lines, some with detail, one without:
    // event 'reboot' for domain sid-lxde
    // event 'lifecycle' for domain sid-lxde: Shutdown Finished
    // event 'device-removed' for domain green: virtio-disk2
    const eventRe = /event '([a-z-]+)' .* domain ([^:]+)(?:: (.*))?$/;

    var match = eventRe.exec(line);
    if (!match) {
        console.warn("Unable to parse event, ignoring:", line);
        return;
    }
    var [event_, name, info] = match.slice(1);

    logDebug(`handleEvent(${connectionName}): domain ${name}: got event ${event_}; details: ${info}`);

    // types and details: https://libvirt.org/html/libvirt-libvirt-domain.html#virDomainEventID
    switch (event_) {
        case 'lifecycle':
            let type = info.split(' ')[0];
            switch (type) {
                case 'Undefined':
                    dispatch(undefineVm(connectionName, name));
                    break;

                case 'Defined':
                case 'Started':
                    dispatch(getVm(connectionName, name));
                    break;

                case 'Stopped':
                    dispatch(updateVm({connectionName, name, state: 'shut off', actualTimeInMs: -1}));
                    // transient VMs don't have a separate Undefined event, so remove them on stop
                    dispatch(undefineVm(connectionName, name, true));
                    break;

                case 'Suspended':
                    dispatch(updateVm({connectionName, name, state: 'paused'}));
                    break;

                case 'Resumed':
                    dispatch(updateVm({connectionName, name, state: 'running'}));
                    break;

                default:
                    logDebug(`Unhandled lifecycle event type ${type} in event: ${line}`);
            }
            break;

        case 'metadata-change':
        case 'device-added':
        case 'device-removed':
        case 'disk-change':
        case 'tray-change':
        case 'control-error':
            // these (can) change what we display, so re-read the state
            dispatch(getVm(connectionName, name));
            break;

        default:
            logDebug(`handleEvent ${connectionName} ${name}: ignoring event ${line}`);
    }
}

function startEventMonitor(dispatch, connectionName) {
    var output_buf = '';

    // set up event monitor for that connection; force PTY as otherwise the buffering
    // will not show every line immediately
    cockpit.spawn(['virsh'].concat(VMS_CONFIG.Virsh.connections[connectionName].params).concat(['-r', 'event', '--all', '--loop']), {'err': 'message', 'pty': true})
        .stream(data => {
            // buffer and line-split the output, there is no guarantee that we always get whole lines
            output_buf += data;
            let lines = output_buf.split('\n');
            while (lines.length > 1)
                handleEvent(dispatch, connectionName, lines.shift().trim());
            output_buf = lines[0];
        })
        .fail(ex => {
            // this usually happens if libvirtd gets stopped or isn't running; retry connecting every 10s
            console.log("virsh event failed:", ex);
            dispatch(deleteUnlistedVMs(connectionName, []));
            dispatch(delayPolling(getAllVms(connectionName)));
        });
}

export default LIBVIRT_PROVIDER;
