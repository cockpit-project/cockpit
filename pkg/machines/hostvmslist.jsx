/*jshint esversion: 6 */
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
import React, { PropTypes } from "react";
import {
    shutdownVm,
    forceVmOff,
    forceRebootVm,
    rebootVm,
    sendNMI,
    startVm,
    installVm,
    usageStartPolling,
    usageStopPolling,
    clearNotification,
} from "./actions.es6";
import {
    rephraseUI,
    logDebug,
    convertToUnit,
    toReadableNumber,
    units,
    toFixedPrecision,
    vmId,
    mouseClick,
} from "./helpers.es6";
import DonutChart from "./c3charts.jsx";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import VmDisksTab from './components/vmDisksTabLibvirt.jsx';
import VmNetworkTab from './vmnetworktab.jsx';
import Consoles from './components/consoles.jsx';
import { deleteDialog } from "./components/deleteDialog.jsx";
import DropdownButtons from './components/dropdownButtons.jsx';
import { createVmDialog } from './components/createVmDialog.jsx';
import VmOverviewTab from './components/vmOverviewTabLibvirt.jsx';
import NotificationArea from './components/notification/notificationArea.jsx';

const _ = cockpit.gettext;

const VmActions = ({ vm, config, dispatch, onStart, onInstall, onReboot, onForceReboot, onShutdown, onForceoff, onSendNMI, installInProgress }) => {
    const id = vmId(vm.name);
    const state = vm.state;
    const hasInstallPhase = vm.metadata.hasInstallPhase;

    let reset = null;
    if (config.provider.canReset(state)) {
        reset = DropdownButtons({
            buttons: [{
                title: _("Restart"),
                action: onReboot,
                id: `${id}-reboot`,
            }, {
                title: _("Force Restart"),
                action: onForceReboot,
                id: `${id}-forceReboot`,
            }],
        });
    }

    let shutdown = null;
    if (config.provider.canShutdown(state)) {
        let buttons = [{
            title: _("Shut Down"),
            action: onShutdown,
            id: `${id}-off`,
        }, {
            title: _("Force Shut Down"),
            action: onForceoff,
            id: `${id}-forceOff`,
        }];
        if (config.provider.canSendNMI && config.provider.canSendNMI(state)) {
            buttons.push({
                title: _("Send Non-Maskable Interrupt"),
                action: onSendNMI,
                id: `${id}-sendNMI`,
            });
        }
        shutdown = DropdownButtons({ buttons: buttons });
    }

    let run = null;
    if (config.provider.canRun(state, hasInstallPhase)) {
        run = (<button className="btn btn-default btn-danger" onClick={mouseClick(onStart)} id={`${id}-run`}>
            {_("Run")}
        </button>);
    }

    let install = null;
    if (config.provider.canInstall(state, hasInstallPhase, installInProgress)) {
        install = (<button className="btn btn-default btn-danger" onClick={mouseClick(onInstall)} id={`${id}-install`}>
            {_("Install")}
        </button>);
    }

    let providerActions = null;
    if (config.provider.VmActions) {
        const ProviderActions = config.provider.VmActions;
        providerActions = <ProviderActions vm={vm} providerState={config.providerState} dispatch={dispatch}/>;
    }

    let deleteAction = null;
    if (state !== undefined && config.provider.canDelete && config.provider.canDelete(state, vm.id, config.providerState)) {
        deleteAction = (
            <button className="btn btn-danger" id={`${id}-delete`}
                    onClick={mouseClick(() => deleteDialog(vm, dispatch))}>
                {_("Delete")}
            </button>
        );
    }

    return (<div>
        {reset}
        {shutdown}
        {run}
        {install}
        {providerActions}
        {deleteAction}
    </div>);
};
VmActions.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.string.isRequired,
    dispatch: PropTypes.func.isRequired,
    onStart: PropTypes.func.isRequired,
    onReboot: PropTypes.func.isRequired,
    onForceReboot: PropTypes.func.isRequired,
    onShutdown: PropTypes.func.isRequired,
    onForceoff: PropTypes.func.isRequired,
    onSendNMI: PropTypes.func.isRequired,
};

const IconElement = ({ onClick, className, title, state }) => {
    return (<span title={title} data-toggle='tooltip' data-placement='left'>
        {state}&nbsp;<i onClick={mouseClick(onClick)} className={className}/>
    </span>);
};
IconElement.propTypes = {
    onClick: PropTypes.func,
    className: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    state: PropTypes.string.isRequired,
};

export const StateIcon = ({ state, config, valueId, extra }) => {
    if (state === undefined) {
        return (<div/>);
    }

    let stateMap = {
        running: { className: 'pficon pficon-ok icon-1x-vms', title: _("The VM is running.") }, // TODO: display VM screenshot if available or the ok-icon otherwise
        idle: { className: 'pficon pficon-running icon-1x-vms', title: _("The VM is idle.") },
        paused: { className: 'pficon pficon-pause icon-1x-vms', title: _("The VM is paused.") },
        shutdown: { className: 'glyphicon glyphicon-wrench icon-1x-vms', title: _("The VM is going down.") },
        'shut off': { className: 'fa fa-arrow-circle-o-down icon-1x-vms', title: _("The VM is down.") },
        crashed: { className: 'pficon pficon-error-circle-o icon-1x-vms', title: _("The VM crashed.") },
        dying: {
            className: 'pficon pficon-warning-triangle-o icon-1x-vms',
            title: _("The VM is in process of dying (shut down or crash is not completed)."),
        },
        pmsuspended: {
            className: 'pficon pficon-ok icon-1x-vms',
            title: _("The VM is suspended by guest power management."),
        },
    };
    if (config.provider.vmStateMap) { // merge default and provider's stateMap to allow both reuse and extension
        stateMap = Object.assign(stateMap, config.provider.vmStateMap);
    }

    if (stateMap[state]) {
        return (
            <span title={stateMap[state].title} data-toggle='tooltip' data-placement='left'>
                {extra}
                <span id={valueId}>{rephraseUI('vmStates', state)}</span>
            </span>);
    }
    return (<small>{state}</small>);
};
StateIcon.propTypes = {
    state: PropTypes.string.isRequired,
    config: PropTypes.string.isRequired,
    valueId: PropTypes.string,
    extra: PropTypes.any,
};

class VmUsageTab extends React.Component {
    componentDidMount() {
        this.props.onUsageStartPolling();
    }

    componentWillUnmount() {
        this.props.onUsageStopPolling();
    }

    render() {
        const vm = this.props.vm;
        const width = 220;
        const height = 170;

        const rssMem = vm["rssMemory"] ? vm["rssMemory"] : 0; // in KiB
        const memTotal = vm["currentMemory"] ? vm["currentMemory"] : 0; // in KiB
        let available = memTotal - rssMem; // in KiB
        available = available < 0 ? 0 : available;

        const totalCpus = vm['vcpus'] > 0 ? vm['vcpus'] : 0;
        // 4 CPU system can have usage 400%, let's keep % between 0..100
        let cpuUsage = vm['cpuUsage'] / (totalCpus > 0 ? totalCpus : 1);
        cpuUsage = isNaN(cpuUsage) ? 0 : cpuUsage;
        cpuUsage = toFixedPrecision(cpuUsage, 1);

        logDebug(`VmUsageTab.render(): rssMem: ${rssMem} KiB, memTotal: ${memTotal} KiB, available: ${available} KiB, totalCpus: ${totalCpus}, cpuUsage: ${cpuUsage}`);

        const memChartData = {
            columns: [
                [_("Used"), toReadableNumber(convertToUnit(rssMem, units.KiB, units.GiB))],
                [_("Available"), toReadableNumber(convertToUnit(available, units.KiB, units.GiB))],
            ],
            groups: [
                ["used", "available"],
            ],
            order: null,
        };

        const cpuChartData = {
            columns: [
                [_("Used"), cpuUsage],
                [_("Available"), 100.0 - cpuUsage],
            ],
            groups: [
                ["used", "available"],
            ],
            order: null,
        };

        const chartSize = {
            width, // keep the .usage-donut-caption CSS in sync
            height,
        };

        return (<table>
                <tr>
                    <td>
                        <DonutChart data={memChartData} size={chartSize} width='8' tooltipText=' '
                                    primaryTitle={toReadableNumber(convertToUnit(rssMem, units.KiB, units.GiB))}
                                    secondaryTitle='GiB'
                                    caption={`used from ${cockpit.format_bytes(memTotal * 1024)} memory`}/>
                    </td>

                    <td>
                        <DonutChart data={cpuChartData} size={chartSize} width='8' tooltipText=' '
                                    primaryTitle={cpuUsage} secondaryTitle='%'
                                    caption={`used from ${totalCpus} vCPUs`}/>
                    </td>
                </tr>
            </table>

        );
    }
}

VmUsageTab.propTypes = {
    vm: React.PropTypes.object.isRequired,
    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
};

/** One VM in the list (a row)
 */
const Vm = ({ vm, config, hostDevices, onStart, onInstall, onShutdown, onForceoff, onReboot, onForceReboot,
              onUsageStartPolling, onUsageStopPolling, onSendNMI, uiState, dispatch }) => {
    const stateAlert = vm.lastMessage && (<span className='pficon-warning-triangle-o machines-status-alert' />);
    const stateIcon = (<StateIcon state={vm.state} config={config} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />);

    const usageTabName = (<div id={`${vmId(vm.name)}-usage`}>{_("Usage")}</div>);
    const disksTabName = (<div id={`${vmId(vm.name)}-disks`}>{_("Disks")}</div>);
    const networkTabName = (<div id={`${vmId(vm.name)}-networks`}>{_("Networks")}</div>);
    const consolesTabName = (<div id={`${vmId(vm.name)}-consoles`}>{_("Consoles")}</div>);

    let tabRenderers = [
        {name: _("Overview"), renderer: VmOverviewTab, data: { vm, config, dispatch }},
        {name: usageTabName, renderer: VmUsageTab, data: { vm, onUsageStartPolling, onUsageStopPolling }, presence: 'onlyActive' },
        {name: disksTabName, renderer: VmDisksTab, data: { vm, onUsageStartPolling, onUsageStopPolling }, presence: 'onlyActive' },
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

    const initiallyExpanded = uiState && uiState.createInProgress;
    let initiallyActiveTab = null;
    if (uiState && uiState.createInProgress && uiState.createInProgress.openConsoleTab) {
        initiallyActiveTab = tabRenderers.map((o) =>  o.name).indexOf(consolesTabName);
    }

    const name = (<span id={`${vmId(vm.name)}-row`}>{vm.name}</span>);

    return (<ListingRow
        rowId={`${vmId(vm.name)}`}
        columns={[
            {name, 'header': true},
            rephraseUI('connections', vm.connectionName),
            stateIcon,
        ]}
        initiallyExpanded={initiallyExpanded}
        initiallyActiveTab={initiallyActiveTab}
        tabRenderers={tabRenderers}
        listingActions={VmActions({
            vm, config, dispatch,
            onStart, onInstall, onReboot, onForceReboot, onShutdown, onForceoff, onSendNMI,
            installInProgress: !!uiState.installInProgress,
        })}/>);
};
Vm.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    hostDevices: PropTypes.object.isRequired,
    onStart: PropTypes.func.isRequired,
    onShutdown: PropTypes.func.isRequired,
    onForceoff: PropTypes.func.isRequired,
    onReboot: PropTypes.func.isRequired,
    onForceReboot: PropTypes.func.isRequired,
    onUsageStartPolling: PropTypes.func.isRequired,
    onUsageStopPolling: PropTypes.func.isRequired,
    onSendNMI: React.PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    initallyExpanded: PropTypes.bool,
};

/**
 * List of all VMs defined on this host
 */
class HostVmsList extends React.Component {
    constructor(props) {
        super(props);
        this.deviceProxyHandler = this.deviceProxyHandler.bind(this);
        this.client = cockpit.dbus("org.freedesktop.NetworkManager", {});
        this.deviceProxies = this.client.proxies("org.freedesktop.NetworkManager.Device");
        this.deviceProxies.addEventListener('changed', this.deviceProxyHandler);
        this.deviceProxies.addEventListener('removed', this.deviceProxyHandler);
    }

    componentWillUnmount() {
        this.client.close();
    }

    deviceProxyHandler() {
        this.forceUpdate();
    }

    render() {
        const { vms, config, osInfoList, ui, dispatch, actions } = this.props;

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

        let allActions = [
            (
                <a className="card-pf-link-with-icon pull-right" id="create-new-vm"
                   onClick={mouseClick(() => createVmDialog(dispatch, osInfoList))}>
                    <span className="pficon pficon-add-circle-o"/>{_("Create New VM")}
                </a>
            )
        ];

        if (actions) {
            allActions = allActions.concat(actions);
        }

        return (<div className='container-fluid'>
            <NotificationArea id={"notification-area"}
                              notifications={ui.notifications}
                              onDismiss={(id) => dispatch(clearNotification(id))}/>
            <Listing title={_("Virtual Machines")}
                     columnTitles={[_("Name"), _("Connection"), _("State")]}
                     actions={allActions}
                     emptyCaption={_("No VM is running or defined on this host")}>
                {vms
                    .sort(sortFunction)
                    .map(vm => {
                    return (
                        <Vm vm={vm} config={config}
                            hostDevices={this.deviceProxies}
                            onStart={() => dispatch(startVm(vm))}
                            onInstall={() => dispatch(installVm(vm))}
                            onReboot={() => dispatch(rebootVm(vm))}
                            onForceReboot={() => dispatch(forceRebootVm(vm))}
                            onShutdown={() => dispatch(shutdownVm(vm))}
                            onForceoff={() => dispatch(forceVmOff(vm))}
                            onUsageStartPolling={() => dispatch(usageStartPolling(vm))}
                            onUsageStopPolling={() => dispatch(usageStopPolling(vm))}
                            onSendNMI={() => dispatch(sendNMI(vm))}
                            dispatch={dispatch}
                            uiState={{
                                createInProgress: ui.vmsCreated[vm.name],
                                installInProgress: ui.vmsInstallInitiated[vm.name],
                            }}
                            key={`${vmId(vm.name)}`}
                        />);
                })}
            </Listing>
        </div>);
    }
}

HostVmsList.propTypes = {
    vms: PropTypes.array.isRequired,
    config: PropTypes.object.isRequired,
    osInfoList: PropTypes.array.isRequired,
    ui: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
};

export default HostVmsList;
