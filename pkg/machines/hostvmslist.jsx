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
import { shutdownVm, forceVmOff, forceRebootVm, rebootVm, startVm,
         usageStartPolling, usageStopPolling, sendNMI } from "./actions.es6";
import { rephraseUI, logDebug, toGigaBytes, toFixedPrecision, vmId } from "./helpers.es6";
import DonutChart from "./c3charts.jsx";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import VmDisksTab from './vmdiskstab.jsx';
import VmNetworkTab from './vmnetworktab.jsx';
import Consoles from './components/consoles.jsx';
import { deleteDialog } from "./components/deleteDialog.jsx";
import InfoRecord from './components/infoRecord.jsx';
import VmLastMessage from './components/vmLastMessage.jsx';

const _ = cockpit.gettext;

function mouseClick(fun) {
    return function (event) {
        if (!event || event.button !== 0)
            return;
        event.stopPropagation();
        return fun(event);
    };
}

const NoVm = () => {
    return (<div className="cockpit-log-warning">
        <div className="blank-slate-pf">
            <div className="blank-slate-pf-icon">
                <i className="pficon pficon-virtual-machine"></i>
                <h1>{ _("No VM is running or defined on this host") }</h1>
            </div>
        </div>
    </div>);
}

const VmActions = ({ vm, config, dispatch, onStart, onReboot, onForceReboot, onShutdown, onForceoff, onSendNMI}) => {
    const id = vmId(vm.name);
    const state = vm.state;

    let reset = null;
    if (config.provider.canReset(state)) {
        reset = DropdownButtons({
            buttons: [{
                title: _("Restart"),
                action: onReboot,
                id: `${id}-reboot`
            }, {
                title: _("Force Restart"),
                action: onForceReboot,
                id: `${id}-forceReboot`
            }]
        });
    }

    let shutdown = null;
    if (config.provider.canShutdown(state)) {
	let buttons = [{
            title: _("Shut Down"),
            action: onShutdown,
            id: `${id}-off`
        }, {
            title: _("Force Shut Down"),
            action: onForceoff,
            id: `${id}-forceOff`
        }];
        if (config.provider.canSendNMI && config.provider.canSendNMI(state)) {
            buttons.push({
                title: _("Send Non-Maskable Interrupt"),
                action: onSendNMI,
                id: `${id}-sendNMI`
            })
        }
        shutdown = DropdownButtons({ buttons: buttons });
    }

    let run = null;
    if (config.provider.canRun(state)) {
        run = (<button className="btn btn-default btn-danger" onClick={mouseClick(onStart)} id={`${id}-run`}>
            {_("Run")}
        </button>);
    }

    let providerActions = null;
    if (config.provider.VmActions) {
        const ProviderActions = config.provider.VmActions;
        providerActions = <ProviderActions vm={vm} providerState={config.providerState} dispatch={dispatch} />;
    }

    let deleteAction = null;
    if (state !== undefined && config.provider.canDelete && config.provider.canDelete(state, vm.id, config.providerState)) {
        deleteAction = (
            <button className="btn btn-danger" id={`${id}-delete`}
                    onClick={ mouseClick(() => deleteDialog(vm, dispatch)) }>
                {_("Delete")}
            </button>
        );
    }

    return (<div>
        {reset}
        {shutdown}
        {run}
        {providerActions}
        {deleteAction}
    </div>);
}
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
}

const IconElement = ({ onClick, className, title, state }) => {
    return (<span title={title} data-toggle='tooltip' data-placement='left'>
        {state}&nbsp;<i onClick={mouseClick(onClick)} className={className}/>
    </span>);
}
IconElement.propTypes = {
    onClick: PropTypes.func,
    className: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    state: PropTypes.string.isRequired,
}

export const StateIcon = ({ state, config, valueId, extra }) => {
    if (state === undefined) {
        return (<div/>);
    }

    let stateMap = {
        running: {className: 'pficon pficon-ok icon-1x-vms', title: _("The VM is running.")}, // TODO: display VM screenshot if available or the ok-icon otherwise
        idle: {className: 'pficon pficon-running icon-1x-vms', title: _("The VM is idle.")},
        paused: {className: 'pficon pficon-pause icon-1x-vms', title: _("The VM is paused.")},
        shutdown: {className: 'glyphicon glyphicon-wrench icon-1x-vms', title: _("The VM is going down.")},
        'shut off': {className: 'fa fa-arrow-circle-o-down icon-1x-vms', title: _("The VM is down.")},
        crashed: {className: 'pficon pficon-error-circle-o icon-1x-vms', title: _("The VM crashed.")},
        dying: {className: 'pficon pficon-warning-triangle-o icon-1x-vms',
            title: _("The VM is in process of dying (shut down or crash is not completed).")},
        pmsuspended: {className: 'pficon pficon-ok icon-1x-vms', title: _("The VM is suspended by guest power management.")},
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

/**
 * Render group of buttons as a dropdown
 *
 * @param buttons array of objects [ {title, action, id}, ... ].
 *        At least one button is required. Button id is optional.
 * @returns {*}
 * @constructor
 */
export const DropdownButtons = ({ buttons }) => {
    if (buttons.length > 1) { // do not display caret for single option
        const buttonsHtml = buttons
            .filter(button => buttons[0].id === undefined || buttons[0].id !== button.id)
            .map(button => {
                return (<li className='presentation'>
                    <a role='menuitem' onClick={mouseClick(button.action)} id={button.id}>
                        {button.title}
                    </a>
                </li>)
            });

        const caretId = buttons[0]['id'] ? `${buttons[0]['id']}-caret` : undefined;
        return (<div className='btn-group dropdown-buttons-container'>
            <button className='btn btn-default btn-danger' id={buttons[0].id} onClick={mouseClick(buttons[0].action)}>
                {buttons[0].title}
            </button>
            <button data-toggle='dropdown' className='btn btn-default dropdown-toggle'>
                <span className='caret' id={caretId}/>
            </button>
            <ul role='menu' className='dropdown-menu'>
                {buttonsHtml}
            </ul>
        </div>);
    }

    return (<div className='btn-group'>
        <button className='btn btn-default btn-danger' onClick={mouseClick(buttons[0].action)} id={buttons[0]['id']}>
            {buttons[0].title}
        </button>
    </div>);
}
DropdownButtons.propTypes = {
    buttons: PropTypes.array.isRequired
}

const VmBootOrder = ({ vm }) => {
    let bootOrder = _("No boot device found");

    if (vm.bootOrder && vm.bootOrder.devices && vm.bootOrder.devices.length > 0) {
        bootOrder = vm.bootOrder.devices.map(bootDevice => bootDevice.type).join(); // Example: network,disk,disk
    }

    return (<InfoRecord id={`${vmId(vm.name)}-bootorder`} descr={_("Boot Order:")} value={bootOrder}/>);
};
VmBootOrder.propTypes = {
    vm: PropTypes.object.isRequired
};

const VmOverviewTab = ({ vm, config, dispatch }) => {
    let providerContent = null;
    if (config.provider.VmOverviewColumn) {
        const ProviderContent = config.provider.VmOverviewColumn;
        providerContent = (<ProviderContent vm={vm} providerState={config.providerState}/>);
    }

    return (<div>
        <VmLastMessage vm={vm} dispatch={dispatch} />
        <table className='machines-width-max'>
            <tr className='machines-listing-ct-body-detail'>
                <td className='machines-listing-detail-top-column'>
                    <table className='form-table-ct'>
                        <InfoRecord descr={_("Memory:")}
                                             value={cockpit.format_bytes((vm.currentMemory ? vm.currentMemory : 0) * 1024)}/>
                        <InfoRecord id={`${vmId(vm.name)}-vcpus`} descr={_("vCPUs:")} value={vm.vcpus}/>
                    </table>
                </td>

                <td className='machines-listing-detail-top-column'>
                    <table className='form-table-ct'>
                        <InfoRecord id={`${vmId(vm.name)}-emulatedmachine`}
                                             descr={_("Emulated Machine:")} value={vm.emulatedMachine}/>
                        <InfoRecord id={`${vmId(vm.name)}-cputype`}
                                             descr={_("CPU Type:")} value={vm.cpuModel}/>
                    </table>
                </td>

                <td className='machines-listing-detail-top-column'>
                    <table className='form-table-ct'>
                        <VmBootOrder vm={vm} />
                        <InfoRecord id={`${vmId(vm.name)}-autostart`}
                                             descr={_("Autostart:")} value={rephraseUI('autostart', vm.autostart)}/>
                    </table>
                </td>

                {providerContent}
            </tr>
        </table>
    </div>);
};
VmOverviewTab.propTypes = {
    vm: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
}

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
                [_("Used"), toGigaBytes(rssMem, 'KiB')],
                [_("Available"), toGigaBytes(available, 'KiB')]
            ],
            groups: [
                ["used", "available"]
            ],
            order: null
        };

        const cpuChartData = {
            columns: [
                [_("Used"), cpuUsage],
                [_("Available"), 100.0 - cpuUsage]
            ],
            groups: [
                ["used", "available"]
            ],
            order: null
        };

        const chartSize = {
            width, // keep the .usage-donut-caption CSS in sync
            height
        };

        return (<table>
                <tr>
                    <td>
                        <DonutChart data={memChartData} size={chartSize} width='8' tooltipText=' '
                                    primaryTitle={toGigaBytes(rssMem, 'KiB')} secondaryTitle='GB'
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
const Vm = ({ vm, config, hostDevices, onStart, onShutdown, onForceoff, onReboot, onForceReboot,
              onUsageStartPolling, onUsageStopPolling, onSendNMI, dispatch }) => {
    const stateAlert = vm.lastMessage && (<span className='pficon-warning-triangle-o machines-status-alert' />);
    const stateIcon = (<StateIcon state={vm.state} config={config} valueId={`${vmId(vm.name)}-state`} extra={stateAlert} />);

    const usageTabName = (<div id={`${vmId(vm.name)}-usage`}>{_("Usage")}</div>);
    const disksTabName = (<div id={`${vmId(vm.name)}-disks`}>{_("Disks")}</div>);
    const networkTabName = (<div id={`${vmId(vm.name)}-networks`}>{_("Networks")}</div>);
    const consolesTabName = (<div id={`${vmId(vm.name)}-consoles`}>{_("Consoles")}</div>);

    let tabRenderers = [
        {name: _("Overview"), renderer: VmOverviewTab, data: {vm, config, dispatch }},
        {name: usageTabName, renderer: VmUsageTab, data: {vm, onUsageStartPolling, onUsageStopPolling}, presence: 'onlyActive' },
        {name: disksTabName, renderer: VmDisksTab, data: {vm, provider: config.provider}, presence: 'onlyActive' },
        {name: networkTabName, renderer: VmNetworkTab, data: { vm, dispatch, hostDevices }},
        {name: consolesTabName, renderer: Consoles, data: { vm, config, dispatch }},
    ];

    if (config.provider.vmTabRenderers) { // External Provider might extend the subtab list
        tabRenderers = tabRenderers.concat(config.provider.vmTabRenderers.map(
            tabRender => {
                let tabName = tabRender.name;
                if (tabRender.idPostfix) {
                    tabName = (<div id={`${vmId(vm.name)}-${tabRender.idPostfix}`}>{tabRender.name}</div>)
                }
                return {
                    name: tabName,
                    renderer: tabRender.component,
                    data: { vm, providerState: config.providerState, dispatch } };
            }
        ));
    }

    const name = (<span id={`${vmId(vm.name)}-row`}>{vm.name}</span>);

    return (<ListingRow
        rowId={`${vmId(vm.name)}`}
        columns={[
            {name, 'header': true},
            rephraseUI('connections', vm.connectionName),
            stateIcon
            ]}
        tabRenderers={tabRenderers}
        listingActions={VmActions({vm, config, dispatch,
            onStart, onReboot, onForceReboot, onShutdown, onForceoff, onSendNMI})}/>);
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
        const { vms, config, dispatch, actions } = this.props;
        if (vms.length === 0) {
            return (<div className='container-fluid'>
                <NoVm />
            </div>);
        }

        const sortFunction = (vmA, vmB) => vmA.name.localeCompare(vmB.name);

        let allActions = []; // like createVmAction
        if (actions) {
            allActions = allActions.concat(actions);
        }

        return (<div className='container-fluid'>
            <Listing title={_("Virtual Machines")} columnTitles={[_("Name"), _("Connection"), _("State")]} actions={allActions}>
                {vms
                    .sort(sortFunction)
                    .map(vm => {
                    return (
                        <Vm vm={vm} config={config}
                            hostDevices={this.deviceProxies}
                            onStart={() => dispatch(startVm(vm))}
                            onReboot={() => dispatch(rebootVm(vm))}
                            onForceReboot={() => dispatch(forceRebootVm(vm))}
                            onShutdown={() => dispatch(shutdownVm(vm))}
                            onForceoff={() => dispatch(forceVmOff(vm))}
                            onUsageStartPolling={() => dispatch(usageStartPolling(vm))}
                            onUsageStopPolling={() => dispatch(usageStopPolling(vm))}
                            onSendNMI={() => dispatch(sendNMI(vm))}
                            dispatch={dispatch}
                        />);
                })}
            </Listing>
        </div>);
    }
}

HostVmsList.propTypes = {
    vms: PropTypes.object.isRequired,
    config: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired
};

export default HostVmsList;
