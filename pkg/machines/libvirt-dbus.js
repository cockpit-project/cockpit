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
    getAllNetworks,
    getAllStoragePools,
    getAllVms,
    getHypervisorMaxVCPU,
    getNetwork,
    getStoragePool,
    getStorageVolumes,
    getVm,
} from './actions/provider-actions.js';

import {
    deleteUnlistedVMs,
    undefineStoragePool,
    undefineVm,
    updateOrAddNetwork,
    updateOrAddVm,
    updateOrAddStoragePool,
    updateStorageVolumes,
    updateVm,
    setHypervisorMaxVCPU,
    vmActionFailed,
} from './actions/store-actions.js';

import {
    getDiskXML,
    getPoolXML,
    getVolumeXML
} from './xmlCreator.js';

import {
    usagePollingEnabled
} from './selectors.js';

import {
    logDebug
} from './helpers.js';

import {
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
    parseNetDumpxml,
    parseStoragePoolDumpxml,
    parseStorageVolumeDumpxml,
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
    VIR_DOMAIN_SHUTOFF: 5,
    VIR_DOMAIN_STATS_VCPU: 8,
    VIR_DOMAIN_STATS_BLOCK: 32,
    VIR_DOMAIN_STATS_STATE: 1,
    VIR_DOMAIN_XML_INACTIVE: 2,
    VIR_CONNECT_LIST_NETWORKS_ACTIVE: 2,
    VIR_CONNECT_LIST_STORAGE_POOLS_ACTIVE: 2,
    VIR_CONNECT_LIST_STORAGE_POOLS_DIR: 64,
    VIR_STORAGE_POOL_CREATE_NORMAL: 0,
    VIR_STORAGE_POOL_DELETE_NORMAL: 0,
    // Storage Pools Event Lifecycle Type
    VIR_STORAGE_POOL_EVENT_DEFINED: 0,
    VIR_STORAGE_POOL_EVENT_UNDEFINED: 1,
    VIR_STORAGE_POOL_EVENT_STARTED: 2,
    VIR_STORAGE_POOL_EVENT_STOPPED: 3,
    VIR_STORAGE_POOL_EVENT_CREATED: 4,
    VIR_STORAGE_POOL_EVENT_DELETED: 5,
    VIR_STORAGE_POOL_EVENT_LAST: 6,
    VIR_STORAGE_VOL_DELETE_NORMAL: 0,
    VIR_STORAGE_VOL_DELETE_WITH_SNAPSHOTS: 2,
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

    ATTACH_DISK({
        connectionName,
        poolName,
        volumeName,
        format,
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

        let xmlDesc = getDiskXML(poolName, volumeName, format, target);

        // Error handling is done from the calling side
        return () => call(connectionName, vmId, 'org.libvirt.Domain', 'AttachDevice', [xmlDesc, flags], TIMEOUT);
    },

    CHANGE_NETWORK_SETTINGS({
        name,
        id: objPath,
        connectionName,
        macAddress,
        networkType,
        networkSource,
        networkModel,
    }) {
        /*
         * 0 -> VIR_DOMAIN_AFFECT_CURRENT
         * 1 -> VIR_DOMAIN_AFFECT_LIVE
         * 2 -> VIR_DOMAIN_AFFECT_CONFIG
         */
        let flags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
        flags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

        // Error handling inside the modal dialog this function is called
        return clientLibvirt[connectionName].call(objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                .then(domXml => {
                    let updatedXml = updateNetworkIface({
                        domXml: domXml[0],
                        networkMac: macAddress,
                        networkType,
                        networkSource,
                        networkModelType: networkModel
                    });
                    if (!updatedXml) {
                        return Promise.reject(new Error("VM CHANGE_NETWORK_SETTINGS action failed: updated device XML couldn't not be generated"));
                    } else {
                        return clientLibvirt[connectionName].call(objPath, 'org.libvirt.Domain', 'UpdateDevice', [updatedXml, flags], TIMEOUT);
                    }
                });
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
                    .then(domXml => {
                        let updatedXml = updateNetworkIface({ domXml: domXml[0], networkMac, networkState: state });
                        if (!updatedXml) {
                            dispatch(vmActionFailed({
                                name,
                                connectionName,
                                message: _("VM CHANGE_NETWORK_STATE action failed"),
                                detail: { exception: "Updated device XML couldn't not be generated" },
                                tab: 'network',
                            }));
                        } else {
                            return call(connectionName, objPath, 'org.libvirt.Domain', 'UpdateDevice', [updatedXml, Enum.VIR_DOMAIN_AFFECT_CURRENT], TIMEOUT);
                        }
                    })
                    .catch(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM CHANGE_NETWORK_STATE action failed"),
                        detail: { exception },
                        tab: 'network',
                    })))
                    .then(() => {
                        dispatch(getVm({ connectionName, id:objPath }));
                    });
        };
    },

    CHANGE_VM_AUTOSTART ({
        connectionName,
        vmName,
        autostart,
    }) {
        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainLookupByName', [vmName], TIMEOUT)
                .then(domainPath => {
                    const args = ['org.libvirt.Domain', 'Autostart', cockpit.variant('b', autostart)];

                    return call(connectionName, domainPath[0], 'org.freedesktop.DBus.Properties', 'Set', args, TIMEOUT);
                });
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

        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], TIMEOUT)
                .then((storagePoolPath) => {
                    return call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'StorageVolCreateXML', [volXmlDesc, 0], TIMEOUT);
                })
                .then((volPath) => {
                    return dispatch(attachDisk({ connectionName, poolName, volumeName, format, target, vmId, permanent, hotplug }));
                });
    },

    CREATE_STORAGE_POOL({
        connectionName,
        name,
        type,
        source,
        target,
        autostart,
    }) {
        const poolXmlDesc = getPoolXML({ name, type, source, target });
        let storagePoolPath;

        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolDefineXML', [poolXmlDesc, 0], TIMEOUT)
                .then(poolPath => {
                    storagePoolPath = poolPath;
                    return call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'Create', [Enum.VIR_STORAGE_POOL_CREATE_NORMAL], TIMEOUT);
                })
                .then(() => {
                    const args = ['org.libvirt.StoragePool', 'Autostart', cockpit.variant('b', autostart)];

                    return call(connectionName, storagePoolPath[0], 'org.freedesktop.DBus.Properties', 'Set', args, TIMEOUT);
                });
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
                        detail: { exception }
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

                        // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
                        // https://github.com/cockpit-project/cockpit/issues/10956
                        // eslint-disable-next-line cockpit/no-cockpit-all
                        return cockpit.all(storageVolPathsPromises);
                    })
                    .then(() => {
                        call(connectionName, objPath, 'org.libvirt.Domain', 'Undefine', [flags], TIMEOUT);
                    })
                    .catch(exception => dispatch(vmActionFailed({
                        name: name,
                        connectionName,
                        message: _("VM DELETE action failed"),
                        detail: { exception }
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
        let diskXML;
        let detachFlags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
        if (live)
            detachFlags |= Enum.VIR_DOMAIN_AFFECT_LIVE;

        return dispatch => {
            call(connectionName, vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .then(domXml => {
                        let getXMLFlags = Enum.VIR_DOMAIN_XML_INACTIVE;
                        diskXML = getDiskElemByTarget(domXml[0], target);

                        return call(connectionName, vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [getXMLFlags], TIMEOUT);
                    })
                    .then(domInactiveXml => {
                        let diskInactiveXML = getDiskElemByTarget(domInactiveXml[0], target);
                        if (diskInactiveXML)
                            detachFlags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

                        return call(connectionName, vmPath, 'org.libvirt.Domain', 'DetachDevice', [diskXML, detachFlags], TIMEOUT);
                    })
                    .catch(exception => dispatch(vmActionFailed({
                        name,
                        connectionName,
                        message: _("VM DETACH_DISK action failed"),
                        detail: { exception },
                        tab: 'disk',
                    })))
                    .then(() => dispatch(getVm({ connectionName, id:vmPath })));
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

    GET_ALL_NETWORKS({
        connectionName,
    }) {
        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListNetworks', [0], TIMEOUT)
                    .then(objPaths => {
                        // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
                        // https://github.com/cockpit-project/cockpit/issues/10956
                        // eslint-disable-next-line cockpit/no-cockpit-all
                        return cockpit.all(objPaths[0].map((path) => dispatch(getNetwork({ connectionName, id:path }))));
                    })
                    .fail(ex => console.warn('GET_ALL_NETWORKS action failed:', JSON.stringify(ex)));
        };
    },

    GET_ALL_STORAGE_POOLS({
        connectionName,
    }) {
        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListStoragePools', [0], TIMEOUT)
                    .then(objPaths => {
                        // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
                        // https://github.com/cockpit-project/cockpit/issues/10956
                        // eslint-disable-next-line cockpit/no-cockpit-all
                        return cockpit.all(objPaths[0].map((path) => dispatch(getStoragePool({ connectionName, id:path }))));
                    })
                    .fail(ex => console.warn('GET_ALL_STORAGE_POOLS action failed:', JSON.stringify(ex)));
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
                dispatch(getAllStoragePools(connectionName));
                dispatch(getAllNetworks(connectionName));
                dispatch(getHypervisorMaxVCPU(connectionName));
                doGetAllVms(dispatch, connectionName);
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
                    .fail(ex => console.warn("GetDomainCapabilities failed: %s", ex));
        }

        return unknownConnectionName(setHypervisorMaxVCPU);
    },

    /*
     * Read properties of a single Network
     *
     * @param Network object path
     */
    GET_NETWORK({
        id: objPath,
        connectionName,
    }) {
        let props = {};

        return dispatch => {
            call(connectionName, objPath, 'org.freedesktop.DBus.Properties', 'GetAll', ['org.libvirt.Network'], TIMEOUT)
                    .then(resultProps => {
                        props.active = resultProps[0].Active.v.v;
                        props.persistent = resultProps[0].Persistent.v.v;
                        props.autostart = resultProps[0].Autostart.v.v;
                        props.name = resultProps[0].Name.v.v;
                        props.id = objPath;
                        props.connectionName = connectionName;

                        return call(connectionName, objPath, 'org.libvirt.Network', 'GetXMLDesc', [0], TIMEOUT);
                    })
                    .then(xml => {
                        const network = parseNetDumpxml(xml);

                        if (network) {
                            props.mode = network.mode;
                            props.device = network.device;
                            props.ip = network.ip;
                            props.bandwidth = network.bandwidth;
                            props.mtu = network.mtu;
                        }

                        dispatch(updateOrAddNetwork(Object.assign({}, props)));
                    })
                    .catch(ex => console.warn('GET_NETWORK action failed failed for path', objPath, ex));
        };
    },

    /*
     * Read Storage Pool properties of a single storage Pool
     *
     * @param Pool object path
     * @returns {Function}
     */
    GET_STORAGE_POOL({
        id: objPath,
        connectionName,
    }) {
        let dumpxmlParams;
        let props = {};

        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.StoragePool', 'GetXMLDesc', [0], TIMEOUT)
                    .then(poolXml => {
                        dumpxmlParams = parseStoragePoolDumpxml(connectionName, poolXml[0], objPath);

                        return call(connectionName, objPath, 'org.freedesktop.DBus.Properties', 'GetAll', ['org.libvirt.StoragePool'], TIMEOUT);
                    })
                    .then((resultProps) => {
                        props.active = resultProps[0].Active.v.v;
                        props.persistent = resultProps[0].Persistent.v.v;
                        props.autostart = resultProps[0].Autostart.v.v;

                        return call(connectionName, objPath, 'org.libvirt.StoragePool', 'GetInfo', [], TIMEOUT);
                    })
                    .then(poolInfo => {
                        props.capacity = poolInfo[0][1];
                        props.allocation = poolInfo[0][2];
                        props.available = poolInfo[0][3];

                        dispatch(updateOrAddStoragePool(Object.assign({}, dumpxmlParams, props)));
                        if (props.active)
                            dispatch(getStorageVolumes({ connectionName, poolName: dumpxmlParams.name }));
                    })
                    .catch(ex => console.warn('GET_STORAGE_POOL action failed failed for path', objPath, ex));
        };
    },

    GET_STORAGE_VOLUMES({ connectionName, poolName }) {
        return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], TIMEOUT)
                .then(storagePoolPath => {
                    return call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'ListStorageVolumes', [0], TIMEOUT);
                })
                .then((objPaths) => {
                    let volumes = [];
                    let storageVolumesPropsPromises = [];

                    for (let i = 0; i < objPaths[0].length; i++) {
                        const objPath = objPaths[0][i];

                        storageVolumesPropsPromises.push(
                            call(connectionName, objPath, 'org.libvirt.StorageVol', 'GetXMLDesc', [0], TIMEOUT)
                        );
                    }

                    // WA to avoid Promise.all() fail-fast behavior
                    const toResultObject = (promise) => {
                        return promise
                                .then(result => ({ success: true, result }))
                                .catch(error => ({ success: false, error }));
                    };

                    Promise.all(storageVolumesPropsPromises.map(toResultObject)).then(volumeXmlList => {
                        for (let i = 0; i < volumeXmlList.length; i++) {
                            if (volumeXmlList[i].success) {
                                let volumeXml = volumeXmlList[i].result[0];
                                const dumpxmlParams = parseStorageVolumeDumpxml(connectionName, volumeXml);

                                volumes.push(dumpxmlParams);
                            }
                        }
                        return dispatch(updateStorageVolumes({
                            connectionName,
                            poolName,
                            volumes
                        }));
                    });
                })
                .fail(ex => console.warn("GET_STORAGE_VOLUMES action failed for pool %s: %s", poolName, JSON.stringify(ex)));
    },

    /*
     * Read VM properties of a single VM
     *
     * @param VM object path
     * @returns {Function}
     */
    GET_VM({
        id: objPath,
        connectionName,
        updateOnly,
    }) {
        let props = {};
        let domainXML;

        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                    .then(domXml => {
                        domainXML = domXml[0];
                        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], TIMEOUT);
                    })
                    .then(domInactiveXml => {
                        let dumpInactiveXmlParams = parseDumpxml(dispatch, connectionName, domInactiveXml[0], objPath);
                        props.inactiveXML = dumpInactiveXmlParams;
                        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetState', [0], TIMEOUT);
                    })
                    .then(state => {
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
                        props = Object.assign(props, {
                            connectionName,
                            id: objPath,
                            state: stateStr,
                        });

                        if (!LIBVIRT_DBUS_PROVIDER.isRunning(stateStr))
                            props.actualTimeInMs = -1;

                        return call(connectionName, objPath, "org.freedesktop.DBus.Properties", "GetAll", ["org.libvirt.Domain"], TIMEOUT);
                    })
                    .then(function(returnProps) {
                        /* Sometimes not all properties are returned, for example when some domain got deleted while part
                         * of the properties got fetched from libvirt. Make sure that there is check before reading the attributes.
                         */
                        if ("Name" in returnProps[0])
                            props.name = returnProps[0].Name.v.v;
                        if ("Persistent" in returnProps[0])
                            props.persistent = returnProps[0].Persistent.v.v;
                        if ("Autostart" in returnProps[0])
                            props.autostart = returnProps[0].Autostart.v.v;
                        props.ui = resolveUiState(dispatch, props.name);

                        logDebug(`${this.name}.GET_VM(${objPath}, ${connectionName}): update props ${JSON.stringify(props)}`);

                        let dumpxmlParams = parseDumpxml(dispatch, connectionName, domainXML, objPath);
                        if (updateOnly)
                            dispatch(updateVm(Object.assign({}, props, dumpxmlParams)));
                        else
                            dispatch(updateOrAddVm(Object.assign({}, props, dumpxmlParams)));
                    })
                    .catch(function(ex) { console.warn("GET_VM action failed failed for path", objPath, ex) });
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
                        detail: { exception }
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
        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], TIMEOUT)
                .then(domXml => {
                    let updatedXML = updateVCPUSettings(domXml[0], count, max, sockets, cores, threads);
                    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], TIMEOUT);
                });
    },

    SHUTDOWN_VM({
        name,
        connectionName,
        id: objPath
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.Domain', 'Shutdown', [0], TIMEOUT)
                    .fail(exception => dispatch(vmActionFailed(
                        { name, connectionName, message: _("VM SHUT DOWN action failed"), detail: { exception } }
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

export function getVmDisksMap(vms, connectionName) {
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
       results from libvirt.js file.
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
            console.warn(`calculateDiskStats(): mandatory property is missing in info (block.${i}.name)`);
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

                // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
                // https://github.com/cockpit-project/cockpit/issues/10956
                // eslint-disable-next-line cockpit/no-cockpit-all
                return cockpit.all(objPaths[0].map((path) => dispatch(getVm({ connectionName, id:path }))));
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
        let flags = Enum.VIR_DOMAIN_STATS_BALLOON | Enum.VIR_DOMAIN_STATS_VCPU | Enum.VIR_DOMAIN_STATS_BLOCK | Enum.VIR_DOMAIN_STATS_STATE;

        call(connectionName, objPath, 'org.libvirt.Domain', 'GetStats', [flags, 0], { timeout: 5000 })
                .done(info => {
                    if (Object.getOwnPropertyNames(info[0]).length > 0) {
                        info = info[0];
                        let props = { name, connectionName, id: objPath };
                        let avgvCpuTime = 0;

                        if ('balloon.rss' in info)
                            props['rssMemory'] = info['balloon.rss'].v.v;
                        else if ('state.state' in info && info['state.state'].v.v == Enum.VIR_DOMAIN_SHUTOFF)
                            props['rssMemory'] = 0.0;
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

    /* Handlers for libvirtd status changes */
    startEventMonitorLibvirtd(connectionName, dispatch, libvirtServiceName);

    /* Handlers for domain events */
    startEventMonitorDomains(connectionName, dispatch);

    /* Handlers for storage pool events */
    startEventMonitorStoragePools(connectionName, dispatch);
}

function startEventMonitorDomains(connectionName, dispatch) {
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
                dispatch(getVm({ connectionName, id:objPath }));
                break;

            case domainEvent["Undefined"]:
                dispatch(undefineVm({ connectionName, id: objPath }));
                break;

            case domainEvent["Started"]:
                dispatch(getVm({ connectionName, id:objPath }));
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
                    id: objPath,
                    updateOnly: true,
                }));
                // transient VMs don't have a separate Undefined event, so remove them on stop
                dispatch(undefineVm({ connectionName, id: objPath, transientOnly: true }));
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
                dispatch(getVm({ connectionName, id:path }));
                break;

            default:
                logDebug(`handle DomainEvent on ${connectionName}: ignoring event ${signal}`);
            }
        });
}

function startEventMonitorLibvirtd(connectionName, dispatch, libvirtServiceName) {
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

function startEventMonitorStoragePools(connectionName, dispatch) {
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Connect', member: 'StoragePoolEvent' },
        (path, iface, signal, args) => {
            let objPath = args[0];
            let eventType = args[1];

            switch (eventType) {
            case Enum.VIR_STORAGE_POOL_EVENT_DEFINED:
            case Enum.VIR_STORAGE_POOL_EVENT_STARTED:
            case Enum.VIR_STORAGE_POOL_EVENT_STOPPED:
            case Enum.VIR_STORAGE_POOL_EVENT_CREATED:
                dispatch(getStoragePool({ connectionName, id:objPath }));
                break;
            case Enum.VIR_STORAGE_POOL_EVENT_UNDEFINED:
                dispatch(undefineStoragePool({ connectionName, id:objPath }));
                break;
            case Enum.VIR_STORAGE_POOL_EVENT_DELETED:
            default:
                logDebug(`handle StoragePoolEvent on ${connectionName}: ignoring event ${signal}`);
            }
        }
    );

    /* Subscribe to signals on StoragePool Interface */
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.StoragePool' },
        (path, iface, signal, args) => {
            switch (signal) {
            case 'Refresh':
            /* These signals imply possible changes in what we display, so re-read the state */
                dispatch(getStoragePool({ connectionName, id:path }));
                break;
            default:
                logDebug(`handleEvent StoragePoolEvent on ${connectionName} : ignoring event ${signal}`);
            }
        });
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
function updateNetworkIface({ domXml, networkMac, networkState, networkModelType, networkType, networkSource }) {
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

            if (networkState) {
                let linkElem = getSingleOptionalElem(interfaceElem, 'link');
                if (linkElem === undefined) {
                    let doc = document.implementation.createDocument('', '', null);
                    linkElem = doc.createElement('link');
                    interfaceElem.appendChild(linkElem);
                }
                linkElem.setAttribute('state', networkState);
            }

            if (networkType) {
                interfaceElem.setAttribute('type', networkType);
            }

            if (networkSource && networkType) {
                let sourceElem = getSingleOptionalElem(interfaceElem, 'source');
                sourceElem.setAttribute(networkType, networkSource);
            }

            if (networkModelType) {
                let modelElem = getSingleOptionalElem(interfaceElem, 'model');
                modelElem.setAttribute('type', networkModelType);
            }

            let returnXML = (new XMLSerializer()).serializeToString(interfaceElem);

            logDebug(`updateNetworkIface: Updated XML: "${returnXML}"`);

            return returnXML;
        }
    }
    console.warn("Can't update network interface element in domXml");
    return null;
}

export function storagePoolActivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Create', [Enum.VIR_STORAGE_POOL_CREATE_NORMAL], TIMEOUT);
}

export function storagePoolDeactivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Destroy', [], TIMEOUT);
}

export function storagePoolRefresh(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Refresh', [0], TIMEOUT);
}

export function storagePoolUndefine(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Undefine', [], TIMEOUT);
}

export function storageVolumeDelete(connectionName, path) {
    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StorageVolLookupByPath', [path], TIMEOUT)
            .then(objPath => call(connectionName, objPath[0], 'org.libvirt.StorageVol', 'Delete', [0], TIMEOUT));
}

export default LIBVIRT_DBUS_PROVIDER;
