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

import { gettext as _ } from 'cockpit';
import moment from 'moment';

import { getValueOrDefault } from './utils.jsx';
import { EMPTY_LABEL, NODE_LABEL, VMI_CREATED_BY_LABEL, VM_KIND } from './constants.es6';
import type { Vm, Vmi } from './types.jsx';

/**
 * Returns pod corresponding to the given vmi.
 */
export function getPod (vmi: Vmi, pods) {
    if (!vmi || !pods) {
        return null;
    }

    const vmiId = vmi.metadata.uid;
    if (!vmiId) {
        return null;
    }

    return pods.find(pod => getValueOrDefault(() => (pod.metadata.annotations[VMI_CREATED_BY_LABEL])) === vmiId);
}

export function getEntityTitle (entity) {
    return entity ? `${getValueOrDefault(() => entity.metadata.namespace, '')}:${getValueOrDefault(() => entity.metadata.name, '')}` : null;
}

export function getMemory (vm: Vm | Vmi) {
    if (vm.kind === VM_KIND) {
        vm = vm.spec.template;
    }
    const memory = getValueOrDefault(() => vm.spec.domain.resources.requests.memory, null);

    if (memory !== null) {
        return memory;
    }

    const memoryValue = getValueOrDefault(() => vm.spec.domain.memory.value, null);
    if (memoryValue) {
        const memoryUnit = getValueOrDefault(() => vm.spec.domain.memory.unit, null);
        return `${memoryValue} ${memoryUnit}`;
    }

    return _("Not Available");
}

export function getCPUs (vm: Vm | Vmi) {
    if (vm.kind === VM_KIND) {
        vm = vm.spec.template;
    }
    return _(getValueOrDefault(() => vm.spec.domain.cpu.cores, 1));
}

// phases description https://github.com/kubevirt/kubevirt/blob/master/pkg/api/v1/types.go
export function getPhase (vmi: Vmi) {
    return getValueOrDefault(() => vmi.status.phase, _("Not Running"));
}

export function getAge (vmi: Vm | Vmi) {
    const createTime = getValueOrDefault(() => (vmi.metadata.creationTimestamp));
    if (!createTime) {
        return EMPTY_LABEL;
    }

    return moment(createTime).fromNow();
}

/**
 * Returns pod metrics corresponding to the given vmi.
 */
export function getPodMetrics (pod, nodeMetrics) {
    const node = getValueOrDefault(() => nodeMetrics[pod.spec.nodeName], null);
    if (!node) {
        return null;
    }

    const podUid = pod.metadata.uid;
    if (!podUid) {
        return null;
    }

    return node.pods.find(pod => pod.podRef.uid === podUid);
}

export function getNodeName (vmi: Vmi) {
    return getValueOrDefault(() => vmi.metadata.labels[NODE_LABEL], null);
}
