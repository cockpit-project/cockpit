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
} from "../../helpers.js";

import VmDisksTab from '../vmDisksTabLibvirt.jsx';
import VmNetworkTab from '../vmnetworktab.jsx';
import Consoles from '../consoles.jsx';
import VmOverviewTab from '../vmOverviewTabLibvirt.jsx';
import VmActions from './vmActions.jsx';
import StateIcon from './stateIcon.jsx';
import VmUsageTab from './vmUsageTab.jsx';
import {
    shutdownVm,
    pauseVm,
    resumeVm,
    forceVmOff,
    forceRebootVm,
    rebootVm,
    sendNMI,
    startVm,
    installVm,
    usageStartPolling,
    usageStopPolling,
} from "../../actions/provider-actions.js";

const _ = cockpit.gettext;

export const getVmListingActions = ({ vm, config, dispatch }) => {
    const onStart = () => dispatch(startVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to start"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onInstall = () => dispatch(installVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to get installed"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onReboot = () => dispatch(rebootVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to Reboot"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onForceReboot = () => dispatch(forceRebootVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to force Reboot"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onShutdown = () => dispatch(shutdownVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to shutdown"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onPause = () => dispatch(pauseVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to pause"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onResume = () => dispatch(resumeVm(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to resume"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onForceoff = () => dispatch(forceVmOff(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to force shutdown"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });
    const onSendNMI = () => dispatch(sendNMI(vm)).catch(ex => {
        this.props.onAddErrorNotification({
            text: cockpit.format(_("VM $0 failed to send NMI"), vm.name),
            detail: ex.message, resourceId: vm.id,
        });
    });

    return VmActions({
        vm,
        config,
        dispatch,
        onStart,
        onInstall,
        onReboot,
        onForceReboot,
        onShutdown,
        onPause,
        onResume,
        onForceoff,
        onSendNMI,
    });
};

export const getVmTabRenderers = ({ vm, config, hostDevices, storagePools, dispatch, networks, nodeDevices, onAddErrorNotification }) => {
    const overviewTabName = (<div id={`${vmId(vm.name)}-overview`}>{_("Overview")}</div>);
    const usageTabName = (<div id={`${vmId(vm.name)}-usage`}>{_("Usage")}</div>);
    const disksTabName = (<div id={`${vmId(vm.name)}-disks`}>{_("Disks")}</div>);
    const networkTabName = (<div id={`${vmId(vm.name)}-networks`}>{_("Network Interfaces")}</div>);
    const consolesTabName = (<div id={`${vmId(vm.name)}-consoles`}>{_("Consoles")}</div>);
    const onUsageStartPolling = () => dispatch(usageStartPolling(vm));
    const onUsageStopPolling = () => dispatch(usageStopPolling(vm));

    let tabRenderers = [
        { name: overviewTabName, renderer: VmOverviewTab, data: { vm, config, dispatch, nodeDevices } },
        { name: usageTabName, renderer: VmUsageTab, data: { vm, onUsageStartPolling, onUsageStopPolling }, presence: 'onlyActive' },
        { name: disksTabName, renderer: VmDisksTab, data: { vm, config, storagePools, onUsageStartPolling, onUsageStopPolling, dispatch, onAddErrorNotification }, presence: 'onlyActive' },
        { name: networkTabName, renderer: VmNetworkTab, data: { vm, dispatch, config, hostDevices, networks, onAddErrorNotification } },
        { name: consolesTabName, renderer: Consoles, data: { vm, config, dispatch } },
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

    return { tabRenderers, initiallyActiveTab };
};

/** One VM in the list (a row)
 */
export const Vm = ({ vm, config, hostDevices, storagePools, dispatch, networks, nodeDevices, resourceHasError, onAddErrorNotification }) => {
    const stateAlert = resourceHasError[vm.id] ? <span className='pficon-warning-triangle-o machines-status-alert' /> : null;
    const stateIcon = (<StateIcon state={vm.state} config={config} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />);
    const vmTabs = getVmTabRenderers({ vm, config, hostDevices, storagePools, dispatch, networks, nodeDevices, resourceHasError, onAddErrorNotification });
    const vmListingActions = getVmListingActions({ vm, config, dispatch });
    const name = (<span id={`${vmId(vm.name)}-row`}>{vm.name}</span>);
    let extraClasses = [];

    if (resourceHasError[vm.id])
        extraClasses.push('error');

    return (<ListingRow
        extraClasses={extraClasses}
        rowId={`${vmId(vm.name)}`}
        columns={[
            { name, 'header': true },
            rephraseUI('connections', vm.connectionName),
            stateIcon,
        ]}
        initiallyExpanded={vm.ui.initiallyExpanded}
        initiallyActiveTab={vmTabs.initiallyActiveTab}
        tabRenderers={vmTabs.tabRenderers}
        navigateToItem={() => cockpit.location.go(['vms', vm.uuid])}
        listingActions={vmListingActions} />);
};

Vm.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    storagePools: PropTypes.array.isRequired,
    hostDevices: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    networks: PropTypes.array.isRequired,
    resourceHasError: PropTypes.object.isRequired,
    onAddErrorNotification: PropTypes.func.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default Vm;
