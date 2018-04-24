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
import service from '../lib/service.js';
import $ from 'jquery';
import createVmScript from 'raw!./scripts/create_machine.sh';
import installVmScript from 'raw!./scripts/install_machine.sh';
import getOSListScript from 'raw!./scripts/get_os_list.sh';
import getLibvirtServiceNameScript from 'raw!./scripts/get_libvirt_service_name.sh';
import store from './store.es6';

import {
    updateOrAddVm,
    updateVm,
    getVm,
    getAllVms,
    delayPolling,
    undefineVm,
    deleteUnlistedVMs,
    vmActionFailed,
    getOsInfoList,
    updateOsInfoList,
    checkLibvirtStatus,
    updateLibvirtState,
} from './actions.es6';

import { usagePollingEnabled } from './selectors.es6';
import { spawnScript, spawnProcess } from './services.es6';
import {
    convertToUnit,
    units,
    isEmpty,
    logDebug,
    rephraseUI,
    fileDownload,
} from './helpers.es6';

import {
    prepareDisksParam,
    prepareDisplaysParam,
} from './libvirtUtils.es6';

import {
    setVmCreateInProgress,
    setVmInstallInProgress,
    finishVmCreateInProgress,
    finishVmInstallInProgress,
    removeVmCreateInProgress,
    clearVmUiState,
} from './components/create-vm-dialog/uiState.es6';

import VMS_CONFIG from './config.es6';

const _ = cockpit.gettext;

const METADATA_NAMESPACE = "https://github.com/cockpit-project/cockpit/tree/master/pkg/machines";

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
    return isEmpty(selectedLine) ? undefined : selectedLine.toString().trim()
            .substring(pattern.length)
            .trim();
}

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
    canDelete: (vmState, vmId, providerState) => true,
    isRunning: (vmState) => LIBVIRT_PROVIDER.canReset(vmState),
    canRun: (vmState, hasInstallPhase) => !hasInstallPhase && vmState == 'shut off',
    canInstall: (vmState, hasInstallPhase) => vmState != 'running' && hasInstallPhase,
    canConsole: (vmState) => vmState == 'running',
    canSendNMI: (vmState) => LIBVIRT_PROVIDER.canReset(vmState),

    serialConsoleCommand: ({ vm }) => !!vm.displays['pty'] ? [ 'virsh', ...VMS_CONFIG.Virsh.connections[vm.connectionName].params, 'console', vm.name ] : false,

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
                })
                        .then(domInfo => {
                            parseDominfo(dispatch, connectionName, name, domInfo);
                        }); // end of GET_VM return
            }
        };
    },

    INIT_DATA_RETRIEVAL () {
        logDebug(`${this.name}.INIT_DATA_RETRIEVAL():`);
        return dispatch => {
            dispatch(getOsInfoList());
            return cockpit.script(getLibvirtServiceNameScript, null, { err: "message", environ: ['LC_ALL=en_US.UTF-8'] })
                    .then(serviceName => {
                        const match = serviceName.match(/([^\s]+)/);
                        const name = match ? match[0] : null;
                        dispatch(updateLibvirtState({ name }));
                        if (name) {
                            dispatch(getAllVms(null, name));
                        } else {
                            console.error("initialize failed: getting libvirt service name failed");
                        }
                    })
                    .fail((exception, data) => {
                        dispatch(updateLibvirtState({ name: null }));
                        console.error(`initialize failed: getting libvirt service name returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                    });
        };
    },

    /**
     * Initiate read of all VMs
     *
     * @returns {Function}
     */
    GET_ALL_VMS ({ connectionName, libvirtServiceName }) {
        logDebug(`${this.name}.GET_ALL_VMS(connectionName='${connectionName}'):`);
        if (connectionName) {
            return dispatch => {
                dispatch(checkLibvirtStatus(libvirtServiceName));
                startEventMonitor(dispatch, connectionName, libvirtServiceName);
                doGetAllVms(dispatch, connectionName);
            };
        }

        return dispatch => { // for all connections
            dispatch(checkLibvirtStatus(libvirtServiceName));
            return cockpit.user().done(loggedUser => {
                const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                        .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                            connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                        .map(connectionName => dispatch(getAllVms(connectionName, libvirtServiceName)));

                return cockpit.all(promises);
            });
        };
    },

    GET_OS_INFO_LIST () {
        logDebug(`${this.name}.GET_OS_INFO_LIST():`);
        return dispatch => cockpit.script(getOSListScript, null, { err: "message", environ: ['LC_ALL=en_US.UTF-8'] })
                .then(osList => {
                    parseOsInfoList(dispatch, osList);
                })
                .fail((exception, data) => {
                    console.error(`get os list returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                });
    },

    SHUTDOWN_VM ({ name, connectionName }) {
        logDebug(`${this.name}.SHUTDOWN_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'SHUTDOWN_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM SHUT DOWN action failed") }),
                                       args: ['shutdown', name]
        });
    },

    FORCEOFF_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEOFF_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'FORCEOFF_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE OFF action failed") }),
                                       args: ['destroy', name]
        });
    },

    REBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.REBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'REBOOT_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM REBOOT action failed") }),
                                       args: ['reboot', name]
        });
    },

    FORCEREBOOT_VM ({ name, connectionName }) {
        logDebug(`${this.name}.FORCEREBOOT_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'FORCEREBOOT_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM FORCE REBOOT action failed") }),
                                       args: ['reset', name]
        });
    },

    START_VM ({ name, connectionName }) {
        logDebug(`${this.name}.START_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'START_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM START action failed") }),
                                       args: ['start', name]
        });
    },

    CREATE_VM({ vmName, source, os, memorySize, storageSize, startVm }) {
        logDebug(`${this.name}.CREATE_VM(${vmName}):`);
        return dispatch => {
            // shows dummy vm  until we get vm from virsh (cleans up inProgress)
            setVmCreateInProgress(dispatch, vmName, { openConsoleTab: startVm });

            if (startVm) {
                setVmInstallInProgress(dispatch, vmName);
            }

            return cockpit.script(createVmScript, [
                vmName,
                source,
                os,
                memorySize,
                storageSize,
                startVm,
            ], { err: "message", environ: ['LC_ALL=C'] })
                    .done(() => {
                        finishVmCreateInProgress(dispatch, vmName);
                        if (startVm) {
                            finishVmInstallInProgress(dispatch, vmName);
                        }
                    })
                    .fail((exception, data) => {
                        clearVmUiState(dispatch, vmName); // inProgress cleanup
                        console.info(`spawn 'vm creation' returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                    });
        };
    },

    INSTALL_VM({ name, vcpus, currentMemory, metadata, disks, displays, connectionName }) {
        logDebug(`${this.name}.INSTALL_VM(${name}):`);
        return dispatch => {
            // shows dummy vm until we get vm from virsh (cleans up inProgress)
            // vm should be returned even if script fails
            setVmInstallInProgress(dispatch, name);

            return cockpit.script(installVmScript, [
                name,
                metadata.installSource,
                metadata.osVariant,
                convertToUnit(currentMemory, units.KiB, units.MiB),
                vcpus,
                prepareDisksParam(disks),
                prepareDisplaysParam(displays),
            ], { err: "message", environ: ['LC_ALL=C'] })
                    .done(() => finishVmInstallInProgress(dispatch, name))
                    .fail(({ message, exception }) => {
                        finishVmInstallInProgress(dispatch, name, { openConsoleTab: false });
                        const handler = buildScriptTimeoutFailHandler({
                            dispatch,
                            name,
                            connectionName,
                            message: _("INSTALL VM action failed"),
                        }, VMS_CONFIG.WaitForRetryInstallVm);
                        handler({ message, exception });
                    });
        };
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
            let args = ['undefine', name, '--managed-save'];
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

    CHANGE_NETWORK_STATE ({ name, networkMac, state, connectionName }) {
        logDebug(`${this.name}.CHANGE_NETWORK_STATE(${name}.${networkMac} ${state}):`);
        return dispatch => {
            spawnVirsh({connectionName,
                        method: 'CHANGE_NETWORK_STATE',
                        failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("CHANGE NETWORK STATE action failed") }),
                        args: ['domif-setlink', name, networkMac, state]
            }).then(() => {
                dispatch(getVm(connectionName, name));
            });
        };
    },

    USAGE_START_POLLING ({ name, connectionName }) {
        logDebug(`${this.name}.USAGE_START_POLLING(${name}):`);
        return dispatch => {
            dispatch(updateVm({ connectionName, name, usagePolling: true }));
            dispatch(doUsagePolling(name, connectionName));
        };
    },

    USAGE_STOP_POLLING ({ name, connectionName }) {
        logDebug(`${this.name}.USAGE_STOP_POLLING(${name}):`);
        return dispatch => dispatch(updateVm({ connectionName, name, usagePolling: false }));
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

    SENDNMI_VM ({ name, connectionName }) {
        logDebug(`${this.name}.SENDNMI_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'SENDNMI_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM SEND Non-Maskable Interrrupt action failed") }),
                                       args: ['inject-nmi', name]
        });
    },

    CHECK_LIBVIRT_STATUS({ serviceName }) {
        logDebug(`${this.name}.CHECK_LIBVIRT_STATUS`);
        return dispatch => {
            const libvirtService = service.proxy(serviceName);
            const dfd = cockpit.defer();

            libvirtService.wait(() => {
                let activeState = libvirtService.exists ? libvirtService.state : 'stopped';
                let unitState = libvirtService.exists && libvirtService.enabled ? 'enabled' : 'disabled';

                dispatch(updateLibvirtState({
                    activeState,
                    unitState,
                }));
                dfd.resolve();
            });

            return dfd.promise();
        };
    },

    START_LIBVIRT({ serviceName }) {
        logDebug(`${this.name}.START_LIBVIRT`);
        return dispatch => {
            return service.proxy(serviceName).start()
                    .done(() => {
                        dispatch(checkLibvirtStatus(serviceName));
                    })
                    .fail(exception => {
                        console.info(`starting libvirt failed: "${JSON.stringify(exception)}"`);
                    });
        };
    },

    ENABLE_LIBVIRT({ enable, serviceName }) {
        logDebug(`${this.name}.ENABLE_LIBVIRT`);
        return dispatch => {
            const libvirtService = service.proxy(serviceName);
            const promise = enable ? libvirtService.enable() : libvirtService.disable();

            return promise.fail(exception => {
                console.info(`enabling libvirt failed: "${JSON.stringify(exception)}"`);
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
            return;
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
        return;
    }

    const domainElem = xmlDoc.getElementsByTagName("domain")[0];
    const osElem = domainElem.getElementsByTagName("os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
    const vcpuElem = domainElem.getElementsByTagName("vcpu")[0];
    const cpuElem = domainElem.getElementsByTagName("cpu")[0];
    const vcpuCurrentAttr = vcpuElem.attributes.getNamedItem('current');
    const devicesElem = domainElem.getElementsByTagName("devices")[0];
    const osTypeElem = osElem.getElementsByTagName("type")[0];
    const metadataElem = getSingleOptionalElem(domainElem, "metadata");

    const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const id = domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
    const osType = osTypeElem.nodeValue;
    const emulatedMachine = osTypeElem.getAttribute("machine");

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = convertToUnit(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit, units.KiB);

    const vcpus = (vcpuCurrentAttr && vcpuCurrentAttr.value) ? vcpuCurrentAttr.value : vcpuElem.childNodes[0].nodeValue;

    const disks = parseDumpxmlForDisks(devicesElem);
    const bootOrder = parseDumpxmlForBootOrder(osElem, devicesElem);
    const cpuModel = parseDumpxmlForCpuModel(cpuElem);
    const displays = parseDumpxmlForConsoles(devicesElem);
    const interfaces = parseDumpxmlForInterfaces(devicesElem);

    const hasInstallPhase = parseDumpxmlMachinesMetadataElement(metadataElem, 'has_install_phase') === 'true';
    const installSource = parseDumpxmlMachinesMetadataElement(metadataElem, 'install_source');
    const osVariant = parseDumpxmlMachinesMetadataElement(metadataElem, 'os_variant');

    const metadata = {
        hasInstallPhase,
        installSource,
        osVariant,
    };

    const ui = resolveUiState(dispatch, name);

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
        interfaces,
        metadata,
        ui,
    }));
}

function resolveUiState(dispatch, name) {
    const result = {
        // used just the first time vm is shown
        initiallyExpanded: false,
        initiallyOpenedConsoleTab: false,
    };

    const uiState = store.getState().ui.vms[name];

    if (uiState) {
        result.initiallyExpanded = uiState.expanded;
        result.initiallyOpenedConsoleTab = uiState.openConsoleTab;

        if (uiState.installInProgress) {
            removeVmCreateInProgress(dispatch, name);
        } else {
            clearVmUiState(dispatch, name);
        }
    }

    return result;
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

function parseDumpxmlForInterfaces(devicesElem) {
    const interfaces = [];
    const interfaceElems = devicesElem.getElementsByTagName('interface');
    if (interfaceElems) {
        for (let i = 0; i < interfaceElems.length; i++) {
            const interfaceElem = interfaceElems[i];

            const targetElem = interfaceElem.getElementsByTagName('target')[0];
            const macElem = getSingleOptionalElem(interfaceElem, 'mac');
            const modelElem = getSingleOptionalElem(interfaceElem, 'model');
            const aliasElem = getSingleOptionalElem(interfaceElem, 'alias');
            const sourceElem = getSingleOptionalElem(interfaceElem, 'source');
            const driverElem = getSingleOptionalElem(interfaceElem, 'driver');
            const virtualportElem = getSingleOptionalElem(interfaceElem, 'virtualport');
            const addressElem = getSingleOptionalElem(interfaceElem, 'address');
            const linkElem = getSingleOptionalElem(interfaceElem, 'link');
            const mtuElem = getSingleOptionalElem(interfaceElem, 'mtu');
            const localElem = addressElem ? getSingleOptionalElem(addressElem, 'local') : null;

            const networkInterface = { // see https://libvirt.org/formatdomain.html#elementsNICS
                type: interfaceElem.getAttribute('type'), // Only one required parameter
                managed: interfaceElem.getAttribute('managed'),
                name: interfaceElem.getAttribute('name') ? interfaceElem.getAttribute('name') : undefined, // Name of interface
                target: targetElem ? targetElem.getAttribute('dev') : undefined,
                mac: macElem.getAttribute('address'), // MAC address
                model: modelElem.getAttribute('type'), // Device model
                aliasName: aliasElem ? aliasElem.getAttribute('name') : undefined,
                virtualportType: virtualportElem ? virtualportElem.getAttribute('type') : undefined,
                driverName: driverElem ? driverElem.getAttribute('name') : undefined,
                state: linkElem ? linkElem.getAttribute('state') : 'up', // State of interface, up/down (plug/unplug)
                mtu: mtuElem ? mtuElem.getAttribute('size') : undefined,
                source: {
                    bridge: sourceElem ? sourceElem.getAttribute('bridge') : undefined,
                    network: sourceElem ? sourceElem.getAttribute('network') : undefined,
                    portgroup: sourceElem ? sourceElem.getAttribute('portgroup') : undefined,
                    dev: sourceElem ? sourceElem.getAttribute('dev') : undefined,
                    mode: sourceElem ? sourceElem.getAttribute('mode') : undefined,
                    address: sourceElem ? sourceElem.getAttribute('address') : undefined,
                    port: sourceElem ? sourceElem.getAttribute('port') : undefined,
                    local: {
                        address: localElem ? localElem.getAttribute('address') : undefined,
                        port: localElem ? localElem.getAttribute('port') : undefined,
                    },
                },
                address: {
                    bus: addressElem ? addressElem.getAttribute('bus') : undefined,
                    function: addressElem ? addressElem.getAttribute('function') : undefined,
                },
            };
            interfaces.push(networkInterface);
        }
    }
    return interfaces;
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
    bootOrder.devices = bootableDevices.sort((devA, devB) => devA.order - devB.order);
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

function parseDumpxmlMachinesMetadataElement(metadataElem, name) {
    if (!metadataElem) {
        return null;
    }
    const subElems = metadataElem.getElementsByTagNameNS(METADATA_NAMESPACE, name);

    return subElems.length > 0 ? subElems[0].textContent : null;
}

function parseOsInfoList(dispatch, osList) {
    const osColumnsNames = ['shortId', 'name', 'version', 'family', 'vendor', 'releaseDate', 'eolDate', 'codename'];
    let parsedList = [];

    osList.split('\n').forEach(line => {
        const osColumns = line.split('|');

        const result = {};

        for (let i = 0; i < osColumnsNames.length; i++) {
            result[osColumnsNames[i]] = osColumns.length > i ? osColumns[i] : null;
        }

        if (result.shortId) {
            parsedList.push(result);
        }
    });

    dispatch(updateOsInfoList(parsedList));
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

    const cpuTime = getValueFromLine(lines, 'cpu.time=');
    // TODO: Add network usage statistics

    if (cpuTime) {
        dispatch(updateVm({connectionName, name, actualTimeInMs, cpuTime}));
    }

    dispatch(updateVm({connectionName, name, disksStats: parseDomstatsForDisks(lines)}));
}

function parseDomstatsForDisks(domstatsLines) {
    const count = getValueFromLine(domstatsLines, 'block.count=');
    if (!count) {
        return;
    }

    // Libvirt reports disk capacity since version 1.2.18 (year 2015)
    // TODO: If disk stats is required for old systems, find a way how to get it when 'block.X.capacity' is not present, consider various options for 'sources'
    const disksStats = {};
    for (let i = 0; i < count; i++) {
        const target = getValueFromLine(domstatsLines, `block.${i}.name=`);
        const physical = getValueFromLine(domstatsLines, `block.${i}.physical=`) || NaN;
        const capacity = getValueFromLine(domstatsLines, `block.${i}.capacity=`) || NaN;
        const allocation = getValueFromLine(domstatsLines, `block.${i}.allocation=`) || NaN;

        if (target) {
            disksStats[target] = {
                physical,
                capacity,
                allocation,
            };
        } else {
            console.warn(`parseDomstatsForDisks(): mandatory property is missing in domstats (block.${i}.name)`);
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

    const canFailHandler = ({ exception, data }) => {
        console.info(`The 'virsh' command failed, as expected: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
        return cockpit.resolve();
    };

    return (dispatch, getState) => {
        if (!usagePollingEnabled(getState(), name, connectionName)) {
            logDebug(`doUsagePolling(${name}, ${connectionName}): usage polling disabled, stopping loop`);
            return;
        }

        // Do polling even if following virsh calls fails. Might fail i.e. if a VM is not (yet) started
        dispatch(delayPolling(doUsagePolling(name, connectionName), null, name, connectionName));

        return spawnVirshReadOnly({ connectionName, method: 'dommemstat', name, failHandler: canFailHandler })
                .then(dommemstat => {
                    if (dommemstat) { // is undefined if vm is not running
                        parseDommemstat(dispatch, connectionName, name, dommemstat);
                        return spawnVirshReadOnly({ connectionName, method: 'domstats', name, failHandler: canFailHandler });
                    }
                })
                .then(domstats => {
                    if (domstats)
                        parseDomstats(dispatch, connectionName, name, domstats);
                });
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
        const error = "Unable to parse event, ignoring:";
        if (line.toLowerCase().includes("failed to connect")) {
            // known error: virsh process fails anyway
            logDebug(error, line);
        } else {
            console.warn(error, line);
        }
        return;
    }
    var [event_, name, info] = match.slice(1);

    logDebug(`handleEvent(${connectionName}): domain ${name}: got event ${event_}; details: ${info}`);

    // types and details: https://libvirt.org/html/libvirt-libvirt-domain.html#virDomainEventID
    switch (event_) {
    case 'lifecycle': {
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
    }
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

function startEventMonitor(dispatch, connectionName, libvirtServiceName) {
    let output_buf = '';

    // set up event monitor for that connection; force PTY as otherwise the buffering
    // will not show every line immediately
    cockpit.spawn(['virsh'].concat(VMS_CONFIG.Virsh.connections[connectionName].params).concat(['-r', 'event', '--all', '--loop']), {'err': 'message', 'pty': true})
            .stream(data => {
                if (data.startsWith("error: Disconnected from") || data.startsWith("error: internal error: client socket is closed")) {
                // libvirt failed
                    logDebug(data);
                    return;
                }

                // buffer and line-split the output, there is no guarantee that we always get whole lines
                output_buf += data;
                let lines = output_buf.split('\n');
                while (lines.length > 1)
                    handleEvent(dispatch, connectionName, lines.shift().trim());
                output_buf = lines[0];
            })
            .fail(ex => {
            // this usually happens if libvirtd gets stopped or isn't running; retry connecting every 10s
                logDebug("virsh event failed:", ex);
                dispatch(checkLibvirtStatus(libvirtServiceName));
                dispatch(deleteUnlistedVMs(connectionName, []));
                dispatch(delayPolling(getAllVms(connectionName, libvirtServiceName)));
            });
}

export default LIBVIRT_PROVIDER;
