import cockpit from 'cockpit';
import service from '../lib/service.js';
import createVmScript from 'raw!./scripts/create_machine.sh';
import installVmScript from 'raw!./scripts/install_machine.sh';
import getOSListScript from 'raw!./scripts/get_os_list.sh';
import getLibvirtServiceNameScript from 'raw!./scripts/get_libvirt_service_name.sh';

import {
    vmActionFailed,
    updateLibvirtState,
    updateOrAddVm,
    updateOsInfoList,
} from './actions/store-actions.es6';

import {
    checkLibvirtStatus,
    getAllVms,
    getHypervisorMaxVCPU,
    getOsInfoList
} from './actions/provider-actions.es6';

import {
    convertToUnit,
    logDebug,
    fileDownload,
    rephraseUI,
    units,
} from './helpers.es6';

import {
    prepareDisksParam,
    prepareDisplaysParam,
} from './libvirtUtils.es6';

import {
    finishVmCreateInProgress,
    finishVmInstallInProgress,
    removeVmCreateInProgress,
    setVmCreateInProgress,
    setVmInstallInProgress,
    clearVmUiState,
} from './components/create-vm-dialog/uiState.es6';

import store from './store.es6';
import VMS_CONFIG from './config.es6';

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

export function getSingleOptionalElem(parent, name) {
    const subElems = parent.getElementsByTagName(name);
    return subElems.length > 0 ? subElems[0] : undefined; // optional
}

export function parseDumpxml(dispatch, connectionName, domXml, id_overwrite) {
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
    const id = id_overwrite || domainElem.getElementsByTagName("uuid")[0].childNodes[0].nodeValue;
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

export function parseDumpxmlMachinesMetadataElement(metadataElem, name) {
    if (!metadataElem) {
        return null;
    }
    const subElems = metadataElem.getElementsByTagNameNS(METADATA_NAMESPACE, name);

    return subElems.length > 0 ? subElems[0].textContent : null;
}

export function parseOsInfoList(dispatch, osList) {
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

            return cockpit.all(promises);
        });
    };
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

export function CREATE_VM({ vmName, source, os, memorySize, storageSize, startVm }) {
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

export function GET_OS_INFO_LIST () {
    logDebug(`${this.name}.GET_OS_INFO_LIST():`);
    return dispatch => cockpit.script(getOSListScript, null, { err: "message", environ: ['LC_ALL=en_US.UTF-8'] })
            .then(osList => {
                parseOsInfoList(dispatch, osList);
            })
            .fail((exception, data) => {
                console.error(`get os list returned error: "${JSON.stringify(exception)}", data: "${JSON.stringify(data)}"`);
            });
}

export function INIT_DATA_RETRIEVAL () {
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
}

export function INSTALL_VM({ name, vcpus, currentMemory, metadata, disks, displays, connectionName }) {
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
