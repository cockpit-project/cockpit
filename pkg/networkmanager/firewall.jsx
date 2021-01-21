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

import '../lib/patternfly/patternfly-4-cockpit.scss';
import cockpit from "cockpit";
import React from "react";
import ReactDOM from "react-dom";
import {
    Alert, Button,
    Breadcrumb, BreadcrumbItem, Checkbox,
    DataList, DataListItem, DataListCell, DataListItemRow, DataListCheck, DataListItemCells,
    Flex, FlexItem,
    Form, FormGroup, FormHelperText,
    Radio, Split, SplitItem,
    TextInput, Title, Toolbar, ToolbarContent, ToolbarItem,
    Tooltip, Page, PageSection, PageSectionVariants, Modal,
} from '@patternfly/react-core';
import { cellWidth } from '@patternfly/react-table';
import { ExclamationCircleIcon, TrashIcon } from '@patternfly/react-icons';

import firewall from "./firewall-client.js";
import { ListingTable } from 'cockpit-components-table.jsx';
import { ModalError } from "cockpit-components-inline-notification.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { FirewallSwitch } from "./firewall-switch.jsx";

import { superuser } from "superuser";

import "page.scss";
import "table.css";
import "form-layout.scss";
import "./networking.scss";

const _ = cockpit.gettext;

superuser.reload_page_on_change();

function serviceRow(props) {
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
        {
            title: props.service.id, header: true
        },
        {
            title: <div key={props.service.id + "tcp"}>
                { tcp.map(p => p.port).join(', ') }
            </div>
        },
        {
            title: <div key={props.service.id + "udp"}>
                { udp.map(p => p.port).join(', ') }
            </div>
        },
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
    const simpleBody = <Split>
        <SplitItem key="description" isFilled>{description}{includes}</SplitItem>
        {!props.readonly && <SplitItem key="actions">{deleteButton}</SplitItem>}
    </Split>;

    return ({
        props: { key: props.service.id },
        rowId: props.service.id,
        columns,
        hasPadding: true,
        expandedContent: simpleBody,
    });
}

function portRow(props) {
    const columns = [
        {
            title: <i key={props.zone.id + "-additional-ports"}>{ _("Additional ports") }</i>
        },
        {
            title: props.zone.ports
                    .filter(p => p.protocol === "tcp")
                    .map(p => p.port)
                    .join(", ")
        },
        {
            title: props.zone.ports
                    .filter(p => p.protocol === "udp")
                    .map(p => p.port)
                    .join(", ")
        },
    ];
    return ({
        props: { key: props.zone.id + "-ports" },
        rowId: props.zone.id + "-ports",
        columns
    });
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
                    <Button variant="danger"
                            aria-label={cockpit.format(_("Not authorized to remove zone $0"), props.zone.id)}
                            isDisabled icon={<TrashIcon />} />
                </span>
            </Tooltip>
        );
    } else {
        deleteButton = <Button variant="danger" onClick={onRemoveZone}
                               aria-label={cockpit.format(_("Remove zone $0"), props.zone.id)}
                               icon={<TrashIcon />} />;
    }

    const addServiceAction = (
        <Button variant="primary" onClick={() => props.openServicesDialog(props.zone.id, props.zone.id)} className="add-services-button" aria-label={cockpit.format(_("Add services to zone $0"), props.zone.id)}>
            {_("Add services")}
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
        <ListingTable columns={[{ title: _("Service"), transforms: [cellWidth(40)] }, { title: _("TCP"), transforms: [cellWidth(30)] }, { title: _("UDP"), transforms: [cellWidth(30)] }]}
                      aria-label={props.zone.id}
                      variant="compact"
                      emptyCaption={_("There are no active services in this zone")}
                      rows={
                          props.zone.services.map(s => {
                              if (s in firewall.services)
                                  return serviceRow({
                                      key: firewall.services[s].id,
                                      service: firewall.services[s],
                                      onRemoveService: service => props.onRemoveService(props.zone.id, service),
                                      readonly: firewall.readonly
                                  });
                          }).concat(
                              props.zone.ports.length > 0
                                  ? portRow({
                                      key: props.zone.id + "-ports",
                                      zone: props.zone,
                                      readonly: firewall.readonly
                                  }) : [])
                                  .filter(Boolean)}

        />}
    </div>;
}

class SearchInput extends React.Component {
    constructor(props) {
        super(props);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.state = { value: props.value || "" };
    }

    onValueChanged(value) {
        this.setState({ value });

        if (this.timer)
            window.clearTimeout(this.timer);

        this.timer = window.setTimeout(() => {
            this.props.onChange(value);
            this.timer = null;
        }, 300);
    }

    render() {
        return (
            <Toolbar>
                <ToolbarContent>
                    <ToolbarItem variant="label">
                        {_("Filter services")}
                    </ToolbarItem>
                    <ToolbarItem>
                        <TextInput type="search"
                                   id={this.props.id}
                                   onChange={this.onValueChanged}
                                   value={this.state.value}
                        />
                    </ToolbarItem>
                </ToolbarContent>
            </Toolbar>
        );
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
        <div className="service-list-item-text">
            { tcpPorts.length > 0 && <span className="service-ports tcp"><strong>TCP: </strong>{ tcpPorts.join(', ') }</span> }
            { udpPorts.length > 0 && <span className="service-ports udp"><strong>UDP: </strong>{ udpPorts.join(', ') }</span> }
        </div>
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

    onToggleService(event, serviceId) {
        var service = serviceId;
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

    setId(value) {
        this.setState({
            custom_id: value,
            generate_custom_id: value.length === 0,
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

    validate(value, event) {
        let error = "";
        let targets = ['tcp', 'custom_tcp_ports', 'tcp_error', 'custom_tcp_value'];
        if (event.target.id === "udp-ports")
            targets = ['udp', 'custom_udp_ports', 'udp_error', 'custom_udp_value'];
        const new_ports = [];
        const event_id = event.target.id;

        this.setState(oldState => {
            const ports = value.split(',');
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
                [targets[3]]: value
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

    onToggleType(value, event) {
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

        const addText = this.state.custom ? _("Add ports") : _("Add services");
        const titleText = this.state.custom ? cockpit.format(_("Add ports to $0 zone"), this.props.zoneName) : cockpit.format(_("Add services to $0 zone"), this.props.zoneName);
        return (
            <Modal id="add-services-dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.close}
                   title={titleText}
                   footer={<>
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
                   </>}
            >
                <Form isHorizontal>
                    <FormGroup className="add-services-dialog-type" isInline>
                        <Radio name="type"
                               id="add-services-dialog--services"
                               value="services"
                               isChecked={!this.state.custom}
                               onChange={this.onToggleType}
                               label={_("Services")} />
                        <Radio name="type"
                               id="add-services-dialog--ports"
                               value="ports"
                               isChecked={this.state.custom}
                               onChange={this.onToggleType}
                               isDisabled={this.state.avail_services == null}
                               label={_("Custom ports")} />
                    </FormGroup>
                    { this.state.custom ||
                        <div>
                            { services ? (
                                <>
                                    <SearchInput id="filter-services-input"
                                                 value={this.state.filter}
                                                 onChange={this.onFilterChanged} />
                                    <DataList className="service-list" isCompact>
                                        {services.map(s => (
                                            <DataListItem key={s.id} aria-labelledby={s.id}>
                                                <DataListItemRow>
                                                    <DataListCheck aria-labelledby={s.id}
                                                                   isChecked={this.state.selected.has(s.id)}
                                                                   onChange={(value, event) => this.onToggleService(event, s.id)}
                                                                   id={"firewall-service-" + s.id}
                                                                   name={s.id + "-checkbox"} />
                                                    <DataListItemCells
                                                            dataListCells={[
                                                                <DataListCell key="service-list-item">
                                                                    <label htmlFor={"firewall-service-" + s.id}
                                                                           className="service-list-iteam-heading">
                                                                        {s.id}
                                                                    </label>
                                                                    {renderPorts(s)}
                                                                </DataListCell>,
                                                            ]} />
                                                </DataListItemRow>
                                            </DataListItem>
                                        ))}
                                    </DataList>
                                </>
                            ) : (
                                <EmptyStatePanel loading />
                            )}
                        </div>
                    }
                    { !this.state.custom ||
                        <>
                            <FormGroup label="TCP"
                                       validated={this.state.tcp_error ? "error" : "default"}
                                       helperText={_("Comma-separated ports, ranges, and aliases are accepted")}
                                       helperTextInvalid={this.state.tcp_error}>
                                <TextInput id="tcp-ports" type="text" onChange={this.validate}
                                           validated={this.state.tcp_error ? "error" : "default"}
                                           value={this.state.custom_tcp_value}
                                           placeholder={_("Example: 22,ssh,8080,5900-5910")} />
                            </FormGroup>

                            <FormGroup label="UDP"
                                       validated={this.state.udp_error ? "error" : "default"}
                                       helperText={_("Comma-separated ports, ranges, and aliases are accepted")}
                                       helperTextInvalid={this.state.udp_error}>
                                <TextInput id="udp-ports" type="text" onChange={this.validate}
                                           validated={this.state.udp_error ? "error" : "default"}
                                           value={this.state.custom_udp_value}
                                           placeholder={_("Example: 88,2019,nfs,rsync")} />
                            </FormGroup>

                            <FormGroup label={_("ID")}>
                                <TextInput id="service-name" onChange={this.setId}
                                           placeholder={_("(Optional)")} value={this.state.custom_id} />
                            </FormGroup>
                        </>
                    }
                </Form>
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
            <Modal id="add-zone-dialog" isOpen
                   position="top" variant="medium"
                   onClose={this.props.close}
                   title={_("Add zone")}
                   footer={<>
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
                   </>}
            >
                <Form isHorizontal>
                    <FormGroup label={ _("Trust level") } className="add-zone-zones">
                        <Flex>
                            <FlexItem className="add-zone-zones-firewalld">
                                <legend>{ _("Sorted from least to most trusted") }</legend>
                                { zones.filter(z => firewall.predefinedZones.indexOf(z) !== -1).sort((a, b) => firewall.predefinedZones.indexOf(a) - firewall.predefinedZones.indexOf(b))
                                        .map(z =>
                                            <Radio key={z} id={z} name="zone" value={z}
                                                   isChecked={this.state.zone == z}
                                                   onChange={(value, e) => this.onChange("zone", e.target.value)}
                                                   label={ firewall.zones[z].id } />
                                        )}
                            </FlexItem>
                            <FlexItem className="add-zone-zones-custom">
                                { customZones.length > 0 && <legend>{ _("Custom zones") }</legend> }
                                { customZones.map(z =>
                                    <Radio key={z} id={z} name="zone" value={z}
                                           isChecked={this.state.zone == z}
                                           onChange={(value, e) => this.onChange("zone", e.target.value)}
                                           label={ firewall.zones[z].id } />
                                )}
                            </FlexItem>
                        </Flex>
                    </FormGroup>

                    <FormGroup label={ _("Description") }>
                        <p id="add-zone-description-readonly">
                            { (this.state.zone && firewall.zones[this.state.zone].description) || _("No description available") }
                        </p>
                    </FormGroup>

                    <FormGroup label={ _("Included services") } hasNoPaddingTop>
                        <div id="add-zone-services-readonly">
                            { (this.state.zone && firewall.zones[this.state.zone].services.join(", ")) || _("None") }
                        </div>
                        <FormHelperText isHidden={false}>{_("The cockpit service is automatically included")}</FormHelperText>
                    </FormGroup>

                    <FormGroup label={ _("Interfaces") } hasNoPaddingTop isInline>
                        { physicalDevices.map(i =>
                            <Checkbox key={i.device}
                                      id={i.device}
                                      value={i.device}
                                      onChange={(value, event) => this.onInterfaceChange(event)}
                                      isChecked={this.state.interfaces.has(i.device)}
                                      label={i.device} />) }
                        { virtualDevices.map(i =>
                            <Checkbox key={i.device}
                                      id={i.device}
                                      value={i.device}
                                      onChange={(value, event) => this.onInterfaceChange(event)}
                                      isChecked={this.state.interfaces.has(i.device)}
                                      label={i.device} />) }
                    </FormGroup>

                    <FormGroup label={ _("Allowed addresses") } hasNoPaddingTop isInline>
                        <Radio name="add-zone-ip"
                               isChecked={this.state.ipRange == "ip-entire-subnet"}
                               value="ip-entire-subnet"
                               id="ip-entire-subnet"
                               onChange={(value, e) => this.onChange("ipRange", e.target.value)}
                               label={ _("Entire subnet") } />
                        <Radio name="add-zone-ip"
                               isChecked={this.state.ipRange == "ip-range"}
                               value="ip-range"
                               id="ip-range"
                               onChange={(value, e) => this.onChange("ipRange", e.target.value)}
                               label={ _("Range") } />
                        { this.state.ipRange === "ip-range" && <TextInput id="add-zone-ip" onChange={value => this.onChange("ipRangeValue", value)} /> }
                        <FormHelperText isHidden={this.state.ipRange != "ip-range"}>{_("IP address with routing prefix. Separate multiple values with a comma. Example: 192.0.2.0/24, 2001:db8::/32")}</FormHelperText>
                    </FormGroup>
                </Form>
            </Modal>
        );
    }
}

function DeleteConfirmationModal(props) {
    return (
        <Modal id="delete-confirmation-dialog" isOpen
               position="top" variant="medium"
               onClose={props.onCancel}
               title={props.title}
               footer={<>
                   <Button variant="danger" onClick={props.onDelete} aria-label={cockpit.format(_("Confirm removal of $0"), props.target)}>
                       { _("Delete") }
                   </Button>
                   <Button variant="link" className="btn-cancel" onClick={props.onCancel}>
                       { _("Cancel") }
                   </Button>
               </>}
        >
            {props.body && <Alert variant="warning" isInline title={props.body} />}
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
            <Button variant="primary" onClick={this.openAddZoneDialog} id="add-zone-button" aria-label={_("Add a new zone")}>
                {_("Add zone")}
            </Button>
        );

        var zones = [...this.state.firewall.activeZones].sort((z1, z2) =>
            z1 === firewall.defaultZone ? -1 : z2 === firewall.defaultZone ? 1 : 0
        ).map(id => this.state.firewall.zones[id]);

        const enabled = this.state.firewall.enabled;

        return (
            <Page breadcrumb={
                <Breadcrumb>
                    <BreadcrumbItem onClick={go_up} className="pf-c-breadcrumb__item" to="#">{_("Networking")}</BreadcrumbItem>
                    <BreadcrumbItem isActive>{_("Firewall")}</BreadcrumbItem>
                </Breadcrumb>}>
                <PageSection id="firewall-heading" className="firewall-heading" variant={PageSectionVariants.light}>
                    <div id="firewall-heading-title" className="firewall-heading-title">
                        <span id="firewall-heading-title-group" className="firewall-heading-title-group">
                            <Title headingLevel="h2" size="3xl">
                                {_("Firewall")}
                            </Title>
                            <FirewallSwitch firewall={firewall} />
                        </span>
                        { enabled && !firewall.readonly && <span className="btn-group">{addZoneAction}</span> }
                    </div>
                </PageSection>
                <PageSection id="zones-listing">
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
                </PageSection>
                { this.state.addServicesModal !== undefined && this.state.addServicesModal }
                { this.state.deleteConfirmationModal !== undefined && this.state.deleteConfirmationModal }
                { this.state.showActivateZoneModal && <ActivateZoneModal close={this.close} /> }
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);

    ReactDOM.render(<Firewall />, document.getElementById("firewall"));
});
