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
import {
    Button, Text, TextVariants, Tooltip,
    DescriptionList, DescriptionListGroup, DescriptionListTerm, DescriptionListDescription,
    Flex, FlexItem
} from "@patternfly/react-core";

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
import { StateIcon } from './vm/stateIcon.jsx';
import LibvirtDBus, { getDomainCapabilities } from '../libvirt-dbus.js';
import { getDomainCapLoader, getDomainCapMaxVCPU } from '../libvirt-common.js';

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

    componentWillUnmount() {
        this._isMounted = false;
    }

    componentDidMount() {
        this._isMounted = true;
        getDomainCapabilities(this.props.vm.connectionName, this.props.vm.arch, this.props.vm.emulatedMachine)
                .done(domCaps => {
                    const loaderElems = getDomainCapLoader(domCaps);
                    const maxVcpu = getDomainCapMaxVCPU(domCaps);

                    if (this._isMounted)
                        this.setState({ loaderElems, maxVcpu: Number(maxVcpu) });
                })
                .fail(() => console.warn("getDomainCapabilities failed"));
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
            <DescriptionListDescription>
                <label className='checkbox-inline'>
                    <input id={`${idPrefix}-autostart-checkbox`}
                        type="checkbox"
                        checked={vm.autostart}
                        onChange={this.onAutostartChanged} />
                    {_("Run when host boots")}
                </label>
            </DescriptionListDescription>
        );
        const bootOrder = (
            <DescriptionListDescription>
                <Button variant="link" isInline isDisabled={!vm.persistent} id={`${idPrefix}-boot-order`} onClick={this.openBootOrder}>
                    {getBootOrder(vm)}
                </Button>
                { vm.persistent && vm.state === "running" && bootOrderChanged() && <WarningInactive iconId="boot-order-tooltip" tooltipId="tip-boot-order" /> }
            </DescriptionListDescription>
        );
        const memoryLink = (
            <DescriptionListDescription>
                <Button variant="link" isInline isDisabled={!vm.persistent} id={`${idPrefix}-memory-count`} onClick={this.openMemory}>
                    {cockpit.format_bytes(vm.currentMemory * 1024)}
                </Button>
            </DescriptionListDescription>
        );
        const vcpuLink = (
            <DescriptionListDescription>
                { <Button variant="link" isInline isDisabled={!vm.persistent} id={`${idPrefix}-vcpus-count`} onClick={this.openVcpu}>{vm.vcpus.count}</Button> }
                { vm.persistent && vm.state === "running" && vcpusChanged && <WarningInactive iconId="vcpus-tooltip" tooltipId="tip-vcpus" /> }
            </DescriptionListDescription>
        );

        let firmwareLinkWrapper;
        // <os firmware=[bios/efi]' settings is available only for libvirt version >= 5.2. Before that version it silently ignores this attribute in the XML
        if (this.state.loaderElems && libvirtVersion >= 5002000) {
            const hasInstallPhase = vm.metadata && vm.metadata.hasInstallPhase;
            const labelForFirmware = labelForFirmwarePath(vm.loader, vm.arch);
            let currentFirmware;
            if (vm.firmware == "efi" || labelForFirmware == "efi")
                currentFirmware = "UEFI";
            else if (labelForFirmware == "custom")
                currentFirmware = cockpit.format(_("Custom firmware: $0"), vm.loader);
            else if (labelForFirmware == "unknown")
                currentFirmware = _("Unknown firmware");
            else
                currentFirmware = "BIOS";

            /* If the VM hasn't an install phase then don't show a link, just the text  */
            if (!LibvirtDBus.canInstall(vm.state, hasInstallPhase)) {
                firmwareLinkWrapper = <div id={`${idPrefix}-firmware`}>{currentFirmware}</div>;
            } else {
                const uefiPaths = this.getOVMFBinariesOnHost(this.state.loaderElems).filter(elem => elem !== undefined);
                const firmwareLink = disabled => {
                    return (
                        <span id={`${idPrefix}-firmware-tooltip`}>
                            <Button variant="link" isInline id={`${idPrefix}-firmware`} isDisabled={disabled} onClick={this.openFirmware}>
                                {currentFirmware}
                            </Button>
                        </span>
                    );
                };

                if (vm.state != "shut off") {
                    if (vm.persistent) {
                        firmwareLinkWrapper = (
                            <Tooltip id='firmware-edit-disabled-on-running' content={_("Shut off the VM in order to edit firmware configuration")}>
                                {firmwareLink(true)}
                            </Tooltip>
                        );
                    } else {
                        firmwareLinkWrapper = (
                            <Tooltip id='firmware-edit-disabled-on-transient' content={_("Transient VMs don't support editing firmware configuration")}>
                                {firmwareLink(true)}
                            </Tooltip>
                        );
                    }
                } else if (!supportsUefiXml(this.state.loaderElems[0])) {
                    firmwareLinkWrapper = (
                        <Tooltip id='missing-uefi-support' content={_("Libvirt or hypervisor does not support UEFI")}>
                            {firmwareLink(true)}
                        </Tooltip>
                    );
                } else if (uefiPaths.length == 0) {
                    firmwareLinkWrapper = (
                        <Tooltip id='missing-uefi-images' content={_("Libvirt did not detect any UEFI/OVMF firmware image installed on the host")}>
                            {firmwareLink(true)}
                        </Tooltip>
                    );
                } else {
                    firmwareLinkWrapper = firmwareLink(false);
                }
            }
        }

        return (
            <>
                <Flex className="overview-tab" direction={{ default:"column", "2xl": "row" }}>
                    <FlexItem>
                        <DescriptionList>
                            <Text component={TextVariants.h4}>
                                {_("General")}
                            </Text>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("State")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    <StateIcon state={vm.state} valueId={`${idPrefix}-state`} showIcon />
                                </DescriptionListDescription>
                            </DescriptionListGroup>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Memory")}</DescriptionListTerm>
                                {memoryLink}
                            </DescriptionListGroup>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("vCPUs")}</DescriptionListTerm>
                                {vcpuLink}
                            </DescriptionListGroup>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("CPU type")}</DescriptionListTerm>
                                <DescriptionListDescription id={`${idPrefix}-cpu-model`}>{vm.cpu.model}</DescriptionListDescription>
                            </DescriptionListGroup>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Boot order")}</DescriptionListTerm>
                                {bootOrder}
                            </DescriptionListGroup>

                            {vm.persistent && <DescriptionListGroup>
                                <DescriptionListTerm>{_("Autostart")}</DescriptionListTerm>
                                {autostart}
                            </DescriptionListGroup>}
                        </DescriptionList>
                    </FlexItem>
                    <FlexItem>
                        <DescriptionList>
                            <Text component={TextVariants.h4}>
                                {_("Hypervisor details")}
                            </Text>

                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Emulated machine")}</DescriptionListTerm>
                                <DescriptionListDescription id={`${idPrefix}-emulated-machine`}>{vm.emulatedMachine}</DescriptionListDescription>
                            </DescriptionListGroup>

                            {firmwareLinkWrapper && <DescriptionListGroup>
                                <DescriptionListTerm>{_("Firmware")}</DescriptionListTerm>
                                {firmwareLinkWrapper}
                            </DescriptionListGroup>}
                        </DescriptionList>
                    </FlexItem>
                </Flex>
                { this.state.showBootOrderModal && <BootOrderModal close={this.close} vm={vm} dispatch={dispatch} nodeDevices={nodeDevices} /> }
                { this.state.showMemoryModal && <MemoryModal close={this.close} vm={vm} dispatch={dispatch} config={config} /> }
                { this.state.showFirmwareModal && <FirmwareModal close={this.close} connectionName={vm.connectionName} vmId={vm.id} firmware={vm.firmware} /> }
                { this.state.showVcpuModal && <VCPUModal close={this.close} vm={vm} dispatch={dispatch} maxVcpu={this.state.maxVcpu} /> }
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
