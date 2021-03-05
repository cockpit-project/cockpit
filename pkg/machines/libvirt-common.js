import cockpit from 'cockpit';
import * as service from '../lib/service.js';
import createVmScript from 'raw-loader!./scripts/create_machine.sh';
import installVmScript from 'raw-loader!./scripts/install_machine.sh';
import getLibvirtServiceNameScript from 'raw-loader!./scripts/get_libvirt_service_name.sh';

import * as python from "python.js";
import getOSListScript from 'raw-loader!./getOSList.py';

import {
    setLoggedInUser,
    updateLibvirtState,
    updateOsInfoList,
} from './actions/store-actions.js';

import {
    getApiData,
    getLoggedInUser,
    getOsInfoList
} from './actions/provider-actions.js';

import {
    convertToUnit,
    logDebug,
    fileDownload,
    rephraseUI,
    units,
} from './helpers.js';

import {
    prepareDisksParam,
    prepareDisplaysParam,
    prepareNICParam,
    prepareVcpuParam,
    prepareMemoryParam,
} from './libvirtUtils.js';

import {
    finishVmCreateInProgress,
    removeVmCreateInProgress,
    setVmCreateInProgress,
    setVmInstallInProgress,
    clearVmUiState,
} from './components/create-vm-dialog/uiState.js';

import store from './store.js';
import VMS_CONFIG from './config.js';

const _ = cockpit.gettext;
const METADATA_NAMESPACE = "https://github.com/cockpit-project/cockpit/tree/master/pkg/machines";

export function buildConsoleVVFile(consoleDetail) {
    return '[virt-viewer]\n' +
        `type=${consoleDetail.type}\n` +
        `host=${consoleDetail.address}\n` +
        `port=${consoleDetail.port}\n` +
        'delete-this-file=1\n' +
        'fullscreen=0\n';
}

export function buildScriptTimeoutFailHandler(handler, delay) {
    return () => window.setTimeout(handler, delay);
}

export function canLoggedUserConnectSession (connectionName, loggedUser) {
    return connectionName !== 'session' || loggedUser.name !== 'root';
}

export function createTempFile(content) {
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

export function getDiskElemByTarget(domxml, targetOriginal) {
    const domainElem = getElem(domxml);

    if (!domainElem) {
        console.warn(`Can't parse dumpxml, input: "${domainElem}"`);
        return;
    }

    const devicesElem = domainElem.getElementsByTagName('devices')[0];
    const diskElems = devicesElem.getElementsByTagName('disk');

    if (diskElems) {
        for (let i = 0; i < diskElems.length; i++) {
            const diskElem = diskElems[i];
            const targetElem = diskElem.getElementsByTagName('target')[0];
            const target = targetElem.getAttribute('dev'); // identifier of the disk, i.e. sda, hdc
            if (target === targetOriginal) {
                return new XMLSerializer().serializeToString(diskElem);
            }
        }
    }
}

export function getIfaceElemByMac(domxml, mac) {
    const domainElem = getElem(domxml);

    if (!domainElem) {
        console.warn(`Can't parse dumpxml, input: "${domainElem}"`);
        return;
    }

    const devicesElem = domainElem.getElementsByTagName('devices')[0];
    const ifaceElems = devicesElem.getElementsByTagName('interface');

    if (ifaceElems) {
        for (let i = 0; i < ifaceElems.length; i++) {
            const ifaceElem = ifaceElems[i];
            const macElem = ifaceElem.getElementsByTagName('mac')[0];
            const address = macElem.getAttribute('address'); // identifier of the iface
            if (address === mac) {
                return new XMLSerializer().serializeToString(ifaceElem);
            }
        }
    }
}

export function getElem(xml) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${xml}"`);
        return;
    }

    return xmlDoc.firstElementChild;
}

export function getDomainCapMaxVCPU(capsXML) {
    const domainCapsElem = getElem(capsXML);
    const vcpuElem = domainCapsElem.getElementsByTagName("vcpu") && domainCapsElem.getElementsByTagName("vcpu")[0];
    return vcpuElem && vcpuElem.getAttribute('max');
}

export function getDomainCapLoader(capsXML) {
    const domainCapsElem = getElem(capsXML);
    const osElem = domainCapsElem.getElementsByTagName("os") && domainCapsElem.getElementsByTagName("os")[0];
    return osElem && osElem.getElementsByTagName("loader");
}

export function getDomainCapCPUCustomModels(capsXML) {
    const domainCapsElem = getElem(capsXML);
    const cpuElem = domainCapsElem.getElementsByTagName("cpu") && domainCapsElem.getElementsByTagName("cpu")[0];
    const modeElems = cpuElem && cpuElem.getElementsByTagName("mode");
    const customModeElem = modeElems && Array.prototype.find.call(modeElems, modeElem => modeElem.getAttribute("name") == "custom");
    return customModeElem && Array.prototype.map.call(customModeElem.getElementsByTagName("model"), modelElem => modelElem.textContent);
}

export function getDomainCapCPUHostModel(capsXML) {
    const domainCapsElem = getElem(capsXML);
    const cpuElem = domainCapsElem.getElementsByTagName("cpu") && domainCapsElem.getElementsByTagName("cpu")[0];
    const modeElems = cpuElem && cpuElem.getElementsByTagName("mode");
    const hostModelModeElem = modeElems && Array.prototype.find.call(modeElems, modeElem => modeElem.getAttribute("name") == "host-model");
    return hostModelModeElem && Array.prototype.map.call(hostModelModeElem.getElementsByTagName("model"), modelElem => modelElem.textContent)[0];
}

export function getSingleOptionalElem(parent, name) {
    const subElems = parent.getElementsByTagName(name);
    return subElems.length > 0 ? subElems[0] : undefined; // optional
}

export function parseDomainSnapshotDumpxml(snapshot) {
    const snapElem = getElem(snapshot);

    const nameElem = getSingleOptionalElem(snapElem, 'name');
    const descElem = getSingleOptionalElem(snapElem, 'description');
    const parentElem = getSingleOptionalElem(snapElem, 'parent');

    const name = nameElem ? nameElem.childNodes[0].nodeValue : undefined;
    const description = descElem ? descElem.childNodes[0].nodeValue : undefined;
    const parentName = parentElem ? parentElem.getElementsByTagName("name")[0].childNodes[0].nodeValue : undefined;
    const state = snapElem.getElementsByTagName("state")[0].childNodes[0].nodeValue;
    const creationTime = snapElem.getElementsByTagName("creationTime")[0].childNodes[0].nodeValue;

    return { name, description, state, creationTime, parentName };
}

export function parseDumpxml(dispatch, connectionName, domXml, id_overwrite) {
    const domainElem = getElem(domXml);
    if (!domainElem) {
        return;
    }

    const osElem = domainElem.getElementsByTagNameNS("", "os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
    const memoryElem = domainElem.getElementsByTagName("memory")[0];
    const vcpuElem = domainElem.getElementsByTagName("vcpu")[0];
    const cpuElem = domainElem.getElementsByTagName("cpu")[0];
    const vcpuCurrentAttr = vcpuElem.attributes.getNamedItem('current');
    const devicesElem = domainElem.getElementsByTagName("devices")[0];
    const osTypeElem = osElem.getElementsByTagName("type")[0];
    const osBootElems = osElem.getElementsByTagName("boot");
    const metadataElem = getSingleOptionalElem(domainElem, "metadata");

    const name = domainElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const id = id_overwrite || domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
    const osType = osTypeElem.nodeValue;
    const osBoot = parseDumpxmlForOsBoot(osBootElems);
    const arch = osTypeElem.getAttribute("arch");
    const emulatedMachine = osTypeElem.getAttribute("machine");
    const firmware = osElem.getAttribute("firmware");
    const loaderElem = getSingleOptionalElem(osElem, "loader");

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = convertToUnit(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit, units.KiB);
    const memoryUnit = memoryElem.getAttribute("unit");
    const memory = convertToUnit(memoryElem.childNodes[0].nodeValue, memoryUnit, units.KiB);

    const vcpus = parseDumpxmlForVCPU(vcpuElem, vcpuCurrentAttr);

    const disks = parseDumpxmlForDisks(devicesElem);
    const cpu = parseDumpxmlForCpu(cpuElem);
    const displays = parseDumpxmlForConsoles(devicesElem);
    const interfaces = parseDumpxmlForInterfaces(devicesElem);
    const redirectedDevices = parseDumpxmlForRedirectedDevices(devicesElem);
    const hostDevices = parseDumpxmlForHostDevices(devicesElem);

    const hasInstallPhase = parseDumpxmlMachinesMetadataElement(metadataElem, 'has_install_phase') === 'true';
    const installSourceType = parseDumpxmlMachinesMetadataElement(metadataElem, 'install_source_type');
    const installSource = parseDumpxmlMachinesMetadataElement(metadataElem, 'install_source');
    const osVariant = parseDumpxmlMachinesMetadataElement(metadataElem, 'os_variant');

    const metadata = {
        hasInstallPhase,
        installSourceType,
        installSource,
        osVariant,
    };

    return {
        connectionName,
        name,
        id,
        osType,
        osBoot,
        firmware,
        loader: loaderElem ? loaderElem.textContent : undefined,
        arch,
        currentMemory,
        memory,
        vcpus,
        disks,
        emulatedMachine,
        cpu,
        displays,
        interfaces,
        redirectedDevices,
        hostDevices,
        metadata,
    };
}

export function parseDumpxmlForOsBoot(osBootElems) {
    const osBoot = [];

    for (let bootNum = 0; bootNum < osBootElems.length; bootNum++) {
        const bootElem = osBootElems[bootNum];
        const dev = bootElem.getAttribute('dev');
        if (dev) {
            osBoot.push({
                order: bootNum + 1,
                type: rephraseUI('bootableDisk', dev) // Example: hd, network, fd, cdrom
            });
        }
    }

    return osBoot; // already sorted
}

export function parseDumpxmlForVCPU(vcpuElem, vcpuCurrentAttr) {
    const vcpus = {};
    vcpus.count = (vcpuCurrentAttr && vcpuCurrentAttr.value) ? vcpuCurrentAttr.value : vcpuElem.childNodes[0].nodeValue;
    vcpus.placement = vcpuElem.getAttribute("placement");
    vcpus.max = vcpuElem.childNodes[0].nodeValue;
    return vcpus;
}

export function parseDumpxmlForCpu(cpuElem) {
    if (!cpuElem) {
        return { topology: {} };
    }

    const cpu = {};

    cpu.mode = cpuElem.getAttribute('mode');
    if (cpu.mode === 'custom') {
        const modelElem = getSingleOptionalElem(cpuElem, 'model');
        if (modelElem) {
            cpu.model = modelElem.childNodes[0].nodeValue; // content of the domain/cpu/model element
        }
    }

    cpu.topology = {};

    const topologyElem = getSingleOptionalElem(cpuElem, 'topology');

    if (topologyElem) {
        cpu.topology.sockets = topologyElem.getAttribute('sockets');
        cpu.topology.threads = topologyElem.getAttribute('threads');
        cpu.topology.cores = topologyElem.getAttribute('cores');
    }

    return cpu;
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
                displays.pty = {};
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
                    volume: sourceElem ? sourceElem.getAttribute('volume') : undefined,
                    protocol: sourceElem ? sourceElem.getAttribute('protocol') : undefined,
                    name: sourceElem ? sourceElem.getAttribute('name') : undefined,
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

export function parseDumpxmlForRedirectedDevices(devicesElem) {
    const redirdevs = [];
    const redirdevElems = devicesElem.getElementsByTagName('redirdev');

    if (redirdevElems) {
        for (let i = 0; i < redirdevElems.length; i++) {
            const redirdevElem = redirdevElems[i];

            const addressElem = redirdevElem.getElementsByTagName('address')[0];
            const sourceElem = getSingleOptionalElem(redirdevElem, 'source');
            const bootElem = getSingleOptionalElem(redirdevElem, 'boot');

            const dev = { // see https://libvirt.org/formatdomain.html#elementsRedir
                bus: redirdevElem.getAttribute('bus'),
                type: redirdevElem.getAttribute('type'),
                bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                address: {
                    type: addressElem.getAttribute('type'),
                    bus: addressElem.getAttribute('bus'),
                    port: addressElem.getAttribute('port'),
                },
                source: {
                    mode: sourceElem ? sourceElem.getAttribute('mode') : undefined,
                    host: sourceElem ? sourceElem.getAttribute('host') : undefined,
                    service: sourceElem ? sourceElem.getAttribute('service') : undefined,
                },
            };
            redirdevs.push(dev);
        }
    }
    return redirdevs;
}

// TODO Parse more attributes. Right now it parses only necessary
export function parseDumpxmlForHostDevices(devicesElem) {
    const hostdevs = [];
    const hostdevElems = devicesElem.getElementsByTagName('hostdev');

    if (hostdevElems) {
        for (let i = 0; i < hostdevElems.length; i++) {
            const hostdevElem = hostdevElems[i];
            const bootElem = getSingleOptionalElem(hostdevElem, 'boot');
            const type = hostdevElem.getAttribute('type');
            let dev;

            switch (type) {
            case "usb": {
                const addressElem = getSingleOptionalElem(hostdevElem, 'address');
                const sourceElem = getSingleOptionalElem(hostdevElem, 'source');

                let vendorElem, productElem;
                if (sourceElem) {
                    vendorElem = sourceElem.getElementsByTagName('vendor')[0];
                    productElem = sourceElem.getElementsByTagName('product')[0];
                }
                dev = {
                    type: type,
                    bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                    address: {
                        port: addressElem ? addressElem.getAttribute('port') : undefined,
                    },
                    source: {
                        vendor: {
                            id: vendorElem ? vendorElem.getAttribute('id') : undefined,
                        },
                        product: {
                            id: productElem ? productElem.getAttribute('id') : undefined,
                        },
                    },
                };
                hostdevs.push(dev);
                break;
            }
            case "pci": {
                const sourceElem = hostdevElem.getElementsByTagName('source')[0];
                const addressElem = sourceElem.getElementsByTagName('address')[0];

                dev = {
                    type: type,
                    bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                    source: {
                        address: {
                            domain: addressElem.getAttribute('domain'),
                            bus: addressElem.getAttribute('bus'),
                            slot: addressElem.getAttribute('slot'),
                            func: addressElem.getAttribute('function'),
                        },
                    },
                };
                hostdevs.push(dev);
                break;
            }
            case "scsi": {
                const sourceElem = hostdevElem.getElementsByTagName('source')[0];
                const addressElem = getSingleOptionalElem(sourceElem, 'address');
                const adapterElem = getSingleOptionalElem(sourceElem, 'adapter');
                const protocol = sourceElem.getAttribute('protocol');
                let name;
                if (protocol === "iscsi")
                    name = sourceElem.getAttribute('name');

                dev = {
                    type: type,
                    bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                    source: {
                        protocol: protocol,
                        name: name,
                        address: {
                            bus: addressElem ? addressElem.getAttribute('bus') : undefined,
                            target: addressElem ? addressElem.getAttribute('target') : undefined,
                            unit: addressElem ? addressElem.getAttribute('unit') : undefined,
                        },
                        adapter: {
                            name: adapterElem ? adapterElem.getAttribute('name') : undefined,
                        },
                    },
                };
                hostdevs.push(dev);
                break;
            }
            case "scsi_host": {
                const sourceElem = hostdevElem.getElementsByTagName('source')[0];

                dev = {
                    type: type,
                    bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                    source: {
                        protocol: sourceElem.getAttribute('protocol'),
                        wwpn: sourceElem.getAttribute('wwpn'),
                    },
                };
                hostdevs.push(dev);
                break;
            }
            case "mdev": {
                const sourceElem = hostdevElem.getElementsByTagName('source')[0];
                const addressElem = sourceElem.getElementsByTagName('address')[0];

                dev = {
                    type: type,
                    bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
                    source: {
                        address: {
                            uuid: addressElem.getAttribute('uuid'),
                        },
                    },
                };
                hostdevs.push(dev);
                break;
            }
            }
        }
    }
    return hostdevs;
}

export function parseDumpxmlForInterfaces(devicesElem) {
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
            const bootElem = getSingleOptionalElem(interfaceElem, 'boot');

            const networkInterface = { // see https://libvirt.org/formatdomain.html#elementsNICS
                type: interfaceElem.getAttribute('type'), // Only one required parameter
                managed: interfaceElem.getAttribute('managed'),
                name: interfaceElem.getAttribute('name') ? interfaceElem.getAttribute('name') : undefined, // Name of interface
                target: targetElem ? targetElem.getAttribute('dev') : undefined,
                mac: macElem.getAttribute('address'), // MAC address
                model: modelElem ? modelElem.getAttribute('type') : undefined, // Device model
                aliasName: aliasElem ? aliasElem.getAttribute('name') : undefined,
                virtualportType: virtualportElem ? virtualportElem.getAttribute('type') : undefined,
                driverName: driverElem ? driverElem.getAttribute('name') : undefined,
                state: linkElem ? linkElem.getAttribute('state') : 'up', // State of interface, up/down (plug/unplug)
                mtu: mtuElem ? mtuElem.getAttribute('size') : undefined,
                bootOrder: bootElem ? bootElem.getAttribute('order') : undefined,
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
                    slot: addressElem ? addressElem.getAttribute('slot') : undefined,
                },
            };
            interfaces.push(networkInterface);
        }
    }
    return interfaces;
}

export function parseDumpxmlMachinesMetadataElement(metadataElem, name) {
    if (!metadataElem) {
        return null;
    }
    const subElems = metadataElem.getElementsByTagNameNS(METADATA_NAMESPACE, name);

    return subElems.length > 0 ? subElems[0].textContent : null;
}

export function parseIfaceDumpxml(ifaceXml) {
    const retObj = {};
    const ifaceElem = getElem(ifaceXml);

    retObj.type = ifaceElem.getAttribute("type");

    return retObj;
}

export function parseNetDumpxml(netXml) {
    const retObj = {};
    const netElem = getElem(netXml);
    if (!netElem) {
        return;
    }

    const forwardElem = netElem.getElementsByTagName("forward")[0];
    const bridgeElem = netElem.getElementsByTagName("bridge")[0];

    if (bridgeElem)
        retObj.bridge = { name: bridgeElem.getAttribute("name") };

    const ipElems = netElem.getElementsByTagName("ip");
    retObj.ip = parseNetDumpxmlForIp(ipElems);

    const mtuElem = netElem.getElementsByTagName("mtu")[0];
    retObj.mtu = mtuElem ? mtuElem.getAttribute("size") : undefined;

    // if mode is not specified, "nat" is assumed, see https://libvirt.org/formatnetwork.html#elementsConnect
    if (forwardElem) {
        const ifaceElem = forwardElem.getElementsByTagName("interface")[0];
        if (ifaceElem)
            retObj.interface = { interface: { dev: ifaceElem.getAttribute("dev") } };

        retObj.forward = { mode: (forwardElem.getAttribute("mode") || "nat") };
    }

    return retObj;
}

function parseNetDumpxmlForIp(ipElems) {
    const ip = [];

    for (let i = 0; i < ipElems.length; i++) {
        const ipElem = ipElems[i];

        let family = ipElem.getAttribute("family");
        if (!family)
            family = "ipv4";
        const address = ipElem.getAttribute("address");
        const netmask = ipElem.getAttribute("netmask");
        const prefix = ipElem.getAttribute("prefix");
        const dhcpElem = ipElem.getElementsByTagName("dhcp")[0];

        let rangeElem;
        let bootp;
        const dhcpHosts = [];
        if (dhcpElem) {
            rangeElem = dhcpElem.getElementsByTagName("range")[0];
            const hostElems = dhcpElem.getElementsByTagName("host");

            for (let i = 0; i < hostElems.length; i++) {
                const host = {
                    ip : hostElems[i].getAttribute("ip"),
                    name : hostElems[i].getAttribute("name"),
                    mac : hostElems[i].getAttribute("mac"),
                    id : hostElems[i].getAttribute("id"),
                };
                dhcpHosts.push(host);
            }

            const bootpElem = dhcpElem.getElementsByTagName("bootp")[0];
            if (bootpElem)
                bootp = { file: bootpElem.getAttribute("file") };
        }

        const tmp = {
            address: address,
            family: family,
            netmask: netmask,
            prefix: prefix,
            dhcp : {
                range : {
                    start : rangeElem ? rangeElem.getAttribute("start") : undefined,
                    end : rangeElem ? rangeElem.getAttribute("end") : undefined,
                },
                hosts: dhcpHosts,
                bootp,
            },
        };

        ip.push(tmp);
    }

    return ip;
}

export function parseNodeDeviceDumpxml(nodeDevice) {
    const deviceElem = getElem(nodeDevice);
    if (!deviceElem) {
        return;
    }

    const name = deviceElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const capabilityElem = deviceElem.getElementsByTagName("capability")[0];

    const capability = {};
    const path = {};

    capability.type = capabilityElem.getAttribute("type");
    if (capability.type == 'net')
        capability.interface = capabilityElem.getElementsByTagName("interface")[0].childNodes[0].nodeValue;
    else if (capability.type == 'usb_device' || capability.type == 'pci') {
        capability.product = {};
        capability.vendor = {};

        const productElem = capabilityElem.getElementsByTagName("product")[0];
        const vendorElem = capabilityElem.getElementsByTagName("vendor")[0];
        if (productElem) {
            capability.product.id = productElem.getAttribute("id");
            capability.product._value = productElem.childNodes[0] ? productElem.childNodes[0].nodeValue : undefined;
        }
        if (vendorElem) {
            capability.vendor.id = vendorElem.getAttribute("id");
            capability.vendor._value = vendorElem.childNodes[0] ? vendorElem.childNodes[0].nodeValue : undefined;
        }
    } else if (capability.type == 'scsi') {
        capability.bus = {};
        capability.lun = {};
        capability.target = {};

        const busElem = capabilityElem.getElementsByTagName("bus")[0];
        const lunElem = capabilityElem.getElementsByTagName("lun")[0];
        const targetElem = capabilityElem.getElementsByTagName("target")[0];

        if (busElem)
            capability.bus._value = busElem.childNodes[0] ? busElem.childNodes[0].nodeValue : undefined;
        if (lunElem)
            capability.lun._value = lunElem.childNodes[0] ? lunElem.childNodes[0].nodeValue : undefined;
        if (targetElem)
            capability.target._value = targetElem.childNodes[0] ? targetElem.childNodes[0].nodeValue : undefined;
    } else if (capability.type == 'mdev') {
        const pathElem = deviceElem.getElementsByTagName("bus")[0];

        if (pathElem)
            path._value = pathElem.childNodes[0] ? pathElem.childNodes[0].nodeValue : undefined;
    }

    return { name, capability };
}

export function parseOsInfoList(dispatch, osList) {
    const osinfodata = JSON.parse(osList);

    dispatch(updateOsInfoList(osinfodata.filter(os => os.shortId)));
}

export function parseStoragePoolDumpxml(connectionName, storagePoolXml, id_overwrite) {
    const storagePoolElem = getElem(storagePoolXml);
    if (!storagePoolElem) {
        return;
    }

    const result = { connectionName };
    result.type = storagePoolElem.getAttribute('type');
    result.name = storagePoolElem.getElementsByTagName('name')[0].childNodes[0].nodeValue;
    result.id = id_overwrite || storagePoolElem.getElementsByTagName('uuid')[0].childNodes[0].nodeValue;
    result.capacity = storagePoolElem.getElementsByTagName('capacity')[0].childNodes[0].nodeValue;
    result.available = storagePoolElem.getElementsByTagName('available')[0].childNodes[0].nodeValue;
    result.allocation = storagePoolElem.getElementsByTagName('allocation')[0].childNodes[0].nodeValue;

    // Fetch path property if target is contained for this type of pool
    if (['dir', 'fs', 'netfs', 'logical', 'disk', 'iscsi', 'scsi', 'mpath', 'zfs'].indexOf(result.type) > -1) {
        const targetElem = storagePoolElem.getElementsByTagName('target')[0];
        result.target = { path: getSingleOptionalElem(targetElem, 'path').childNodes[0].nodeValue };
    }
    const sourceElem = storagePoolElem.getElementsByTagName('source')[0];
    if (sourceElem) {
        result.source = {};

        const hostElem = sourceElem.getElementsByTagName('host');
        if (hostElem[0])
            result.source.host = { name: hostElem[0].getAttribute('name') };

        const deviceElem = sourceElem.getElementsByTagName('device');
        if (deviceElem[0])
            result.source.device = { path: deviceElem[0].getAttribute('path') };

        const dirElem = sourceElem.getElementsByTagName('dir');
        if (dirElem[0])
            result.source.dir = { path: dirElem[0].getAttribute('path') };

        const sourceNameElem = sourceElem.getElementsByTagName('name');
        if (sourceNameElem[0])
            result.source.name = sourceNameElem[0].childNodes[0].nodeValue;

        const formatElem = sourceElem.getElementsByTagName('format');
        if (formatElem[0])
            result.source.format = { type: formatElem[0].getAttribute('type') };
    }

    return result;
}

export function parseStorageVolumeDumpxml(connectionName, storageVolumeXml, id_overwrite) {
    const storageVolumeElem = getElem(storageVolumeXml);
    if (!storageVolumeElem) {
        return;
    }
    const type = storageVolumeElem.getAttribute('type');
    const name = storageVolumeElem.getElementsByTagName('name')[0].childNodes[0].nodeValue;
    const id = id_overwrite || undefined;
    const targetElem = storageVolumeElem.getElementsByTagName('target')[0];
    const path = getSingleOptionalElem(targetElem, 'path').childNodes[0].nodeValue;
    const capacity = storageVolumeElem.getElementsByTagName('capacity')[0].childNodes[0].nodeValue;
    const allocation = storageVolumeElem.getElementsByTagName('allocation')[0].childNodes[0].nodeValue;
    const physicalElem = storageVolumeElem.getElementsByTagName('physical')[0];
    const physical = physicalElem ? physicalElem.childNodes[0].nodeValue : NaN;
    const formatElem = storageVolumeElem.getElementsByTagName('format')[0];
    const format = formatElem ? formatElem.getAttribute('type') : undefined;
    return {
        connectionName,
        name,
        id,
        type,
        path,
        capacity,
        allocation,
        physical,
        format,
    };
}

export function resolveUiState(dispatch, name, connectionName) {
    const result = {
        // used just the first time vm is shown
        initiallyExpanded: false,
        initiallyOpenedConsoleTab: false,
    };

    const uiState = store.getState().ui.vms.find(vm => vm.name == name && vm.connectionName == connectionName);

    if (uiState) {
        result.initiallyExpanded = uiState.expanded;
        result.initiallyOpenedConsoleTab = uiState.openConsoleTab;

        if (uiState.installInProgress) {
            removeVmCreateInProgress(dispatch, name, connectionName);
        } else {
            clearVmUiState(dispatch, name, connectionName);
        }
    }

    return result;
}

export function unknownConnectionName(action, libvirtServiceName) {
    return dispatch => {
        return cockpit.user().done(loggedUser => {
            const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                    .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                        connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                    .map(connectionName => dispatch(action(connectionName, libvirtServiceName)));
            return Promise.all(promises);
        });
    };
}

/*
 * Start of Common Provider function declarations.
 * The order should be kept alphabetical in this section.
 */

export const canConsole = (vmState) => vmState == 'running';
export const canDelete = (vmState, vmId) => true;
export const canInstall = (vmState, hasInstallPhase) => vmState != 'running' && hasInstallPhase;
export const canReset = (vmState) => vmState == 'running' || vmState == 'idle' || vmState == 'paused';
export const canRun = (vmState, hasInstallPhase) => !hasInstallPhase && vmState == 'shut off';
export const canSendNMI = (vmState) => canReset(vmState);
export const canShutdown = (vmState) => canReset(vmState);
export const canPause = (vmState) => vmState == 'running';
export const canResume = (vmState) => vmState == 'paused';
export const isRunning = (vmState) => canReset(vmState);
export const serialConsoleCommand = ({ vm }) => vm.displays.pty ? ['virsh', ...VMS_CONFIG.Virsh.connections[vm.connectionName].params, 'console', vm.name] : false;

export function CHECK_LIBVIRT_STATUS({ serviceName }) {
    logDebug(`${this.name}.CHECK_LIBVIRT_STATUS`);
    return dispatch => {
        const libvirtService = service.proxy(serviceName);
        const dfd = cockpit.defer();

        libvirtService.wait(() => {
            const activeState = libvirtService.exists ? libvirtService.state : 'stopped';
            const unitState = libvirtService.exists && libvirtService.enabled ? 'enabled' : 'disabled';

            dispatch(updateLibvirtState({
                activeState,
                unitState,
            }));
            dfd.resolve();
        });

        return dfd.promise();
    };
}

/*
 * Basic, but working.
 * TODO: provide support for more complex scenarios, like with TLS or proxy
 *
 * To try with virt-install: --graphics spice,listen=[external host IP]
 */
export function CONSOLE_VM({
    name,
    consoleDetail
}) {
    logDebug(`${this.name}.CONSOLE_VM(name='${name}'), detail = `, consoleDetail);
    return dispatch => {
        fileDownload({
            data: buildConsoleVVFile(consoleDetail),
            fileName: 'console.vv',
            mimeType: 'application/x-virt-viewer'
        });
    };
}

export function CREATE_VM({
    connectionName,
    vmName,
    source,
    sourceType,
    os,
    memorySize,
    storageSize,
    startVm,
    storagePool,
    storageVolume,
    unattended,
    rootPassword,
    userPassword,
    userLogin,
    profile,
    useCloudInit,
}) {
    logDebug(`${this.name}.CREATE_VM(${vmName}):`);
    return dispatch => {
        // shows dummy vm  until we get vm from virsh (cleans up inProgress)
        setVmCreateInProgress(dispatch, vmName, connectionName, { openConsoleTab: startVm });

        if (startVm) {
            setVmInstallInProgress(dispatch, { name: vmName, connectionName });
        }

        const opts = { err: "message", environ: ['LC_ALL=C'] };
        if (connectionName === 'system')
            opts.superuser = 'try';

        return cockpit.script(createVmScript, [
            connectionName,
            vmName,
            source,
            sourceType,
            os,
            memorySize,
            storageSize,
            startVm,
            storagePool,
            storageVolume,
            unattended,
            rootPassword,
            userPassword,
            userLogin,
            profile,
            useCloudInit,
        ], opts)
                .done(() => {
                    finishVmCreateInProgress(dispatch, vmName, connectionName);
                    clearVmUiState(dispatch, vmName, connectionName);
                })
                .fail((exception, data) => {
                    clearVmUiState(dispatch, vmName, connectionName); // inProgress cleanup
                    console.info(`spawn 'vm creation' returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                });
    };
}

export function ENABLE_LIBVIRT({ enable, serviceName }) {
    logDebug(`${this.name}.ENABLE_LIBVIRT`);
    return dispatch => {
        const libvirtService = service.proxy(serviceName);
        const promise = enable ? libvirtService.enable() : libvirtService.disable();

        return promise.fail(exception => {
            console.info(`enabling libvirt failed: "${JSON.stringify(exception)}"`);
        });
    };
}

export function GET_LOGGED_IN_USER() {
    logDebug(`${this.name}.GET_LOGGED_IN_USER:`);
    return dispatch => {
        return cockpit.user().then(loggedUser => {
            dispatch(setLoggedInUser({ loggedUser }));
        });
    };
}

export function GET_OS_INFO_LIST () {
    logDebug(`${this.name}.GET_OS_INFO_LIST():`);
    return dispatch => python.spawn(getOSListScript, null, { err: "message", environ: ['LC_ALL=C.UTF-8'] })
            .then(osList => {
                parseOsInfoList(dispatch, osList);
            })
            .fail((exception, data) => {
                console.error(`get os list returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                parseOsInfoList(dispatch, '[]');
            });
}

export function INIT_DATA_RETRIEVAL () {
    logDebug(`${this.name}.INIT_DATA_RETRIEVAL():`);
    return dispatch => {
        dispatch(getOsInfoList());
        dispatch(getLoggedInUser());
        return cockpit.script(getLibvirtServiceNameScript, null, { err: "message", environ: ['LC_ALL=C.UTF-8'] })
                .then(serviceName => {
                    const match = serviceName.match(/([^\s]+)/);
                    const name = match ? match[0] : null;
                    dispatch(updateLibvirtState({ name }));
                    if (name) {
                        dispatch(getApiData(null, name));
                    } else {
                        console.error("initialize failed: getting libvirt service name failed");
                    }
                })
                .fail((exception, data) => {
                    dispatch(updateLibvirtState({ name: null }));
                    console.error(`initialize failed: getting libvirt service name returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
                });
    };
}

export function INSTALL_VM({ onAddErrorNotification, ...vm }) {
    const {
        autostart, connectionName, cpu, currentMemory,
        disks, displays, firmware, interfaces, memory,
        metadata, name, vcpus,
    } = vm;

    logDebug(`${this.name}.INSTALL_VM(${name}):`);
    return dispatch => {
        // shows dummy vm until we get vm from virsh (cleans up inProgress)
        // vm should be returned even if script fails
        setVmInstallInProgress(dispatch, vm);

        const opts = { err: "message", environ: ['LC_ALL=C'] };
        if (connectionName === 'system')
            opts.superuser = 'try';

        return cockpit.script(installVmScript, [
            connectionName,
            name,
            metadata.installSourceType,
            metadata.installSource,
            metadata.osVariant,
            prepareMemoryParam(convertToUnit(currentMemory, units.KiB, units.MiB), convertToUnit(memory, units.KiB, units.MiB)),
            prepareVcpuParam(vcpus, cpu),
            prepareDisksParam(disks),
            prepareDisplaysParam(displays),
            prepareNICParam(interfaces),
            firmware == "efi" ? 'uefi' : '',
            autostart,
        ], opts)
                .done(() => clearVmUiState(dispatch, name, connectionName))
                .fail(ex => {
                    clearVmUiState(dispatch, name, connectionName); // inProgress cleanup
                    buildScriptTimeoutFailHandler(
                        () => onAddErrorNotification({ text: cockpit.format(_("VM $0 failed to get installed"), name), detail: ex.message })
                        , VMS_CONFIG.WaitForRetryInstallVm);
                });
    };
}

export function START_LIBVIRT({ serviceName }) {
    logDebug(`${this.name}.START_LIBVIRT`);
    return dispatch => {
        return service.proxy(serviceName).start()
                .fail(exception => {
                    console.info(`starting libvirt failed: "${JSON.stringify(exception)}"`);
                });
    };
}
