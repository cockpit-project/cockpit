/*jshint esversion: 6 */
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
import { StateIcon, DropdownButtons } from "../../machines/hostvmslist.jsx";

import { toGigaBytes, valueOrDefault, isSameHostAddress, getHostAddress } from '../helpers.es6';
import { startVm, goToSubpage } from '../actions.es6';
import rephraseUI from '../rephraseUI.es6';

React;
const _ = cockpit.gettext;

const NoVm = () => (<div>{_("No VM found in oVirt.")}</div>);
const NoVmUnitialized = () => (<div>{_("Please wait till VMs list is loaded from the server.")}</div>);
const VmHA = ({ highAvailability }) => (<div>{highAvailability && highAvailability.enabled && highAvailability.enabled === 'true' ? (_("yes")) : (_("no"))}</div>);
const VmMemory = ({ mem }) => (<div>{toGigaBytes(mem, 'B')} GiB</div>);
const VmOS = ({ os }) => (<div>{os.type}</div>);
const VmStateless = ({ stateless }) => (<div>{rephraseUI('stateless', stateless)}</div>);
const VmDescription = ({ descr }) => (<span>{descr}</span>); // cropping is not needed, the text wraps

const VmCpu = ({ cpu }) => { // TODO: render CPU architecture and topology?
    const vCpus = valueOrDefault(cpu.topology.sockets, 1) * valueOrDefault(cpu.topology.cores, 1) * valueOrDefault(cpu.topology.threads, 1);
    const tooltip = `${_("sockets")}: ${cpu.topology.sockets}\n${_("cores")}: ${cpu.topology.cores}\n${_("threads")}: ${cpu.topology.threads}`;
    return (<span title={tooltip} data-toggle='tooltip' data-placement='left'>{vCpus}</span>);
};

const VmHost = ({ id, hosts, dispatch }) => {
    if (!id || !hosts || !hosts[id]) {
        return null; // not running or data load not yet finished
    }
    const host = hosts[id];
    if (isSameHostAddress(host.address)) {
        return (<a href='#' onClick={() => dispatch(goToSubpage('hostvms'))}>
            {_("Host")}
            </a>);
    }

    const cockpitUrl = `https://${host.address}:${CONFIG.cockpitPort}/machines`;
    // just the <a href> without the onClick handler is not working
    return (<a href={cockpitUrl} onClick={() => {window.top.location=cockpitUrl;}}>
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
    return <span title={tooltip} data-toggle='tooltip' data-placement='left'>{template.name}</span>
};

const VmActions = ({ vm, hostName, dispatch }) => {
    // TODO: disable the button after execution, reenable at next refresh
    let buttons = null;

    const runButton = {
        title: _("Run"),
        action: () => dispatch(startVm(vm)),
        id: `cluster-${vm.id}-run`
    };
    const runHereButton = {
        title: _("Run Here"),
        action: () => dispatch(startVm(vm, hostName)),
        id: `cluster-${vm.id}-run-here`
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
                <DropdownButtons buttons={buttons}/>
                <VmLastMessage vm={vm}/>
            </span>
        );
    }

    return null;
};

const VmCluster = ({ id, clusters }) => {
    if (!id || !clusters || !clusters[id]) {
        return null;
    }
    return (
        <div>
            {clusters[id].name}
        </div>
    );
};

const VmLastMessage = ({ vm }) => {
    if (!vm.lastMessage) {
        return null;
    }
    const detail = (vm.lastMessageDetail && vm.lastMessageDetail.exception) ? vm.lastMessageDetail.exception: vm.lastMessage;
    return (
        <p title={detail} data-toggle='tooltip'>
            <span className='pficon-warning-triangle-o' />&nbsp;{vm.lastMessage}
        </p>
    );
};

const Vm = ({ vm, hosts, templates, clusters, config, dispatch }) => {
    const stateIcon = (<StateIcon state={vm.state} config={config}/>);

    const hostAddress = getHostAddress();
    const hostId = Object.getOwnPropertyNames(hosts).find(hostId => hosts[hostId].address === hostAddress);
    const hostName = hostId && hosts[hostId] ? hosts[hostId].name : undefined;

    return (<ListingRow // TODO: icons?
        columns={[
            {name: vm.name, 'header': true},
            <VmDescription descr={vm.description} />,
            <VmCluster id={vm.clusterId} clusters={clusters} />,
            <VmTemplate id={vm.templateId} templates={templates} />,
            <VmMemory mem={vm.memory} />,
            <VmCpu cpu={vm.cpu} />,
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
    const { vms, hosts, templates, clusters } = config.providerState;

    if (!vms) { // before cluster vms are loaded
        return (<NoVmUnitialized />);
    }

    if (vms.length === 0) { // there are no vms
        return (<NoVm />);
    }

    return (<div className='container-fluid'>
        <Listing title={_("Cluster Virtual Machines")} columnTitles={[
        _("Name"), _("Description"), _("Cluster"), _("Template"), _("Memory"), _("vCPUs"), _("OS"),
        _("HA"), _("Stateless"), _("Host"),
        (<div className='ovirt-provider-cluster-vms-actions'>{_("Action")}</div>),
        (<div className='ovirt-provider-cluster-vms-state'>{_("State")}</div>)]}>
            {Object.getOwnPropertyNames(vms).map(vmId => {
                return (
                    <Vm vm={vms[vmId]}
                        hosts={hosts}
                        templates={templates}
                        clusters={clusters}
                        config={config}
                        dispatch={dispatch}
                    />);
            })}
        </Listing>
    </div>);
};

// --- hack for phantomJS:
// https://tc39.github.io/ecma262/#sec-array.prototype.find
if (!Array.prototype.find) {
    Object.defineProperty(Array.prototype, 'find', {
        value: function(predicate) {
            // 1. Let O be ? ToObject(this value).
            if (this == null) {
                throw new TypeError('"this" is null or not defined');
            }

            var o = Object(this);

            // 2. Let len be ? ToLength(? Get(O, "length")).
            var len = o.length >>> 0;

            // 3. If IsCallable(predicate) is false, throw a TypeError exception.
            if (typeof predicate !== 'function') {
                throw new TypeError('predicate must be a function');
            }

            // 4. If thisArg was supplied, let T be thisArg; else let T be undefined.
            var thisArg = arguments[1];

            // 5. Let k be 0.
            var k = 0;

            // 6. Repeat, while k < len
            while (k < len) {
                // a. Let Pk be ! ToString(k).
                // b. Let kValue be ? Get(O, Pk).
                // c. Let testResult be ToBoolean(? Call(predicate, T, « kValue, k, O »)).
                // d. If testResult is true, return kValue.
                var kValue = o[k];
                if (predicate.call(thisArg, kValue, k, o)) {
                    return kValue;
                }
                // e. Increase k by 1.
                k++;
            }

            // 7. Return undefined.
            return undefined;
        }
    });
}
// ------------

export { VmLastMessage, VmDescription, VmMemory, VmCpu, VmOS, VmHA, VmStateless };
export default ClusterVms;
