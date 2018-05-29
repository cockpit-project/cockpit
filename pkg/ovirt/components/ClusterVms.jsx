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
import React from "react";
import cockpit from 'cockpit';

import CONFIG from '../config.es6';

import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import StateIcon from "../../machines/components/vm/stateIcon.jsx";
import DropdownButtons from "../../machines/components/dropdownButtons.jsx";
import VCPUModal from './vcpuModal.jsx';

import { toGigaBytes, valueOrDefault, isSameHostAddress } from '../helpers.es6';
import { startVm, goToSubpage } from '../actions.es6';
import rephraseUI from '../rephraseUI.es6';
import { getCurrentCluster, getHost } from '../selectors.es6';

const _ = cockpit.gettext;

const NoVm = () => (<div>{_("No VM found in oVirt.")}</div>);
const NoVmUnitialized = () => (<div>{_("Please wait till VMs list is loaded from the server.")}</div>);
const VmHA = ({ highAvailability }) => (<div>{highAvailability && highAvailability.enabled && highAvailability.enabled === 'true' ? (_("yes")) : (_("no"))}</div>);
const VmMemory = ({ mem }) => (<div>{toGigaBytes(mem, 'B')} GiB</div>);
const VmOS = ({ os }) => (<div>{os.type}</div>);
const VmStateless = ({ stateless }) => (<div>{rephraseUI('stateless', stateless)}</div>);
const VmDescription = ({ descr }) => (<span>{descr}</span>); // cropping is not needed, the text wraps

const VmCpu = ({ vm, dispatch }) => {
    const vCpus = valueOrDefault(vm.cpu.topology.sockets, 1) * valueOrDefault(vm.cpu.topology.cores, 1) * valueOrDefault(vm.cpu.topology.threads, 1);
    const tooltip = `${_("sockets")}: ${vm.cpu.topology.sockets}\n${_("cores")}: ${vm.cpu.topology.cores}\n${_("threads")}: ${vm.cpu.topology.threads}`;

    const handleOpenModal = function () {
        VCPUModal({
            vm,
            dispatch
        });
    };

    return (<a title={tooltip} id={`cluster-${vm.name}-cpus`} data-toggle='tooltip' data-placement='left' onClick={handleOpenModal}>{vCpus}</a>);
};

const VmHost = ({ id, hosts, dispatch }) => {
    if (!id || !hosts || !hosts[id]) {
        return null; // not running or data load not yet finished
    }
    const host = hosts[id];
    if (isSameHostAddress(host.address)) {
        return (<a href='#' tabIndex="0" onClick={() => dispatch(goToSubpage('hostvms'))}>
            {_("Host")}
        </a>);
    }

    const cockpitUrl = `https://${host.address}:${CONFIG.cockpitPort}/machines`;
    // just the <a href> without the tabIndex="0" onClick handler is not working
    return (<a href={cockpitUrl} tabIndex="0" onClick={() => { window.top.location = cockpitUrl }}>
        {host.name}
    </a>);
};

const VmTemplate = ({ id, templates }) => {
    if (!id || !templates || !templates[id]) {
        return null; // not running or data load not yet finished
    }

    const template = templates[id];
    const baseTemplateName = template.version.baseTemplateId && templates[template.version.baseTemplateId] ? templates[template.version.baseTemplateId].name : '';
    const tooltip = `${_("Description")}: ${template.description}\n${_("Version")}: ${valueOrDefault(template.version.name, '')}\n${_("Version num")}: ${valueOrDefault(template.version.number, '')}\n${_("Base template")}: ${baseTemplateName}\n`;
    return <span title={tooltip} data-toggle='tooltip' data-placement='left'>{template.name}</span>;
};

const VmActions = ({ vm, hostName, dispatch }) => {
    // TODO: disable the button after execution, reenable at next refresh
    let buttons = null;

    const runButton = {
        title: _("Run"),
        action: () => dispatch(startVm(vm)),
        id: `cluster-${vm.name}-run`
    };
    const runHereButton = {
        title: _("Run Here"),
        action: () => dispatch(startVm(vm, hostName)),
        id: `cluster-${vm.name}-run-here`
    };

    if (['suspended'].indexOf(vm.state) >= 0) {
        buttons = [runButton];
    }

    if (['shut off', 'down'].indexOf(vm.state) >= 0) {
        buttons = [runButton, runHereButton];
    }

    if (buttons) {
        return (
            <span>
                <DropdownButtons buttons={buttons} />
                <VmLastMessage vm={vm} />
            </span>
        );
    }

    return null;
};

const VmLastMessage = ({ vm }) => {
    if (!vm.lastMessage) {
        return null;
    }

    let detail = vm.lastMessage;
    if (vm.lastMessageDetail && vm.lastMessageDetail.data) {
        detail = vm.lastMessageDetail.data;
    }

    return (
        <p title={detail} data-toggle='tooltip' id={`clustervm-${vm.name}-actionerror`}>
            <span className='pficon-warning-triangle-o' />&nbsp;{vm.lastMessage}
        </p>
    );
};

const Vm = ({ vm, hosts, templates, config, dispatch }) => {
    const stateIcon = (<StateIcon state={vm.state} config={config} />);
    const ovirtConfig = config.providerState && config.providerState.ovirtConfig;
    const currentHost = getHost(hosts, ovirtConfig);
    const hostName = currentHost && currentHost.name;

    return (<ListingRow // TODO: icons?
        columns={[
            {name: vm.name, 'header': true},
            <VmDescription descr={vm.description} />,
            <VmTemplate id={vm.templateId} templates={templates} />,
            <VmMemory mem={vm.memory} />,
            <VmCpu vm={vm} dispatch={dispatch} />,
            <VmOS os={vm.os} />,
            <VmHA highAvailability={vm.highAvailability} />,
            <VmStateless stateless={vm.stateless} />,
            <VmHost id={vm.hostId} hosts={hosts} dispatch={dispatch} />,
            <VmActions vm={vm} dispatch={dispatch} hostName={hostName} />,
            stateIcon
        ]}
    />);
};

const ClusterVms = ({ dispatch, config }) => {
    const { vms, hosts, templates, clusters, ovirtConfig } = config.providerState;

    if (!vms) { // before cluster vms are loaded
        return (<NoVmUnitialized />);
    }

    if (vms.length === 0) { // there are no vms
        return (<NoVm />);
    }

    const currentCluster = getCurrentCluster(hosts, clusters, ovirtConfig);
    let title = cockpit.format(_("Cluster Virtual Machines"));
    if (currentCluster) {
        title = cockpit.format(_("Virtual Machines of $0 cluster"), currentCluster.name);
    }

    return (<div className='container-fluid'>
        <Listing title={title} emptyCaption='' columnTitles={[
            _("Name"), _("Description"), _("Template"), _("Memory"), _("vCPUs"), _("OS"),
            _("HA"), _("Stateless"), _("Host"),
            (<div className='ovirt-provider-cluster-vms-actions'>{_("Action")}</div>),
            (<div className='ovirt-provider-cluster-vms-state'>{_("State")}</div>)]}>
            {Object.getOwnPropertyNames(vms).map(vmId => {
                return (
                    <Vm vm={vms[vmId]}
                        hosts={hosts}
                        templates={templates}
                        config={config}
                        dispatch={dispatch}
                        key={vmId}
                    />);
            })}
        </Listing>
    </div>);
};

// ------------

export { VmLastMessage, VmDescription, VmMemory, VmCpu, VmOS, VmHA, VmStateless };
export default ClusterVms;
