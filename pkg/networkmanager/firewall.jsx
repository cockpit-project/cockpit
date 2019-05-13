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
    ListView,
    Modal,
    OverlayTrigger,
    Tooltip
} from "patternfly-react";

import firewall from "./firewall-client.js";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";

import "page.css";
import "table.css";
import "form-layout.less";
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
        <div>
            { props.zones.filter(z => z.services.indexOf(props.service.id) !== -1).map(z => z.name || z.id)
                    .join(', ') }
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

function ZoneRow(props) {
    let columns = [
        { name: props.zone.name, header: true },
        <React.Fragment>{ props.zone.id === firewall.defaultZone ? <span className="fa fa-check">default</span> : '' }</React.Fragment>,
        <React.Fragment>{ props.zone.interfaces.length > 0 ? props.zone.interfaces.join(', ') : '*' }</React.Fragment>,
        <React.Fragment>{ props.zone.source.length > 0 ? props.zone.source.join(', ') : '*' }</React.Fragment>,
    ];
    return <ListingRow key={props.zone.id}
                       columns={columns} />;
}

class SearchInput extends React.Component {
    constructor(props) {
        super(props);

        this.onValueChanged = this.onValueChanged.bind(this);
        this.state = { value: props.value || "" };
    }

    onValueChanged(event) {
        let value = event.target.value;
        this.setState({ value:value });

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
                      value={this.state.value}
                      className={this.props.className}
                      onChange={this.onValueChanged} />;
    }
}

const renderPorts = ports => {
    let tcpPorts = [];
    let udpPorts = [];
    for (let port of ports) {
        if (port.protocol === "tcp")
            tcpPorts.push(port.port);
        else
            udpPorts.push(port.port);
    }
    return (
        <React.Fragment>
            { tcpPorts.length > 0 && <span className="service-ports tcp"><strong>TCP: </strong>{ tcpPorts.join(', ') }</span> }
            { udpPorts.length > 0 && <span className="service-ports udp"><strong>UDP: </strong>{ udpPorts.join(', ') }</span> }
        </React.Fragment>
    );
};

class AddServicesModal extends React.Component {
    constructor() {
        super();

        this.state = {
            services: null,
            selected: new Set(),
            filter: "",
            custom: false,
            generate_name: true,
            tcp_error: "",
            udp_error: "",
            avail_services: null,
            custom_id: "",
            custom_name: "",
            custom_tcp_ports: [],
            custom_udp_ports: [],
            custom_tcp_value: "",
            custom_udp_value: "",
            /* If only one zone is active, automatically add services to that zone */
            zones: firewall.activeZones.size === 1 ? [firewall.defaultZone] : [],
        };
        this.save = this.save.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
        this.setName = this.setName.bind(this);
        this.getName = this.getName.bind(this);
        this.validate = this.validate.bind(this);
        this.createPorts = this.createPorts.bind(this);
        this.parseServices = this.parseServices.bind(this);
        this.generateName = this.generateName.bind(this);
        this.onToggleType = this.onToggleType.bind(this);
        this.onToggleZone = this.onToggleZone.bind(this);
    }

    createPorts() {
        var ret = [];
        this.state.custom_tcp_ports.forEach(port => ret.push([port, 'tcp']));
        this.state.custom_udp_ports.forEach(port => ret.push([port, 'udp']));
        return ret;
    }

    save() {
        if (this.state.custom) {
            firewall.createService(this.state.custom_id, this.state.custom_name, this.createPorts())
                    .then(firewall.enableService(this.state.zones, this.state.custom_id));
        } else {
            firewall.addServices(this.state.zones, [...this.state.selected]);
        }
        this.props.close();
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

    /* Create list of services from /etc/services type file
     *
     * Return dictionary of services:
     *  - key => port number or port alias (80/http)
     *  - item => dictionary with 3 compulsory items:
     *      - name => port alias (http)
     *      - port => port number (80)
     *      - type => list of types (tcp/udp...)
     *      - description => _may be not present_ (Web Server)
     */
    parseServices(content) {
        if (!content) {
            console.warn("Couldn't read /etc/services");
            return [ ];
        }

        var ret = {};
        content.split('\n').forEach(line => {
            if (!line || line.startsWith("#"))
                return;
            let m = line.match(/^(\S+)\s+(\d+)\/(\S+).*?(#(.*))?$/);
            let new_port = { name: m[1], port: m[2], type: [m[3]] };
            if (m.length > 5 && m[5])
                new_port['description'] = m[5].trim();
            if (ret[m[1]])
                ret[m[1]]['type'].push(new_port['type'][0]);
            else
                ret[m[1]] = new_port;
            if (ret[m[2]])
                ret[m[2]]['type'].push(new_port['type'][0]);
            else
                ret[m[2]] = new_port;
        });
        return ret;
    }

    setName(event) {
        this.setState({
            custom_name: event.target.value,
            generate_name: false,
        });
    }

    getName(port) {
        let known = this.state.avail_services[port];
        if (known)
            return known['name'];
        else
            return port;
    }

    generateName(all_ports) {
        var name = "";
        if (all_ports.length === 1) {
            let known = this.state.avail_services[all_ports[0]];
            if (known)
                name = known['description'] || known['name'];
            else
                name = all_ports[0];
        } else if (all_ports.length > 1) {
            name = all_ports.slice(0, 3).map(this.getName)
                    .join(", ");
            if (all_ports.length > 3)
                name += "...";
        }
        return name;
    }

    getPortNumber(port, type, avail) {
        if (!avail) {
            let num_p = Number(port);
            if (isNaN(num_p))
                return [0, _("Unknown service name")];
            else if (num_p <= 0 || num_p > 65535)
                return [0, _("Invalid port number")];
            else
                return [port, ""];
        } else if (avail['type'].indexOf(type) < 0)
            return [0, _("Port number and type do not match")];
        else {
            return [avail.port, ""];
        }
    }

    validate(event) {
        let ports = event.target.value.split(',');
        let error = "";
        let targets = ['tcp', 'custom_tcp_ports', 'tcp_error', 'custom_tcp_value'];
        if (event.target.id === "udp-ports")
            targets = ['udp', 'custom_udp_ports', 'udp_error', 'custom_udp_value'];

        let new_ports = [];
        let self = this;
        ports.forEach(function(port) {
            port = port.trim();
            if (!port)
                return;
            let ports;
            if (port.indexOf("-") > -1) {
                ports = port.split("-");
                if (ports.length != 2) {
                    error = _("Invalid range");
                    return;
                }
                [ports[0], error] = self.getPortNumber(ports[0], targets[0], self.state.avail_services[ports[0]]);
                if (!error) {
                    [ports[1], error] = self.getPortNumber(ports[1], targets[0], self.state.avail_services[ports[1]]);
                    if (!error) {
                        if (Number(ports[0]) >= Number(ports[1]))
                            error = _("Range must be strictly ordered");
                        else
                            new_ports.push(ports[0] + "-" + ports[1]);
                    }
                }
            } else {
                [ports, error] = self.getPortNumber(port, targets[0], self.state.avail_services[port]);
                if (!error)
                    new_ports.push(ports);
            }
        });
        let newState = { [targets[1]]: new_ports,
                         [targets[2]]: error,
                         [targets[3]]: event.target.value };

        let name = this.state.custom_name;
        let all_ports = new_ports.concat(this.state.custom_udp_ports);
        if (event.target.id === "udp-ports")
            all_ports = this.state.custom_tcp_ports.concat(new_ports);

        if (this.state.generate_name)
            name = this.generateName(all_ports);

        let new_id = "custom--" + all_ports.map(this.getName).join('-');

        newState['custom_name'] = name;
        newState['custom_id'] = new_id;
        this.setState(newState);
    }

    onToggleType(event) {
        this.setState({
            custom: event.target.value === "ports"
        });
    }

    onToggleZone(event) {
        let zone = event.target.value;
        this.setState(state => {
            if (state.zones.indexOf(zone) === -1)
                return { zones: state.zones.concat(zone) };
            return { zones: state.zones.filter(z => z !== zone) };
        });
    }

    componentDidMount() {
        firewall.getAvailableServices()
                .then(services => this.setState({
                    services: services.map(s => {
                        s.name = s.name || s.id;
                        return s;
                    })
                }));
        cockpit.file('/etc/services').read()
                .done(content => this.setState({
                    avail_services: this.parseServices(content)
                }));
    }

    onFilterChanged(value) {
        this.setState({ filter: value.toLowerCase() });
    }

    render() {
        let services;
        if (this.state.filter && this.state.services && !isNaN(this.state.filter))
            services = this.state.services.filter(s => {
                for (let port of s.ports)
                    if (port.port === this.state.filter)
                        return true;
                return false;
            });
        else if (this.state.filter && this.state.services)
            services = this.state.services.filter(s => s.name.toLowerCase().indexOf(this.state.filter) > -1);
        else
            services = this.state.services;

        // hide services which have been enabled in all zones
        if (services) {
            services = services.filter(s => {
                let allZonesContainService = true;
                for (let zone of firewall.activeZones)
                    allZonesContainService &= firewall.zones[zone].services.indexOf(s.id) !== -1;
                return !allZonesContainService;
            });
        }

        var addText = this.state.custom ? _("Add Ports") : _("Add Services");
        return (
            <Modal id="add-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title> {addText} </Modal.Title>
                </Modal.Header>
                <div id="cockpit_modal_dialog">
                    <Modal.Body id="add-services-dialog">
                        { firewall.activeZones.size > 1 &&
                            <React.Fragment>
                                <form className="ct-form-layout horizontal">
                                    <label htmlFor="zone-input">{ _("Add services to following zones:") }</label>
                                    <fieldset id="zone-input">
                                        { Array.from(firewall.activeZones).sort((a, b) => a.localeCompare(b))
                                                .map(z =>
                                                    <label className="radio" key={z}>
                                                        <input type="checkbox" value={z} onChange={this.onToggleZone} />{ z }{ z === firewall.defaultZone && " " + _("(default)") }
                                                    </label>) }
                                    </fieldset>
                                </form>
                                <hr />
                            </React.Fragment>}
                        <form action="" className="toggle-body ct-form-layout">
                            <label className="radio ct-form-layout-full">
                                <input type="radio" name="type" value="services" onChange={this.onToggleType} defaultChecked />
                                {_("Services")}
                            </label>
                            { this.state.custom ||
                                <React.Fragment>
                                    { services ? (
                                        <fieldset className="ct-form-layout">
                                            <label htmlFor="filter-services-input" className="control-label">
                                                {_("Filter Services")}
                                            </label>
                                            <SearchInput id="filter-services-input"
                                                value={this.state.filter}
                                                className="form-control"
                                                onChange={this.onFilterChanged} />
                                            <ListView className="list-group dialog-list-ct ct-form-layout-full">
                                                {
                                                    services.map(s => (
                                                        <ListView.Item key={s.id}
                                                                       className="list-group-item"
                                                                       checkboxInput={ <input data-id={s.id}
                                                                                              id={"firewall-service-" + s.id}
                                                                                              type="checkbox"
                                                                                              checked={this.state.selected.has(s.id)}
                                                                                              onChange={this.onToggleService} /> }
                                                                       stacked
                                                                       heading={ <label htmlFor={"firewall-service-" + s.id}>{s.name}</label> }
                                                                       description={ renderPorts(s.ports) }>
                                                        </ListView.Item>
                                                    ))
                                                }
                                            </ListView>
                                        </fieldset>
                                    ) : (
                                        <div className="spinner spinner-lg" />
                                    )}
                                </React.Fragment>
                            }
                            <label className="radio ct-form-layout-full">
                                <input type="radio" name="type" value="ports" onChange={this.onToggleType} disabled={this.state.avail_services == null} />
                                {_("Custom Ports")}
                            </label>
                            { !this.state.custom ||
                                <React.Fragment>
                                    <label className="control-label" htmlFor="hint" hidden>Hint</label>
                                    <p id="hint">
                                        {_("Comma-separated ports, ranges, and aliases are accepted")}
                                    </p>

                                    <label className="control-label" htmlFor="tcp-ports">TCP</label>
                                    <input id="tcp-ports" type="text" onChange={this.validate}
                                           className={"form-control " + (this.state.tcp_error ? "error" : "") }
                                           value={this.state.custom_tcp_value}
                                           placeholder={_("Example: 22,ssh,8080,5900-5910")}
                                           autoFocus />
                                    <output className="has-error" htmlFor="tcp-ports">{this.state.tcp_error}</output>

                                    <label className="control-label" htmlFor="udp-ports">UDP</label>
                                    <input id="udp-ports" type="text" onChange={this.validate}
                                           className={"form-control " + (this.state.udp_error ? "error" : "") }
                                           value={this.state.custom_udp_value}
                                           placeholder={_("Example: 88,2019,nfs,rsync")} />
                                    <output className="has-error" htmlFor="udp-ports">{this.state.udp_error}</output>

                                    <label className="control-label" htmlFor="service-name">Name</label>
                                    <input id="service-name" className="form-control" type="text" onChange={this.setName}
                                           placeholder={_("(Optional)")} value={this.state.custom_name} />
                                </React.Fragment>
                            }
                        </form>
                    </Modal.Body>
                </div>
                <Modal.Footer>
                    <Button bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.save}>
                        {addText}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

class RemoveServicesModal extends React.Component {
    constructor(props) {
        super(props);

        this.zonesWithService = Array.from(firewall.activeZones)
                .filter(z => firewall.zones[z].services.indexOf(this.props.service) !== -1);
        this.state = {
            zones: this.zonesWithService.length === 1 ? this.zonesWithService : [],
        };
        this.save = this.save.bind(this);
        this.onToggleZone = this.onToggleZone.bind(this);
    }

    save() {
        firewall.removeServiceFromZones(this.state.zones, this.props.service);
        this.props.close();
    }

    onToggleZone(event) {
        let zone = event.target.value;
        this.setState(state => {
            if (state.zones.indexOf(zone) === -1)
                return { zones: state.zones.concat(zone) };
            return { zones: state.zones.filter(z => z !== zone) };
        });
    }

    render() {
        return (
            <Modal id="remove-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title>{ _("Remove service from zones") }</Modal.Title>
                </Modal.Header>
                <Modal.Body id="remove-services-dialog-body">
                    <form className="ct-form-layout horizontal">
                        <fieldset id="zone-input">
                            { this.zonesWithService.map(z =>
                                <label className="radio" key={z}>
                                    <input type="checkbox" value={z} onChange={this.onToggleZone} defaultChecked={ this.zonesWithService.length === 1 } />
                                    { z }{ z === firewall.defaultZone && " " + _("(default)") }
                                </label>) }
                        </fieldset>
                    </form>
                </Modal.Body>
                <Modal.Footer>
                    <Button bsStyle="default" className="btn-cancel" onClick={this.props.close}>
                        { _("Cancel") }
                    </Button>
                    <Button bsStyle="primary" onClick={this.save} disabled={ this.zonesWithService.length === 0 || this.state.zones.length === 0 }>
                        { _("Remove service") }
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
            showAddServicesModal: false,
            showRemoveServicesModal: false,
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
        this.setState({ showRemoveServicesModal: service });
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    close() {
        this.setState({ showAddServicesModal: false, showRemoveServicesModal: false });
    }

    open() {
        this.setState({ showAddServicesModal: true });
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

        var zones = [...this.state.firewall.activeZones].map(id => {
            const zone = this.state.firewall.zones[id];
            zone.name = zone.name || id;
            return zone;
        });

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
                <div id="zones-listing">
                    { enabled && <Listing title={_("Active zones")}
                             columnTitles={[ _("Zone"), "", _("Interfaces"), _("IP Range") ]}
                             emptyCaption={_("No active zones")}>
                        {
                            zones.map(z => <ZoneRow key={z.id}
                                                    zone={z}
                                                    readonly={this.state.firewall.readonly} />)
                        }
                    </Listing> }
                </div>
                <div id="services-listing">
                    { enabled && <Listing title={_("Allowed Services")}
                             columnTitles={[ _("Service"), _("TCP"), _("UDP"), _("Zones"), "" ]}
                             emptyCaption={_("No open ports")}
                             actions={addServiceAction}>
                        {
                            services.map(s => <ServiceRow key={s.id}
                                                      service={s}
                                                      zones={zones}
                                                      readonly={this.state.firewall.readonly}
                                                      onRemoveService={this.onRemoveService} />)
                        }
                    </Listing> }
                </div>
                { this.state.showAddServicesModal && <AddServicesModal close={this.close} /> }
                { this.state.showRemoveServicesModal && <RemoveServicesModal service={this.state.showRemoveServicesModal} close={this.close} /> }
            </div>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
