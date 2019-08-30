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

import VmOverviewTab, { commonTitles } from './vmOverviewTab.jsx';
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
import WarningInactive from './warningInactive.jsx';

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
            showMemoryModal: false
        };
        this.openVcpu = this.openVcpu.bind(this);
        this.openMemory = this.openMemory.bind(this);
        this.openBootOrder = this.openBootOrder.bind(this);
        this.close = this.close.bind(this);
        this.onAutostartChanged = this.onAutostartChanged.bind(this);
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
        this.setState({ showVcpuModal: false, showMemoryModal: false, showBootOrderModal: false });
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

        const { vm, dispatch, config, nodeDevices } = this.props;
        const idPrefix = vmId(vm.name);

        const vcpusChanged = (vm.vcpus.count !== vm.inactiveXML.vcpus.count) ||
                             (vm.vcpus.max !== vm.inactiveXML.vcpus.max) ||
                             (vm.cpu.sockets !== vm.inactiveXML.cpu.sockets) ||
                             (vm.cpu.threads !== vm.inactiveXML.cpu.threads) ||
                             (vm.cpu.cores !== vm.inactiveXML.cpu.cores);

        let autostart = rephraseUI('autostart', vm.autostart);
        let bootOrder = getBootOrder(vm);
        let memoryLink = cockpit.format_bytes(vm.currentMemory * 1024);

        if (config.provider.name === "LibvirtDBus") {
            autostart = (
                <label className='checkbox-inline'>
                    <input id={`${idPrefix}-autostart-checkbox`}
                           type="checkbox"
                           checked={vm.autostart}
                           onChange={this.onAutostartChanged} />
                    {_("Run when host boots")}
                </label>
            );

            bootOrder = (
                <div>
                    <a id={`${vmId(vm.name)}-boot-order`} onClick={this.openBootOrder}>
                        {getBootOrder(vm)}
                    </a>
                    { vm.state === "running" && bootOrderChanged() && <WarningInactive iconId="boot-order-tooltip" tooltipId="tip-boot-order" /> }
                </div>
            );

            memoryLink = (
                <a id={`${idPrefix}-memory-count`} onClick={this.openMemory}>
                    {memoryLink}
                </a>
            );
        }
        const vcpuLink = (
            <React.Fragment>
                <a id={`${vmId(vm.name)}-vcpus-count`} onClick={this.openVcpu}>{vm.vcpus.count}</a>
                { vm.state === "running" && vcpusChanged && <WarningInactive iconId="vcpus-tooltip" tooltipId="tip-vcpus" /> }
            </React.Fragment>
        );

        const items = [
            { title: commonTitles.MEMORY, value: memoryLink, idPostfix: 'memory' },
            { title: _("Emulated Machine"), value: vm.emulatedMachine, idPostfix: 'emulatedmachine' },
            { title: commonTitles.CPUS, value: vcpuLink, idPostfix: 'vcpus' },
            { title: _("Boot Order"), value: bootOrder, idPostfix: 'bootorder' },
            { title: _("CPU Type"), value: vm.cpu.model, idPostfix: 'cputype' },
            { title: _("Autostart"), value: autostart, idPostfix: 'autostart' },
        ];

        return (
            <div>
                <VmOverviewTab idPrefix={idPrefix} items={items}
                    extraItems={config.provider.vmOverviewExtra && config.provider.vmOverviewExtra(vm, config.providerState)} />
                { this.state.showVcpuModal && <VCPUModal close={this.close} vm={vm} dispatch={dispatch} config={config} /> }
                { this.state.showBootOrderModal && <BootOrderModal close={this.close} vm={vm} dispatch={dispatch} nodeDevices={nodeDevices} /> }
                { this.state.showMemoryModal && <MemoryModal close={this.close} vm={vm} dispatch={dispatch} config={config} /> }
            </div>
        );
    }
}

VmOverviewTabLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default VmOverviewTabLibvirt;
