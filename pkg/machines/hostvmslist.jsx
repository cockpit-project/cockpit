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
import { shutdownVm, forceVmOff, forceRebootVm, rebootVm, startVm, hostVmsListToggleVmExpand, hostVmsListShowSubtab, setRefreshInterval } from "./actions.es6";
import { canReset, canShutdown, canRun, rephraseUI, logDebug, toGigaBytes } from "./helpers.es6";
import DonutChart from "./c3charts.jsx";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";

const _ = cockpit.gettext;

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

const VmActions = ({ vmId, state, onStart, onReboot, onForceReboot, onShutdown, onForceoff }) => {
    const reset = canReset(state) ? DropdownButtons({
        buttons: [{
            title: _("Restart"),
            action: onReboot,
            id: `${vmId}-reboot`
        }, {
            title: _("Force Restart"),
            action: onForceReboot,
            id: `${vmId}-forceReboot`
        }]
    }) : '';

    const shutdown = canShutdown(state) ? DropdownButtons({
        buttons: [{
            title: _("Shut Down"),
            action: onShutdown,
            id: `${vmId}-off`
        }, {
            title: _("Force Shut Down"),
            action: onForceoff,
            id: `${vmId}-forceOff`
        }]
    }) : '';

    const run = canRun(state) ? (<button className="btn btn-default btn-danger" onClick={onStart}>{_("Run")}</button>) : '';

    return (<div>
        {reset}
        {shutdown}
        {run}
    </div>);
}
VmActions.propTypes = {
    vmId: PropTypes.string.isRequired,
    state: PropTypes.string.isRequired,
    onStart: PropTypes.func.isRequired,
    onReboot: PropTypes.func.isRequired,
    onForceReboot: PropTypes.func.isRequired,
    onShutdown: PropTypes.func.isRequired,
    onForceoff: PropTypes.func.isRequired
}

const IconElement = ({ onClick, className, title, state }) => {
    return (<span title={title} data-toggle='tooltip' data-placement='left'>
        {state}&nbsp;<i onClick={onClick} className={className}/>
    </span>);
}
IconElement.propTypes = {
    onClick: PropTypes.func,
    className: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    state: PropTypes.string.isRequired,
}

const StateIcon = ({ state }) => {
    switch (state) {
        case 'running':// TODO: display VM screenshot if available or the ok-icon otherwise
            return (<IconElement state={state} className='pficon pficon-ok icon-1x-vms' title={_("The VM is running.")}/>);
        case 'idle':
            return (<IconElement state={state} className='pficon pficon-running icon-1x-vms' title={_("The VM is idle.")}/>);
        case 'paused':
            return (<IconElement state={state} className='pficon pficon-pause icon-1x-vms' title={_("The VM is paused.")}/>);
        case 'shutdown':
            return (<IconElement state={state} className='glyphicon glyphicon-wrench icon-1x-vms'
                                 title={_("The VM is going down.")}/>);
        case 'shut off':
            return (<IconElement state={state} className='fa fa-arrow-circle-o-down icon-1x-vms' title={_("The VM is down.")}/>);
        case 'crashed':
            return (<IconElement state={state} className='pficon pficon-error-circle-o icon-1x-vms'
                                 title={_("The VM crashed.")}/>);
        case 'dying':
            return (<IconElement state={state} className='pficon pficon-warning-triangle-o icon-1x-vms'
                                 title={_("The VM is in process of dying (shut down or crash is not completed).")}/>);
        case 'pmsuspended':
            return (<IconElement state={state} className='pficon pficon-ok icon-1x-vms'
                                 title={_("The VM is suspended by guest power management.")}/>);
        case undefined:
            return (<div/>);
        default:
            return (<small>{state}</small>);
    }
}
StateIcon.propTypes = {
    state: PropTypes.string.isRequired
}

/**
 * Render group of buttons as a dropdown
 *
 * @param buttons array of objects [ {title, action, id}, ... ].
 *        At least one button is required. Button id is optional.
 * @returns {*}
 * @constructor
 */
const DropdownButtons = ({ buttons }) => {
    const buttonsHtml = buttons.map(
        button => {
            return (<li className='presentation'>
                <a role='menuitem' onClick={button.action} id={button.id}>
                    {button.title}
                </a>
            </li>)
        }
    );

    const caretId = buttons[0]['id'] ? `${buttons[0]['id']}-caret` : undefined;
    return (<div className='btn-group'>
        <button className='btn btn-default btn-danger' onClick={buttons[0].action}>
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
DropdownButtons.propTypes = {
    buttons: PropTypes.array.isRequired
}

function vmId(vmName) {
    return `vm-${vmName}`;
}

const VmOverviewTabRecord = ({id, descr, value}) => {
    return (<tr>
        <td className='top'>
            <label className='control-label'>
                {descr}
            </label>
        </td>
        <td id={id}>
            {value}
        </td>
    </tr>);
};
VmOverviewTabRecord.propTypes = {
    id: PropTypes.string,
    descr: PropTypes.string.isRequired,
    value: PropTypes.string.isRequired
}

const VmOverviewTab = ({ vm }) => {
    return (<table className='machines-width-max'>
        <tr className='machines-listing-ct-body-detail'>
            <td>
                <table className='form-table-ct'>
                    <VmOverviewTabRecord id={`${vmId(vm.name)}-state`} descr='State:' value={vm.state}/>
                    <VmOverviewTabRecord descr={_("Memory:")}
                                         value={cockpit.format_bytes((vm.currentMemory ? vm.currentMemory : 0) * 1024)}/>
                    <VmOverviewTabRecord descr={_("vCPUs:")} value={vm.vcpus}/>
                </table>
            </td>

            <td>
                <table className='form-table-ct'>
                    <VmOverviewTabRecord descr={_("ID:")} value={vm.id}/>
                    <VmOverviewTabRecord descr={_("OS Type:")} value={vm.osType}/>
                    <VmOverviewTabRecord descr={_("Autostart:")} value={rephraseUI('autostart', vm.autostart)}/>
                </table>
            </td>
        </tr>
    </table>);
};
VmOverviewTab.propTypes = {
    vm: PropTypes.object.isRequired
}

const VmUsageTab = ({ vm }) => {
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
    }

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
};
VmUsageTab.propTypes = {
    vm: React.PropTypes.object.isRequired
};

/** One VM in the list (a row)
 */
const Vm = ({ vm, onStart, onShutdown, onForceoff, onReboot, onForceReboot }) => {
    const stateIcon = (<StateIcon state={vm.state} />);
    return (<ListingRow
        columns={[{name: vm.name, 'header': true}, stateIcon]}
        tabRenderers={[ {name: _("Overview"), renderer: VmOverviewTab, data: {vm: vm}},
            {name: _("Usage"), renderer: VmUsageTab, data: {vm: vm}, presence: 'onlyActive' } ]}
        listingActions={VmActions({vmId: vmId(vm.name), state: vm.state,
            onStart, onReboot, onForceReboot, onShutdown, onForceoff})}/>);
};
Vm.propTypes = {
    vm: React.PropTypes.object.isRequired,
    onStart: React.PropTypes.func.isRequired,
    onShutdown: React.PropTypes.func.isRequired,
    onForceoff: React.PropTypes.func.isRequired,
    onReboot: React.PropTypes.func.isRequired,
    onForceReboot: React.PropTypes.func.isRequired
};

/**
 * List of all VMs defined on this host
 */
const HostVmsList = ({ vms, dispatch }) => {
    if (vms.length === 0) {
        return (<div className='container-fluid'>
            <NoVm />
        </div>);
    }

    return (<div className='container-fluid'>
        <Listing title={_("Virtual Machines")} columnTitles={[_("Name"), _("State")]}>
            {vms.map(vm => {
                return (
                    <Vm vm={vm} onStart={() => dispatch(startVm(vm.name))} onReboot={() => dispatch(rebootVm(vm.name))}
                        onForceReboot={() => dispatch(forceRebootVm(vm.name))}
                        onShutdown={() => dispatch(shutdownVm(vm.name))}
                        onForceoff={() => dispatch(forceVmOff(vm.name))}/>);
            })}
        </Listing>
    </div>);
};
HostVmsList.propTypes = {
    vms: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired
};

export default HostVmsList;
