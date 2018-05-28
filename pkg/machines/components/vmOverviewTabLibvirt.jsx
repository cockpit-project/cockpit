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
import VmLastMessage from './vmLastMessage.jsx';

import { rephraseUI, vmId } from "../helpers.es6";

const _ = cockpit.gettext;

function getBootOrder(vm) {
    let bootOrder = _("No boot device found");
    if (vm.bootOrder && vm.bootOrder.devices && vm.bootOrder.devices.length > 0) {
        bootOrder = vm.bootOrder.devices.map(bootDevice => bootDevice.type).join(); // Example: network,disk,disk
    }

    return bootOrder;
}

const VmOverviewTabLibvirt = ({ vm, config, dispatch }) => {
    const idPrefix = vmId(vm.name);
    const message = (<VmLastMessage vm={vm} dispatch={dispatch} />);

    const handleOpenModal = function () {
        config.provider.openVCPUModal(
            {
                vm,
                dispatch,
                config,
            },
            config.providerState
        );
    };

    const memoryLink = (<a id={`${vmId(vm.name)}-vcpus-count`} data-toggle="modal" data-target={`${vmId(vm.name)}-vcpu-modal`} onClick={handleOpenModal}>{vm.vcpus.count}</a>);

    let items = [
        { title: commonTitles.MEMORY, value: cockpit.format_bytes((vm.currentMemory ? vm.currentMemory : 0) * 1024), idPostfix: 'memory' },
        { title: _("Emulated Machine:"), value: vm.emulatedMachine, idPostfix: 'emulatedmachine' },
        { title: commonTitles.CPUS, value: memoryLink, idPostfix: 'vcpus' },
        { title: _("Boot Order:"), value: getBootOrder(vm), idPostfix: 'bootorder' },
        { title: _("CPU Type:"), value: vm.cpu.model, idPostfix: 'cputype' },
        { title: _("Autostart:"), value: rephraseUI('autostart', vm.autostart), idPostfix: 'autostart' },
    ];

    return (<VmOverviewTab message={message}
                           idPrefix={idPrefix}
                           items={items}
                           extraItems={config.provider.vmOverviewExtra && config.provider.vmOverviewExtra(vm, config.providerState)} />);
};

VmOverviewTabLibvirt.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export default VmOverviewTabLibvirt;
