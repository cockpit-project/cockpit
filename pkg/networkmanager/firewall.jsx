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
import ReactDOM from "react-dom";
import {
    Button,
    Modal,
    OverlayTrigger,
    Tooltip
} from "patternfly-react";

import firewall from "./firewall-client.js";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";

import "page.css";
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
            <OverlayTrigger className="pull-right" placement="top"
                            overlay={ <Tooltip id="tip-auth">{ _("You are not authorized to modify the firewall.") }</Tooltip> } >
                <button className="btn btn-danger pficon pficon-delete" disabled />
            </OverlayTrigger>
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

    var tabs = [];
    if (props.service.description)
        tabs.push({ name: _("Details"), renderer: () => <p>{props.service.description}</p> });

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
        return <input autoFocus
                      id={this.props.id}
                      className={this.props.className}
                      onChange={this.onValueChanged} />;
    }
}

class AddServicesBody extends React.Component {
    constructor() {
        super();

        this.state = {
            services: null,
            selected: new Set(),
            filter: ""
        };

        this.save = this.save.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
    }

    save() {
        firewall.addServices([...this.state.selected]);
        this.props.close();
    }

    componentDidMount() {
        firewall.getAvailableServices()
                .then(services => this.setState({
                    services: services.map(s => {
                        s.name = s.name || s.id;
                        return s;
                    })
                }));
    }

    onFilterChanged(value) {
        this.setState({ filter: value.toLowerCase() });
    }

    onToggleService(event) {
        var service = event.target.getAttribute("data-id");
        var enabled = event.target.checked;

        this.setState(oldState => {
            let selected = new Set(oldState.selected);

            if (enabled)
                selected.add(service);
            else
                selected.delete(service);

            return {
                selected: selected
            };
        });
    }

    render() {
        let services;
        if (this.state.filter && this.state.services)
            services = this.state.services.filter(s => s.name.toLowerCase().indexOf(this.state.filter) > -1);
        else
            services = this.state.services;

        // hide already enabled services
        if (services)
            services = services.filter(s => !firewall.enabledServices.has(s.id));

        let body;
        if (this.state.services) {
            body = (
                <Modal.Body id="add-services-dialog">
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
                                        <input data-id={s.id}
                                               type="checkbox"
                                               checked={this.state.selected.has(s.id)}
                                               onChange={this.onToggleService} />
                                        &nbsp;
                                        <span>{s.name}</span>
                                    </label>
                                </li>
                            ))
                        }
                    </ul>
                </Modal.Body>
            );
        } else {
            body = (
                <Modal.Body id="add-services-dialog">
                    <div className="spinner spinner-lg" />
                </Modal.Body>
            );
        }

        return (
            <Modal id="add-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title> {`Add Services`} </Modal.Title>
                </Modal.Header>
                <div id="cockpit_modal_dialog">
                    {body}
                </div>
                <Modal.Footer>
                    <Button bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.save}>
                        {_("Add Services")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

export class Firewall extends React.Component {
    constructor() {
        super();

        this.state = {
            showModal: false,
            firewall,
            pendingTarget: null /* `null` for not pending */
        };

        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.onSwitchChanged = this.onSwitchChanged.bind(this);
        this.onRemoveService = this.onRemoveService.bind(this);
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
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

    onRemoveService(service) {
        firewall.removeService(service);
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    close() {
        this.setState({ showModal: false });
    }

    open() {
        this.setState({ showModal: true });
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
                    <p>{cockpit.format(_("Please install the $0 package"), "firewalld")}</p>
                </EmptyState>
            );
        }

        var addServiceAction;
        if (this.state.firewall.readonly) {
            addServiceAction = (
                <OverlayTrigger className="pull-right" placement="top"
                                overlay={ <Tooltip id="tip-auth">{ _("You are not authorized to modify the firewall.") }</Tooltip> } >
                    <Button bsStyle="primary" className="pull-right" disabled> {_("Add Services")} </Button>
                </OverlayTrigger>
            );
        } else {
            addServiceAction = (
                <Button bsStyle="primary" onClick={this.open} className="pull-right">
                    {_("Add Services")}
                </Button>
            );
        }

        var services = [...this.state.firewall.enabledServices].map(id => {
            const service = this.state.firewall.services[id];
            service.name = service.name || id;
            return service;
        });
        services.sort((a, b) => a.name.localeCompare(b.name));

        var enabled = this.state.pendingTarget !== null ? this.state.pendingTarget : this.state.firewall.enabled;

        return (
            <div className="container-fluid page-ct">
                <ol className="breadcrumb">
                    <li><a tabIndex="0" onClick={go_up}>{_("Networking")}</a></li>
                    <li className="active">{_("Firewall")}</li>
                </ol>
                <h1>
                    {_("Firewall")}
                    <OnOffSwitch state={enabled}
                                 enabled={this.state.pendingTarget === null}
                                 onChange={this.onSwitchChanged} />
                </h1>
                { enabled && <Listing title={_("Allowed Services")}
                         columnTitles={[ _("Service"), _("TCP"), _("UDP"), "" ]}
                         emptyCaption={_("No open ports")}
                         actions={addServiceAction}>
                    {
                        services.map(s => <ServiceRow key={s.id}
                                                      service={s}
                                                      readonly={this.state.firewall.readonly}
                                                      onRemoveService={this.onRemoveService} />)
                    }
                </Listing> }
                { this.state.showModal && <AddServicesBody close={this.close} /> }
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
