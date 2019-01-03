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

import {
    updateVm,
    updateOrAddVm,
    undefineVm,
    updateOrAddStoragePool,
    deleteUnlistedVMs,
    updateStorageVolumes,
    setHypervisorMaxVCPU,
} from './actions/store-actions.js';

import {
    attachDisk,
    checkLibvirtStatus,
    delayPolling,
    getAllStoragePools,
    getAllVms,
    getHypervisorMaxVCPU,
    getStoragePool,
    getStorageVolumes,
    getVm,
} from './actions/provider-actions.js';

import { usagePollingEnabled } from './selectors.js';
import { spawnScript, spawnProcess } from './services.js';
import {
    isEmpty,
    logDebug,
} from './helpers.js';

import {
    buildFailHandler,
    canConsole,
    canDelete,
    canInstall,
    canReset,
    canRun,
    canSendNMI,
    canShutdown,
    createTempFile,
    isRunning,
    parseDumpxml,
    parseStoragePoolDumpxml,
    resolveUiState,
    serialConsoleCommand,
    unknownConnectionName,
    updateVCPUSettings,
    CONSOLE_VM,
    CHECK_LIBVIRT_STATUS,
    CREATE_VM,
    ENABLE_LIBVIRT,
    GET_LOGGED_IN_USER,
    GET_OS_INFO_LIST,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    START_LIBVIRT,
} from './libvirt-common.js';

import VMS_CONFIG from './config.js';

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
     * @param providerContext - contains context details, like the dispatch function, see provider.js
     * @returns {boolean} - true, if initialization succeeded; or Promise
     */
    init({ dispatch }) {
        // This is default provider - the Libvirt, so we do not need to use the providerContext param.
        // The method is here for reference only.
        return true; // or Promise
    },

    /* Start of common provider functions */
    canConsole,
    canDelete,
    canInstall,
    canReset,
    canRun,
    canSendNMI,
    canShutdown,
    isRunning,
    serialConsoleCommand,
    CONSOLE_VM,
    CHECK_LIBVIRT_STATUS,
    CREATE_VM,
    ENABLE_LIBVIRT,
    GET_LOGGED_IN_USER,
    GET_OS_INFO_LIST,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    START_LIBVIRT,
    /* End of common provider functions  */

    /**
     * Read VM properties of a single VM (virsh)
     *
     * @param VM name
     * @returns {Function}
     */
    GET_VM ({ name, connectionName, updateOnly }) {
        logDebug(`${this.name}.GET_VM()`);
        let xmlDesc;
        let xmlInactiveDesc;

        return dispatch => {
            if (!isEmpty(name)) {
                return spawnVirshReadOnly({connectionName, method: 'dumpxml', name})
                        .then(domXml => {
                            xmlDesc = domXml;
                            return spawnVirshReadOnly({connectionName, method: 'dumpxml', params: '--inactive', name});
                        })
                        .then(domInactiveXml => {
                            xmlInactiveDesc = domInactiveXml;
                            return spawnVirshReadOnly({connectionName, method: 'dominfo', name});
                        })
                        .then(domInfo => {
                            let dumpxmlParams = parseDumpxml(dispatch, connectionName, xmlDesc);
                            let domInfoParams = parseDominfo(dispatch, connectionName, name, domInfo);

                            dumpxmlParams.ui = resolveUiState(dispatch, name);
                            dumpxmlParams.inactiveXML = parseDumpxml(dispatch, connectionName, xmlInactiveDesc);

                            if (updateOnly)
                                dispatch(updateVm(
                                    Object.assign({}, dumpxmlParams, domInfoParams)
                                ));
                            else
                                dispatch(updateOrAddVm(
                                    Object.assign({}, dumpxmlParams, domInfoParams)
                                ));
                        }); // end of GET_VM return
            }
        };
    },

    GET_ALL_STORAGE_POOLS({ connectionName }) {
        const connection = VMS_CONFIG.Virsh.connections[connectionName];

        return dispatch => spawnScript({
            script: `virsh ${connection.params.join(' ')} -r pool-list --all | awk 'NR>2 {print $1}'`
        }).then(output => {
            const storagePoolNames = output.trim().split(/\r?\n/);
            storagePoolNames.forEach((storagePoolName, index) => {
                storagePoolNames[index] = storagePoolName.trim();
            });
            logDebug(`GET_ALL_STORAGE_POOLS: vmNames: ${JSON.stringify(storagePoolNames)}`);

            return cockpit.all(storagePoolNames.map((name) => dispatch(getStoragePool({connectionName, name}))));
        });
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
                dispatch(getAllStoragePools(connectionName));
            };
        }

        return unknownConnectionName(getAllVms, libvirtServiceName);
    },

    /**
     * Read properties of a single Storage Pool (virsh)
     *
     * @param Storage Pool name
     * @returns {Function}
     */
    GET_STORAGE_POOL({ name, connectionName }) {
        let dumpxmlParams;

        return dispatch => {
            if (!isEmpty(name)) {
                return spawnVirshReadOnly({connectionName, method: 'pool-dumpxml', name})
                        .then(storagePoolXml => {
                            dumpxmlParams = parseStoragePoolDumpxml(connectionName, storagePoolXml);
                            return spawnVirshReadOnly({connectionName, method: 'pool-info', name});
                        })
                        .then(poolInfo => {
                            const poolInfoParams = parseStoragePoolInfo(poolInfo);

                            dispatch(updateOrAddStoragePool(Object.assign({}, dumpxmlParams, poolInfoParams)));
                            dispatch(getStorageVolumes({ connectionName, poolName: name }));
                        });
            }
        };
    },

    GET_STORAGE_VOLUMES({ connectionName, poolName }) {
        logDebug(`${this.name}.GET_STORAGE_VOLUMES(connectionName='${connectionName}', poolName='${poolName}')`);
        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        // Caution: output of virsh v1.3.1 (ubuntu-1604) and v3.7.0 differs, the 'grep' unifies it
        const command = `virsh ${connection} -q pool-refresh ${poolName} && virsh ${connection} -q -r vol-list ${poolName} --details | (grep file || true)`;
        let data = '';
        return dispatch => cockpit
                .script(command, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']})
                .stream(output => { data += output })
                .then(() => parseStorageVolumes(dispatch, connectionName, poolName, data))
                .fail((exception, data) => {
                    console.warn('Failed to get list of Libvirt storage volumes for connection: ', connectionName, ', pool: ', poolName, ': ', data, exception);
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
                .then(() => {
                    logDebug('Storage volume created, poolName: ', poolName, ', volumeName: ', volumeName);
                    return dispatch(attachDisk({ connectionName, poolName, volumeName, format, target, vmName, permanent, hotplug }));
                });
    },

    ATTACH_DISK({ connectionName, poolName, volumeName, format, target, vmName, permanent, hotplug }) {
        logDebug(`${this.name}.ATTACH_DISK("`, connectionName, '", "', poolName, '", "', volumeName, '", "', target, '", "', vmName, '"');
        const connection = VMS_CONFIG.Virsh.connections[connectionName].params.join(' ');
        const volpathCommand = `virsh ${connection} vol-path --pool ${poolName} ${volumeName}`;

        return () => cockpit.script(volpathCommand, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']})
                .then((volPath) => {
                    let scope = permanent ? '--config' : '';
                    scope = scope + (hotplug ? ' --live' : '');
                    const command = `virsh ${connection} attach-disk ${vmName} --driver qemu --subdriver ${format} ${volPath.trim()} ${target} ${scope}`;

                    logDebug('ATTACH_DISK command: ', command);
                    return cockpit.script(command, null, {err: "message", environ: ['LC_ALL=en_US.UTF-8']});
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

    SET_VCPU_SETTINGS ({ name, connectionName, count, max, sockets, cores, threads, isRunning }) {
        logDebug(`${this.name}.SET_VCPU_SETTINGS(${name}):`);

        return dispatch => spawnVirshReadOnly({
            connectionName,
            method: 'dumpxml',
            name
        })
                .then((domXml) => {
                    let domXML = updateVCPUSettings(domXml, count, max, sockets, cores, threads);
                    return createTempFile(domXML);
                })
                .then((tempFilename) => {
                    return spawnVirsh({connectionName,
                                       method: 'SET_VCPU_SETTINGS',
                                       args: ['define', tempFilename.trim()]
                    });
                });
    },

    DELETE_VM ({ name, connectionName, options }) {
        logDebug(`${this.name}.DELETE_VM(${name}, ${JSON.stringify(options)}):`);

        return dispatch => {
            function destroy() {
                return spawnVirsh({ connectionName,
                                    method: 'DELETE_VM',
                                    failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM DELETE (DESTROY) action failed") }),
                                    args: [ 'destroy', name ]
                });
            }

            function undefine() {
                let args = ['undefine', name, '--managed-save', '--nvram'];
                if (options.storage) {
                    args.push('--storage');
                    args.push(options.storage.join(','));
                }
                return spawnVirsh({ connectionName,
                                    method: 'DELETE_VM',
                                    failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM DELETE (UNDEFINE) action failed") }),
                                    args: args
                });
            }

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
                dispatch(getVm({connectionName, name}));
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

    SENDNMI_VM ({ name, connectionName }) {
        logDebug(`${this.name}.SENDNMI_VM(${name}):`);
        return dispatch => spawnVirsh({connectionName,
                                       method: 'SENDNMI_VM',
                                       failHandler: buildFailHandler({ dispatch, name, connectionName, message: _("VM SEND Non-Maskable Interrrupt action failed") }),
                                       args: ['inject-nmi', name]
        });
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
        return cockpit.all(vmNames.map((name) => dispatch(getVm({connectionName, name}))));
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

function spawnVirshReadOnly({connectionName, method, name, params, failHandler}) {
    let args = params ? ['-r', method, params, name] : ['-r', method, name];

    return spawnVirsh({connectionName, method, args, failHandler});
}

function parseDominfo(dispatch, connectionName, name, domInfo) {
    const lines = parseLines(domInfo);
    const state = getValueFromLine(lines, 'State:');
    const autostart = getValueFromLine(lines, 'Autostart:');
    const persistent = getValueFromLine(lines, 'Persistent:') == 'yes';

    if (!LIBVIRT_PROVIDER.isRunning(state)) { // clean usage data
        return {connectionName, name, state, autostart, persistent, actualTimeInMs: -1};
    } else {
        return {connectionName, name, state, persistent, autostart};
    }
}

function parseDommemstat(dispatch, connectionName, name, dommemstat) {
    const lines = parseLines(dommemstat);

    let rssMemory = getValueFromLine(lines, 'rss'); // in KiB

    if (rssMemory) {
        return {connectionName, name, rssMemory};
    }
}

function parseDomstats(dispatch, connectionName, name, domstats) {
    const actualTimeInMs = Date.now();

    const lines = parseLines(domstats);

    const cpuTime = getValueFromLine(lines, 'cpu.time=');
    // TODO: Add network usage statistics
    let retParams = {connectionName, name, actualTimeInMs, disksStats: parseDomstatsForDisks(lines)};

    if (cpuTime) {
        retParams['cpuTime'] = cpuTime;
    }
    return retParams;
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

function parseStoragePoolInfo(poolInfo) {
    const lines = parseLines(poolInfo);
    const active = getValueFromLine(lines, 'State:') == 'running';
    const autostart = getValueFromLine(lines, 'Autostart:') == 'yes';
    const persistent = getValueFromLine(lines, 'Persistent:') == 'yes';

    return {active, persistent, autostart};
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

        return spawnVirshReadOnly({ connectionName, method: 'domstats', name, failHandler: canFailHandler })
                .then(domstats => {
                    if (domstats) {
                        let domstatsParams = parseDomstats(dispatch, connectionName, name, domstats);
                        dispatch(updateVm(domstatsParams));
                    }
                    return spawnVirshReadOnly({ connectionName, method: 'dommemstat', name, failHandler: canFailHandler });
                })
                .then(dommemstats => {
                    if (dommemstats) {
                        let dommemstatsParams = parseDommemstat(dispatch, connectionName, name, dommemstats);
                        if (dommemstatsParams)
                            dispatch(updateVm(dommemstatsParams));
                    }
                }, dispatch(updateVm({connectionName, name, rssMemory: 0.0}))
                );
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
            dispatch(undefineVm({connectionName, name}));
            break;

        case 'Defined':
        case 'Started':
            dispatch(getVm({connectionName, name}));
            break;

        case 'Stopped':
            // there might be changes between live and permanent domain definition, so full reload
            dispatch(getVm({connectionName, name, updateOnly: true}));

            // transient VMs don't have a separate Undefined event, so remove them on stop
            dispatch(undefineVm({connectionName, name, transientOnly: true}));
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
        dispatch(getVm({connectionName, name}));
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
