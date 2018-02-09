/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

// @flow
import React from 'react';
import { gettext as _ } from 'cockpit';

import VmOverviewTab, { commonTitles } from '../../../../machines/components/vmOverviewTab.jsx';

import type { Vm, VmMessages, Pod } from '../types.jsx';
import { getPairs, NODE_LABEL, vmIdPrefx, getValueOrDefault } from '../utils.jsx';

import VmMessage from './VmMessage.jsx';

React;

function getNodeName(vm: Vm) {
    return (vm.metadata.labels && vm.metadata.labels[NODE_LABEL]) || null
}

const getLabels = (vm: Vm) => {
    let labels = null;
    if (vm.metadata.labels) {
        labels = getPairs(vm.metadata.labels).map(pair => {
            const printablePair = `${pair.key}=${pair.value}`;
            return (<div key={printablePair}>{printablePair}</div>)
        })
    }
    return labels;
};

function getMemory(vm: Vm) {
    const memory = getValueOrDefault(() => vm.spec.domain.resources.requests.memory, null);

    if (memory !== null) {
        return memory
    }

    const memoryValue = getValueOrDefault(() => vm.spec.domain.memory.value, null);
    if (memoryValue) {
        const memoryUnit = getValueOrDefault(() => vm.spec.domain.memory.unit, null);
        return `${memoryValue} ${memoryUnit}`;
    }

    return _("Not Available");
}

const PodLink = ({ pod }) => {
    if (!pod || !pod.metadata.namespace || !pod.metadata.name) {
        return null;
    }

    return (<a href={`#/l/pods/${pod.metadata.namespace}/${pod.metadata.name}`}>{pod.metadata.name}</a>);
};

const VmOverviewTabKubevirt = ({ vm, vmMessages, pod }: { vm: Vm, vmMessages: VmMessages, pod: Pod }) => {
    const idPrefix = vmIdPrefx(vm);

    const message = (<VmMessage vmMessages={vmMessages} vm={vm}/>);

    const nodeName = getNodeName(vm);
    const nodeLink = nodeName ? (<a href={`#/nodes/${nodeName}`}>{nodeName}</a>) : '-';
    const podLink = (<PodLink pod={pod}/>);

    const items = [
        {title: commonTitles.MEMORY, value: getMemory(vm), idPostfix: 'memory'},
        {title: _("Node:"), value: nodeLink, idPostfix: 'node'},
        {title: commonTitles.CPUS, value: _(getValueOrDefault(() => vm.spec.domain.cpu.cores, 1)), idPostfix: 'vcpus'},
        {title: _("Labels:"), value: getLabels(vm), idPostfix: 'labels'},
        {title: _("Pod:"), value: podLink, idPostfix: 'pod'},
    ];
    return (<VmOverviewTab message={message}
                           idPrefix={idPrefix}
                           items={items} />);
};

export default VmOverviewTabKubevirt;
