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
import { virt } from '../machines/provider.js';

export function suspendVm({ id, name, connectionName }) {
    return virt('SUSPEND_VM', { id, name, connectionName });
}

export function migrateVm (vmId, vmName, hostId) {
    return virt('MIGRATE_VM', { vmId, vmName, hostId });
}

export function pollOvirtAction() {
    return virt('POLL_OVIRT', { });
}

export function downloadIcons ({ iconIds, forceReload }) {
    return virt('DOWNLOAD_ICONS', { iconIds, forceReload });
}

export function downloadIcon ({ iconId }) {
    return virt('DOWNLOAD_ICON', { iconId });
}

export function startVm(vm, hostName) { // matches action creator in ../machines/actions.js
    return virt('START_VM', { name: vm.name, id: vm.id, connectionName: vm.connectionName, hostName });
}

export function createVmFromTemplate ({ templateName, clusterName, vm }) {
    return virt('CREATE_VM_FROM_TEMPLATE', { templateName, clusterName, vm });
}

export function switchHostToMaintenance ({ hostId }) {
    return virt('HOST_TO_MAINTENANCE', { hostId });
}

export function updateHost(host) {
    return {
        type: 'OVIRT_UPDATE_HOST',
        payload: host
    };
}

export function removeHost(id) {
    return {
        type: 'OVIRT_REMOVE_HOST',
        payload: {
            id,
        }
    };
}

export function updateVm(vm) {
    return {
        type: 'OVIRT_UPDATE_VM',
        payload: vm
    };
}

export function removeVm(id) {
    return {
        type: 'OVIRT_REMOVE_VM',
        payload: {
            id,
        }
    };
}

export function updateTemplate(template) {
    return {
        type: 'OVIRT_UPDATE_TEMPLATE',
        payload: template
    };
}

export function removeTemplate(id) {
    return {
        type: 'OVIRT_REMOVE_TEMPLATE',
        payload: {
            id,
        }
    };
}

export function updateCluster(cluster) {
    return {
        type: 'OVIRT_UPDATE_CLUSTER',
        payload: cluster
    };
}

export function removeCluster(id) {
    return {
        type: 'OVIRT_REMOVE_CLUSTER',
        payload: {
            id,
        }
    };
}

export function updateIcon(icon) {
    return {
        type: 'OVIRT_UPDATE_ICON',
        payload: icon
    };
}

export function loginInProgress(isInProgress) {
    return {
        type: 'OVIRT_LOGIN_IN_PROGRESS',
        payload: {
            loginInProgress: isInProgress
        }
    };
}

export function goToSubpage (target) {
    return {
        type: 'OVIRT_GOTO_SUBPAGE',
        payload: {
            target,
        },
    };
}

export function setHostname(hostname) {
    return {
        type: 'OVIRT_SET_HOSTNAME',
        payload: {
            hostname,
        }
    };
}

export function setHostIPs(ips) {
    return {
        type: 'OVIRT_SET_HOST_IPS',
        payload: {
            ips,
        }
    };
}

export function vmActionFailed({ name, connectionName, message, detail, extraPayload, tab = 'overview' }) {
    return {
        type: 'VM_ACTION_FAILED',
        payload: {
            name,
            connectionName,
            message,
            detail,
            extraPayload,
            tab,
        },
    };
}
