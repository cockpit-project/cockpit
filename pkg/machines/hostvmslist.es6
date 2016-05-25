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
import { ReloadSwitch } from "./reloadSwitch.es6";
import { canReset, canShutdown, canRun, rephraseUI, logDebug, toGigaBytes } from "./helpers.es6";
import DonutChart from "./c3charts.es6";
import cockpitListing from "cockpit-components-listing.jsx";

function NoVm() {
    return React.createElement("div", {className: "cockpit-log-warning"},
        React.createElement("div", {className: "blank-slate-pf"},
            React.createElement("div", {className: "blank-slate-pf-icon"},
                React.createElement("i", {className: "pficon pficon-virtual-machine"})),
            React.createElement("span", null,
                React.createElement("h1", null, "No VM is running or defined on this host"))
        ));
}

function VmActions({vmId, state, onStart, onReboot, onForceReboot, onShutdown, onForceoff}) {
    return React.createElement("div", null,
        canReset(state) ? DropdownButtons([{
            title: "Restart",
            action: onReboot,
            id: `${vmId}-reboot`
        }, {title: "Force Restart", action: onForceReboot, id: `${vmId}-forceReboot`}]) : "",
        canShutdown(state) ? DropdownButtons([{
            title: "Shut Down",
            action: onShutdown,
            id: `${vmId}-off`
        }, {title: "Force Shut Down", action: onForceoff, id: `${vmId}-forceOff`}]) : "",
        canRun(state) ? React.createElement("button", {
            className: "btn btn-default btn-danger",
            onClick: onStart
        }, "Run") : ""
    );
}

function StateIcon({ state }) {
    function iconElement({onClick, className, title}) {
        return React.createElement("span", {title, 'data-toggle': 'tooltip', 'data-placement': 'left'}, `${state} `,
            React.createElement('i', {onClick, className}));
    }

    switch (state) {
        case 'running':// TODO: display VM screenshot if available or the ok-icon otherwise
            return iconElement({className: 'pficon pficon-ok icon-1x-vms', title: 'The VM is running.'});
        case 'idle':
            return iconElement({className: 'pficon pficon-running icon-1x-vms', title: 'The VM is idle.'});
        case 'paused':
            return iconElement({className: 'pficon pficon-pause icon-1x-vms', title: 'The VM is paused.'});
        case 'shutdown':
            return iconElement({className: 'glyphicon glyphicon-wrench icon-1x-vms', title: 'The VM is going down.'});
        case 'shut off':
            return iconElement({className: 'fa fa-arrow-circle-o-down icon-1x-vms', title: 'The VM is down.'});
        case 'crashed':
            return iconElement({className: 'pficon pficon-error-circle-o icon-1x-vms', title: 'The VM crashed.'});
        case 'dying':
            return iconElement({
                className: 'pficon pficon-warning-triangle-o icon-1x-vms',
                title: 'The VM is in process of dying (shut down or crash is not completed).'
            });
        case 'pmsuspended':
            return iconElement({
                className: 'pficon pficon-ok icon-1x-vms',
                title: 'The VM is suspended by guest power management'
            });
        case undefined:
            return React.createElement("div");
        default:
            return React.createElement("small", null, state);
    }
}

/**
 * Render group of buttons as a dropdown
 *
 * @param buttons array of objects [ {title, action, id}, ... ].
 *        At least one button is required. Button id is optional.
 * @returns {*}
 * @constructor
 */
function DropdownButtons(buttons) {
    const buttonsHtml = buttons.map(
        button => React.createElement("li", {className: "presentation"},
            React.createElement("a", {role: "menuitem", onClick: button.action, id: button['id']}, button.title))
    );

    const caretId = buttons[0]['id'] ? `${buttons[0]['id']}-caret` : undefined;

    return React.createElement("div", {className: "btn-group"},
        React.createElement("button", {
            className: "btn btn-default btn-danger",
            onClick: buttons[0].action
        }, buttons[0].title),
        React.createElement("button", {'data-toggle': "dropdown", className: "btn btn-default dropdown-toggle"},
            React.createElement("span", {className: "caret", id: caretId})),
        React.createElement("ul", {role: "menu", className: "dropdown-menu"}, buttonsHtml)
    );
}

function vmId(vmName) {
    return `vm-${vmName}`;
}
const VmOverviewTab = React.createClass({
    propTypes: {
        vm: React.PropTypes.object.isRequired,
    },
    render: function () {
        const vm = this.props.vm;

        return React.createElement("table", {className: "machines-width-max"},
            React.createElement("tr", {className: "machines-listing-ct-body-detail"},
                React.createElement("td", null, // left column
                    React.createElement("table", {className: "form-table-ct"},

                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "State:")),
                            React.createElement("td", {id: `${vmId(vm.name)}-state`}, vm.state)),

                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "Memory:")),
                            React.createElement("td", null, cockpit.format_bytes((vm.currentMemory ? vm.currentMemory : 0) * 1024))),

                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "vCPUs:")),
                            React.createElement("td", null, vm.vcpus)))),

                React.createElement("td", null, // right column
                    React.createElement("table", {className: "form-table-ct"},
                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "ID:")),
                            React.createElement("td", null, vm.id)),

                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "OS Type:")),
                            React.createElement("td", null, vm.osType)),

                        React.createElement("tr", null,
                            React.createElement("td", {className: "top"},
                                React.createElement("label", {className: "control-label"}, "Autostart:")),
                            React.createElement("td", null, rephraseUI('autostart', vm.autostart)))
                    ))
            ));
    }
});

const VmUsageTab = React.createClass({
    propTypes: {
        vm: React.PropTypes.object.isRequired,
    },
    render: function () {
        const width = 220;
        const height = 170;

        const vm = this.props.vm;

        const rssMem = vm["rssMemory"] ? vm["rssMemory"] : 0; // in KiB
        const memTotal = vm["currentMemory"] ? vm["currentMemory"] : 0; // in KiB
        let available = memTotal - rssMem; // in KiB
        available = available < 0 ? 0 : available;

        const totalCpus = vm['vcpus'] > 0 ? vm['vcpus'] : 0;
        // 4 CPU system can have usage 400%, let's keep % between 0..100
        let cpuUsage = vm['cpuUsage'] / (totalCpus > 0 ? totalCpus : 1);
        cpuUsage = isNaN(cpuUsage) ? 0 : cpuUsage;

        logDebug(`VmUsageTab.render(): rssMem: ${rssMem} KiB, memTotal: ${memTotal} KiB, available: ${available} KiB, totalCpus: ${totalCpus}, cpuUsage: ${cpuUsage}`);

        return React.createElement('table', null,
            React.createElement('tr', null,
                React.createElement('td', null,
                    React.createElement(DonutChart, {
                        data: {
                            columns: [
                                ["Used", toGigaBytes(rssMem, 'KiB')],
                                ["Available", toGigaBytes(available, 'KiB')]
                            ],
                            groups: [
                                ["used", "available"]
                            ],
                            order: null
                        },
                        size: {
                            width, // keep the .usage-donut-caption CSS in sync
                            height
                        },
                        width: 8,
                        tooltipText: ' ', // GB
                        primaryTitle: toGigaBytes(rssMem, 'KiB'),
                        secondaryTitle: 'GB',
                        caption: `used from ${cockpit.format_bytes(memTotal * 1024)} memory`
                    })),
                React.createElement('td', null,
                    React.createElement(DonutChart, {
                        data: {
                            columns: [
                                ["Used", cpuUsage],
                                ["Available", 100.0 - cpuUsage]
                            ],
                            groups: [
                                ["used", "available"]
                            ],
                            order: null
                        },
                        size: {
                            width, // keep the .usage-donut-caption CSS in sync
                            height
                        },
                        width: 8,
                        tooltipText: ' ', // %
                        primaryTitle: cpuUsage,
                        secondaryTitle: '%',
                        caption: `used from ${totalCpus} vCPUs`
                    })
                )));

        /*
         color = {
         pattern: ['#3f9c35', '#cc0000', '#D1D1D1']
         }
         */
    }
});

/** One VM in the list (a row)
 */
const Vm = React.createClass({
    propTypes: {
        vm: React.PropTypes.object.isRequired,
        onStart: React.PropTypes.func.isRequired,
        onShutdown: React.PropTypes.func.isRequired,
        onForceoff: React.PropTypes.func.isRequired,
        onReboot: React.PropTypes.func.isRequired,
        onForceReboot: React.PropTypes.func.isRequired
    },
    render: function () {
        const vm = this.props.vm;

        return React.createElement(cockpitListing.ListingRow, {
            columns: [
                {name: vm.name, 'header': true},
                React.createElement(StateIcon, {state: vm.state})
            ],
            tabRenderers: [
                {
                    name: 'Overview',
                    renderer: VmOverviewTab,
                    data: {vm: vm}
                },
                {
                    name: 'Usage',
                    renderer: VmUsageTab,
                    data: {vm: vm},
                    presence: 'onlyActive'
                }
            ],
            listingActions: VmActions({
                vmId: vmId(vm.name), state: vm.state,
                onStart: this.props.onStart,
                onReboot: this.props.onReboot, onForceReboot: this.props.onForceReboot,
                onShutdown: this.props.onShutdown, onForceoff: this.props.onForceoff
            })
        });
    }
});

/**
 * List of all VMs defined on this host
 */
const HostVmsList = React.createClass({
    propTypes: {
        vms: React.PropTypes.object.isRequired,
        dispatch: React.PropTypes.func.isRequired
    },
    render: function () {
        const vms = this.props.vms;
        const dispatch = this.props.dispatch;

        let rows = [];
        if (vms.length !== 0) {
            rows = vms.map(vm =>
                React.createElement(Vm, {
                        vm: vm,
                        onStart: () => dispatch(startVm(vm.name)),
                        onReboot: () => dispatch(rebootVm(vm.name)),
                        onForceReboot: () => dispatch(forceRebootVm(vm.name)),
                        onShutdown: () => dispatch(shutdownVm(vm.name)),
                        onForceoff: () => dispatch(forceVmOff(vm.name))
                    }
                ));
        }

        return React.createElement("div", {className: 'container-fluid'}, (vms.length === 0) ? React.createElement(NoVm) :
            React.createElement(cockpitListing.Listing, {
                title: "Virtual Machines",
                columnTitles: ['Name', 'State']
            }, rows)
        );
    }
});

export default HostVmsList;
