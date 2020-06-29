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
    getAllNodeDevices,
    getAllStoragePools,
    getAllVms,
    getApiData,
    getHypervisorMaxVCPU,
    getInterface,
    getNetwork,
    getNodeDevice,
    getNodeMaxMemory,
    getStoragePool,
    getStorageVolumes,
    getVm,
    getVmSnapshots,
} from './actions/provider-actions.js';

import {
    deleteUnlistedVMs,
    undefineNetwork,
    undefineStoragePool,
    undefineVm,
    updateLibvirtVersion,
    updateDomainSnapshots,
    updateOrAddInterface,
    updateOrAddNetwork,
    updateOrAddNodeDevice,
    updateOrAddVm,
    updateOrAddStoragePool,
    updateStorageVolumes,
    updateVm,
    setHypervisorMaxVCPU,
    setNodeMaxMemory,
} from './actions/store-actions.js';

import {
    getDiskXML,
    getIfaceXML,
    getNetworkXML,
    getPoolXML,
    getVolumeXML,
    getSnapshotXML
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
    canPause,
    canReset,
    canResume,
    canRun,
    canSendNMI,
    canShutdown,
    getDiskElemByTarget,
    getElem,
    getIfaceElemByMac,
    getSingleOptionalElem,
    isRunning,
    parseDomainSnapshotDumpxml,
    parseDumpxml,
    parseNetDumpxml,
    parseIfaceDumpxml,
    parseNodeDeviceDumpxml,
    parseStoragePoolDumpxml,
    parseStorageVolumeDumpxml,
    resolveUiState,
    serialConsoleCommand,
    unknownConnectionName,
    updateBootOrder,
    updateDisk,
    updateMaxMemory,
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

const clientLibvirt = {};
/* Default timeout for libvirt-dbus method calls */
const timeout = 30000;

const Enum = {
    VIR_DOMAIN_AFFECT_CURRENT: 0,
    VIR_DOMAIN_AFFECT_LIVE: 1,
    VIR_DOMAIN_AFFECT_CONFIG: 2,
    VIR_DOMAIN_INTERFACE_ADDRESSES_SRC_LEASE: 0,
    VIR_DOMAIN_UNDEFINE_MANAGED_SAVE: 1,
    VIR_DOMAIN_UNDEFINE_SNAPSHOTS_METADATA: 2,
    VIR_DOMAIN_UNDEFINE_NVRAM: 4,
    VIR_DOMAIN_SNAPSHOT_LIST_INTERNAL : 256,
    VIR_DOMAIN_STATS_BALLOON: 4,
    VIR_DOMAIN_SHUTOFF: 5,
    VIR_DOMAIN_STATS_VCPU: 8,
    VIR_DOMAIN_STATS_BLOCK: 32,
    VIR_DOMAIN_STATS_STATE: 1,
    VIR_DOMAIN_XML_INACTIVE: 2,
    VIR_CONNECT_LIST_DOMAINS_PERSISTENT: 4,
    VIR_CONNECT_LIST_DOMAINS_TRANSIENT: 8,
    VIR_CONNECT_LIST_INTERFACES_INACTIVE: 1,
    VIR_CONNECT_LIST_INTERFACES_ACTIVE: 2,
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
    // Networks Event Lifecycle Type
    VIR_NETWORK_EVENT_DEFINED: 0,
    VIR_NETWORK_EVENT_UNDEFINED: 1,
    VIR_NETWORK_EVENT_STARTED: 2,
    VIR_NETWORK_EVENT_STOPPED: 3,
    VIR_NETWORK_EVENT_LAST: 4,
    // Keycodes
    VIR_KEYCODE_SET_LINUX: 0,
};

const LIBVIRT_DBUS_PROVIDER = {
    name: 'LibvirtDBus',

    /* Start of common provider functions */
    canConsole,
    canDelete,
    canInstall,
    canPause,
    canReset,
    canResume,
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
        hotplug,
        cacheMode,
        shareable,
        busType,
    }) {
        const xmlDesc = getDiskXML(poolName, volumeName, format, target, cacheMode, shareable, busType);

        return attachDevice({ connectionName, vmId, permanent, hotplug, xmlDesc });
    },

    CHANGE_BOOT_ORDER({
        id: objPath,
        connectionName,
        devices,
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' })
                .then(domXml => {
                    const updatedXML = updateBootOrder(domXml, devices);
                    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], { timeout, type: 's' });
                });
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
        return clientLibvirt[connectionName].call(objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' })
                .then(domXml => {
                    const updatedXml = updateNetworkIface({
                        domXml: domXml[0],
                        networkMac: macAddress,
                        networkType,
                        networkSource,
                        networkModelType: networkModel
                    });
                    if (!updatedXml) {
                        return Promise.reject(new Error("VM CHANGE_NETWORK_SETTINGS action failed: updated device XML couldn't not be generated"));
                    } else {
                        return clientLibvirt[connectionName].call(objPath, 'org.libvirt.Domain', 'UpdateDevice', [updatedXml, flags], { timeout, type: 'su' });
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
        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], { timeout, type: 'u' })
                .then(domXml => {
                    const updatedXml = updateNetworkIface({ domXml: domXml[0], networkMac, networkState: state });
                    // updateNetworkIface can fail but we 'll catch the exception from the API call itself that will error on null argument
                    return call(connectionName, objPath, 'org.libvirt.Domain', 'UpdateDevice', [updatedXml, Enum.VIR_DOMAIN_AFFECT_CURRENT], { timeout, type: 'su' });
                });
    },

    CHANGE_VM_AUTOSTART ({
        connectionName,
        vmName,
        autostart,
    }) {
        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainLookupByName', [vmName], { timeout, type: 's' })
                .then(domainPath => {
                    const args = ['org.libvirt.Domain', 'Autostart', cockpit.variant('b', autostart)];

                    return call(connectionName, domainPath[0], 'org.freedesktop.DBus.Properties', 'Set', args, { timeout, type: 'ssv' });
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
        hotplug,
        cacheMode,
        busType,
    }) {
        const volXmlDesc = getVolumeXML(volumeName, size, format);

        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], { timeout, type: 's' })
                .then((storagePoolPath) => {
                    return call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'StorageVolCreateXML', [volXmlDesc, 0], { timeout, type: 'su' })
                            .then(() => {
                                return storagePoolRefresh(connectionName, storagePoolPath[0]);
                            });
                })
                .then((volPath) => {
                    return dispatch(attachDisk({ connectionName, poolName, volumeName, format, target, vmId, permanent, hotplug, cacheMode, busType }));
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

        return (dispatch) => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolDefineXML', [poolXmlDesc, 0], { timeout, type: 'su' })
                .then(poolPath => {
                    storagePoolPath = poolPath[0];
                    const args = ['org.libvirt.StoragePool', 'Autostart', cockpit.variant('b', autostart)];

                    return call(connectionName, storagePoolPath, 'org.freedesktop.DBus.Properties', 'Set', args, { timeout, type: 'ssv' });
                }, exc => {
                    if (storagePoolPath)
                        storagePoolUndefine(connectionName, storagePoolPath);
                    return cockpit.reject(exc);
                });
    },

    DELETE_VM({
        name,
        connectionName,
        id: objPath,
        options,
        storagePools
    }) {
        function destroy() {
            return call(connectionName, objPath, 'org.libvirt.Domain', 'Destroy', [0], { timeout, type: 'u' });
        }

        function undefine() {
            const storageVolPromises = [];
            const flags = Enum.VIR_DOMAIN_UNDEFINE_MANAGED_SAVE | Enum.VIR_DOMAIN_UNDEFINE_SNAPSHOTS_METADATA | Enum.VIR_DOMAIN_UNDEFINE_NVRAM;

            for (let i = 0; i < options.storage.length; i++) {
                const disk = options.storage[i];

                switch (disk.type) {
                case 'file': {
                    storageVolPromises.push(
                        call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StorageVolLookupByPath', [disk.source.file], { timeout, type: 's' })
                                .then(volPath => call(connectionName, volPath[0], 'org.libvirt.StorageVol', 'Delete', [0], { timeout, type: 'u' }))
                    );
                    const pool = storagePools.find(pool => pool.connectionName === connectionName && pool.volumes.some(vol => vol.path === disk.source.file));
                    if (pool)
                        storageVolPromises.push(storagePoolRefresh(connectionName, pool.id));
                    break;
                }
                case 'volume': {
                    storageVolPromises.push(
                        call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [disk.source.pool], { timeout, type: 's' })
                                .then(objPath => call(connectionName, objPath[0], 'org.libvirt.StoragePool', 'StorageVolLookupByName', [disk.source.volume], { timeout, type: 's' }))
                                .then(volPath => call(connectionName, volPath[0], 'org.libvirt.StorageVol', 'Delete', [0], { timeout, type: 'u' }))
                    );
                    const pool = storagePools.find(pool => pool.connectionName === connectionName && pool.name === disk.source.pool);
                    if (pool)
                        storageVolPromises.push(storagePoolRefresh(connectionName, pool.id));
                    break;
                }
                default:
                    logDebug("Disks of type $0 are currently ignored during VM deletion".format(disk.type));
                }
            }

            // FIXME: use Promise.all() here; but that causes "Error: Actions must be plain objects"
            // eslint-disable-next-line cockpit/no-cockpit-all
            return cockpit.all(storageVolPromises)
                    .then(() => {
                        return call(connectionName, objPath, 'org.libvirt.Domain', 'Undefine', [flags], { timeout, type: 'u' });
                    });
        }

        if (options.destroy) {
            return undefine().then(destroy());
        } else {
            return undefine()
                    .catch(ex => {
                        // Transient domains get undefined after shut off
                        if (!ex.message.includes("Domain not found"))
                            return Promise.reject(ex);
                    });
        }
    },

    DETACH_DISK({
        name,
        connectionName,
        id: vmPath,
        target,
        live,
        persistent
    }) {
        let diskXML;
        let detachFlags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
        if (live)
            detachFlags |= Enum.VIR_DOMAIN_AFFECT_LIVE;

        return call(connectionName, vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], { timeout, type: 'u' })
                .then(domXml => {
                    const getXMLFlags = Enum.VIR_DOMAIN_XML_INACTIVE;
                    diskXML = getDiskElemByTarget(domXml[0], target);

                    return call(connectionName, vmPath, 'org.libvirt.Domain', 'GetXMLDesc', [getXMLFlags], { timeout, type: 'u' });
                })
                .then(domInactiveXml => {
                    const diskInactiveXML = getDiskElemByTarget(domInactiveXml[0], target);
                    if (diskInactiveXML && persistent)
                        detachFlags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

                    return call(connectionName, vmPath, 'org.libvirt.Domain', 'DetachDevice', [diskXML, detachFlags], { timeout, type: 'su' });
                });
    },

    FORCEOFF_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Destroy', [0], { timeout, type: 'u' });
    },

    FORCEREBOOT_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Reset', [0], { timeout, type: 'u' });
    },

    GET_ALL_NETWORKS({
        connectionName,
    }) {
        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListNetworks', [0], { timeout, type: 'u' })
                    .then(objPaths => {
                        return Promise.all(objPaths[0].map((path) => dispatch(getNetwork({ connectionName, id:path }))));
                    })
                    .catch(ex => console.warn('GET_ALL_NETWORKS action failed:', ex.toString()));
        };
    },

    GET_ALL_NODE_DEVICES({
        connectionName,
    }) {
        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListNodeDevices', [0], { timeout, type: 'u' })
                    .then(objPaths => Promise.all(objPaths[0].map(path => dispatch(getNodeDevice({ connectionName, id:path })))))
                    .catch(ex => console.warn('GET_ALL_NODE_DEVICES action failed:', ex.toString()));
        };
    },

    GET_ALL_STORAGE_POOLS({
        connectionName,
    }) {
        return dispatch => {
            return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListStoragePools', [0], { timeout, type: 'u' })
                    .then(objPaths => {
                        return Promise.all(objPaths[0].map(path => {
                            return call(connectionName, path, 'org.freedesktop.DBus.Properties', 'Get', ['org.libvirt.StoragePool', 'Active'], { timeout, type: 'ss' })
                                    .then(active => {
                                        if (active[0].v)
                                            return storagePoolRefresh(connectionName, path);
                                        else
                                            return dispatch(getStoragePool({ connectionName, id:path }));
                                    });
                        }));
                    })
                    .catch(ex => console.warn('GET_ALL_STORAGE_POOLS action failed:', ex.toString()));
        };
    },

    GET_ALL_VMS({ connectionName }) {
        return dispatch => {
            call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListDomains', [0], { timeout, type: 'u' })
                    .then(objPaths => {
                        dispatch(deleteUnlistedVMs(connectionName, [], objPaths[0]));
                        return Promise.all(objPaths[0].map((path) => dispatch(getVm({ connectionName, id:path }))));
                    })
                    .catch(ex => console.warn('GET_ALL_VMS action failed:', ex.toString()));
        };
    },

    GET_API_DATA({ connectionName, libvirtServiceName }) {
        if (connectionName) {
            return dispatch => {
                dispatch(checkLibvirtStatus(libvirtServiceName));
                dbus_client(connectionName);
                startEventMonitor(dispatch, connectionName, libvirtServiceName);
                dispatch(getAllVms(connectionName));
                dispatch(getAllStoragePools(connectionName));
                getAllInterfaces(dispatch, connectionName);
                dispatch(getAllNetworks(connectionName));
                dispatch(getAllNodeDevices(connectionName));
                dispatch(getHypervisorMaxVCPU(connectionName));
                dispatch(getNodeMaxMemory(connectionName));
                dispatch(getLibvirtVersion(connectionName));
            };
        }

        /* Initial all resources to empty objects before loading them */
        const flags = Enum.VIR_CONNECT_LIST_INTERFACES_ACTIVE | Enum.VIR_CONNECT_LIST_INTERFACES_INACTIVE;
        return dispatch => {
            dispatch(unknownConnectionName(connectionName => initResource(connectionName, "ListInterfaces", updateOrAddInterface, flags)));
            dispatch(unknownConnectionName(connectionName => initResource(connectionName, "ListNodeDevices", updateOrAddNodeDevice, 0)));
            dispatch(unknownConnectionName(connectionName => initResource(connectionName, "ListNetworks", updateOrAddNetwork, 0)));
            dispatch(unknownConnectionName(connectionName => initResource(connectionName, "ListStoragePools", updateOrAddStoragePool, 0)));
            dispatch(unknownConnectionName(connectionName => initResource(connectionName, "ListDomains", updateOrAddVm, 0)));
            /* Load resource for all of the connections */
            dispatch(unknownConnectionName(getApiData, libvirtServiceName));
        };
    },

    GET_HYPERVISOR_MAX_VCPU({ connectionName }) {
        logDebug(`${this.name}.GET_HYPERVISOR_MAX_VCPU: connection: ${connectionName}`);

        if (connectionName) {
            return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'GetDomainCapabilities', ['', '', '', '', 0], { timeout, type: 'ssssu' })
                    .done((capsXML) => {
                        const count = getDomainMaxVCPU(capsXML[0]);
                        dispatch(setHypervisorMaxVCPU({ count, connectionName }));
                    })
                    .catch(ex => console.warn("GetDomainCapabilities failed: %s", ex.toString()));
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
        updateOnly,
    }) {
        const props = {};

        return dispatch => {
            call(connectionName, objPath, 'org.freedesktop.DBus.Properties', 'GetAll', ['org.libvirt.Network'], { timeout, type: 's' })
                    .then(resultProps => {
                        /* Sometimes not all properties are returned; for example when some network got deleted while part
                         * of the properties got fetched from libvirt. Make sure that there is check before reading the attributes.
                         */
                        if ("Active" in resultProps[0])
                            props.active = resultProps[0].Active.v.v;
                        if ("Persistent" in resultProps[0])
                            props.persistent = resultProps[0].Persistent.v.v;
                        if ("Autostart" in resultProps[0])
                            props.autostart = resultProps[0].Autostart.v.v;
                        if ("Name" in resultProps[0])
                            props.name = resultProps[0].Name.v.v;
                        props.id = objPath;
                        props.connectionName = connectionName;

                        return call(connectionName, objPath, 'org.libvirt.Network', 'GetXMLDesc', [0], { timeout, type: 'u' });
                    })
                    .then(xml => {
                        const network = parseNetDumpxml(xml);
                        dispatch(updateOrAddNetwork(Object.assign({}, props, network), updateOnly));
                    })
                    .catch(ex => console.warn('GET_NETWORK action failed for path', objPath, ex.toString()));
        };
    },

    /*
     * Read properties of a single Interface
     *
     * @param {object} objPath interface object path
     * @param {string} connectionName
     */
    GET_INTERFACE({
        id: objPath,
        connectionName,
    }) {
        const props = {};

        return dispatch => {
            call(connectionName, objPath, 'org.freedesktop.DBus.Properties', 'GetAll', ['org.libvirt.Interface'], { timeout, type: 's' })
                    .then(resultProps => {
                        /* Sometimes not all properties are returned; for example when some network got deleted while part
                         * of the properties got fetched from libvirt. Make sure that there is check before reading the attributes.
                         */
                        if ("Active" in resultProps[0])
                            props.active = resultProps[0].Active.v.v;
                        if ("MAC" in resultProps[0])
                            props.mac = resultProps[0].MAC.v.v;
                        if ("Name" in resultProps[0])
                            props.name = resultProps[0].Name.v.v;
                        props.id = objPath;
                        props.connectionName = connectionName;

                        return call(connectionName, objPath, 'org.libvirt.Interface', 'GetXMLDesc', [0], { timeout, type: 'u' });
                    })
                    .then(xml => {
                        const iface = parseIfaceDumpxml(xml);
                        dispatch(updateOrAddInterface(Object.assign({}, props, iface)));
                    })
                    .catch(ex => console.log('listInactiveInterfaces action for path', objPath, ex.toString()));
        };
    },

    /*
     * Read properties of a single NodeDevice
     *
     * @param NodeDevice object path
     */
    GET_NODE_DEVICE({
        id: objPath,
        connectionName,
    }) {
        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.NodeDevice', 'GetXMLDesc', [0], { timeout, type: 'u' })
                    .then(deviceXml => {
                        const deviceXmlObject = parseNodeDeviceDumpxml(deviceXml);
                        deviceXmlObject.connectionName = connectionName;

                        dispatch(updateOrAddNodeDevice(deviceXmlObject));
                    })
                    .catch(ex => console.warn('GET_NODE_DEVICE action failed for path', objPath, ex.toString()));
        };
    },

    GET_NODE_MAX_MEMORY({ connectionName }) {
        if (connectionName) {
            // Some nodes don't return all memory in just one cell.
            // Using -1 == VIR_NODE_MEMORY_STATS_ALL_CELLS will return memory across all cells
            return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'NodeGetMemoryStats', [-1, 0], { timeout, type: 'iu' })
                    .then(stats => dispatch(setNodeMaxMemory({ memory: stats[0].total })))
                    .catch(ex => console.warn("NodeGetMemoryStats failed: %s", ex));
        }

        return unknownConnectionName(setNodeMaxMemory);
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
        updateOnly,
    }) {
        let dumpxmlParams;
        const props = {};

        return dispatch => {
            call(connectionName, objPath, 'org.libvirt.StoragePool', 'GetXMLDesc', [0], { timeout, type: 'u' })
                    .then(poolXml => {
                        dumpxmlParams = parseStoragePoolDumpxml(connectionName, poolXml[0], objPath);

                        return call(connectionName, objPath, 'org.freedesktop.DBus.Properties', 'GetAll', ['org.libvirt.StoragePool'], { timeout, type: 's' });
                    })
                    .then((resultProps) => {
                        /* Sometimes not all properties are returned; for example when some storage got deleted while part
                         * of the properties got fetched from libvirt. Make sure that there is check before reading the attributes.
                         */
                        if ("Active" in resultProps[0])
                            props.active = resultProps[0].Active.v.v;
                        if ("Persistent" in resultProps[0])
                            props.persistent = resultProps[0].Persistent.v.v;
                        if ("Autostart" in resultProps[0])
                            props.autostart = resultProps[0].Autostart.v.v;

                        dispatch(updateOrAddStoragePool(Object.assign({}, dumpxmlParams, props), updateOnly));
                        if (props.active)
                            dispatch(getStorageVolumes({ connectionName, poolName: dumpxmlParams.name }));
                        else
                            dispatch(updateStorageVolumes({ connectionName, poolName: dumpxmlParams.name, volumes: [] }));
                    })
                    .catch(ex => console.warn('GET_STORAGE_POOL action failed for path', objPath, ex.toString()));
        };
    },

    GET_STORAGE_VOLUMES({ connectionName, poolName }) {
        return dispatch => call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], { timeout, type: 's' })
                .then(storagePoolPath => {
                    return call(connectionName, storagePoolPath[0], 'org.libvirt.StoragePool', 'ListStorageVolumes', [0], { timeout, type: 'u' });
                })
                .then((objPaths) => {
                    const volumes = [];
                    const storageVolumesPropsPromises = [];

                    for (let i = 0; i < objPaths[0].length; i++) {
                        const objPath = objPaths[0][i];

                        storageVolumesPropsPromises.push(
                            call(connectionName, objPath, 'org.libvirt.StorageVol', 'GetXMLDesc', [0], { timeout, type: 'u' })
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
                                const volumeXml = volumeXmlList[i].result[0];
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
                .catch(ex => console.warn("GET_STORAGE_VOLUMES action failed for pool %s: %s", poolName, ex.toString()));
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
            return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], { timeout, type: 'u' })
                    .then(domXml => {
                        domainXML = domXml[0];
                        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' });
                    })
                    .then(domInactiveXml => {
                        const dumpInactiveXmlParams = parseDumpxml(dispatch, connectionName, domInactiveXml[0], objPath);
                        props.inactiveXML = dumpInactiveXmlParams;
                        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetState', [0], { timeout, type: 'u' });
                    })
                    .then(state => {
                        const DOMAINSTATE = [
                            "no state",
                            "running",
                            "blocked",
                            "paused",
                            "shutdown",
                            "shut off",
                            "crashed",
                            "pmsuspended",
                        ];
                        const stateStr = DOMAINSTATE[state[0][0]];
                        props = Object.assign(props, {
                            connectionName,
                            id: objPath,
                            state: stateStr,
                        });

                        if (!LIBVIRT_DBUS_PROVIDER.isRunning(stateStr))
                            props.actualTimeInMs = -1;

                        return call(connectionName, objPath, "org.freedesktop.DBus.Properties", "GetAll", ["org.libvirt.Domain"], { timeout, type: 's' });
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
                        props.ui = resolveUiState(dispatch, props.name, props.connectionName);

                        logDebug(`${this.name}.GET_VM(${objPath}, ${connectionName}): update props ${JSON.stringify(props)}`);

                        const dumpxmlParams = parseDumpxml(dispatch, connectionName, domainXML, objPath);
                        if (updateOnly)
                            dispatch(updateVm(Object.assign({}, props, dumpxmlParams)));
                        else
                            dispatch(updateOrAddVm(Object.assign({}, props, dumpxmlParams)));

                        dispatch(getVmSnapshots({ connectionName, domainPath: objPath }));
                    })
                    .catch(ex => console.warn("GET_VM action failed for path", objPath, ex.toString()));
        };
    },

    GET_DOMAIN_SNAPSHOTS({ connectionName, domainPath }) {
        return dispatch => call(connectionName, domainPath, 'org.libvirt.Domain', 'ListDomainSnapshots', [0], { timeout, type: 'u' })
                .then(objPaths => {
                    const snaps = [];
                    const promises = [];

                    objPaths[0].forEach(objPath => {
                        promises.push(call(connectionName, objPath, 'org.libvirt.DomainSnapshot', 'GetXMLDesc', [0], { timeout, type: 'u' })
                                .then((xml) => {
                                    const result = { xml };
                                    return call(connectionName, objPath, 'org.libvirt.DomainSnapshot', 'IsCurrent', [0], { timeout, type: 'u' })
                                            .then((isCurrent) => {
                                                result.isCurrent = isCurrent;
                                                return result;
                                            });
                                })
                        );
                    });

                    // WA to avoid Promise.all() fail-fast behavior
                    const toResultObject = (promise) => {
                        return promise
                                .then(result => ({ success: true, result }))
                                .catch(error => ({ success: false, error }));
                    };

                    Promise.all(promises.map(toResultObject))
                            .then(snapXmlList => {
                                snapXmlList.forEach(snap => {
                                    if (snap.success) {
                                        const result = snap.result;
                                        const snapParams = parseDomainSnapshotDumpxml(result.xml[0]);
                                        snapParams.isCurrent = result.isCurrent[0];
                                        snaps.push(snapParams);
                                    } else {
                                        console.warn("DomainSnapshot method GetXMLDesc failed", snap.error.toString());
                                    }
                                });
                                return dispatch(updateDomainSnapshots({
                                    connectionName,
                                    domainPath,
                                    snaps: snaps.sort((a, b) => a.creationTime - b.creationTime)
                                }));
                            });
                })
                .catch(ex => {
                    console.warn("LIST_DOMAIN_SNAPSHOTS action failed for domain %s: %s", domainPath, JSON.stringify(ex));
                    dispatch(updateDomainSnapshots({
                        connectionName,
                        domainPath,
                        snaps: -1
                    }));
                });
    },

    PAUSE_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Suspend', [], { timeout, type: '' });
    },

    REBOOT_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Reboot', [0], { timeout, type: 'u' });
    },

    RESUME_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Resume', [], { timeout, type: '' });
    },

    SENDNMI_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'InjectNMI', [0], { timeout, type: 'u' });
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
        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' })
                .then(domXml => {
                    const updatedXML = updateVCPUSettings(domXml[0], count, max, sockets, cores, threads);
                    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], { timeout, type: 's' });
                });
    },

    SET_MEMORY({
        id: objPath,
        connectionName,
        memory, // in KiB
        isRunning
    }) {
        let flags = Enum.VIR_DOMAIN_AFFECT_CONFIG;
        if (isRunning)
            flags |= Enum.VIR_DOMAIN_AFFECT_LIVE;

        return call(connectionName, objPath, 'org.libvirt.Domain', 'SetMemory', [memory, flags], { timeout, type: 'tu' });
    },

    SET_MAX_MEMORY({
        id: objPath,
        connectionName,
        maxMemory // in KiB
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [0], { timeout, type: 'u' })
                .then(domXml => {
                    const updatedXML = updateMaxMemory(domXml[0], maxMemory);
                    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], { timeout, type: 's' });
                });
    },

    SHUTDOWN_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Shutdown', [0], { timeout, type: 'u' });
    },

    START_VM({
        connectionName,
        id: objPath
    }) {
        return call(connectionName, objPath, 'org.libvirt.Domain', 'Create', [0], { timeout, type: 'u' });
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
    const parser = new DOMParser();
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
        const flags = Enum.VIR_DOMAIN_STATS_BALLOON | Enum.VIR_DOMAIN_STATS_VCPU | Enum.VIR_DOMAIN_STATS_BLOCK | Enum.VIR_DOMAIN_STATS_STATE;

        call(connectionName, objPath, 'org.libvirt.Domain', 'GetStats', [flags, 0], { timeout: 5000, type: 'uu' })
                .done(info => {
                    if (Object.getOwnPropertyNames(info[0]).length > 0) {
                        info = info[0];
                        const props = { name, connectionName, id: objPath };
                        let avgvCpuTime = 0;

                        if ('balloon.rss' in info)
                            props.rssMemory = info['balloon.rss'].v.v;
                        else if ('state.state' in info && info['state.state'].v.v == Enum.VIR_DOMAIN_SHUTOFF)
                            props.rssMemory = 0.0;
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
                .catch(ex => console.warn(`GetStats(${name}, ${connectionName}) failed: ${ex.toString()}`))
                .always(() => dispatch(delayPolling(doUsagePolling(name, connectionName, objPath), null, name, connectionName)));
    };
}

/**
 * Subscribe to D-Bus signals and defines the handlers to be invoked in each occasion.
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

    /* Handlers for network events */
    startEventMonitorNetworks(connectionName, dispatch);

    /* Handlers for storage pool events */
    startEventMonitorStoragePools(connectionName, dispatch);
}

function startEventMonitorDomains(connectionName, dispatch) {
    /* Subscribe to Domain Lifecycle signals on Connect Interface */
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Connect', member: 'DomainEvent' },
        (path, iface, signal, args) => {
            const domainEvent = {
                Defined: 0,
                Undefined: 1,
                Started: 2,
                Suspended: 3,
                Resumed: 4,
                Stopped: 5,
                Shutdown: 6,
                PMsuspended: 7,
                Crashed: 8
            };
            const objPath = args[0];
            const eventType = args[1];

            logDebug(`signal on ${path}: ${iface}.${signal}(${JSON.stringify(args)})`);

            switch (eventType) {
            case domainEvent.Defined:
                dispatch(getVm({ connectionName, id:objPath }));
                break;

            case domainEvent.Undefined:
                domainEventUndefined(connectionName, objPath, dispatch);
                break;

            case domainEvent.Started:
                dispatch(getVm({ connectionName, id:objPath }));
                break;

            case domainEvent.Suspended:
                dispatch(updateVm({
                    connectionName,
                    id: objPath,
                    state: 'paused'
                }));
                break;

            case domainEvent.Resumed:
                dispatch(updateVm({
                    connectionName,
                    id: objPath,
                    state: 'running'
                }));
                break;

            case domainEvent.Stopped:
                domainUpdateOrDelete(connectionName, objPath, dispatch);
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
            case 'BalloonChange':
            case 'ControlError':
            case 'DeviceAdded':
            case 'DeviceRemoved':
            case 'DiskChange':
            case 'MetadataChanged':
            case 'TrayChange':
            /* These signals imply possible changes in what we display, so re-read the state */
                dispatch(getVm({ connectionName, id:path, updateOnly: true }));
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
        const systemdClient = cockpit.dbus('org.freedesktop.systemd1', { bus: connectionName });
        systemdClient.subscribe(
            { interface: 'org.freedesktop.DBus.Properties', path: '/org/freedesktop/systemd1/unit/libvirtd_2eservice', member: 'PropertiesChanged' },
            (path, iface, signal, args) => {
                if (args[0] === "org.freedesktop.systemd1.Unit" && args[1].ActiveState.v === "deactivating") {
                    dispatch(checkLibvirtStatus(libvirtServiceName));
                    dispatch(deleteUnlistedVMs(connectionName, []));
                    dispatch(delayPolling(getApiData(connectionName, libvirtServiceName)));
                }
            }
        );
    }
}

// Undefined the VM from Redux store only if it's not transient
function domainEventUndefined(connectionName, domPath, dispatch) {
    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListDomains', [Enum.VIR_CONNECT_LIST_DOMAINS_TRANSIENT], { timeout, type: 'u' })
            .then(objPaths => {
                if (!objPaths[0].includes(domPath))
                    dispatch(undefineVm({ connectionName, id: domPath }));
                else
                    dispatch(getVm({ connectionName, id:domPath, updateOnly: true }));
            })
            .catch(ex => console.warn('ListDomains action failed:', ex.toString()));
}

function domainUpdateOrDelete(connectionName, domPath, dispatch) {
    // Transient VMs cease to exists once they are stopped. Check if VM was transient and update or undefined it
    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListDomains', [0], { timeout, type: 'u' })
            .then(objPaths => {
                if (objPaths[0].includes(domPath))
                    dispatch(getVm({ connectionName, id:domPath, updateOnly: true }));
                else // Transient vm will get undefined when stopped
                    dispatch(undefineVm({ connectionName, id:domPath, transientOnly: true }));
            })
            .catch(ex => console.warn('GET_ALL_NETWORKS action failed:', ex.toString()));
}

function storagePoolUpdateOrDelete(connectionName, poolPath, dispatch) {
    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListStoragePools', [0], { timeout, type: 'u' })
            .then(objPaths => {
                if (objPaths[0].includes(poolPath))
                    dispatch(getStoragePool({ connectionName, id:poolPath, updateOnly: true }));
                else // Transient pool which got undefined when stopped
                    dispatch(undefineStoragePool({ connectionName, id:poolPath }));
            })
            .catch(ex => console.warn('GET_ALL_NETWORKS action failed:', ex.toString()));
}

function networkUpdateOrDelete(connectionName, netPath, dispatch) {
    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListNetworks', [0], { timeout, type: 'u' })
            .then(objPaths => {
                if (objPaths[0].includes(netPath))
                    dispatch(getNetwork({ connectionName, id:netPath, updateOnly: true }));
                else // Transient network which got undefined when stopped
                    dispatch(undefineNetwork({ connectionName, id:netPath }));
            })
            .catch(ex => console.warn('GET_ALL_NETWORKS action failed:', ex.toString()));
}

function startEventMonitorNetworks(connectionName, dispatch) {
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Connect', member: 'NetworkEvent' },
        (path, iface, signal, args) => {
            const objPath = args[0];
            const eventType = args[1];

            switch (eventType) {
            case Enum.VIR_NETWORK_EVENT_DEFINED:
            case Enum.VIR_NETWORK_EVENT_STARTED:
                dispatch(getNetwork({ connectionName, id:objPath }));
                break;
            case Enum.VIR_NETWORK_EVENT_STOPPED:
                networkUpdateOrDelete(connectionName, objPath, dispatch);
                break;
            case Enum.VIR_NETWORK_EVENT_UNDEFINED:
                dispatch(undefineNetwork({ connectionName, id:objPath }));
                break;
            default:
                logDebug(`handle Network on ${connectionName}: ignoring event ${signal}`);
            }
        }
    );

    /* Subscribe to signals on Network Interface */
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Network' },
        (path, iface, signal, args) => {
            switch (signal) {
            case 'Refresh':
            /* These signals imply possible changes in what we display, so re-read the state */
                dispatch(getNetwork({ connectionName, id:path }));
                break;
            default:
                logDebug(`handleEvent Network on ${connectionName} : ignoring event ${signal}`);
            }
        });
}

function startEventMonitorStoragePools(connectionName, dispatch) {
    dbus_client(connectionName).subscribe(
        { interface: 'org.libvirt.Connect', member: 'StoragePoolEvent' },
        (path, iface, signal, args) => {
            const objPath = args[0];
            const eventType = args[1];

            switch (eventType) {
            case Enum.VIR_STORAGE_POOL_EVENT_DEFINED:
            case Enum.VIR_STORAGE_POOL_EVENT_CREATED:
                dispatch(updateOrAddStoragePool({ connectionName, id: objPath }));
                dispatch(getStoragePool({ connectionName, id:objPath, updateOnly: true }));
                break;
            case Enum.VIR_STORAGE_POOL_EVENT_STOPPED:
                storagePoolUpdateOrDelete(connectionName, objPath, dispatch);
                break;
            case Enum.VIR_STORAGE_POOL_EVENT_STARTED:
                dispatch(getStoragePool({ connectionName, id:objPath, updateOnly: true }));
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
        const opts = { bus: connectionName };
        if (connectionName === 'system')
            opts.superuser = 'try';
        clientLibvirt[connectionName] = cockpit.dbus("org.libvirt", opts);
    }

    return clientLibvirt[connectionName];
}

export function getLibvirtVersion(connectionName) {
    return (dispatch) => call(connectionName, "/org/libvirt/QEMU", "org.freedesktop.DBus.Properties", "Get", ["org.libvirt.Connect", "LibVersion"], { timeout, type: 'ss' })
            .then(version => dispatch(updateLibvirtVersion({ libvirtVersion: version[0].v })));
}

/**
 * Call a Libvirt method
 */
function call(connectionName, objectPath, iface, method, args, opts) {
    return dbus_client(connectionName).call(objectPath, iface, method, args, opts);
}

function attachDevice({ connectionName, vmId, permanent, hotplug, xmlDesc }) {
    let flags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
    if (hotplug)
        flags |= Enum.VIR_DOMAIN_AFFECT_LIVE;
    if (permanent)
        flags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

    // Error handling is done from the calling side
    return call(connectionName, vmId, 'org.libvirt.Domain', 'AttachDevice', [xmlDesc, flags], { timeout, type: 'su' });
}

/**
 * Returns updated XML description of the network interface specified by mac address.
 * @param  {String} domXml      Domain XML description.
 * @param  {String} networkMac  MAC Address of the network interface we will update.
 * @param  {String} state       Desired state; one of up/down.
 * @return {String}             Updated XML description of the device we will update or null on error.
 */
function updateNetworkIface({ domXml, networkMac, networkState, networkModelType, networkType, networkSource }) {
    const parser = new DOMParser();
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
                    const doc = document.implementation.createDocument('', '', null);
                    linkElem = doc.createElement('link');
                    interfaceElem.appendChild(linkElem);
                }
                linkElem.setAttribute('state', networkState);
            }

            const typeChanged = networkType !== interfaceElem.getAttribute('type', networkType);
            if (networkType) {
                interfaceElem.setAttribute('type', networkType);
            }

            if (networkSource && networkType) {
                let sourceElem = getSingleOptionalElem(interfaceElem, 'source');
                // Source elements of different iface types might contain differently named attributes,
                // so we delete whole element and create a new one
                if (typeChanged && sourceElem) {
                    sourceElem.remove();
                    sourceElem = undefined;
                }
                if (!sourceElem) {
                    sourceElem = document.createElement("source");
                    interfaceElem.appendChild(sourceElem);
                }
                if (networkType === 'network')
                    sourceElem.setAttribute('network', networkSource);
                else if (networkType === 'direct')
                    sourceElem.setAttribute('dev', networkSource);
                else if (networkType === 'bridge')
                    sourceElem.setAttribute('bridge', networkSource);
            }

            if (networkModelType) {
                const modelElem = getSingleOptionalElem(interfaceElem, 'model');
                modelElem.setAttribute('type', networkModelType);
            }

            const returnXML = (new XMLSerializer()).serializeToString(interfaceElem);

            logDebug(`updateNetworkIface: Updated XML: "${returnXML}"`);

            return returnXML;
        }
    }
    console.warn("Can't update network interface element in domXml");
    return null;
}

export function attachIface({ connectionName, vmId, mac, permanent, hotplug, sourceType, source, model }) {
    const xmlDesc = getIfaceXML(sourceType, source, model, mac);

    return attachDevice({ connectionName, vmId, permanent, hotplug, xmlDesc });
}

export function updateDiskAttributes({ connectionName, objPath, target, readonly, shareable, busType, existingTargets }) {
    return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' })
            .then(domXml => {
                const updatedXML = updateDisk({ diskTarget: target, domXml, readonly, shareable, busType, existingTargets });
                return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [updatedXML], { timeout, type: 's' });
            });
}

export function changeNetworkAutostart(network, autostart, dispatch) {
    return call(network.connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'NetworkLookupByName', [network.name], { timeout, type: 's' })
            .then(networkPath => {
                const args = ['org.libvirt.Network', 'Autostart', cockpit.variant('b', autostart)];

                return call(network.connectionName, networkPath[0], 'org.freedesktop.DBus.Properties', 'Set', args, { timeout, type: 'ssv' });
            })
            .then(() => dispatch(getNetwork({ connectionName: network.connectionName, id: network.id, name: network.name })));
}

export function createSnapshot({ connectionName, vmId, name, description }) {
    const xmlDesc = getSnapshotXML(name, description);

    return call(connectionName, vmId, 'org.libvirt.Domain', 'SnapshotCreateXML', [xmlDesc, 0], { timeout, type: 'su' });
}

export function deleteSnapshot({ connectionName, domainPath, snapshotName }) {
    return call(connectionName, domainPath, 'org.libvirt.Domain', 'SnapshotLookupByName', [snapshotName, 0], { timeout, type: 'su' })
            .then((objPath) => {
                return call(connectionName, objPath[0], 'org.libvirt.DomainSnapshot', 'Delete', [0], { timeout, type: 'u' });
            });
}

export function revertSnapshot({ connectionName, domainPath, snapshotName }) {
    return call(connectionName, domainPath, 'org.libvirt.Domain', 'SnapshotLookupByName', [snapshotName, 0], { timeout, type: 'su' })
            .then((objPath) => {
                return call(connectionName, objPath[0], 'org.libvirt.DomainSnapshot', 'Revert', [0], { timeout, type: 'u' });
            });
}

export function detachIface(mac, connectionName, id, live, persistent, dispatch) {
    let ifaceXML;
    let detachFlags = Enum.VIR_DOMAIN_AFFECT_CURRENT;
    if (live)
        detachFlags |= Enum.VIR_DOMAIN_AFFECT_LIVE;

    return call(connectionName, id, 'org.libvirt.Domain', 'GetXMLDesc', [0], { timeout, type: 'u' })
            .then(domXml => {
                const getXMLFlags = Enum.VIR_DOMAIN_XML_INACTIVE;
                ifaceXML = getIfaceElemByMac(domXml[0], mac);

                return call(connectionName, id, 'org.libvirt.Domain', 'GetXMLDesc', [getXMLFlags], { timeout, type: 'u' });
            })
            .then(domInactiveXml => {
                const ifaceInactiveXML = getIfaceElemByMac(domInactiveXml[0], mac);
                if (ifaceInactiveXML && persistent)
                    detachFlags |= Enum.VIR_DOMAIN_AFFECT_CONFIG;

                return call(connectionName, id, 'org.libvirt.Domain', 'DetachDevice', [ifaceXML, detachFlags], { timeout, type: 'su' });
            })
            .then(() => dispatch(getVm({ connectionName, id })));
}

export function domainSendKey(connectionName, id, keyCodes) {
    const holdTime = 0;
    const flags = 0;

    return call(connectionName, id, 'org.libvirt.Domain', 'SendKey', [Enum.VIR_KEYCODE_SET_LINUX, holdTime, keyCodes, flags], { timeout, type: "uuauu" });
}

export function getAllInterfaces(dispatch, connectionName) {
    const flags = Enum.VIR_CONNECT_LIST_INTERFACES_ACTIVE | Enum.VIR_CONNECT_LIST_INTERFACES_INACTIVE;

    call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'ListInterfaces', [flags], { timeout, type: 'u' })
            .then((ifaces) => {
                return Promise.all(ifaces[0].map(path => dispatch(getInterface({ connectionName, id:path }))));
            })
            .catch(ex => console.warn('getAllInterfaces action failed:', ex.toString()));
}

export function getDomainCapabilities(connectionName) {
    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'GetDomainCapabilities', ['', '', '', '', 0], { timeout, type: 'ssssu' });
}

function initResource(connectionName, method, updateOrAddMethod, flags) {
    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', method, [flags], { timeout, type: 'u' })
            .then(objPaths => {
                return Promise.all(objPaths[0].map(() => updateOrAddMethod({})));
            })
            .catch(ex => console.warn('initResource action failed:', ex.toString()));
}

export function networkActivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.Network', 'Create', [], { timeout, type: '' });
}

export function networkCreate({
    connectionName, name, forwardMode, device, ipv4, netmask, ipv6, prefix,
    ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd
}) {
    const netXmlDesc = getNetworkXML({
        name, forwardMode, ipv4, netmask, ipv6, prefix, device,
        ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd
    });

    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'NetworkDefineXML', [netXmlDesc], { timeout, type: 's' });
}

export function networkDeactivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.Network', 'Destroy', [], { timeout, type: '' });
}

export function networkUndefine(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.Network', 'Undefine', [], { timeout, type: '' });
}

export function setOSFirmware(connectionName, objPath, loaderType) {
    return call(connectionName, objPath, 'org.libvirt.Domain', 'GetXMLDesc', [Enum.VIR_DOMAIN_XML_INACTIVE], { timeout, type: 'u' })
            .then(domXml => {
                const domainElem = getElem(domXml);

                if (!domainElem)
                    throw new Error("setOSFirmware: domXML has no domain element");

                const osElem = domainElem.getElementsByTagNameNS("", "os")[0];
                const loaderElem = getSingleOptionalElem(osElem, "loader");

                if (loaderElem)
                    loaderElem.remove();

                if (!loaderType)
                    osElem.removeAttribute("firmware");
                else
                    osElem.setAttribute("firmware", loaderType);

                domainElem.appendChild(osElem);

                const tmp = document.createElement("div");
                tmp.appendChild(domainElem);

                return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'DomainDefineXML', [tmp.innerHTML], { timeout, type: 's' });
            });
}

export function snapshotCurrent(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.Domain', 'SnapshotCurrent', [0], { timeout, type: 'u' });
}

export function storagePoolActivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Create', [Enum.VIR_STORAGE_POOL_CREATE_NORMAL], { timeout, type: 'u' });
}

export function storagePoolDeactivate(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Destroy', [], { timeout, type: '' });
}

export function storagePoolRefresh(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Refresh', [0], { timeout, type: 'u' });
}

export function storagePoolUndefine(connectionName, objPath) {
    return call(connectionName, objPath, 'org.libvirt.StoragePool', 'Undefine', [], { timeout, type: '' });
}

export function storageVolumeCreate(connectionName, poolName, volName, size, format) {
    const volXmlDesc = getVolumeXML(volName, size, format);

    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], { timeout, type: 's' })
            .then(path => {
                return call(connectionName, path[0], 'org.libvirt.StoragePool', 'StorageVolCreateXML', [volXmlDesc, 0], { timeout, type: 'su' })
                        .then(() => {
                            return storagePoolRefresh(connectionName, path[0]);
                        });
            });
}

export function storageVolumeDelete(connectionName, poolName, volName) {
    return call(connectionName, '/org/libvirt/QEMU', 'org.libvirt.Connect', 'StoragePoolLookupByName', [poolName], { timeout, type: 's' })
            .then(objPath => call(connectionName, objPath[0], 'org.libvirt.StoragePool', 'StorageVolLookupByName', [volName], { timeout, type: 's' }))
            .then(objPath => call(connectionName, objPath[0], 'org.libvirt.StorageVol', 'Delete', [0], { timeout, type: 'u' }));
}

export function vmInterfaceAddresses(connectionName, objPath) {
    // 'lease' source will work only for those domains which take IP address from libvirt spawned dnsmasq (i.e. have <interface type='network'/>)
    return call(connectionName, objPath, 'org.libvirt.Domain', 'InterfaceAddresses', [Enum.VIR_DOMAIN_INTERFACE_ADDRESSES_SRC_LEASE, 0], { timeout, type: 'uu' });
}

export default LIBVIRT_DBUS_PROVIDER;
