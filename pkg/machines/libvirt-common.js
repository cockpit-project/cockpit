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
    checkLibvirtStatus,
    getAllVms,
    getHypervisorMaxVCPU,
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
} from './libvirtUtils.js';

import {
    finishVmCreateInProgress,
    finishVmInstallInProgress,
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
    const domainElem = getDomainElem(domxml);

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

export function getDomainElem(domXml) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(domXml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${domXml}"`);
        return;
    }

    return xmlDoc.getElementsByTagName("domain")[0];
}

function getNetworkElem(netXml) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(netXml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${netXml}"`);
        return;
    }

    return xmlDoc.getElementsByTagName("network")[0];
}

function getNodeDeviceElem(deviceXml) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(deviceXml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${deviceXml}"`);
        return;
    }

    return xmlDoc.getElementsByTagName("device")[0];
}

function getStoragePoolElem(poolXml) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(poolXml, "application/xml");

    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${poolXml}"`);
        return;
    }

    return xmlDoc.getElementsByTagName("pool")[0];
}

function getStorageVolumeElem(poolXml) {
    let parser = new DOMParser();
    const xmlDoc = parser.parseFromString(poolXml, 'application/xml');
    if (!xmlDoc) {
        console.warn(`Can't parse dumpxml, input: "${poolXml}"`);
        return;
    }
    return xmlDoc.getElementsByTagName('volume')[0];
}

export function getSingleOptionalElem(parent, name) {
    const subElems = parent.getElementsByTagName(name);
    return subElems.length > 0 ? subElems[0] : undefined; // optional
}

export function parseDumpxml(dispatch, connectionName, domXml, id_overwrite) {
    const domainElem = getDomainElem(domXml);
    if (!domainElem) {
        return;
    }

    const osElem = domainElem.getElementsByTagNameNS("", "os")[0];
    const currentMemoryElem = domainElem.getElementsByTagName("currentMemory")[0];
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

    const currentMemoryUnit = currentMemoryElem.getAttribute("unit");
    const currentMemory = convertToUnit(currentMemoryElem.childNodes[0].nodeValue, currentMemoryUnit, units.KiB);

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
        arch,
        currentMemory,
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
    let osBoot = [];

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

    const cpuMode = cpuElem.getAttribute('mode');
    let cpuModel = '';
    if (cpuMode && cpuMode === 'custom') {
        const modelElem = getSingleOptionalElem(cpuElem, 'model');
        if (modelElem) {
            cpuModel = modelElem.childNodes[0].nodeValue; // content of the domain/cpu/model element
        }
    }

    cpu.model = rephraseUI('cpuMode', cpuMode) + (cpuModel ? ` (${cpuModel})` : '');
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
                    volume: sourceElem ? sourceElem.getAttribute('volume') : undefined,
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
                model: modelElem.getAttribute('type'), // Device model
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

export function parseNetDumpxml(netXml) {
    let retObj = {};
    const netElem = getNetworkElem(netXml);
    if (!netElem) {
        return;
    }

    const forwardElem = netElem.getElementsByTagName("forward")[0];
    const bridgeElem = netElem.getElementsByTagName("bridge")[0];

    if (bridgeElem)
        retObj.bridge = { "name": bridgeElem.getAttribute("name") };

    const ipElems = netElem.getElementsByTagName("ip");
    retObj.ip = parseNetDumpxmlForIp(ipElems);

    const mtuElem = netElem.getElementsByTagName("mtu")[0];
    retObj.mtu = mtuElem ? mtuElem.getAttribute("size") : undefined;

    // if mode is not specified, "nat" is assumed, see https://libvirt.org/formatnetwork.html#elementsConnect
    if (forwardElem) {
        let ifaceElem = forwardElem.getElementsByTagName("interface")[0];
        if (ifaceElem)
            retObj.interface = { "interface": { "dev": ifaceElem.getAttribute("dev") } };

        retObj.forward = { "mode": (forwardElem.getAttribute("mode") || "nat") };
    }

    return retObj;
}

function parseNetDumpxmlForIp(ipElems) {
    let ip = [];

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
        let dhcpHosts = [];
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
                bootp = { 'file': bootpElem.getAttribute("file") };
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
    const deviceElem = getNodeDeviceElem(nodeDevice);
    if (!deviceElem) {
        return;
    }

    const name = deviceElem.getElementsByTagName("name")[0].childNodes[0].nodeValue;
    const capabilityElem = deviceElem.getElementsByTagName("capability")[0];

    let capability = {};
    let path = {};

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
    const osColumnsNames = ['id', 'shortId', 'name', 'version', 'family', 'vendor', 'releaseDate', 'eolDate', 'codename'];
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

export function parseStoragePoolDumpxml(connectionName, storagePoolXml, id_overwrite) {
    const storagePoolElem = getStoragePoolElem(storagePoolXml);
    if (!storagePoolElem) {
        return;
    }

    let result = { connectionName };
    result['type'] = storagePoolElem.getAttribute('type');
    result['name'] = storagePoolElem.getElementsByTagName('name')[0].childNodes[0].nodeValue;
    result['id'] = id_overwrite || storagePoolElem.getElementsByTagName('uuid')[0].childNodes[0].nodeValue;

    // Fetch path property if target is contained for this type of pool
    if (['dir', 'fs', 'netfs', 'logical', 'disk', 'iscsi', 'scsi', 'mpath', 'zfs'].indexOf(result.type) > -1) {
        const targetElem = storagePoolElem.getElementsByTagName('target')[0];
        result['target'] = { 'path': getSingleOptionalElem(targetElem, 'path').childNodes[0].nodeValue };
    }
    const sourceElem = storagePoolElem.getElementsByTagName('source')[0];
    if (sourceElem) {
        result['source'] = {};

        const hostElem = sourceElem.getElementsByTagName('host');
        if (hostElem[0])
            result['source']['host'] = { 'name': hostElem[0].getAttribute('name') };

        const deviceElem = sourceElem.getElementsByTagName('device');
        if (deviceElem[0])
            result['source']['device'] = { 'path': deviceElem[0].getAttribute('path') };

        const dirElem = sourceElem.getElementsByTagName('dir');
        if (dirElem[0])
            result['source']['dir'] = { 'path': dirElem[0].getAttribute('path') };
    }

    return result;
}

export function parseStorageVolumeDumpxml(connectionName, storageVolumeXml, id_overwrite) {
    const storageVolumeElem = getStorageVolumeElem(storageVolumeXml);
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
    const format = formatElem.getAttribute('type');
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

export function resolveUiState(dispatch, name) {
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

export function unknownConnectionName(action, libvirtServiceName) {
    return dispatch => {
        return cockpit.user().done(loggedUser => {
            const promises = Object.getOwnPropertyNames(VMS_CONFIG.Virsh.connections)
                    .filter(
                        // The 'root' user does not have its own qemu:///session just qemu:///system
                        // https://bugzilla.redhat.com/show_bug.cgi?id=1045069
                        connectionName => canLoggedUserConnectSession(connectionName, loggedUser))
                    .map(connectionName => dispatch(action(connectionName, libvirtServiceName)));

            // We can't use Promise.all() here until cockpit is able to dispatch es2015 promises
            // https://github.com/cockpit-project/cockpit/issues/10956
            // eslint-disable-next-line cockpit/no-cockpit-all
            return cockpit.all(promises);
        });
    };
}

export function updateBootOrder(domXml, devices) {
    const domainElem = getDomainElem(domXml);
    if (!domainElem)
        throw new Error("updateBootOrder: domXML has no domain element");

    let deviceElem = domainElem.getElementsByTagName("devices")[0];
    let disks = deviceElem.getElementsByTagName("disk");
    let interfaces = deviceElem.getElementsByTagName("interface");
    let hostdevs = deviceElem.getElementsByTagName("hostdev");
    let redirdevs = deviceElem.getElementsByTagName("redirdev");

    if (devices) {
        // only boot option in devices shall be used, boot options in OS therefore has to be removed
        let osBootElems = domainElem.getElementsByTagName("os")[0].getElementsByTagName("boot");
        while (osBootElems.length)
            osBootElems[0].remove();
    }

    // Update Disks
    for (let i = 0; i < disks.length; i++) {
        const disk = disks[i];
        const target = disk.getElementsByTagName("target")[0].getAttribute("dev");
        const index = devices.findIndex(t => t.device.target === target);

        let bootElem = getSingleOptionalElem(disk, "boot");
        if (index >= 0) { // it will have bootorder
            if (!bootElem) {
                bootElem = document.createElement("boot");
                disk.appendChild(bootElem);
            }
            bootElem.setAttribute("order", index + 1);
        } else {
            if (bootElem) // it's has boot order, but it's ought to not have one, so we delete it
                bootElem.remove();
        }
    }

    // Update interfaces
    for (let i = 0; i < interfaces.length; i++) {
        const iface = interfaces[i];
        const mac = iface.getElementsByTagName("mac")[0].getAttribute("address");
        const index = devices.findIndex(t => t.device.mac === mac);

        let bootElem = getSingleOptionalElem(iface, "boot");
        if (index >= 0) { // it will have bootorder
            if (!bootElem) {
                bootElem = document.createElement("boot");
                iface.appendChild(bootElem);
            }
            bootElem.setAttribute("order", index + 1);
        } else {
            if (bootElem) // it's has boot order, but it's ought to not have one, so we delete it
                bootElem.remove();
        }
    }

    // Update redirected devices
    for (let i = 0; i < redirdevs.length; i++) {
        const redirdev = redirdevs[i];
        const port = redirdev.getElementsByTagName("address")[0].getAttribute("port");
        const index = devices.findIndex(t => {
            if (t.device.address)
                return t.device.address.port === port;
        });

        let bootElem = getSingleOptionalElem(redirdev, "boot");
        if (index >= 0) { // it will have bootorder
            if (!bootElem) {
                bootElem = document.createElement("boot");
                redirdev.appendChild(bootElem);
            }
            bootElem.setAttribute("order", index + 1);
        } else {
            if (bootElem) // it's has boot order, but it's ought to not have one, so we delete it
                bootElem.remove();
        }
    }

    // Update host devices
    for (let i = 0; i < hostdevs.length; i++) {
        const hostdev = hostdevs[i];
        const type = hostdev.getAttribute("type");
        const sourceElem = hostdev.getElementsByTagName("source")[0];
        let bootElem = getSingleOptionalElem(hostdev, "boot");
        let index;

        if (type === "usb") {
            const vendorElem = getSingleOptionalElem(sourceElem, "vendor");
            const productElem = getSingleOptionalElem(sourceElem, "product");
            const addressElem = getSingleOptionalElem(hostdev, "address");

            if (vendorElem && productElem) {
                const vendorId = vendorElem.getAttribute('id');
                const productId = productElem.getAttribute('id');

                index = devices.findIndex(t => {
                    if (t.device.source.vendor && t.device.source.product)
                        return t.device.source.vendor.id === vendorId && t.device.source.product.id === productId;
                    else
                        return false;
                });
            } else if (addressElem) {
                const port = addressElem.getAttribute('port');

                index = devices.findIndex(t => {
                    if (t.device.source.address)
                        return t.device.address.port === port;
                    else
                        return false;
                });
            }
        } else if (type === "pci") {
            const addressElem = hostdev.getElementsByTagName("address")[0];

            const domain = addressElem.getAttribute('domain');
            const bus = addressElem.getAttribute('bus');
            const slot = addressElem.getAttribute('slot');
            const func = addressElem.getAttribute('function');

            index = devices.findIndex(t => {
                if (t.device.source.address)
                    return t.device.source.address.domain === domain &&
                           t.device.source.address.bus === bus &&
                           t.device.source.address.slot === slot &&
                           t.device.source.address.func === func;
                else
                    return false;
            });
        } else if (type === "scsi") {
            const addressElem = getSingleOptionalElem(sourceElem, "address");
            const adapterElem = getSingleOptionalElem(sourceElem, "adapter");

            const protocol = addressElem.getAttribute('protocol');
            const name = addressElem.getAttribute('name');

            if (addressElem && adapterElem) {
                const bus = addressElem.getAttribute('bus');
                const target = addressElem.getAttribute('target');
                const unit = addressElem.getAttribute('unit');
                const adapterName = adapterElem.getAttribute('name');

                index = devices.findIndex(t => {
                    if (t.device.source.address && t.device.source.adapter)
                        return t.device.source.address.bus === bus &&
                               t.device.source.address.target === target &&
                               t.device.source.address.unit === unit &&
                               t.device.source.adapter.adapterName === adapterName;
                    else
                        return false;
                });
            } else if (protocol && name) {
                index = devices.findIndex(t => {
                    if (t.device.source.address)
                        return t.device.source.protocol === protocol &&
                               t.device.source.name === name;
                    else
                        return false;
                });
            }
        } else if (type === "scsi_host") {
            const wwpn = sourceElem.getAttribute('wwpn');
            const protocol = sourceElem.getAttribute('protocol');

            index = devices.findIndex(t => t.device.source.wwpn === wwpn &&
                                           t.device.source.protocol === protocol);
        } else if (type === "mdev") {
            const addressElem = hostdev.getElementsByTagName("address")[0];
            const uuid = addressElem.getAttribute('uuid');

            index = devices.findIndex(t => {
                if (t.device.source.address)
                    return t.device.source.address.uuid === uuid;
                else
                    return false;
            });
        }

        if (index >= 0) { // it will have bootorder
            if (!bootElem) {
                bootElem = document.createElement("boot");
                hostdev.appendChild(bootElem);
            }
            bootElem.setAttribute("order", index + 1);
        } else {
            if (bootElem) // it's has boot order, but it's ought to not have one, so we delete it
                bootElem.remove();
        }
    }

    const tmp = document.createElement("div");

    tmp.appendChild(domainElem);

    return tmp.innerHTML;
}

export function updateVCPUSettings(domXml, count, max, sockets, cores, threads) {
    const domainElem = getDomainElem(domXml);
    if (!domainElem)
        throw new Error("updateVCPUSettings: domXML has no domain element");

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

    return tmp.innerHTML;
}

/*
 * Start of Common Provider function declarations.
 * The order should be kept alphabetical in this section.
 */

export let canConsole = (vmState) => vmState == 'running';
export let canDelete = (vmState, vmId, providerState) => true;
export let canInstall = (vmState, hasInstallPhase) => vmState != 'running' && hasInstallPhase;
export let canReset = (vmState) => vmState == 'running' || vmState == 'idle' || vmState == 'paused';
export let canRun = (vmState, hasInstallPhase) => !hasInstallPhase && vmState == 'shut off';
export let canSendNMI = (vmState) => canReset(vmState);
export let canShutdown = (vmState) => canReset(vmState);
export let canPause = (vmState) => vmState == 'running';
export let canResume = (vmState) => vmState == 'paused';
export let isRunning = (vmState) => canReset(vmState);
export let serialConsoleCommand = ({ vm }) => vm.displays['pty'] ? [ 'virsh', ...VMS_CONFIG.Virsh.connections[vm.connectionName].params, 'console', vm.name ] : false;

export function CHECK_LIBVIRT_STATUS({ serviceName }) {
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

export function CREATE_VM({ connectionName, vmName, source, sourceType, os, memorySize, storageSize, startVm }) {
    logDebug(`${this.name}.CREATE_VM(${vmName}):`);
    return dispatch => {
        // shows dummy vm  until we get vm from virsh (cleans up inProgress)
        setVmCreateInProgress(dispatch, vmName, { openConsoleTab: startVm });

        if (startVm) {
            setVmInstallInProgress(dispatch, vmName);
        }

        return cockpit.script(createVmScript, [
            connectionName,
            vmName,
            source,
            sourceType,
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
    return dispatch => python.spawn(getOSListScript, null, { err: "message", environ: ['LC_ALL=en_US.UTF-8'] })
            .then(osList => {
                parseOsInfoList(dispatch, osList);
            })
            .fail((exception, data) => {
                parseOsInfoList(dispatch, '');
                console.error(`get os list returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
            });
}

export function INIT_DATA_RETRIEVAL () {
    logDebug(`${this.name}.INIT_DATA_RETRIEVAL():`);
    return dispatch => {
        dispatch(getOsInfoList());
        dispatch(getLoggedInUser());
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
}

export function INSTALL_VM({ name, vcpus, currentMemory, metadata, disks, displays, connectionName, onAddErrorNotification }) {
    logDebug(`${this.name}.INSTALL_VM(${name}):`);
    return dispatch => {
        // shows dummy vm until we get vm from virsh (cleans up inProgress)
        // vm should be returned even if script fails
        setVmInstallInProgress(dispatch, name);

        return cockpit.script(installVmScript, [
            connectionName,
            name,
            metadata.installSourceType,
            metadata.installSource,
            metadata.osVariant,
            convertToUnit(currentMemory, units.KiB, units.MiB),
            vcpus.count,
            prepareDisksParam(disks),
            prepareDisplaysParam(displays),
        ], { err: "message", environ: ['LC_ALL=C'] })
                .done(() => finishVmInstallInProgress(dispatch, name))
                .fail(ex => {
                    finishVmInstallInProgress(dispatch, name, { openConsoleTab: false });
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
                .done(() => {
                    dispatch(checkLibvirtStatus(serviceName));
                })
                .fail(exception => {
                    console.info(`starting libvirt failed: "${JSON.stringify(exception)}"`);
                });
    };
}
