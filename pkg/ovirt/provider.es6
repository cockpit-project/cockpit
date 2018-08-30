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
import cockpit from 'cockpit';

import { buildFailHandler } from '../machines/libvirt-common.es6';
import LIBVIRT_PROVIDER from '../machines/libvirt-virsh.es6';
import { logDebug, logError, fileDownload } from '../machines/helpers.es6';
import { readConfiguration } from './configFuncs.es6';
import { CONSOLE_TYPE_ID_MAP } from './config.es6';
import { ovirtApiGet, ovirtApiPost, ovirtApiPut } from './ovirtApiAccess.es6';
import { pollOvirt, forceNextOvirtPoll } from './ovirt.es6';
import { oVirtIconToInternal } from './ovirtConverters.es6';

import { updateIcon, downloadIcon } from './actions.es6';
import { getHypervisorMaxVCPU } from '../machines/actions/provider-actions.es6';

import { getAllIcons, isVmManagedByOvirt } from './selectors.es6';
import { ovirtReducer } from './reducers.es6';

import VmActions from './components/VmActions.jsx';
import vmOverviewExtra from './components/VmOverviewColumn.jsx';
import ConsoleClientResources from './components/ConsoleClientResources.jsx';
import OVirtTab from './components/OVirtTab.jsx';
import VCPUModal from './components/vcpuModal.jsx';

import { waitForReducerSubtreeInit } from './store.es6';

const _ = cockpit.gettext;

const OVIRT_PROVIDER = Object.create(LIBVIRT_PROVIDER); // inherit whatever is not implemented here

const QEMU_SYSTEM = 'system'; // conforms connection name defined in parent's cockpit:machines/config.es6

OVIRT_PROVIDER.name = 'oVirt';
OVIRT_PROVIDER.ovirtApiMetadata = {
    passed: undefined, // check for oVirt API version
}; // will be filled by initialization

OVIRT_PROVIDER.reducer = ovirtReducer;

// --- React extension
OVIRT_PROVIDER.VmActions = VmActions;
OVIRT_PROVIDER.vmOverviewExtra = vmOverviewExtra;
OVIRT_PROVIDER.ConsoleClientResources = ConsoleClientResources;
OVIRT_PROVIDER.vmTabRenderers = [
    {
        name: _("oVirt"),
        idPostfix: 'ovirt',
        component: OVirtTab,
    },
];

OVIRT_PROVIDER.openVCPUModal = (params, providerState) => isVmManagedByOvirt(providerState, params.vm.id) ? VCPUModal(params) : LIBVIRT_PROVIDER.openVCPUModal(params);

// --- enable/disable actions in UI
OVIRT_PROVIDER.canDelete = (vmState, vmId, providerState) =>
    isVmManagedByOvirt(providerState, vmId) ? false : LIBVIRT_PROVIDER.canDelete(vmState, vmId);

/* Use of serial Console is disabled.
  TODO: use ssh to connect to serial console of oVirt-managed VM.
  https://www.ovirt.org/develop/release-management/features/virt/serial-console/
  https://access.redhat.com/documentation/en-us/red_hat_virtualization/4.1/html/virtual_machine_management_guide/sect-starting_the_virtual_machine
*/
OVIRT_PROVIDER.serialConsoleCommand = ({ vm }) => false;

// --- verbs
OVIRT_PROVIDER.init = function ({ dispatch }) {
    logDebug(`Virtual Machines Provider used: ${this.name}`);

    waitForReducerSubtreeInit(() => dispatch(getHypervisorMaxVCPU()));
    return readConfiguration({ dispatch }); // and do oVirt login
};

OVIRT_PROVIDER.POLL_OVIRT = function (payload) {
    return pollOvirt();
};

OVIRT_PROVIDER.SHUTDOWN_VM = function (payload) {
    logDebug(`SHUTDOWN_VM(payload: ${JSON.stringify(payload)})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, redirecting the action to Libvirt');
        return LIBVIRT_PROVIDER.SHUTDOWN_VM(payload);
    }

    const id = payload.id;
    const vmName = payload.name;
    return (dispatch) => {
        forceNextOvirtPoll();
        return ovirtApiPost(
            `vms/${id}/shutdown`,
            '<action><async>false</async></action>',
            buildFailHandler({
                dispatch,
                name: vmName,
                connectionName: payload.connectionName,
                message: _("SHUTDOWN action failed")
            })
        );
    };
};

OVIRT_PROVIDER.FORCEOFF_VM = function (payload) {
    logDebug(`FORCEOFF_VM(payload: ${JSON.stringify(payload)})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, redirecting the action to Libvirt');
        return LIBVIRT_PROVIDER.FORCEOFF_VM(payload);
    }

    const id = payload.id;
    const vmName = payload.name;
    return (dispatch) => {
        forceNextOvirtPoll();
        return ovirtApiPost(
            `vms/${id}/stop`,
            '<action><async>false</async></action>',
            buildFailHandler({
                dispatch,
                name: vmName,
                connectionName: payload.connectionName,
                message: _("SHUTDOWN action failed")
            })
        );
    };
};

OVIRT_PROVIDER.REBOOT_VM = function (payload) {
    logDebug(`REBOOT_VM(payload: ${JSON.stringify(payload)})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, redirecting the action to Libvirt');
        return LIBVIRT_PROVIDER.REBOOT_VM(payload);
    }

    const vmName = payload.name;
    const id = payload.id;
    return (dispatch) => {
        forceNextOvirtPoll();
        return ovirtApiPost(
            `vms/${id}/reboot`,
            '<action><async>false</async></action>',
            buildFailHandler({
                dispatch,
                name: vmName,
                connectionName: payload.connectionName,
                message: _("REBOOT action failed")
            })
        );
    };
};

OVIRT_PROVIDER.FORCEREBOOT_VM = function (payload) {
    logDebug(`FORCEREBOOT_VM(payload: ${JSON.stringify(payload)})`);
    return OVIRT_PROVIDER.REBOOT_VM(payload); // TODO: implement the 'force' - seems like not exposed by oVirt API
};

OVIRT_PROVIDER.START_VM = function (payload) {
    logDebug(`START_VM(payload: ${JSON.stringify(payload)})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, redirecting the action to Libvirt');
        return LIBVIRT_PROVIDER.START_VM(payload);
    }

    const id = payload.id;
    const vmName = payload.name;
    const hostName = payload.hostName; // optional

    const actionXml = hostName
        ? `<action><async>false</async><vm><placement_policy><hosts><host><name>${hostName}</name></host></hosts></placement_policy></vm></action>`
        : '<action><async>false</async></action>';

    return (dispatch) => {
        forceNextOvirtPoll();

        return ovirtApiPost(
            `vms/${id}/start`,
            actionXml,
            buildFailHandler({
                dispatch,
                name: vmName,
                connectionName: payload.connectionName,
                message: _("START action failed")
            })
        );
    };
};

OVIRT_PROVIDER.CREATE_VM_FROM_TEMPLATE = function (payload) {
    logDebug(`CREATE_VM: payload = ${JSON.stringify(payload)}`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, but CREATE_VM action is not supported by the Libvirt provider. Skipping.');
        return () => {};
    }

    const templateName = payload.templateName || 'blank'; // optional
    const clusterName = payload.clusterName || 'default'; // optional
    const { vm } = payload;

    const name = `<name>${vm.name}</name>`;
    const template = `<template><name>${templateName}</name></template>`;
    const cluster = `<cluster><name>${clusterName}</name></cluster>`;
    const action = `<vm>${name}${cluster}${template}</vm>`;

    return (dispatch) => {
        forceNextOvirtPoll();
        return ovirtApiPost(
            `vms`,
            action,
            buildFailHandler({
                dispatch,
                name: vm.name,
                connectionName: QEMU_SYSTEM,
                message: _("CREATE VM action failed"),
                extraPayload: { templateName },
            })
        );
    };
};

OVIRT_PROVIDER.MIGRATE_VM = function ({ vmId, vmName, hostId }) {
    logDebug(`MIGRATE_VM(payload: {vmId: "${vmId}", hostId: "${hostId}"}`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match but the MIGRATE action is not supported by Libvirt provider, skipping');
        return () => {};
    }

    const action = hostId
        ? `<action><async>false</async><host id="${hostId}"/></action>`
        : '<action/>';

    return (dispatch) => {
        forceNextOvirtPoll();
        ovirtApiPost(
            `vms/${vmId}/migrate`,
            action,
            buildFailHandler({
                dispatch,
                name: vmName,
                connectionName: undefined, // TODO: oVirt-only, not implemented for Libvirt
                message: _("MIGRATE action failed")
            })
        );
    };
};

OVIRT_PROVIDER.SUSPEND_VM = function ({ id, name }) {
    logDebug(`SUSPEND_VM(id=${id})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, but SUSPEND_VM action is not supported by the Libvirt provider. Skipping.');
        return () => {};
    }

    return (dispatch) => ovirtApiPost(
        `vms/${id}/suspend`,
        '<action><async>false</async></action>',
        buildFailHandler({
            dispatch,
            name,
            connectionName: undefined, // TODO: oVirt-only, not implemented for Libvirt
            message: _("SUSPEND action failed")
        })).then(data => {
        logDebug('SUSPEND_VM finished', data);
        window.setTimeout(forceNextOvirtPoll, 5000); // hack for better user experience
    }
    );
};

OVIRT_PROVIDER.DOWNLOAD_ICON = function ({ iconId }) {
    logDebug(`DOWNLOAD_ICON(iconId=${iconId})`);
    return (dispatch) => ovirtApiGet(
        `icons/${iconId}`
    ).then(data => {
        const icon = JSON.parse(data);
        if (icon && icon['media_type'] && icon['data']) {
            dispatch(updateIcon(oVirtIconToInternal(icon)));
        }
    });
};

OVIRT_PROVIDER.DOWNLOAD_ICONS = function ({ iconIds, forceReload }) {
    logDebug(`DOWNLOAD_ICONS(forceReload=${forceReload}) called for ${iconIds.length} icon ids`);

    return (dispatch, getState) => {
        const existingIcons = forceReload ? {} : getAllIcons(getState());
        const iconIdsToDownload = Object.getOwnPropertyNames(iconIds).filter(iconId => !existingIcons[iconId]);
        iconIdsToDownload.forEach(iconId => dispatch(downloadIcon({ iconId })));
    };
};

OVIRT_PROVIDER.onConsoleAboutToShow = function ({ type, vm, providerState }) {
    logDebug(`onConsoleAboutToShow(payload: {vmId: "${vm.id}", type: "${type}"}`);
    const vmId = vm.id;
    const orig = vm.displays[type];

    if (!isVmManagedByOvirt(providerState, vmId) || !isOvirtApiCheckPassed()) {
        return cockpit.resolve(orig);
    }

    const consoleDetail = Object.assign({}, orig); // to be updated and returned as a result of promise
    const consoleId = CONSOLE_TYPE_ID_MAP[type];

    return ovirtApiGet(
        `vms/${vmId}/graphicsconsoles/${consoleId}`,
        { Accept: 'application/x-virt-viewer' }
    ).then(vvFile => {
        const password = vvFile.match(/[^\r\n]+/g).filter(line => {
            return line.trim().startsWith('password=');
        });
        if (password) {
            consoleDetail.password = password[0].substring('password='.length);
        }
        return consoleDetail;
    });
};

OVIRT_PROVIDER.CONSOLE_VM = function (payload) { // download a .vv file generated by oVirt
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match, redirecting CONSOLE_VM action to Libvirt');
        return LIBVIRT_PROVIDER.CONSOLE_VM(payload);
    }

    const type = payload.consoleDetail.type; // spice, vnc, rdp
    const vmId = payload.id;

    // console ID is so far considered as a constant in oVirt for particular console type.
    // TODO: cleaner (but slower) approach would be to query 'vms/${vmId}/graphicsconsoles' first to get full list
    const consoleId = CONSOLE_TYPE_ID_MAP[type];
    if (!consoleId) {
        logError(`CONSOLE_VM: unable to map console type to id. Payload: ${JSON.stringify(payload)}`);
        return;
    }

    return (dispatch, getState) => {
        if (!isVmManagedByOvirt(getState().config.providerState, vmId)) {
            logDebug(`CONSOLE_VM: vmId: ${vmId} is not managed by oVirt, redirecting to Libvirt`);
            return LIBVIRT_PROVIDER.CONSOLE_VM(payload)(dispatch, getState);
        }

        logDebug(`CONSOLE_VM: requesting .vv file from oVirt for vmId: ${vmId}, type: ${type}`);
        forceNextOvirtPoll();
        return ovirtApiGet(
            `vms/${vmId}/graphicsconsoles/${consoleId}`,
            { Accept: 'application/x-virt-viewer' }
        ).then(vvFile => {
            fileDownload({
                data: vvFile,
                fileName: `${type}Console.vv`,
                mimeType: 'application/x-virt-viewer'
            });
        });
    };
};

OVIRT_PROVIDER.HOST_TO_MAINTENANCE = function ({ hostId }) {
    logDebug(`HOST_TO_MAINTENANCE(hostId=${hostId})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match but the HOST_TO_MAINTENANCE action is not supported by Libvirt provider, skipping');
        return () => {};
    }

    return (dispatch) => {
        forceNextOvirtPoll();

        const dfd = cockpit.defer();
        dfd.notify(_("Switching host to maintenance mode in progress ..."));

        ovirtApiPost(
            `hosts/${hostId}/deactivate`,
            '<action/>',
            ({ data, exception }) => {
                dfd.reject(_("Switching host to maintenance mode failed. Received error: ") + data);
            }
        ).then(() => {
            dfd.resolve();
        });

        return dfd.promise;
    };
};

OVIRT_PROVIDER.SET_VCPU_SETTINGS = function (payload) {
    logDebug(`SET_VCPU_SETTINGS(payload=${JSON.stringify(payload)})`);
    if (!isOvirtApiCheckPassed()) {
        logDebug('oVirt API version does not match and SET_VCPU_SETTINGS action is not supported by Libvirt provider as is must be. Skipping.');
        return () => {};
    }

    let { id, name, connectionName, sockets, cores, threads } = payload;

    return (dispatch) => ovirtApiPut(
        `vms/${id}`,
        `<vm><cpu><topology><sockets>${sockets}</sockets><cores>${cores}</cores><threads>${threads}</threads></topology></cpu></vm>`,
        buildFailHandler({
            dispatch,
            name,
            connectionName: connectionName, // TODO: oVirt-only, not implemented for Libvirt
            message: _("SET VCPU SETTINGS action failed")
        })).then(data => {
        logDebug('SET_VCPU_SETTINGS finished', data);
        window.setTimeout(forceNextOvirtPoll, 5000); // hack for better user experience
    }
    );
};

export function setOvirtApiCheckResult (passed) {
    OVIRT_PROVIDER.ovirtApiMetadata.passed = passed;
    if (!passed) {
        // showFailedOvirtApiVersionCheck(REQUIRED_OVIRT_API_VERSION);
        // TODO: dispatch action to show error message for incompatible OVIRT API version
    }
}

export function isOvirtApiCheckPassed () {
    return OVIRT_PROVIDER.ovirtApiMetadata.passed;
}

export default OVIRT_PROVIDER;
