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

import '../../src/base1/patternfly-cockpit.scss';
import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";
import {
    ListView,
    Modal,
} from "patternfly-react";
import { Alert, Button, Tooltip } from '@patternfly/react-core';
import { ExclamationCircleIcon, TrashIcon } from '@patternfly/react-icons';

import firewall from "./firewall-client.js";
import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { OnOffSwitch } from "cockpit-components-onoff.jsx";
import { ModalError } from "cockpit-components-inline-notification.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";

import { superuser } from "superuser";

import "page.scss";
import "table.css";
import "form-layout.scss";
import "./networking.css";

const _ = cockpit.gettext;

superuser.reload_page_on_change();

function ServiceRow(props) {
    var tcp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'TCP');
    var udp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'UDP');

    for (const s of props.service.includes) {
        if (firewall.services[s]) {
            tcp = tcp.concat(firewall.services[s].ports.filter(p => p.protocol.toUpperCase() == 'TCP'));
            udp = udp.concat(firewall.services[s].ports.filter(p => p.protocol.toUpperCase() == 'UDP'));
        }
    }

    function onRemoveService(event) {
        if (event.button !== 0)
            return;

        props.onRemoveService(props.service.id);
        event.stopPropagation();
    }

    var deleteButton = <Button key={props.service.id + "-delete-button"} variant="danger" onClick={onRemoveService} aria-label={cockpit.format(_("Remove service $0"), props.service.id)}><TrashIcon /></Button>;

    var columns = [
        { name: props.service.id, header: true },
        <div key={props.service.id + "tcp"}>
            { tcp.map(p => p.port).join(', ') }
        </div>,
        <div key={props.service.id + "udp"}>
            { udp.map(p => p.port).join(', ') }
        </div>,
        null
    ];

    let description, includes;
    if (props.service.description)
        description = <p>{props.service.description}</p>;

    if (props.service.includes.length > 0) {
        includes = <>
            <h5>Included Services</h5>
            <ul>{props.service.includes.map(s => {
                const service = firewall.services[s];
                if (service && service.description)
                    return <li key={service.id}><strong>{service.id}</strong>: {service.description}</li>;
            })} </ul></>;
    }
    const simpleBody = <>{description}{includes}</>;

    return <ListingRow key={props.service.id}
                       rowId={props.service.id}
                       columns={columns}
                       simpleBody={simpleBody}
                       listingActions={!props.readonly && deleteButton} />;
}

function PortRow(props) {
    const columns = [
        <i key={props.zone.id + "-additional-ports"}>{ _("Additional ports") }</i>,
        props.zone.ports
                .filter(p => p.protocol === "tcp")
                .map(p => p.port)
                .join(", "),
        props.zone.ports
                .filter(p => p.protocol === "udp")
                .map(p => p.port)
                .join(", "),
        null
    ];
    return <ListingRow key={props.zone.id + "-ports"}
                       rowId={props.zone.id + "-ports"}
                       columns={columns} />;
}

function ZoneSection(props) {
    function onRemoveZone(event) {
        if (event.button !== 0)
            return;

        event.stopPropagation();
        props.onRemoveZone(props.zone.id);
    }

    let deleteButton;
    if (props.readonly) {
        deleteButton = (
            <Tooltip id="tip-auth" content={ _("You are not authorized to modify the firewall.") }>
                <span>
                    <Button variant="danger" aria-label={cockpit.format(_("Not authorized to remove zone $0"), props.zone.id)} isDisabled><span className="pficon pficon-delete" /></Button>
                </span>
            </Tooltip>
        );
    } else {
        deleteButton = <Button variant="danger" onClick={onRemoveZone} aria-label={cockpit.format(_("Remove zone $0"), props.zone.id)}><span className="pficon pficon-delete" /></Button>;
    }

    const addServiceAction = (
        <Button variant="primary" onClick={() => props.openServicesDialog(props.zone.id, props.zone.id)} className="add-services-button" aria-label={cockpit.format(_("Add services to zone $0"), props.zone.id)}>
            {_("Add Services")}
        </Button>
    );

    return <div className="zone-section" data-id={props.zone.id}>
        <div className="zone-section-heading">
            <span>
                <h4>{ cockpit.format(_("$0 zone"), props.zone.id) }</h4>
                <div className="zone-section-targets">
                    { props.zone.interfaces.length > 0 && <span className="zone-section-target"><strong>{_("Interfaces")}</strong> {props.zone.interfaces.join(", ")}</span> }
                    { props.zone.source.length > 0 && <span className="zone-section-target"><strong>{_("Addresses")}</strong> {props.zone.source.join(", ")}</span> }
                </div>
            </span>
            { !firewall.readonly && <div className="zone-section-buttons">{deleteButton}{addServiceAction}</div> }
        </div>
        {props.zone.services.length > 0 &&
        <Listing columnTitles={[_("Service"), _("TCP"), _("UDP"), ""]}
                     emptyCaption={_("There are no active services in this zone")}>
            { props.zone.services.map(s => {
                if (s in firewall.services)
                    return <ServiceRow key={firewall.services[s].id}
                                       service={firewall.services[s]}
                                       onRemoveService={service => props.onRemoveService(props.zone.id, service)}
                                       readonly={firewall.readonly} />;
            })
            }
            { props.zone.ports.length > 0 &&
            <PortRow key={props.zone.id + "-ports"}
                     zone={props.zone}
                     readonly={firewall.readonly} />}

        </Listing>
        }
    </div>;
}

class SearchInput extends React.Component {
    constructor(props) {
        super(props);

        this.onValueChanged = this.onValueChanged.bind(this);
        this.state = { value: props.value || "" };
    }

    onValueChanged(event) {
        const value = event.target.value;
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

const renderPorts = service => {
    const tcpPorts = [];
    const udpPorts = [];
    function addPorts(ports) {
        for (const port of ports) {
            if (port.protocol === "tcp")
                tcpPorts.push(port.port);
            else
                udpPorts.push(port.port);
        }
    }
    addPorts(service.ports);
    for (const s of service.includes)
        addPorts(firewall.services[s].ports);

    return (
        <>
            { tcpPorts.length > 0 && <span className="service-ports tcp"><strong>TCP: </strong>{ tcpPorts.join(', ') }</span> }
            { udpPorts.length > 0 && <span className="service-ports udp"><strong>UDP: </strong>{ udpPorts.join(', ') }</span> }
        </>
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
            generate_custom_id: true,
            tcp_error: "",
            udp_error: "",
            avail_services: null,
            custom_id: "",
            custom_tcp_ports: [],
            custom_udp_ports: [],
            custom_tcp_value: "",
            custom_udp_value: "",
            dialogError: null,
            dialogErrorDetail: null,
        };
        this.save = this.save.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
        this.setId = this.setId.bind(this);
        this.getName = this.getName.bind(this);
        this.validate = this.validate.bind(this);
        this.createPorts = this.createPorts.bind(this);
        this.parseServices = this.parseServices.bind(this);
        this.onToggleType = this.onToggleType.bind(this);
    }

    createPorts() {
        var ret = [];
        this.state.custom_tcp_ports.forEach(port => ret.push([port, 'tcp']));
        this.state.custom_udp_ports.forEach(port => ret.push([port, 'udp']));
        return ret;
    }

    save() {
        let p;
        if (this.state.custom) {
            p = firewall.createService(this.state.custom_id, this.createPorts(), this.props.zoneId);
        } else {
            p = firewall.addServices(this.props.zoneId, [...this.state.selected]);
        }
        p.then(() => this.props.close())
                .catch(error => {
                    this.setState({
                        dialogError: this.state.custom ? _("Failed to add port") : _("Failed to add service"),
                        dialogErrorDetail: error.name + ": " + error.message,
                    });
                });
    }

    onToggleService(event) {
        var service = event.target.getAttribute("data-id");
        var enabled = event.target.checked;

        this.setState(oldState => {
            const selected = new Set(oldState.selected);

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
            return [];
        }

        var ret = {};
        content.split('\n').forEach(line => {
            if (!line || line.startsWith("#"))
                return;
            const m = line.match(/^(\S+)\s+(\d+)\/(\S+).*?(#(.*))?$/);
            const new_port = { name: m[1], port: m[2], type: [m[3]] };
            if (m.length > 5 && m[5])
                new_port.description = m[5].trim();
            if (ret[m[1]])
                ret[m[1]].type.push(new_port.type[0]);
            else
                ret[m[1]] = new_port;
            if (ret[m[2]])
                ret[m[2]].type.push(new_port.type[0]);
            else
                ret[m[2]] = new_port;
        });
        return ret;
    }

    setId(event) {
        this.setState({
            custom_id: event.target.value,
            generate_custom_id: event.target.value.length === 0,
        });
    }

    getName(port) {
        const known = this.state.avail_services[port];
        if (known)
            return known.name;
        else
            return port;
    }

    getPortNumber(port, type, avail) {
        if (!avail) {
            const num_p = Number(port);
            if (isNaN(num_p))
                return [0, _("Unknown service name")];
            else if (num_p <= 0 || num_p > 65535)
                return [0, _("Invalid port number")];
            else
                return [port, ""];
        } else if (avail.type.indexOf(type) < 0)
            return [0, _("Port number and type do not match")];
        else {
            return [avail.port, ""];
        }
    }

    validate(event) {
        let error = "";
        let targets = ['tcp', 'custom_tcp_ports', 'tcp_error', 'custom_tcp_value'];
        if (event.target.id === "udp-ports")
            targets = ['udp', 'custom_udp_ports', 'udp_error', 'custom_udp_value'];
        const new_ports = [];
        const event_value = event.target.value;
        const event_id = event.target.id;

        this.setState(oldState => {
            const ports = event_value.split(',');
            ports.forEach((port) => {
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
                    [ports[0], error] = this.getPortNumber(ports[0], targets[0], oldState.avail_services[ports[0]]);
                    if (!error) {
                        [ports[1], error] = this.getPortNumber(ports[1], targets[0], oldState.avail_services[ports[1]]);
                        if (!error) {
                            if (Number(ports[0]) >= Number(ports[1]))
                                error = _("Range must be strictly ordered");
                            else
                                new_ports.push(ports[0] + "-" + ports[1]);
                        }
                    }
                } else {
                    [ports, error] = this.getPortNumber(port, targets[0], oldState.avail_services[port]);
                    if (!error)
                        new_ports.push(ports);
                }
            });
            const newState = {
                [targets[1]]: new_ports,
                [targets[2]]: error,
                [targets[3]]: event_value
            };

            let all_ports = new_ports.concat(oldState.custom_udp_ports);
            if (event_id === "udp-ports")
                all_ports = oldState.custom_tcp_ports.concat(new_ports);

            if (oldState.generate_custom_id) {
                if (all_ports.length > 0)
                    newState.custom_id = "custom--" + all_ports.map(this.getName).join('-');
                else
                    newState.custom_id = "";
            }

            return newState;
        });
    }

    onToggleType(event) {
        this.setState({
            custom: event.target.value === "ports"
        });
    }

    componentDidMount() {
        firewall.getAvailableServices()
                .then(services => this.setState({ services }));
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
                for (const port of s.ports)
                    if (port.port === this.state.filter)
                        return true;
                return false;
            });
        else if (this.state.filter && this.state.services)
            services = this.state.services.filter(s => s.id.indexOf(this.state.filter) > -1);
        else
            services = this.state.services;

        // hide services which have been enabled in the zone
        if (services)
            services = services.filter(s => firewall.zones[this.props.zoneId].services.indexOf(s.id) === -1);

        const addText = this.state.custom ? _("Add Ports") : _("Add Services");
        const titleText = this.state.custom ? cockpit.format(_("Add ports to $0 zone"), this.props.zoneName) : cockpit.format(_("Add services to $0 zone"), this.props.zoneName);
        return (
            <Modal id="add-services-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title> {titleText} </Modal.Title>
                </Modal.Header>
                <div id="cockpit_modal_dialog">
                    <Modal.Body id="add-services-dialog-body">
                        <form action="" className="toggle-body ct-form">
                            <label className="radio ct-form-full">
                                <input type="radio" name="type" value="services" onChange={this.onToggleType} defaultChecked />
                                {_("Services")}
                            </label>
                            { this.state.custom ||
                                <>
                                    { services ? (
                                        <fieldset>
                                            <div className="ct-form">
                                                <label htmlFor="filter-services-input" className="control-label">
                                                    {_("Filter Services")}
                                                </label>
                                                <SearchInput id="filter-services-input"
                                                    value={this.state.filter}
                                                    className="form-control"
                                                    onChange={this.onFilterChanged} />
                                                <ListView className="list-group dialog-list-ct ct-form-full">
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
                                                                        heading={ <label htmlFor={"firewall-service-" + s.id}>{s.id}</label> }
                                                                        description={ renderPorts(s) } />
                                                        ))
                                                    }
                                                </ListView>
                                            </div>
                                        </fieldset>
                                    ) : (
                                        <div className="spinner spinner-lg" />
                                    )}
                                </>
                            }
                            <label className="radio ct-form-full">
                                <input type="radio" name="type" value="ports" onChange={this.onToggleType} disabled={this.state.avail_services == null} />
                                {_("Custom Ports")}
                            </label>
                            { !this.state.custom ||
                                <>
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

                                    <label className="control-label" htmlFor="service-name">{_("Id")}</label>
                                    <input id="service-name" className="form-control" type="text" onChange={this.setId}
                                           placeholder={_("(Optional)")} value={this.state.custom_id} />
                                </>
                            }
                        </form>
                    </Modal.Body>
                </div>
                <Modal.Footer>
                    {
                        this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />
                    }
                    { !this.state.custom ||
                        <Alert variant="warning"
                            isInline
                            title={_("Adding custom ports will reload firewalld. A reload will result in the loss of any runtime-only configuration!")} />
                    }
                    <Button variant='primary' onClick={this.save} aria-label={titleText}>
                        {addText}
                    </Button>
                    <Button variant='link' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

class ActivateZoneModal extends React.Component {
    constructor() {
        super();

        this.state = {
            ipRange: "ip-entire-subnet",
            ipRangeValue: null,
            zone: null,
            interfaces: new Set(),
            dialogError: null,
            dialogErrorDetail: null,
        };
        this.onInterfaceChange = this.onInterfaceChange.bind(this);
        this.onChange = this.onChange.bind(this);
        this.save = this.save.bind(this);
    }

    onInterfaceChange(event) {
        const int = event.target.value;
        const enabled = event.target.checked;
        this.setState(state => {
            const interfaces = new Set(state.interfaces);
            if (enabled)
                interfaces.add(int);
            else
                interfaces.delete(int);
            return { interfaces: interfaces };
        });
    }

    onChange(key, value) {
        this.setState({ [key]: value });
    }

    save() {
        let p;
        if (firewall.zones[this.state.zone].services.indexOf("cockpit") === -1)
            p = firewall.addService(this.state.zone, "cockpit");
        else
            p = Promise.resolve();

        const sources = this.state.ipRange === "ip-range" ? this.state.ipRangeValue.split(",").map(ip => ip.trim()) : [];
        p.then(() =>
            firewall.activateZone(this.state.zone, [...this.state.interfaces], sources)
                    .then(() => this.props.close())
                    .catch(error => {
                        this.setState({
                            dialogError: _("Failed to add zone"),
                            dialogErrorDetail: error.name + ": " + error.message,
                        });
                    }));
    }

    render() {
        const zones = Object.keys(firewall.zones).filter(z => firewall.zones[z].target === "default" && !firewall.activeZones.has(z));
        const customZones = zones.filter(z => firewall.predefinedZones.indexOf(z) === -1);
        const interfaces = firewall.availableInterfaces.filter(i => {
            let inZone = false;
            firewall.activeZones.forEach(z => {
                inZone |= firewall.zones[z].interfaces.indexOf(i.device) !== -1;
            });
            return !inZone;
        });
        const virtualDevices = interfaces.filter(i => i.capabilities >= 7 && i.device !== "lo").sort((a, b) => a.device.localeCompare(b.device));
        const physicalDevices = interfaces.filter(i => (i.capabilities < 5 || i.capabilities > 7) && i.device !== "lo").sort((a, b) => a.device.localeCompare(b.device));
        return (
            <Modal id="add-zone-dialog" show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.Title>{ _("Add Zone") }</Modal.Title>
                </Modal.Header>
                <Modal.Body id="add-zone-dialog-body">
                    <form className="ct-form">
                        <label htmlFor="add-zone-services-readonly" className="control-label">
                            { _("Trust level") }
                        </label>
                        <div role="group" className="add-zone-zones">
                            <fieldset className="add-zone-zones-firewalld">
                                <legend>{ _("Sorted from least trusted to most trusted") }</legend>
                                { zones.filter(z => firewall.predefinedZones.indexOf(z) !== -1).sort((a, b) => firewall.predefinedZones.indexOf(a) - firewall.predefinedZones.indexOf(b))
                                        .map(z =>
                                            <label className="radio" key={z}><input type="radio" name="zone" value={z} onChange={e => this.onChange("zone", e.target.value)} />
                                                { firewall.zones[z].id }
                                            </label>
                                        )}
                            </fieldset>
                            <fieldset className="add-zone-zones-custom">
                                { customZones.length > 0 && <legend>{ _("Custom zones") }</legend> }
                                { customZones.map(z =>
                                    <label className="radio" key={z}><input type="radio" name="zone" value={z} onChange={e => this.onChange("zone", e.target.value)} />
                                        { firewall.zones[z].id }
                                    </label>
                                )}
                            </fieldset>
                        </div>

                        <label htmlFor="add-zone-description-readonly" className="control-label">{ _("Description") }</label>
                        <p id="add-zone-description-readonly">
                            { (this.state.zone && firewall.zones[this.state.zone].description) || _("No description available") }
                        </p>

                        <label htmlFor="add-zone-services-readonly" className="control-label">{ _("Included services") }</label>
                        <div id="add-zone-services-readonly">
                            { (this.state.zone && firewall.zones[this.state.zone].services.join(", ")) || _("None") }
                            <legend>{_("The cockpit service is automatically included")}</legend>
                        </div>

                        <label htmlFor="add-zone-interface" className="control-label">{ _("Interfaces") }</label>
                        <fieldset className="add-zone-interfaces">
                            { physicalDevices.map(i =>
                                <label className="radio" key={i.device}>
                                    <input type="checkbox" value={i.device} onChange={this.onInterfaceChange} checked={this.state.interfaces.has(i.device)} />
                                    { i.device }
                                </label>) }
                            { virtualDevices.map(i =>
                                <label className="radio" key={i.device}>
                                    <input type="checkbox" value={i.device} onChange={this.onInterfaceChange} checked={this.state.interfaces.has(i.device)} />
                                    { i.device }
                                </label>) }
                        </fieldset>

                        <label htmlFor="add-zone-ip" className="control-label">{ _("Allowed Addresses") }</label>
                        <label className="radio" key="ip-entire-subnet">
                            <input type="radio" name="add-zone-ip" value="ip-entire-subnet" onChange={e => this.onChange("ipRange", e.target.value)} defaultChecked />
                            { _("Entire subnet") }
                        </label>
                        <div role="group">
                            <label className="radio" key="ip-range">
                                <input type="radio" name="add-zone-ip" value="ip-range" onChange={e => this.onChange("ipRange", e.target.value)} />
                                { _("Range") }
                            </label>
                            { this.state.ipRange === "ip-range" && <input id="add-zone-ip" onChange={e => this.onChange("ipRangeValue", e.target.value)} /> }
                        </div>
                        <div>{ this.state.ipRange === "ip-range" && <legend>{_("IP address with routing prefix. Separate multiple values with a comma. Example: 192.0.2.0/24, 2001:db8::/32")}</legend> }</div>
                    </form>
                </Modal.Body>
                <Modal.Footer>
                    {
                        this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />
                    }
                    <Button variant="primary" onClick={this.save} isDisabled={this.state.zone === null ||
                                                                            (this.state.interfaces.size === 0 && this.state.ipRange === "ip-entire-subnet") ||
                                                                            (this.state.ipRange === "ip-range" && !this.state.ipRangeValue)}>
                        { _("Add zone") }
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={this.props.close}>
                        { _("Cancel") }
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

function DeleteConfirmationModal(props) {
    return (
        <Modal id="delete-confirmation-dialog" show>
            <Modal.Header>
                <Modal.Title>{ props.title }</Modal.Title>
            </Modal.Header>
            <Modal.Body className="delete-confirmation-body">
                {props.body && <span className="fa fa-exclamation-triangle" />}
                <div>{props.body}</div>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="danger" onClick={props.onDelete} aria-label={cockpit.format(_("Confirm removal of $0"), props.target)}>
                    { _("Delete") }
                </Button>
                <Button variant="link" className="btn-cancel" onClick={props.onCancel}>
                    { _("Cancel") }
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

export class Firewall extends React.Component {
    constructor() {
        super();

        this.state = {
            addServicesModal: undefined,
            deleteConfirmationModal: undefined,
            firewall,
            pendingTarget: null /* `null` for not pending */
        };

        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.onSwitchChanged = this.onSwitchChanged.bind(this);
        this.openServicesDialog = this.openServicesDialog.bind(this);
        this.openAddZoneDialog = this.openAddZoneDialog.bind(this);
        this.onRemoveZone = this.onRemoveZone.bind(this);
        this.onRemoveService = this.onRemoveService.bind(this);
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

    onRemoveZone(zone) {
        let body;
        if (firewall.zones[zone].services.indexOf("cockpit") !== -1)
            body = _("This zone contains the cockpit service. Make sure that this zone does not apply to your current web console connection.");
        else
            body = _("Removing the zone will remove all services within it.");
        this.setState({
            deleteConfirmationModal: <DeleteConfirmationModal title={ cockpit.format(_("Remove zone $0"), zone) }
            body={body}
            target={zone}
            onCancel={ () =>
                this.setState({ deleteConfirmationModal: undefined })
            }
        onDelete={ () => {
            firewall.deactiveateZone(zone);
            this.setState({ deleteConfirmationModal: undefined });
        }} />
        });
    }

    onRemoveService(zone, service) {
        if (service === 'cockpit') {
            const body = _("Removing the cockpit service might result in the web console becoming unreachable. Make sure that this zone does not apply to your current web console connection.");
            this.setState({
                deleteConfirmationModal: <DeleteConfirmationModal title={ cockpit.format(_("Remove $0 service from $1 zone"), service, zone) }
                body={body}
                target={service}
                onCancel={ () =>
                    this.setState({ deleteConfirmationModal: undefined })
                }
                onDelete={ () => {
                    firewall.removeService(zone, service);
                    this.setState({ deleteConfirmationModal: undefined });
                }} />
            });
        } else {
            firewall.removeService(zone, service);
        }
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    close() {
        this.setState({
            addServicesModal: undefined,
            showRemoveServicesModal: false,
            showActivateZoneModal: false,
        });
    }

    openServicesDialog(zoneId, zoneName) {
        this.setState({ addServicesModal: <AddServicesModal zoneId={zoneId} zoneName={zoneName} close={this.close} /> });
    }

    openAddZoneDialog() {
        this.setState({ showActivateZoneModal: true });
    }

    render() {
        function go_up(event) {
            if (!event || event.button !== 0)
                return;

            cockpit.jump("/network", cockpit.transport.host);
        }

        if (!this.state.firewall.installed) {
            return <EmptyStatePanel title={ _("Firewall is not available") }
                                    paragraph={ cockpit.format(_("Please install the $0 package"), "firewalld") }
                                    icon={ ExclamationCircleIcon } />;
        }

        var addZoneAction = (
            <Button variant="primary" onClick={this.openAddZoneDialog} className="pull-right" id="add-zone-button" aria-label={_("Add a new zone")}>
                {_("Add Zone")}
            </Button>
        );

        var zones = [...this.state.firewall.activeZones].sort((z1, z2) =>
            z1 === firewall.defaultZone ? -1 : z2 === firewall.defaultZone ? 1 : 0
        ).map(id => this.state.firewall.zones[id]);

        var enabled = this.state.pendingTarget !== null ? this.state.pendingTarget : this.state.firewall.enabled;

        let firewallOnOff;
        if (firewall.readonly) {
            firewallOnOff = <Tooltip id="tip-auth"
                                     content={ _("You are not authorized to modify the firewall.") }>
                <OnOffSwitch state={enabled}
                             onChange={this.onSwitchChanged}
                             aria-label={enabled ? _("Not authorized to disable the firewall") : _("Not authorized to enable the firewall")}
                             disabled />
            </Tooltip>;
        } else {
            firewallOnOff = <OnOffSwitch state={enabled}
                                         disabled={!!this.state.pendingTarget}
                                         onChange={this.onSwitchChanged}
                                         aria-label={enabled ? _("Disable the firewall") : _("Enable the firewall")} />;
        }

        return (
            <>
                <div id="firewall-heading">
                    <ol className="breadcrumb">
                        <li><button role="link" className="link-button" onClick={go_up}>{_("Networking")}</button></li>
                        <li className="active">{_("Firewall")}</li>
                    </ol>
                    <div id="firewall-heading-title">
                        <span id="firewall-heading-title-group">
                            <h1>{_("Firewall")}</h1>
                            { firewallOnOff }
                        </span>
                        { enabled && !firewall.readonly && <span className="btn-group">{addZoneAction}</span> }
                    </div>
                </div>
                <div id="zones-listing" className="container-fluid page-ct">
                    { enabled && <>
                        {
                            zones.map(z => <ZoneSection key={z.id}
                                                        zone={z}
                                                        openServicesDialog={this.openServicesDialog}
                                                        readonly={this.state.firewall.readonly}
                                                        onRemoveZone={this.onRemoveZone}
                                                        onRemoveService={this.onRemoveService} />
                            )
                        }
                    </> }
                </div>
                { this.state.addServicesModal !== undefined && this.state.addServicesModal }
                { this.state.deleteConfirmationModal !== undefined && this.state.deleteConfirmationModal }
                { this.state.showActivateZoneModal && <ActivateZoneModal close={this.close} /> }
            </>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
