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
import React from 'react';
import PropTypes from 'prop-types';
import cockpit from 'cockpit';
import { OverlayTrigger, Tooltip } from "patternfly-react";
import { Button } from "@patternfly/react-core";

import { VCPUModal } from './vcpuModal.jsx';
import MemoryModal from './vm/memoryModal.jsx';
import {
    getBootOrderDevices,
    getSortedBootOrderDevices,
    rephraseUI,
    vmId
} from '../helpers.js';
import {
    changeVmAutostart,
    getVm
} from '../actions/provider-actions.js';
import { BootOrderModal } from './vm/bootOrderModal.jsx';
import { FirmwareModal } from './vm/firmwareModal.jsx';
import WarningInactive from './warningInactive.jsx';
import { supportsUefiXml, labelForFirmwarePath } from './vm/helpers.js';
import { getDomainCapabilities } from '../libvirt-dbus.js';

import './overviewTab.css';

const _ = cockpit.gettext;

/**
 * Returns a sorted array of all devices with boot order
 *
 * @param {object} vm
 * @returns {array}
 */
function getBootOrder(vm) {
    let bootOrder = _("No boot device found");
    const devices = getSortedBootOrderDevices(vm).filter(d => d.bootOrder);

    if (devices && devices.length > 0) {
        bootOrder = devices.map(bootDevice => rephraseUI("bootableDisk", bootDevice.type)).join(); // Example: network,disk,disk
    }

    return bootOrder;
}

class VmOverviewTabLibvirt extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            runningVmUpdated: false,
            showVcpuModal: false,
            showBootOrderModal: false,
            showMemoryModal: false,
            showFirmwareModal: false,
        };
        this.openVcpu = this.openVcpu.bind(this);
        this.openMemory = this.openMemory.bind(this);
        this.openBootOrder = this.openBootOrder.bind(this);
        this.openFirmware = this.openFirmware.bind(this);
        this.close = this.close.bind(this);
        this.onAutostartChanged = this.onAutostartChanged.bind(this);
    }

    componentDidMount() {
        if (this.props.config.provider.name == 'LibvirtDBus') {
            getDomainCapabilities(this.props.vm.connectionName)
                    .done(domCaps => {
                        const parser = new DOMParser();
                        const xmlDoc = parser.parseFromString(domCaps, "application/xml");
                        if (!xmlDoc)
                            return;

                        const domainCapabilities = xmlDoc.getElementsByTagName("domainCapabilities")[0];
                        const osElem = domainCapabilities.getElementsByTagName("os") && domainCapabilities.getElementsByTagName("os")[0];
                        const loaderElems = osElem && osElem.getElementsByTagName("loader");

                        this.setState({ loaderElems });
                    })
                    .fail(ex => console.warn("getDomainCapabilities failed"));
        }
    }

    onAutostartChanged() {
        const { dispatch, vm } = this.props;
        const autostart = !vm.autostart;

        dispatch(changeVmAutostart({ vm, autostart }))
                .then(() => {
                    dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                });
    }

    close() {
        this.setState({ showVcpuModal: false, showMemoryModal: false, showBootOrderModal: false, showFirmwareModal: false });
    }

    getOVMFBinariesOnHost(loaderElems) {
        return Array.prototype.map.call(loaderElems, loader => {
            const valueElem = loader.getElementsByTagName('value');

            if (valueElem && valueElem[0].parentNode == loader)
                return valueElem[0].textContent;
        });
    }

    openVcpu() {
        this.setState({ showVcpuModal: true });
    }

    openBootOrder() {
        this.setState({ showBootOrderModal: true });
    }

    openMemory() {
        this.setState({ showMemoryModal: true });
    }

    openFirmware() {
        this.setState({ showFirmwareModal: true });
    }

    render() {
        const bootOrderChanged = () => {
            const activeDevices = getBootOrderDevices(vm);
            const inactiveDevices = getBootOrderDevices(vm.inactiveXML);

            // check if number bootable devices has changed
            if (inactiveDevices.length !== activeDevices.length)
                return true;
            else
                // check if boot order of any device has changed
                return !inactiveDevices.every((element, index) => element.bootOrder === activeDevices[index].bootOrder);
        };

        const { vm, dispatch, config, nodeDevices, libvirtVersion } = this.props;
        const idPrefix = vmId(vm.name);

        const vcpusChanged = (vm.vcpus.count !== vm.inactiveXML.vcpus.count) ||
                             (vm.vcpus.max !== vm.inactiveXML.vcpus.max) ||
                             (vm.cpu.sockets !== vm.inactiveXML.cpu.sockets) ||
                             (vm.cpu.threads !== vm.inactiveXML.cpu.threads) ||
                             (vm.cpu.cores !== vm.inactiveXML.cpu.cores);

        const autostart = (
            <label className='checkbox-inline'>
                <input id={`${idPrefix}-autostart-checkbox`}
                    type="checkbox"
                    disabled={config.provider.name !== "LibvirtDBus"}
                    checked={config.provider.name == "LibvirtDBus" ? vm.autostart : vm.autostart != "disable" }
                    onChange={this.onAutostartChanged} />
                {_("Run when host boots")}
            </label>
        );
        const bootOrder = (
            <div>
                <Button variant="link" isInline isDisabled={config.provider.name !== "LibvirtDBus" || !vm.persistent} id={`${idPrefix}-boot-order`} onClick={this.openBootOrder}>
                    {getBootOrder(vm)}
                </Button>
                { vm.persistent && vm.state === "running" && bootOrderChanged() && <WarningInactive iconId="boot-order-tooltip" tooltipId="tip-boot-order" /> }
            </div>
        );
        const memoryLink = (
            <div>
                <Button variant="link" isInline isDisabled={config.provider.name !== "LibvirtDBus" || !vm.persistent} id={`${idPrefix}-memory-count`} onClick={this.openMemory}>
                    {cockpit.format_bytes(vm.currentMemory * 1024)}
                </Button>
            </div>
        );
        const vcpuLink = (
            <div>
                { <Button variant="link" isInline isDisabled={!vm.persistent} id={`${idPrefix}-vcpus-count`} onClick={this.openVcpu}>{vm.vcpus.count}</Button> }
                { vm.persistent && vm.state === "running" && vcpusChanged && <WarningInactive iconId="vcpus-tooltip" tooltipId="tip-vcpus" /> }
            </div>
        );

        let firmwareLinkWrapper;
        // <os firmware=[bios/efi]' settings is available only for libvirt version >= 5.2. Before that version it silently ignores this attribute in the XML
        if (config.provider.name == 'LibvirtDBus' && this.state.loaderElems && libvirtVersion >= 5002000) {
            const hasInstallPhase = vm.metadata.hasInstallPhase;
            const labelForFirmware = labelForFirmwarePath(vm.loader, vm.arch);
            let currentFirmware;
            if (vm.firmware || labelForFirmware == "efi")
                currentFirmware = "UEFI";
            else if (labelForFirmware == "custom")
                currentFirmware = cockpit.format(_("Custom firmware: $0"), vm.loader);
            else if (labelForFirmware == "unknown")
                currentFirmware = _("Unknown firmware");
            else
                currentFirmware = "BIOS";

            /* If the VM hasn't an install phase then don't show a link, just the text  */
            if (!config.provider.canInstall(vm.state, hasInstallPhase)) {
                firmwareLinkWrapper = <div id={`${idPrefix}-firmware`}>{currentFirmware}</div>;
            } else {
                const uefiPaths = this.getOVMFBinariesOnHost(this.state.loaderElems).filter(elem => elem !== undefined);
                const firmwareLink = disabled => {
                    return (
                        <div id={`${idPrefix}-firmware-tooltip`}>
                            <Button variant="link" isInline id={`${idPrefix}-firmware`} isDisabled={disabled} onClick={this.openFirmware}>
                                {currentFirmware}
                            </Button>
                        </div>
                    );
                };

                if (vm.state != "shut off") {
                    if (vm.persistent) {
                        firmwareLinkWrapper = (
                            <OverlayTrigger overlay={ <Tooltip id='firmware-edit-disabled-on-running'>{ _("Shut off the VM in order to edit firmware configuration") }</Tooltip> } placement='top'>
                                {firmwareLink(true)}
                            </OverlayTrigger>
                        );
                    } else {
                        firmwareLinkWrapper = (
                            <OverlayTrigger overlay={ <Tooltip id='firmware-edit-disabled-on-transient'>{ _("Transient VMs don't support editting firmware configuration") }</Tooltip> } placement='top'>
                                {firmwareLink(true)}
                            </OverlayTrigger>
                        );
                    }
                } else if (!supportsUefiXml(this.state.loaderElems[0])) {
                    firmwareLinkWrapper = (
                        <OverlayTrigger overlay={ <Tooltip id='missing-uefi-support'>{ _("Libvirt or hypervisor does not support UEFI") }</Tooltip> } placement='top'>
                            {firmwareLink(true)}
                        </OverlayTrigger>
                    );
                } else if (uefiPaths.length == 0) {
                    firmwareLinkWrapper = (
                        <OverlayTrigger overlay={ <Tooltip id='missing-uefi-images'>{ _("Libvirt did not detect any UEFI/OVMF firmware image installed on the host") }</Tooltip> } placement='top'>
                            {firmwareLink(true)}
                        </OverlayTrigger>
                    );
                } else {
                    firmwareLinkWrapper = firmwareLink(false);
                }
            }
        }

        return (
            <>
                <div className="overview-tab-grid">
                    <div className='ct-form'>
                        <label className='control-label label-title'> {_("General")} </label>
                        <span />
                        <label className='control-label' htmlFor={`${idPrefix}-memory-count`}>{_("Memory")}</label>
                        {memoryLink}
                        <label className='control-label' htmlFor={`${idPrefix}-vcpus-count`}>{_("vCPUs")}</label>
                        {vcpuLink}
                        <label className='control-label' htmlFor={`${idPrefix}-cpu-model`}>{_("CPU Type")}</label>
                        <div id={`${idPrefix}-cpu-model`}>{vm.cpu.model}</div>
                        <label className='control-label' htmlFor={`${idPrefix}-boot-order`}>{_("Boot Order")}</label>
                        {bootOrder}
                        {vm.persistent && <>
                            <label className='control-label' htmlFor={`${idPrefix}-autostart-checkbox`}>{_("Autostart")}</label>
                            {autostart}
                        </>}
                    </div>
                    <div className="ct-form">
                        <label className='control-label label-title'> {_("Hypervisor Details")} </label>
                        <span />
                        <label className='control-label' htmlFor={`${idPrefix}-emulated-machine`}>{_("Emulated Machine")}</label>
                        <div id={`${idPrefix}-emulated-machine`}>{vm.emulatedMachine}</div>
                        {firmwareLinkWrapper ? <label className='control-label' htmlFor={`${idPrefix}-firmware`}>{_("Firmware")}</label> : null}
                        {firmwareLinkWrapper}
                    </div>
                </div>
                { this.state.showBootOrderModal && <BootOrderModal close={this.close} vm={vm} dispatch={dispatch} nodeDevices={nodeDevices} /> }
                { this.state.showMemoryModal && <MemoryModal close={this.close} vm={vm} dispatch={dispatch} config={config} /> }
                { this.state.showFirmwareModal && <FirmwareModal close={this.close} connectionName={vm.connectionName} vmId={vm.id} firmware={vm.firmware} /> }
                { this.state.showVcpuModal && <VCPUModal close={this.close} vm={vm} dispatch={dispatch} config={config} /> }
            </>
        );
    }
}

VmOverviewTabLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    libvirtVersion: PropTypes.number.isRequired,
    dispatch: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default VmOverviewTabLibvirt;
