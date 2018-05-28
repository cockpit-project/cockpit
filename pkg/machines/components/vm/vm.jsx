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

import { ListingRow } from "cockpit-components-listing.jsx";

import {
    rephraseUI,
    vmId,
} from "../../helpers.es6";

import VmDisksTab from '../vmDisksTabLibvirt.jsx';
import VmNetworkTab from '../../vmnetworktab.jsx';
import Consoles from '../consoles.jsx';
import VmOverviewTab from '../vmOverviewTabLibvirt.jsx';
import VmActions from './vmActions.jsx';
import StateIcon from './stateIcon.jsx';
import VmUsageTab from './vmUsageTab.jsx';

const _ = cockpit.gettext;

/** One VM in the list (a row)
 */
const Vm = ({ vm, config, hostDevices, storagePools, onStart, onInstall, onShutdown, onForceoff, onReboot, onForceReboot,
              onUsageStartPolling, onUsageStopPolling, onSendNMI, dispatch }) => {
    const stateAlert = vm.lastMessage && (<span className='pficon-warning-triangle-o machines-status-alert' />);
    const stateIcon = (<StateIcon state={vm.state} config={config} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />);

    const overviewTabName = (<div id={`${vmId(vm.name)}-overview`}>{_("Overview")}</div>);
    const usageTabName = (<div id={`${vmId(vm.name)}-usage`}>{_("Usage")}</div>);
    const disksTabName = (<div id={`${vmId(vm.name)}-disks`}>{_("Disks")}</div>);
    const networkTabName = (<div id={`${vmId(vm.name)}-networks`}>{_("Networks")}</div>);
    const consolesTabName = (<div id={`${vmId(vm.name)}-consoles`}>{_("Consoles")}</div>);

    let tabRenderers = [
        {name: overviewTabName, renderer: VmOverviewTab, data: { vm, config, dispatch }},
        {name: usageTabName, renderer: VmUsageTab, data: { vm, onUsageStartPolling, onUsageStopPolling }, presence: 'onlyActive'},
        {name: disksTabName, renderer: VmDisksTab, data: { vm, config, storagePools, onUsageStartPolling, onUsageStopPolling, dispatch }, presence: 'onlyActive'},
        {name: networkTabName, renderer: VmNetworkTab, data: { vm, dispatch, hostDevices }},
        {name: consolesTabName, renderer: Consoles, data: { vm, config, dispatch }},
    ];

    if (config.provider.vmTabRenderers) { // External Provider might extend the subtab list
        tabRenderers = tabRenderers.concat(config.provider.vmTabRenderers.map(
            tabRender => {
                let tabName = tabRender.name;
                if (tabRender.idPostfix) {
                    tabName = (<div id={`${vmId(vm.name)}-${tabRender.idPostfix}`}>{tabRender.name}</div>);
                }
                return {
                    name: tabName,
                    renderer: tabRender.component,
                    data: { vm, providerState: config.providerState, dispatch },
                };
            }
        ));
    }

    let initiallyActiveTab = null;
    if (vm.ui.initiallyOpenedConsoleTab) {
        initiallyActiveTab = tabRenderers.map((o) => o.name).indexOf(consolesTabName);
    }

    const name = (<span id={`${vmId(vm.name)}-row`}>{vm.name}</span>);

    return (<ListingRow
        rowId={`${vmId(vm.name)}`}
        columns={[
            {name, 'header': true},
            rephraseUI('connections', vm.connectionName),
            stateIcon,
        ]}
        initiallyExpanded={vm.ui.initiallyExpanded}
        initiallyActiveTab={initiallyActiveTab}
        tabRenderers={tabRenderers}
        listingActions={VmActions({
            vm,
            config,
            dispatch,
            onStart,
            onInstall,
            onReboot,
            onForceReboot,
            onShutdown,
            onForceoff,
            onSendNMI,
        })} />);
};

Vm.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    storagePools: PropTypes.object.isRequired,
    hostDevices: PropTypes.object.isRequired,
    onStart: PropTypes.func.isRequired,
    onShutdown: PropTypes.func.isRequired,
    onForceoff: PropTypes.func.isRequired,
    onReboot: PropTypes.func.isRequired,
    onForceReboot: PropTypes.func.isRequired,
    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
    onSendNMI: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export default Vm;
