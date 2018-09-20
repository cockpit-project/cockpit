/* jshint esversion: 6 */

/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import cockpit from "cockpit";
import React from "react";
import ReactDOM from 'react-dom';

import firewall from "./firewall-client.es6";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import { show_modal_dialog } from "cockpit-components-dialog.jsx";
import { Tooltip } from "cockpit-components-tooltip.jsx";

import "table.css";
import "./networking.css";

const _ = cockpit.gettext;

function EmptyState(props) {
    return (
        <div className="curtains-ct blank-slate-pf">
            {props.icon && <div className={"blank-slate-pf-icon " + props.icon} />}
            <h1>{props.title}</h1>
            {props.children}
        </div>
    );
}

function ServiceRow(props) {
    if (!props.service.name)
        return <ListingRow key={props.service.id} columns={["", "", ""]} />;

    var tcp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'TCP');
    var udp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'UDP');

    function onRemoveService(event) {
        if (event.button !== 0)
            return;

        props.onRemoveService(props.service.id);
        event.stopPropagation();
    }

    var deleteButton;
    if (props.readonly) {
        deleteButton = (
            <Tooltip className="pull-right" tip={_("You are not authorized to modify the firewall.")}>
                <button className="btn btn-danger pficon pficon-delete" disabled />
            </Tooltip>
        );
    } else {
        deleteButton = <button className="btn btn-danger pficon pficon-delete" onClick={onRemoveService} />;
    }

    var columns = [
        { name: props.service.name, header: true },
        <div>
            { tcp.map(p => p.port).join(', ') }
        </div>,
        <div>
            { udp.map(p => p.port).join(', ') }
        </div>,
        deleteButton
    ];

    var tabs = [
        { name: _("Details"), renderer: () => <p>{props.service.description}</p> }
    ];

    return <ListingRow key={props.service.id}
                       rowId={props.service.id}
                       columns={columns}
                       tabRenderers={tabs} />;
}

class SearchInput extends React.Component {
    constructor() {
        super();

        this.onValueChanged = this.onValueChanged.bind(this);
    }

    onValueChanged(event) {
        let value = event.target.value;

        if (this.timer)
            window.clearTimeout(this.timer);

        this.timer = window.setTimeout(() => {
            this.props.onChange(value);
            this.timer = null;
        }, 300);
    }

    render() {
        return <input id={this.props.id}
                      className={this.props.className}
                      onChange={this.onValueChanged} />;
    }
}

class AddServicesDialogBody extends React.Component {
    constructor() {
        super();

        this.state = {
            services: null,
            selected: new Set(),
            filter: ""
        };

        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
    }

    componentDidMount() {
        firewall.getAvailableServices()
                .then(services => this.setState({ services: services }));
    }

    onFilterChanged(value) {
        this.setState({ filter: value.toLowerCase() });
    }

    onToggleService(event) {
        var service = event.target.id;
        var enabled = event.target.checked;

        this.setState(oldState => {
            let selected = new Set(oldState.selected);

            if (enabled)
                selected.add(service);
            else
                selected.delete(service);

            this.props.selectionChanged(selected);

            return {
                selected: selected
            };
        });
    }

    render() {
        if (!this.state.services) {
            return (
                <div className="modal-body">
                    <div className="spinner spinner-lg" />
                </div>
            );
        }

        var services;
        if (this.state.filter)
            services = this.state.services.filter(s => s.name.toLowerCase().indexOf(this.state.filter) > -1);
        else
            services = this.state.services;

        return (
            <div id="add-services-dialog" className="modal-body">
                <table className="form-table-ct">
                    <tbody>
                        <tr>
                            <td>
                                <label htmlFor="filter-services-input" className="control-label">
                                    {_("Filter Services")}
                                </label>
                            </td>
                            <td>
                                <SearchInput id="filter-services-input"
                                             className="form-control"
                                             onChange={this.onFilterChanged} />
                            </td>
                        </tr>
                    </tbody>
                </table>
                <ul className="list-group dialog-list-ct">
                    {
                        services.map(s => (
                            <li key={s.id} className="list-group-item">
                                <label>
                                    <input id={s.id}
                                           type="checkbox"
                                           checked={this.state.selected.has(s.id)}
                                           onClick={this.onToggleService} />
                                    &nbsp;
                                    <span>{s.name}</span>
                                </label>
                            </li>
                        ))
                    }
                </ul>
            </div>
        );
    }
}

export class Firewall extends React.Component {
    constructor() {
        super();

        this.state = {
            firewall,
            pendingTarget: null /* `null` for not pending */
        };

        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.onSwitchChanged = this.onSwitchChanged.bind(this);
        this.onAddServices = this.onAddServices.bind(this);
        this.onRemoveService = this.onRemoveService.bind(this);
    }

    onFirewallChanged() {
        this.setState((prevState) => {
            if (prevState.pendingTarget === firewall.enabled)
                return { firewall, pendingTarget: null };

            return { firewall };
        });
    }

    onSwitchChanged(value) {
        this.setState({ pendingTarget: value });

        if (value)
            firewall.enable();
        else
            firewall.disable();
    }

    onAddServices() {
        var services = [...this.state.firewall.services].map(id => this.state.firewall.services[id]);
        services.sort((a, b) => a.name.localeCompare(b.name));

        var selected = new Set();

        show_modal_dialog(
            {
                title: _("Add Services"),
                body: <AddServicesDialogBody selectionChanged={s => { selected = [...s] }} />
            },
            {
                cancel_caption: _("Cancel"),
                actions: [
                    {
                        caption: _("Add Services"),
                        style: 'primary',
                        clicked: () => firewall.addServices(selected)
                    }
                ]
            });
    }

    onRemoveService(service) {
        firewall.removeService(service);
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    render() {
        function go_up(event) {
            if (!event || event.button !== 0)
                return;

            cockpit.jump("/network", cockpit.transport.host);
        }

        if (!this.state.firewall.installed) {
            return (
                <EmptyState title={_("Firewall is not available")} icon="fa fa-exclamation-circle">
                    <p>{cockpit.format(_("Please install the {0} package"), "firewalld")}</p>
                </EmptyState>
            );
        }

        var addServiceAction;
        if (this.state.firewall.readonly) {
            addServiceAction = (
                <Tooltip key="" className="pull-right" tip={_("You are not authorized to modify the firewall.")}>
                    <button className="btn btn-primary" disabled> {_("Add Services…")} </button>
                </Tooltip>
            );
        } else {
            addServiceAction = <button key="" className="btn btn-primary pull-right" onClick={this.onAddServices}>{_("Add Services…")}</button>;
        }

        var services = [...this.state.firewall.enabledServices].map(id => this.state.firewall.services[id]);
        services.sort((a, b) => a.name.localeCompare(b.name));

        var enabled = this.state.pendingTarget !== null ? this.state.pendingTarget : this.state.firewall.enabled;

        return (
            <div className="container-fluid page-ct">
                <ol className="breadcrumb">
                    <li><a onClick={go_up}>{_("Networking")}</a></li>
                    <li className="active">{_("Firewall")}</li>
                </ol>
                <h1>
                    {_("Firewall")}
                    <OnOffSwitch state={enabled}
                                 enabled={this.state.pendingTarget === null}
                                 onChange={this.onSwitchChanged} />
                </h1>
                <Listing title={_("Allowed Services")}
                         columnTitles={[ _("Service"), _("TCP"), _("UDP"), "" ]}
                         emptyCaption={_("No open ports")}
                         actions={[ addServiceAction ]}>
                    {
                        services.map(s => <ServiceRow key={s.id}
                                                      service={s}
                                                      readonly={this.state.firewall.readonly}
                                                      onRemoveService={this.onRemoveService} />)
                    }
                </Listing>
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
