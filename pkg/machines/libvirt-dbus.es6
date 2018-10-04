/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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
 * Provider for Libvirt using libvirt-dbus API.
 * See https://github.com/libvirt/libvirt-dbus
 */
import cockpit from 'cockpit';

import {
    attachDisk,
    checkLibvirtStatus,
    delayPolling,
    getAllVms,
    getHypervisorMaxVCPU,
    getStoragePools,
    getStorageVolumes,
    getVm,
} from './actions/provider-actions.es6';

import {
    deleteUnlistedVMs,
    undefineVm,
    updateStoragePools,
    updateStorageVolumes,
    updateVm,
    setHypervisorMaxVCPU,
    vmActionFailed,
} from './actions/store-actions.es6';

import {
    getDiskXML,
    getVolumeXML
} from './xmlCreator.es6';

import {
    usagePollingEnabled
} from './selectors.es6';

import VCPUModal from './components/vcpuModal.jsx';

import {
    logDebug
} from './helpers.es6';

import {
    buildFailHandler,
    canConsole,
    canDelete,
    canInstall,
    canReset,
    canRun,
    canSendNMI,
    canShutdown,
    getDiskElemByTarget,
    getSingleOptionalElem,
    isRunning,
    parseDumpxml,
    serialConsoleCommand,
    unknownConnectionName,
    updateVCPUSettings,
    CONSOLE_VM,
    CHECK_LIBVIRT_STATUS,
    CREATE_VM,
    ENABLE_LIBVIRT,
    GET_OS_INFO_LIST,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    START_LIBVIRT,
} from './libvirt-common.es6';

const _ = cockpit.gettext;

let clientLibvirt = {};
/* Default timeout for libvirt-dbus method calls */
const TIMEOUT = { timeout: 30000 };

const Enum = {
    VIR_DOMAIN_AFFECT_CURRENT: 0,
    VIR_DOMAIN_AFFECT_LIVE: 1,
    VIR_DOMAIN_AFFECT_CONFIG: 2,
    VIR_DOMAIN_UNDEFINE_MANAGED_SAVE: 1,
    VIR_DOMAIN_UNDEFINE_SNAPSHOTS_METADATA: 2,
    VIR_DOMAIN_UNDEFINE_NVRAM: 4,
    VIR_DOMAIN_STATS_BALLOON: 4,
    VIR_DOMAIN_STATS_VCPU: 8,
    VIR_DOMAIN_STATS_BLOCK: 32,
    VIR_DOMAIN_XML_INACTIVE: 2,
    VIR_CONNECT_LIST_STORAGE_POOLS_ACTIVE: 2,
    VIR_CONNECT_LIST_STORAGE_POOLS_DIR: 64
};

let LIBVIRT_DBUS_PROVIDER = {};
LIBVIRT_DBUS_PROVIDER = {
    name: 'LibvirtDBus',

    /*
     * Initialize the provider.
     *
     * @param providerContext
     * @returns {boolean} - true, if initialization succeeded; or Promise
     */
    init(providerContext) {
        return true;
    },

    openVCPUModal: (params) => VCPUModal(params),

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
    GET_OS_INFO_LIST,
    INIT_DATA_RETRIEVAL,
    INSTALL_VM,
    START_LIBVIRT,
    /* End of common provider functions  */

    ATTACH_DISK({
        connectionName,
        diskFileName,
        target,
        vmId,
        vmName,
        permanent,
        hotplug
    }) {
        let flags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
        if (hotplug)
            flags |= Enum.VIR_DOMAIN_AFFECT_LIVE;
        if (permanent)
            flags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

        let xmlDesc = getDiskXML(diskFileName, target);

        return dispatch => {
            call(connectionName, vmId, 'org.libvirt.Domain', 'AttachDevice', [xmlDesc, flags], TIMEOUT)
                    .fail(exception => {
                        console.error("ATTACH_DISK failed for diskFileName", diskFileName, JSON.stringify(exception));
                        dispatch(vmActionFailed({
                            name: vmName,
                            connectionName,
                            message: _("VM ATTACH_DISK action failed"),
                            detail: { exception }
                        }));
                    });
        };
    },

    CHANGE_NETWORK_STATE({
        connectionName,
        id: objPath,
        name,
        networkMac,
        state,
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .done(domXml => {
                        let updatedXml = updateNetworkIfaceState(domXml[0], networkMac, state);
                        if (!updatedXml) {
                            dispatch(vmActionFailed({
                                name,
                                connectionName,
                                message: _("VM CHANGE_NETWORK_STATE action failed: updated device XML couldn't not be generated"),
                            }));
                        } else {
                            call(connectionName, objPath, 'org.libvirt.Domain', 'UpdateDevice', [updatedXml, Enum.VIR_DOMAIN_AFFECT_CURRENT], TIMEOUT)
                                    .done(() => {
                                        dispatch(getVm({connectionName, id:objPath}));
                                    })
                                    .fail(exception => dispatch(vmActionFailed({
                                        name,
                                        connectionName,
                                        message: _("VM CHANGE_NETWORK_STATE action failed"),
                                        detail: {exception}
                                    })));
                        }
                    })
                    .fail(ex => console.error("VM GetXMLDesc method for domain %s failed: %s", name, JSON.stringify(ex)));
        };
    },

    CREATE_AND_ATTACH_VOLUME({
        connectionName,
        poolName,
        volumeName,
        size,
        format,
        target,
        vmId,
        vmName,
        permanent,
        hotplug
    }) {
        let volXmlDesc = getVolumeXML(volumeName, size, format, target);

        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], TIMEOUT)
                    .done((storagePoolPath) => {
                        call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'StorageVolCreateXML', [volXmlDesc, 0], TIMEOUT)
                                .done((storageVolumePath) => {
                                    call(connectionName, storageVolumePath[0], "org.freedesktop.DBus.Properties", "Get", ["org.libvirt.StorageVol", "Path"], TIMEOUT)
                                            .done((volPath) => {
                                                return dispatch(attachDisk({ connectionName, diskFileName: volPath[0].v, target, vmId, permanent, hotplug }))
                                                        .then(() => {
                                                            // force reload of VM data, events are not reliable (i.e. for a down VM)
                                                            dispatch(getVm({connectionName, id:vmId}));
                                                        }, (exception) => dispatch(vmActionFailed({
                                                            name: vmName,
                                                            connectionName,
                                                            message: _("CREATE_AND_ATTACH_VOLUME action failed"),
                                                            detail: {exception}
                                                        })));
                                            })
                                            .fail(exception => dispatch(vmActionFailed({
                                                name: vmName,
                                                connectionName,
                                                message: _("CREATE_AND_ATTACH_VOLUME action failed"),
                                                detail: {exception}
                                            })));
                                })
                                .fail(exception => dispatch(vmActionFailed({
                                    name: vmName,
                                    connectionName,
                                    message: _("CREATE_AND_ATTACH_VOLUME action failed"),
                                    detail: {exception}
                                })));
                    })
                    .fail(exception => dispatch(vmActionFailed({
                        name: vmName,
                        connectionName,
                        message: _("CREATE_AND_ATTACH_VOLUME action failed"),
                        detail: {exception}
                    })));
        };
    },

    DELETE_VM({
        name,
        connectionName,
        id: objPath,
        options
    }) {
        function destroy(dispatch) {
            return call(connectionName, objPath, 'org.libvirt.Domain', 'Destroy', [0], TIMEOUT)
                    .catch(exception => dispatch(vmActionFailed({
                        name: name,
                        connectionName,
                        message: _("VM DELETE action failed"),
                        detail: {exception}
                    })));
        }

        function undefine(dispatch) {
            let storageVolPromises = [];
            let storageVolPathsPromises = [];
            let flags = Enum.VIR_DOMAIN_UNDEFINE_MANAGED_SAVE | Enum.VIR_DOMAIN_UNDEFINE_SNAPSHOTS_METADATA | Enum.VIR_DOMAIN_UNDEFINE_NVRAM;

            for (let i = 0; i < options.storage.length; i++) {
                storageVolPathsPromises.push(
                    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StorageVolLookupByPath', [options.storage[i]], TIMEOUT)
                );
            }

            Promise.all(storageVolPathsPromises)
                    .then((storageVolPaths) => {
                        for (let i = 0; i < storageVolPaths.length; i++) {
                            storageVolPromises.push(
                                call(connectionName, storageVolPaths[i][0], 'org.libvirt.StorageVol', 'Delete', [0], TIMEOUT)
                            );
                        }
                        return Promise.all(storageVolPathsPromises);
                    })
                    .then(() => {
                        call(connectionName, objPath, 'org.libvirt.Domain', 'Undefine', [flags], TIMEOUT);
                    })
                    .catch(exception => dispatch(vmActionFailed({
                        name: name,
                        connectionName,
                        message: _("VM DELETE action failed"),
                        detail: {exception}
                    })));
        }

        return dispatch => {
            if (options.destroy) {
                return destroy(dispatch).then(undefine(dispatch));
            } else {
                return undefine(dispatch);
            }
        };
    },

    DETACH_DISK({
        name,
        connectionName,
        id: vmPath,
        target,
        live
    }) {
        let detachFlags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
        if (live)
            detachFlags |= Enum.VIR_DOMAIN_AFFECT_LIVE;

        return dispatch => {
            clientLibvirt[connectionName].call(vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .done(domXml => {
                        let diskXML = getDiskElemByTarget(domXml[0], target);
                        let getXMLFlags = Enum.VIR_DOMAIN_XML_INACTIVE;

                        clientLibvirt[connectionName].call(vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [getXMLFlags], TIMEOUT)
                                .done(domInactiveXml => {
                                    let diskInactiveXML = getDiskElemByTarget(domInactiveXml[0], target);
                                    if (diskInactiveXML)
                                        detachFlags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

                                    clientLibvirt[connectionName].call(vmPath, 'org.libvirt.Domain', 'DetachDevice', [diskXML, detachFlags], TIMEOUT)
                                            .done(() => { dispatch(getVm({connectionName, id:vmPath})) })
                                            .fail(buildFailHandler({ dispatch, name, connectionName, message: _("VM DETACH action failed") }));
                                })
                                .fail(buildFailHandler({ dispatch, name, connectionName, message: _("VM DETACH action failed") }));
                    })
                    .fail(buildFailHandler({ dispatch, name, connectionName, message: _("VM DETACH action failed") }));
        };
    },

    FORCEOFF_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Destroy', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM FORCE OFF action failed"),
                        detail: { exception }
                    })));
        };
    },

    FORCEREBOOT_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Reset', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM FORCE REBOOT action failed"),
                        detail: { exception }
                    })));
        };
    },

    /*
     * Initiate read of all VMs
     *
     * @returns {Function}
     */
    GET_ALL_VMS({
        connectionName,
        libvirtServiceName
    }) {
        if (connectionName) {
            return dispatch => {
                dispatch(checkLibvirtStatus(libvirtServiceName));
                dbus_client(connectionName);
                startEventMonitor(dispatch, connectionName, libvirtServiceName);
                doGetAllVms(dispatch, connectionName);
                dispatch(getStoragePools(connectionName));
                dispatch(getHypervisorMaxVCPU(connectionName));
            };
        }

        return unknownConnectionName(getAllVms, libvirtServiceName);
    },

    GET_HYPERVISOR_MAX_VCPU({ connectionName }) {
        logDebug(`${this.name}.GET_HYPERVISOR_MAX_VCPU: connection: ${connectionName}`);

        if (connectionName) {
            return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'GetDomainCapabilities', ['', '', '', '', 0], TIMEOUT)
                    .done((capsXML) => {
                        let count = getDomainMaxVCPU(capsXML[0]);
                        dispatch(setHypervisorMaxVCPU({ count, connectionName }));
                    })
                    .fail(ex => console.error("GetDomainCapabilities failed: %s", ex));
        }

        return unknownConnectionName(setHypervisorMaxVCPU);
    },

    /**
     * Retrieves list of libvirt "storage pools" for particular connection.
     */
    GET_STORAGE_POOLS({
        connectionName
    }) {
        let flags = Enum.VIR_CONNECT_LIST_STORAGE_POOLS_ACTIVE | Enum.VIR_CONNECT_LIST_STORAGE_POOLS_DIR;
        return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListStoragePools', [flags], TIMEOUT)
                .done(objPaths => {
                    let pools = [];
                    let storagePoolsPropsPromises = [];

                    logDebug(`GET_STORAGE_POOLS: object paths: ${JSON.stringify(objPaths)}`);

                    for (let i = 0; i < objPaths[0].length; i++) {
                        storagePoolsPropsPromises.push(call(connectionName, objPaths[0][i], "org.freedesktop.DBus.Properties", "Get", ["org.libvirt.StoragePool", "Name"], TIMEOUT));
                    }
                    Promise.all(storagePoolsPropsPromises).then(poolNames => {
                        for (let i = 0; i < poolNames.length; i++) {
                            pools.push(poolNames[i][0].v);
                        }
                        dispatch(updateStoragePools({
                            connectionName,
                            pools,
                        }));
                        const promises = pools.map(poolName => dispatch(getStorageVolumes(connectionName, poolName)));
                        return cockpit.all(promises);
                    });
                })
                .fail(ex => console.error("ListStoragePools failed:", JSON.stringify(ex)));
    },

    GET_STORAGE_VOLUMES({ connectionName, poolName }) {
        return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], TIMEOUT)
                .done(storagePoolPath => {
                    call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'ListStorageVolumes', [0], TIMEOUT)
                            .done((objPaths) => {
                                let volumes = [];
                                let storageVolumesPropsPromises = [];

                                for (let i = 0; i < objPaths[0].length; i++) {
                                    storageVolumesPropsPromises.push(call(connectionName, objPaths[0][i], "org.freedesktop.DBus.Properties", "GetAll", ["org.libvirt.StorageVol"], TIMEOUT));
                                }
                                Promise.all(storageVolumesPropsPromises).then((resultProps) => {
                                    for (let i = 0; i < resultProps.length; i++) {
                                        let props = resultProps[i][0];
                                        if (("Name" in props) && ("Path" in props)) {
                                            volumes.push({
                                                "name": props.Name.v.v,
                                                "path": props.Path.v.v
                                            });
                                        }
                                    }
                                    return dispatch(updateStorageVolumes({
                                        connectionName,
                                        poolName,
                                        volumes
                                    }));
                                });
                            })
                            .fail(ex => console.error("ListStorageVolumes failed:", ex));
                })
                .fail(ex => console.error("StoragePoolLookupByName for pool %s failed: %s", poolName, JSON.stringify(ex)));
    },

    /*
     * Read VM properties of a single VM
     *
     * @param VM object path
     * @returns {Function}
     */
    GET_VM({
        id: objPath,
        connectionName
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .done(domXml => {
                        parseDumpxml(dispatch, connectionName, domXml[0], objPath);
                        call(connectionName, objPath, 'org.libvirt.Domain', 'GetState', [0], TIMEOUT)
                                .done(state => {
                                    let DOMAINSTATE = [
                                        "no state",
                                        "running",
                                        "blocked",
                                        "paused",
                                        "shutdown",
                                        "shut off",
                                        "crashed",
                                        "pmsuspended",
                                    ];
                                    let stateStr = DOMAINSTATE[state[0][0]];
                                    let props = {
                                        connectionName,
                                        id: objPath,
                                        state: stateStr,
                                    };
                                    if (!LIBVIRT_DBUS_PROVIDER.isRunning(stateStr))
                                        props.actualTimeInMs = -1;

                                    call(connectionName, objPath, "org.freedesktop.DBus.Properties", "GetAll", ["org.libvirt.Domain"], TIMEOUT)
                                            .done(function(returnProps) {
                                                /* Sometimes not all properties are returned, for example when some domain got deleted while part
                                                 * of the properties got fetched from libvirt. Make sure that there is check before reading the attributes.
                                                 */
                                                if ("Name" in returnProps[0])
                                                    props.name = returnProps[0].Name.v.v;
                                                if ("Persistent" in returnProps[0])
                                                    props.persistent = returnProps[0].Persistent.v.v;
                                                if ("Autostart" in returnProps[0])
                                                    props.autostart = returnProps[0].Autostart.v.v;

                                                logDebug(`${this.name}.GET_VM(${objPath}, ${connectionName}): update props ${JSON.stringify(props)}`);
                                                dispatch(updateVm(props));
                                            })
                                            .fail(function(ex) { console.warn("failed waiting for Domain proxy to get ready", ex) });
                                })
                                .fail(function(ex) { console.warn("GetState method failed for path", objPath, ex) });
                    })
                    .fail(function(ex) { console.warn("GetXMLDesc method failed for path", objPath, ex) });
        };
    },

    REBOOT_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Reboot', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM REBOOT action failed"),
                        detail: { exception }
                    })));
        };
    },

    SENDNMI_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'InjectNMI', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM SENDNMI action failed"),
                        detail: {exception}
                    })));
        };
    },

    SET_VCPU_SETTINGS ({
        name,
        id: objPath,
        connectionName,
        count,
        max,
        sockets,
        cores,
        threads,
        isRunning
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .done(domXml => {
                        let updatedXML = updateVCPUSettings(domXml[0], count, max, sockets, cores, threads);
                        call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], TIMEOUT)
                                .fail(exception => dispatch(vmActionFailed(
                                    { name, connectionName, message: _("SET_VCPU_SETTINGS action failed"), detail: {exception} }
                                )));
                    })
                    .fail(exception => dispatch(vmActionFailed(
                        { name, connectionName, message: _("SET_VCPU_SETTINGS action failed"), detail: {exception} }
                    )));
        };
    },

    SHUTDOWN_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Shutdown', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed(
                        { name, connectionName, message: _("VM SHUT DOWN action failed"), detail: {exception} }
                    )));
        };
    },

    START_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Create', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM START action failed"),
                        detail: { exception }
                    })));
        };
    },

    USAGE_START_POLLING({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            dispatch(updateVm({ connectionName, name, usagePolling: true }));
            dispatch(doUsagePolling(name, connectionName, objPath));
        };
    },

    USAGE_STOP_POLLING({
        name,
        connectionName
    }) {
        return dispatch => dispatch(updateVm({
            connectionName,
            name,
            usagePolling: false
        }));
    },
};

function getDomainMaxVCPU(capsXML) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(capsXML, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse capabilities xml, input: "${capsXML}"`);
        return;
    }

    const domainCapsElem = xmlDoc.getElementsByTagName("domainCapabilities")[0];
    const vcpuElem = domainCapsElem.getElementsByTagName("vcpu")[0];
    const vcpuMaxAttr = vcpuElem.getAttribute('max');

    return vcpuMaxAttr;
}

/**
 * Calculates disk statistics.
 * @param  {info} Object returned by GetStats method call.
 * @return {Dictionary Object}
 */
function calculateDiskStats(info) {
    const disksStats = {};

    if (!('block.count' in info))
        return;
    const count = info['block.count'].v.v;
    if (!count)
        return;

    /* Note 1: Libvirt reports disk capacity since version 1.2.18 (year 2015)
       TODO: If disk stats is required for old systems, find a way how to get
       it when 'block.X.capacity' is not present, consider various options for
       'sources'

       Note 2: Casting to string happens for return types to be same with
       results from libvirt.es6 file.
     */
    for (let i = 0; i < count; i++) {
        const target = info[`block.${i}.name`].v.v;
        const physical = info[`block.${i}.physical`] === undefined ? NaN : info[`block.${i}.physical`].v.v.toString();
        const capacity = info[`block.${i}.capacity`] === undefined ? NaN : info[`block.${i}.capacity`].v.v.toString();
        const allocation = info[`block.${i}.allocation`] === undefined ? NaN : info[`block.${i}.allocation`].v.v.toString();

        if (target) {
            disksStats[target] = {
                physical,
                capacity,
                allocation,
            };
        } else {
            console.error(`calculateDiskStats(): mandatory property is missing in info (block.${i}.name)`);
        }
    }
    return disksStats;
}

/**
 * Update all VMs found by ListDomains method for specific D-Bus connection.
 * @param  {Function} dispatch.
 * @param  {String} connectionName D-Bus connection type; one of session/system.
 */
function doGetAllVms(dispatch, connectionName) {
    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListDomains', [0], TIMEOUT)
            .done(objPaths => {
                logDebug(`GET_ALL_VMS: object paths: ${JSON.stringify(objPaths)}`);

                dispatch(deleteUnlistedVMs(connectionName, [], objPaths[0]));

                return cockpit.all(objPaths[0].map((path) => dispatch(getVm({connectionName, id:path}))));
            })
            .fail(ex => console.warn("ListDomains failed:", JSON.stringify(ex)));
}

/**
 * Dispatch an action to initialize usage polling for Domain statistics.
 * @param  {String} name           Domain name.
 * @param  {String} connectionName D-Bus connection type; one of session/system.
 * @param  {String} objPath        D-Bus object path of the Domain we need to poll.
 * @return {Function}
 */
function doUsagePolling(name, connectionName, objPath) {
    logDebug(`doUsagePolling(${name}, ${connectionName}, ${objPath})`);

    return (dispatch, getState) => {
        if (!usagePollingEnabled(getState(), name, connectionName)) {
            logDebug(`doUsagePolling(${name}, ${connectionName}): usage polling disabled, stopping loop`);
            return;
        }
        let flags = Enum.VIR_DOMAIN_STATS_BALLOON | Enum.VIR_DOMAIN_STATS_VCPU | Enum.VIR_DOMAIN_STATS_BLOCK;

        call(connectionName, objPath, 'org.libvirt.Domain', 'GetStats', [flags, 0], { timeout: 5000 })
                .done(info => {
                    if (Object.getOwnPropertyNames(info[0]).length > 0) {
                        info = info[0];
                        let props = { name, connectionName, id: objPath };
                        let avgvCpuTime = 0;

                        if ('balloon.rss' in info)
                            props['rssMemory'] = info['balloon.rss'].v.v;
                        for (var i = 0; i < info['vcpu.maximum'].v.v; i++) {
                            if (!(`vcpu.${i}.time` in info))
                                continue;
                            avgvCpuTime += info[`vcpu.${i}.time`].v.v;
                        }
                        avgvCpuTime /= info['vcpu.current'].v.v;
                        if (info['vcpu.current'].v.v > 0)
                            Object.assign(props, {
                                actualTimeInMs: Date.now(),
                                cpuTime: avgvCpuTime
                            });
                        Object.assign(props, {
                            disksStats: calculateDiskStats(info)
                        });

                        logDebug(`doUsagePolling: ${JSON.stringify(props)}`);
                        dispatch(updateVm(props));
                    }
                })
                .fail(ex => console.warn(`GetStats(${name}, ${connectionName}) failed: ${JSON.stringify(ex)}`))
                .always(() => dispatch(delayPolling(doUsagePolling(name, connectionName, objPath), null, name, connectionName)));
    };
}

/**
 * Subscribe to D-Bus signals and defines the handlers to be invoked in each occassion.
 * @param  {String} connectionName D-Bus connection type; one of session/system.
 * @param  {String} libvirtServiceName
 */
function startEventMonitor(dispatch, connectionName, libvirtServiceName) {
    if (connectionName !== 'session' && connectionName !== 'system')
        return;

    /* Subscribe to Domain Lifecycle signals on Connect Interface */
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Connect', member: 'DomainEvent' },
        (path, iface, signal, args) => {
            let domainEvent = {
                "Defined": 0,
                "Undefined": 1,
                "Started": 2,
                "Suspended": 3,
                "Resumed": 4,
                "Stopped": 5,
                "Shutdown": 6,
                "PMsuspended": 7,
                "Crashed": 8
            };
            let objPath = args[0];
            let eventType = args[1];

            logDebug(`signal on ${path}: ${iface}.${signal}(${JSON.stringify(args)})`);

            switch (eventType) {
            case domainEvent["Defined"]:
                dispatch(getVm({connectionName, id:objPath}));
                break;

            case domainEvent["Undefined"]:
                dispatch(undefineVm({connectionName, id: objPath}));
                break;

            case domainEvent["Started"]:
                dispatch(getVm({connectionName, id:objPath}));
                break;

            case domainEvent["Suspended"]:
                dispatch(updateVm({
                    connectionName,
                    id: objPath,
                    state: 'paused'
                }));
                break;

            case domainEvent["Resumed"]:
                dispatch(updateVm({
                    connectionName,
                    id: objPath,
                    state: 'running'
                }));
                break;

            case domainEvent["Stopped"]:
                dispatch(getVm({
                    connectionName,
                    id: objPath
                }));
                // transient VMs don't have a separate Undefined event, so remove them on stop
                dispatch(undefineVm({connectionName, id: objPath, transientOnly: true}));
                break;

            default:
                logDebug(`Unhandled lifecycle event type ${eventType}`);
                break;
            }
        }
    );

    /* Subscribe to signals on Domain Interface */
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Domain' },
        (path, iface, signal, args) => {
            logDebug(`signal on ${path}: ${iface}.${signal}(${JSON.stringify(args)})`);

            switch (signal) {
            case 'ControlError':
            case 'DeviceAdded':
            case 'DeviceRemoved':
            case 'DiskChange':
            case 'MetadataChanged':
            case 'TrayChange':
            /* These signals imply possible changes in what we display, so re-read the state */
                dispatch(getVm({connectionName, id:path}));
                break;

            default:
                logDebug(`handleEvent ${connectionName} ${name}: ignoring event ${signal}`);
            }
        });

    /* Listen on a stopped libvirtd on systemd D-Bus. If user is using libvirtd not started
     * by systemd this handler will not be triggered.
     */
    if (connectionName === 'system') {
        let systemdClient = cockpit.dbus('org.freedesktop.systemd1', { bus: connectionName });
        systemdClient.subscribe(
            { interface: 'org.freedesktop.DBus.Properties', path: '/org/freedesktop/systemd1/unit/libvirtd_2eservice', member: 'PropertiesChanged' },
            (path, iface, signal, args) => {
                if (args[0] === "org.freedesktop.systemd1.Unit" && args[1].ActiveState.v === "deactivating") {
                    dispatch(checkLibvirtStatus(libvirtServiceName));
                    dispatch(deleteUnlistedVMs(connectionName, []));
                    dispatch(delayPolling(getAllVms(connectionName, libvirtServiceName)));
                }
            }
        );
    }
}

/**
 * Get Libvirt D-Bus client
 */
function dbus_client(connectionName) {
    if (!(connectionName in clientLibvirt) || clientLibvirt[connectionName] === null) {
        let opts = { bus: connectionName };
        if (connectionName === 'system')
            opts['superuser'] = 'try';
        clientLibvirt[connectionName] = cockpit.dbus("org.libvirt", opts);
    }

    return clientLibvirt[connectionName];
}

/**
 * Call a Libvirt method
 */
function call(connectionName, objectPath, iface, method, args, opts) {
    return dbus_client(connectionName).call(objectPath, iface, method, args, opts);
}

/**
 * Returns updated XML description of the network interface specified by mac address.
 * @param  {String} domXml      Domain XML description.
 * @param  {String} networkMac  MAC Address of the network interface we will update.
 * @param  {String} state       Desired state; one of up/down.
 * @return {String}             Updated XML description of the device we will update or null on error.
 */
function updateNetworkIfaceState(domXml, networkMac, state) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(domXml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${domXml}"`);
        return null;
    }

    const domainElem = xmlDoc.getElementsByTagName("domain")[0];
    const devicesElem = domainElem.getElementsByTagName("devices")[0];
    const interfaceElems = devicesElem.getElementsByTagName('interface');

    if (interfaceElems) {
        for (let i = 0; i < interfaceElems.length; i++) {
            const interfaceElem = interfaceElems[i];
            const macElem = getSingleOptionalElem(interfaceElem, 'mac');
            if (macElem === undefined)
                return null;
            const mac = macElem.getAttribute('address');

            if (mac !== networkMac)
                continue;

            let linkElem = getSingleOptionalElem(interfaceElem, 'link');
            if (linkElem === undefined) {
                let doc = document.implementation.createDocument('', '', null);
                linkElem = doc.createElement('link');
                interfaceElem.appendChild(linkElem);
            }
            linkElem.setAttribute('state', state);
            let returnXML = (new XMLSerializer()).serializeToString(interfaceElem);

            logDebug(`updateNetworkIfaceState: Updated XML: "${returnXML}"`);

            return returnXML;
        }
    }
    console.warn("Can't update network interface element in domXml");
    return null;
}

export default LIBVIRT_DBUS_PROVIDER;
