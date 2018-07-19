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

import {
    updateOrAddVm,
    updateVm,
    getVm,
    getAllVms,
    delayPolling,
    undefineVm,
    deleteUnlistedVMs,
    getOsInfoList,
    checkLibvirtStatus,
    updateLibvirtState,
    setHypervisorMaxVCPU,
    getHypervisorMaxVCPU,
    getStoragePools,
    getStorageVolumes,
    updateStoragePools,
    updateStorageVolumes,
    attachDisk,
} from './actions.es6';

import { usagePollingEnabled } from './selectors.es6';
import { spawnScript, spawnProcess } from './services.es6';
import {
    convertToUnit,
    units,
    isEmpty,
    logDebug,
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
    clearVmUiState,
} from './components/create-vm-dialog/uiState.es6';

import VCPUModal from './components/vcpuModal.jsx';

import {
    buildConsoleVVFile,
    buildFailHandler,
    buildScriptTimeoutFailHandler,
    canLoggedUserConnectSession,
    getSingleOptionalElem,
    parseDumpxmlForBootOrder,
    parseDumpxmlForConsoles,
    parseDumpxmlForCpu,
    parseDumpxmlForDisks,
    parseDumpxmlForVCPU,
    parseDumpxmlForInterfaces,
    parseDumpxmlMachinesMetadataElement,
    parseOsInfoList,
    resolveUiState,
} from './libvirt-common.es6';

import VMS_CONFIG from './config.es6';

const _ = cockpit.gettext;

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

let LIBVIRT_PROVIDER = {};
LIBVIRT_PROVIDER = {
    name: 'Libvirt',

    /**
     * Initialize the provider.
     * Arguments are used for reference only, they are actually not needed for this Libvirt provider.
     *
     * @param providerContext - contains context details, like the dispatch function, see provider.es6
     * @returns {boolean} - true, if initialization succeeded; or Promise
     */
    init({ dispatch }) {
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
    openVCPUModal: (params) => VCPUModal(params),

    serialConsoleCommand: ({ vm }) => vm.displays['pty'] ? [ 'virsh', ...VMS_CONFIG.Virsh.connections[vm.connectionName].params, 'console', vm.name ] : false,

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
                        dispatch(getHypervisorMaxVCPU());
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
                dispatch(getStoragePools(connectionName));
            };
        }

        return unknownConnectionName(getAllVms, libvirtServiceName);
    },

    /**
     * Retrieves list of libvirt "storage pools" for particular connection.
     */
    GET_STORAGE_POOLS({ connectionName }) {
        logDebug(`${this.name}.GET_STORAGE_POOLS(connectionName='${connectionName}')`);

        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        // Workaround: virsh v1.3.1 in ubuntu-1604 does not support '--name' parameter
        const command = `virsh ${connection} -r pool-list --type dir | grep active | awk '{print $1 }'`;
        let poolList = '';
        // TODO: add support for other pool types then just the "directory"
        return dispatch => cockpit
                .script(command, null, { err: "message", environ: ['LC_ALL=en_US.UTF-8'] })
                .stream(output => { poolList += output; })
                .then(() => { // so far only pool names are needed, extend here otherwise
                    const promises = parseStoragePoolList(dispatch, connectionName, poolList)
                            .map(poolName => dispatch(getStorageVolumes(connectionName, poolName)));

                    return cockpit.all(promises);
                })
                .fail((exception, data) => {
                    console.error('Failed to get list of Libvirt storage pools for connection ', connectionName, ': ', data, exception);
                });
    },

    GET_STORAGE_VOLUMES({ connectionName, poolName }) {
        logDebug(`${this.name}.GET_STORAGE_VOLUMES(connectionName='${connectionName}', poolName='${poolName}')`);
        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        // Caution: output of virsh v1.3.1 (ubuntu-1604) and v3.7.0 differs, the 'grep' unifies it
        const command = `virsh ${connection} -q pool-refresh ${poolName} && virsh ${connection} -q -r vol-list ${poolName} --details | (grep file || true)`;
        let data = '';
        return dispatch => cockpit
                .script(command, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']})
                .stream(output => { data += output; })
                .then(() => parseStorageVolumes(dispatch, connectionName, poolName, data))
                .fail((exception, data) => {
                    console.error('Failed to get list of Libvirt storage volumes for connection: ', connectionName, ', pool: ', poolName, ': ', data, exception);
                });
    },

    /**
     * disk size - in MiB
     */
    CREATE_AND_ATTACH_VOLUME({ connectionName, poolName, volumeName, size, format, target, vmName, permanent, hotplug }) {
        logDebug(`${this.name}.CREATE_AND_ATTACH_VOLUME("`, connectionName, '", "', poolName, '", "', volumeName, '", "', size, '", "', format, '", "', target, '", "', vmName, '"');
        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        // Workaround: The "grep" part of the command bellow is a workaround for old version of virsh (1.3.1 , ubuntu-1604), since the "virsh -q vol-create-as" produces extra line there
        const command = `(virsh ${connection} -q vol-create-as ${poolName} ${volumeName} --capacity ${size}M --format ${format} && virsh ${connection} -q vol-path ${volumeName} --pool ${poolName}) | grep -v 'Vol ${volumeName} created'`;
        logDebug('CREATE_AND_ATTACH_VOLUME command: ', command);
        return dispatch => cockpit.script(command, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']})
                .then(diskFileName => {
                    logDebug('Storage volume created, poolName: ', poolName, ', volumeName: ', volumeName, ', diskFileName: ', diskFileName);
                    return dispatch(attachDisk({ connectionName, diskFileName: diskFileName.trim(), target, vmName, permanent, hotplug }));
                });
    },

    ATTACH_DISK({ connectionName, diskFileName, target, vmName, permanent, hotplug }) {
        logDebug(`${this.name}.ATTACH_DISK("`, connectionName, '", "', diskFileName, '", "', target, '", "', vmName, '"');
        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        let scope = permanent ? '--config' : '';
        scope = scope + (hotplug ? ' --live' : '');
        const command = `virsh ${connection} attach-disk ${vmName} ${diskFileName} ${target} ${scope}`;
        logDebug('ATTACH_DISK command: ', command);
        return () => cockpit.script(command, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']});
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
        }).then(() => {
            dispatch(getVm(connectionName, name));
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
                vcpus.count,
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

    SET_VCPU_SETTINGS ({ name, connectionName, count, max, sockets, cores, threads, isRunning }) {
        logDebug(`${this.name}.SET_VCPU_SETTINGS(${name}):`);
        return dispatch => spawnVirshReadOnly({
            connectionName,
            method: 'dumpxml',
            name
        }).then((domXml) => {
            const domainElem = getDomainElem(domXml);

            let cpuElem = domainElem.getElementsByTagName("cpu")[0];
            if (!cpuElem) {
                cpuElem = document.createElement("cpu");
                domainElem.appendChild(cpuElem);
            }
            let topologyElem = cpuElem.getElementsByTagName("topology")[0];
            if (!topologyElem) {
                topologyElem = document.createElement("topology");
                cpuElem.appendChild(topologyElem);
            }
            topologyElem.setAttribute("sockets", sockets);
            topologyElem.setAttribute("threads", threads);
            topologyElem.setAttribute("cores", cores);

            let vcpuElem = domainElem.getElementsByTagName("vcpu")[0];
            if (!vcpuElem) {
                vcpuElem = document.createElement("vcpu");
                domainElem.appendChild(vcpuElem);
                vcpuElem.setAttribute("placement", "static");
            }

            vcpuElem.setAttribute("current", count);
            vcpuElem.textContent = max;

            const tmp = document.createElement("div");
            tmp.appendChild(domainElem);

            return createTempFile(tmp.innerHTML);
        })
                .then((tempFilename) => {
                    return spawnVirsh({connectionName,
                                       method: 'SET_VCPU_SETTINGS',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("SET VCPU SETTINGS action failed") }),
                                       args: ['define', tempFilename.trim()]
                    });
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
    GET_HYPERVISOR_MAX_VCPU ({ connectionName }) {
        logDebug(`${this.name}.GET_HYPERVISOR_MAX_VCPU:`);
        if (connectionName) {
            return dispatch => spawnVirsh({connectionName,
                                           method: 'GET_HYPERVISOR_MAX_VCPU',
                                           failHandler: buildFailHandler({ dispatch, connectionName, message: _("GET HYPERVISOR MAX VCPU action failed") }),
                                           args: ['-r', 'maxvcpus']
            }).then((count) => dispatch(setHypervisorMaxVCPU({ count, connectionName })));
        }

        return unknownConnectionName(getHypervisorMaxVCPU);
    }
};

function unknownConnectionName (action, libvirtServiceName) {
    return dispatch => {
        return cockpit.user().done(loggedUser => {
            const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                    .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                        connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                    .map(connectionName => dispatch(action(connectionName, libvirtServiceName)));

            return cockpit.all(promises);
        });
    };
}

function createTempFile (content) {
    const dfd = cockpit.defer();
    cockpit.spawn(["mktemp", "/tmp/abc-script.XXXXXX"]).then(tempFilename => {
        cockpit.file(tempFilename.trim())
                .replace(content)
                .done(() => {
                    dfd.resolve(tempFilename);
                })
                .fail((ex, data) => {
                    dfd.reject(ex, data, "Can't write to temporary file");
                });
    })
            .fail((ex, data) => {
                dfd.reject(ex, data, "Can't create temporary file");
            });
    return dfd.promise;
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

function getDomainElem(domXml) {
    const xmlDoc = $.parseXML(domXml);

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${domXml}"`);
        return;
    }

    return xmlDoc.getElementsByTagName("domain")[0];
}

function parseDumpxml(dispatch, connectionName, domXml) {
    const domainElem = getDomainElem(domXml);
    if (!domainElem) {
        return;
    }

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

    const vcpus = parseDumpxmlForVCPU(vcpuElem, vcpuCurrentAttr);

    const disks = parseDumpxmlForDisks(devicesElem);
    const bootOrder = parseDumpxmlForBootOrder(osElem, devicesElem);
    const cpu = parseDumpxmlForCpu(cpuElem);
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
        connectionName,
        name,
        id,
        osType,
        currentMemory,
        vcpus,
        disks,
        emulatedMachine,
        cpu,
        bootOrder,
        displays,
        interfaces,
        metadata,
        ui,
    }));
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

function parseStoragePoolList(dispatch, connectionName, poolList) {
    logDebug('parsePoolList(), input: ', poolList);
    const pools = poolList.trim()
            .split('\n')
            .map(rawPoolName => rawPoolName.trim())
            .filter(rawPoolName => !!rawPoolName); // non-empty only, if pool list is de-facto empty

    dispatch(updateStoragePools({
        connectionName,
        pools,
    }));

    return pools; // return pools to simplify further processing
}

function parseStorageVolumes(dispatch, connectionName, poolName, volumes) {
    logDebug('parseStorageVolumes(), input: ', volumes);
    return dispatch(updateStorageVolumes({ // return promise to allow waiting in addDiskDialog()
        connectionName,
        poolName,
        volumes: volumes.trim()
                .split('\n')
                .map(volume => volume.trim())
                .filter(volume => !!volume) // non-empty lines
                .map(volume => {
                    const fields = volume.split(/\s\s+/); // two spaces at least; lowers chance for bug with spaces in the volume name
                    if (fields.length < 3 || fields[2] !== 'file') {
                        // skip 'dir' type; use just flatten dir-pool structure
                        return null;
                    }
                    return {
                        name: fields[0].trim(),
                        path: fields[1].trim(),
                    };
                })
                .filter(volume => !!volume),
    }));
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
            // there might be changes between live and permanent domain definition, so full reload
            dispatch(getVm(connectionName, name));

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
