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
import 'cockpit-dark-theme'; // once per page
import cockpit from "cockpit";
import React, { useState } from 'react';
import { createRoot } from "react-dom/client";
import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Card, CardActions, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DataList, DataListCell, DataListCheck, DataListItem, DataListItemCells, DataListItemRow } from "@patternfly/react-core/dist/esm/components/DataList/index.js";
import { Dropdown, DropdownItem, KebabToggle } from "@patternfly/react-core/dist/esm/components/Dropdown/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Form, FormGroup, FormHelperText } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { Title } from "@patternfly/react-core/dist/esm/components/Title/index.js";
import { Toolbar, ToolbarContent, ToolbarItem } from "@patternfly/react-core/dist/esm/components/Toolbar/index.js";
import { Page, PageBreadcrumb, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import firewall from "./firewall-client.js";
import { FormHelper } from "cockpit-components-form-helper";
import { ListingTable } from 'cockpit-components-table.jsx';
import { ModalError } from "cockpit-components-inline-notification.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.jsx";
import { FirewallSwitch } from "./firewall-switch.jsx";

import { superuser } from "superuser";
import { WithDialogs, DialogsContext } from "dialogs.jsx";

import "./networking.scss";

const _ = cockpit.gettext;

superuser.reload_page_on_change();

const upperCaseFirstLetter = text => text[0].toUpperCase() + text.slice(1);

const DeleteDropdown = ({ items, id }) => {
    const [isActionsKebabOpen, setActionsKebabOpen] = useState(false);

    const dropdown_items = items.map(item => <DropdownItem key={item.text}
                                                           className={item.danger ? "pf-m-danger" : ""}
                                                           aria-label={item.ariaLabel}
                                                           onClick={item.handleClick}>
        {item.text}
    </DropdownItem>);

    return (<Dropdown toggle={<KebabToggle onToggle={isOpen => setActionsKebabOpen(isOpen)} id={id || null} />}
                      isOpen={isActionsKebabOpen}
                      isPlain
                      position="right"
                      dropdownItems={dropdown_items} />);
};

function serviceRow(props) {
    let tcp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'TCP');
    let udp = props.service.ports.filter(p => p.protocol.toUpperCase() == 'UDP');

    for (const s of props.service.includes) {
        if (firewall.services[s]) {
            tcp = tcp.concat(firewall.services[s].ports.filter(p => p.protocol.toUpperCase() == 'TCP'));
            udp = udp.concat(firewall.services[s].ports.filter(p => p.protocol.toUpperCase() == 'UDP'));
        }
    }

    function onRemoveService(event) {
        props.onRemoveService(props.service.id);
        event.stopPropagation();
    }

    function onEditService(event) {
        props.onEditService(props.service.id);
        event.stopPropagation();
    }

    const columns = [
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

    if (!props.readonly) {
        // Only allow editing manually created services - no name is a decent (and only) indicator
        const items = [];
        if (!props.service.name)
            items.push({ text: _("Edit"), ariaLabel: cockpit.format(_("Edit service $0"), props.service.id), handleClick: onEditService });

        items.push({ text: _("Delete"), danger: true, ariaLabel: cockpit.format(_("Remove service $0"), props.service.id), handleClick: onRemoveService });

        columns.push({
            title: <DeleteDropdown items={items} id={props.service.key} />
        });
    }

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
                else
                    return null;
            })} </ul></>;
    }

    return ({
        props: { key: props.service.id, 'data-row-id': props.service.id },
        columns,
        hasPadding: true,
        expandedContent: <>{description}{includes}</>,
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
        props: { key: props.zone.id + "-ports", 'data-row-id': props.zone.id + "-ports" },
        columns
    });
}

function ZoneSection(props) {
    function onRemoveZone(event) {
        event.stopPropagation();
        props.onRemoveZone(props.zone.id);
    }

    const deleteButton = (<DeleteDropdown items={[{ text: _("Delete"), danger: true, ariaLabel: cockpit.format(_("Remove zone $0"), props.zone.id), handleClick: onRemoveZone }]} id={`dropdown-${props.zone.id}`} />);
    const addServiceAction = (
        <Button variant="primary" onClick={() => props.openServicesDialog(props.zone.id, props.zone.id)} className="add-services-button" aria-label={cockpit.format(_("Add services to zone $0"), props.zone.id)}>
            {_("Add services")}
        </Button>
    );

    return <Card className="zone-section" data-id={props.zone.id}>
        <CardHeader className="zone-section-heading">
            <CardTitle>
                <Flex alignItems={{ default: 'alignSelfBaseline' }} spaceItems={{ default: 'spaceItemsXl' }}>
                    <Title headingLevel="h2" size="xl">
                        { cockpit.format(_("$0 zone"), upperCaseFirstLetter(props.zone.name || props.zone.id)) }
                    </Title>
                    <Flex>
                        { props.zone.interfaces.length > 0 &&
                        <span>
                            <strong>{cockpit.ngettext("Interface", "Interfaces", props.zone.interfaces.length)}</strong> {props.zone.interfaces.join(", ")}
                        </span>
                        }
                        <span>
                            <strong>{_("Allowed addresses")}</strong> {props.zone.source.length ? props.zone.source.join(", ") : _("Entire subnet")}
                        </span>
                    </Flex>
                </Flex>
            </CardTitle>
            { !firewall.readonly && <CardActions className="zone-section-buttons">{addServiceAction}{deleteButton}</CardActions> }
        </CardHeader>
        {(props.zone.services.length > 0 || props.zone.ports.length > 0) &&
        <CardBody className="contains-list">
            <ListingTable columns={[{ title: _("Service"), props: { width: 40 } }, { title: _("TCP"), props: { width: 30 } }, { title: _("UDP"), props: { width: 30 } }, { title: "", props: { width: 10 } }]}
                          id={props.zone.id}
                          aria-label={props.zone.id}
                          variant="compact"
                          emptyCaption={_("There are no active services in this zone")}
                          rows={
                              props.zone.services.map(s => {
                                  if (s in firewall.services) {
                                      return serviceRow({
                                          key: firewall.services[s].id,
                                          service: firewall.services[s],
                                          onRemoveService: service => props.onRemoveService(props.zone.id, service),
                                          onEditService: service => props.onEditService(props.zone, firewall.services[service]),
                                          readonly: firewall.readonly,
                                      });
                                  } else {
                                      return null;
                                  }
                              }).concat(
                                  props.zone.ports.length > 0
                                      ? portRow({
                                          key: props.zone.id + "-ports",
                                          zone: props.zone,
                                          readonly: firewall.readonly
                                      })
                                      : [])
                                      .filter(Boolean)}

            />
        </CardBody>}
    </Card>;
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

class AddEditServicesModal extends React.Component {
    static contextType = DialogsContext;

    constructor(props) {
        super(props);

        this.state = {
            services: null,
            selected: new Set(),
            filter: "",
            custom: !!props.custom_id,
            generate_custom_id: !props.custom_id,
            tcp_error: "",
            udp_error: "",
            avail_services: null,
            custom_id: props.custom_id || "",
            custom_description: props.custom_description || "",
            custom_tcp_ports: props.custom_tcp_ports || [],
            custom_udp_ports: props.custom_udp_ports || [],
            custom_tcp_value: props.custom_tcp_value || "",
            custom_udp_value: props.custom_udp_value || "",
            dialogError: null,
            dialogErrorDetail: null,
        };
        this.save = this.save.bind(this);
        this.edit = this.edit.bind(this);
        this.checkNullValues = this.checkNullValues.bind(this);
        this.onFilterChanged = this.onFilterChanged.bind(this);
        this.onToggleService = this.onToggleService.bind(this);
        this.setId = this.setId.bind(this);
        this.setDescription = this.setDescription.bind(this);
        this.getName = this.getName.bind(this);
        this.validate = this.validate.bind(this);
        this.createPorts = this.createPorts.bind(this);
        this.parseServices = this.parseServices.bind(this);
        this.onToggleType = this.onToggleType.bind(this);
        this.getCustomId = this.getCustomId.bind(this);
    }

    createPorts() {
        const ret = [];
        this.state.custom_tcp_ports.forEach(port => ret.push([port, 'tcp']));
        this.state.custom_udp_ports.forEach(port => ret.push([port, 'udp']));
        return ret;
    }

    getCustomId() {
        const all_ports = this.state.custom_tcp_ports.concat(this.state.custom_udp_ports);
        return "custom--" + all_ports.map(this.getName).join('-');
    }

    checkNullValues() {
        return (!this.state.custom_tcp_value && !this.state.custom_udp_value);
    }

    edit(event) {
        const Dialogs = this.context;
        firewall.editService(this.props.custom_id, this.createPorts(), this.state.custom_description)
                .then(() => Dialogs.close())
                .catch(error => {
                    this.setState({
                        dialogError: _("Failed to edit service"),
                        dialogErrorDetail: error.name + ": " + error.message,
                    });
                });

        if (event)
            event.preventDefault();
        return false;
    }

    save(event) {
        const Dialogs = this.context;
        let p;
        if (this.state.custom) {
            const custom_id = this.state.custom_id === "" ? this.getCustomId() : this.state.custom_id;
            p = firewall.createService(custom_id, this.createPorts(), this.props.zoneId, this.state.custom_description);
        } else {
            p = firewall.addServices(this.props.zoneId, [...this.state.selected]);
        }
        p.then(() => Dialogs.close())
                .catch(error => {
                    this.setState(prevState => ({
                        dialogError: prevState.custom ? _("Failed to add port") : _("Failed to add service"),
                        dialogErrorDetail: error.name + ": " + error.message,
                    }));
                });

        if (event)
            event.preventDefault();
        return false;
    }

    onToggleService(event, serviceId) {
        const service = serviceId;
        const enabled = event.target.checked;

        this.setState(oldState => {
            const selected = new Set(oldState.selected);

            if (enabled)
                selected.add(service);
            else
                selected.delete(service);

            return {
                selected
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

        const ret = {};
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

    setDescription(value) {
        this.setState({
            custom_description: value
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
                .then(content => this.setState({
                    avail_services: this.parseServices(content)
                }));
    }

    onFilterChanged(value) {
        this.setState({ filter: value.toLowerCase() });
    }

    render() {
        const Dialogs = this.context;
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

        let addText = "";
        let titleText = "";
        if (this.props.custom_id) {
            addText = _("Edit service");
            titleText = cockpit.format(_("Edit custom service in $0 zone"), this.props.zoneName);
        } else {
            addText = this.state.custom ? _("Add ports") : _("Add services");
            titleText = this.state.custom ? cockpit.format(_("Add ports to $0 zone"), this.props.zoneName) : cockpit.format(_("Add services to $0 zone"), this.props.zoneName);
        }

        return (
            <Modal id="add-services-dialog" isOpen
                   position="top" variant="medium"
                   onClose={Dialogs.close}
                   title={titleText}
                   footer={<>
                       { !this.state.custom ||
                           <Alert variant="warning"
                               isInline
                               title={_("Adding custom ports will reload firewalld. A reload will result in the loss of any runtime-only configuration!")} />
                       }
                       <Button variant='primary' isDisabled={(this.state.custom && this.checkNullValues()) || (!this.state.custom && !this.state.selected.size)} onClick={this.props.custom_id ? this.edit : this.save} aria-label={titleText}>
                           {addText}
                       </Button>
                       <Button variant='link' className='btn-cancel' onClick={Dialogs.close}>
                           {_("Cancel")}
                       </Button>
                   </>}
            >
                <Form isHorizontal onSubmit={this.props.custom_id ? this.edit : this.save}>
                    {
                        this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />
                    }
                    { !!this.props.custom_id ||
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
                    }
                    { this.state.custom ||
                        <div>
                            { services
                                ? (
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
                                )
                                : (
                                    <EmptyStatePanel loading />
                                )}
                        </div>
                    }
                    { !this.state.custom ||
                        <>
                            <FormGroup label="TCP">
                                <TextInput id="tcp-ports" type="text" onChange={this.validate}
                                           validated={this.state.tcp_error ? "error" : "default"}
                                           isDisabled={this.state.avail_services == null}
                                           value={this.state.custom_tcp_value}
                                           placeholder={_("Example: 22,ssh,8080,5900-5910")} />
                                <FormHelper helperTextInvalid={this.state.tcp_error} helperText={_("Comma-separated ports, ranges, and services are accepted")} />
                            </FormGroup>

                            <FormGroup label="UDP">
                                <TextInput id="udp-ports" type="text" onChange={this.validate}
                                           validated={this.state.udp_error ? "error" : "default"}
                                           isDisabled={this.state.avail_services == null}
                                           value={this.state.custom_udp_value}
                                           placeholder={_("Example: 88,2019,nfs,rsync")} />
                                <FormHelper helperTextInvalid={this.state.udp_error} helperText={_("Comma-separated ports, ranges, and services are accepted")} />
                            </FormGroup>

                            <FormGroup label={_("ID")}>
                                <TextInput id="service-name" onChange={this.setId} isDisabled={!!this.props.custom_id || this.state.avail_services == null}
                                           value={this.state.custom_id} />
                                <FormHelper helperText={_("If left empty, ID will be generated based on associated port services and port numbers")} />
                            </FormGroup>

                            <FormGroup label={_("Description")}>
                                <TextInput id="service-description" onChange={this.setDescription} isDisabled={this.state.avail_services == null}
                                           value={this.state.custom_description} />
                            </FormGroup>
                        </>
                    }
                </Form>
            </Modal>
        );
    }
}

class ActivateZoneModal extends React.Component {
    static contextType = DialogsContext;

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
        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.onInterfaceChange = this.onInterfaceChange.bind(this);
        this.onChange = this.onChange.bind(this);
        this.save = this.save.bind(this);
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    onFirewallChanged() {
        this.setState({});
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
            return { interfaces };
        });
    }

    onChange(key, value) {
        this.setState({ [key]: value });
    }

    save(event) {
        const Dialogs = this.context;
        let p;
        if (firewall.zones[this.state.zone].services.indexOf("cockpit") === -1)
            p = firewall.addService(this.state.zone, "cockpit");
        else
            p = Promise.resolve();

        const sources = this.state.ipRange === "ip-range" ? this.state.ipRangeValue.split(",").map(ip => ip.trim()) : [];
        p.then(() =>
            firewall.activateZone(this.state.zone, [...this.state.interfaces], sources)
                    .then(Dialogs.close)
                    .catch(error => {
                        this.setState({
                            dialogError: _("Failed to add zone"),
                            dialogErrorDetail: error.name + ": " + error.message,
                        });
                    }));

        if (event)
            event.preventDefault();
        return false;
    }

    render() {
        const Dialogs = this.context;
        const zones = Object.keys(firewall.zones).filter(z => firewall.zones[z].target === "default" && !firewall.activeZones.has(z));
        const customZones = zones.filter(z => firewall.predefinedZones.indexOf(z) === -1);
        const interfaces = firewall.availableInterfaces.filter(i => {
            let inZone = false;
            firewall.activeZones.forEach(z => {
                inZone |= firewall.zones[z].interfaces.indexOf(i.device) !== -1;
            });
            return !inZone;
        });
        // https://networkmanager.dev/docs/api/latest/nm-dbus-types.html#NMDeviceCapabilities
        const NM_DEVICE_CAP_IS_SOFTWARE = 4;
        const virtualDevices = interfaces.filter(i => (i.capabilities & NM_DEVICE_CAP_IS_SOFTWARE) !== 0 && i.device !== "lo").sort((a, b) => a.device.localeCompare(b.device));
        const physicalDevices = interfaces.filter(i => ((i.capabilities & NM_DEVICE_CAP_IS_SOFTWARE) === 0) && i.device !== "lo").sort((a, b) => a.device.localeCompare(b.device));
        return (
            <Modal id="add-zone-dialog" isOpen
                   position="top" variant="medium"
                   onClose={Dialogs.close}
                   title={_("Add zone")}
                   footer={<>
                       <Button variant="primary" onClick={this.save} isDisabled={this.state.zone === null ||
                                                                               (this.state.interfaces.size === 0 && this.state.ipRange === "ip-entire-subnet") ||
                                                                               (this.state.ipRange === "ip-range" && !this.state.ipRangeValue)}>
                           { _("Add zone") }
                       </Button>
                       <Button variant="link" className="btn-cancel" onClick={Dialogs.close}>
                           { _("Cancel") }
                       </Button>
                   </>}
            >
                <Form isHorizontal onSubmit={this.save}>
                    {
                        this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />
                    }
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
                        <FormHelper helperText={_("The cockpit service is automatically included")} />
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
    static contextType = DialogsContext;

    constructor() {
        super();

        this.state = {
            firewall,
            pendingTarget: null /* `null` for not pending */
        };

        this.onFirewallChanged = this.onFirewallChanged.bind(this);
        this.openServicesDialog = this.openServicesDialog.bind(this);
        this.openAddZoneDialog = this.openAddZoneDialog.bind(this);
        this.onRemoveZone = this.onRemoveZone.bind(this);
        this.onRemoveService = this.onRemoveService.bind(this);
        this.onEditService = this.onEditService.bind(this);
    }

    onFirewallChanged() {
        this.setState((prevState) => {
            if (prevState.pendingTarget === firewall.enabled)
                return { firewall, pendingTarget: null };

            return { firewall };
        });
    }

    onRemoveZone(zone) {
        const Dialogs = this.context;
        let body;
        if (firewall.zones[zone].services.indexOf("cockpit") !== -1)
            body = _("This zone contains the cockpit service. Make sure that this zone does not apply to your current web console connection.");
        else
            body = _("Removing the zone will remove all services within it.");
        Dialogs.show(<DeleteConfirmationModal title={ cockpit.format(_("Remove zone $0"), zone) }
                                              body={body}
                                              target={zone}
                                              onCancel={Dialogs.close}
                                              onDelete={ () => {
                                                  firewall.deactiveateZone(zone);
                                                  Dialogs.close();
                                              }} />
        );
    }

    onRemoveService(zone, service) {
        const Dialogs = this.context;
        if (service === 'cockpit') {
            const body = _("Removing the cockpit service might result in the web console becoming unreachable. Make sure that this zone does not apply to your current web console connection.");
            Dialogs.show(<DeleteConfirmationModal title={ cockpit.format(_("Remove $0 service from $1 zone"), service, zone) }
                                                  body={body}
                                                  target={service}
                                                  onCancel={Dialogs.close}
                                                  onDelete={ () => {
                                                      firewall.removeService(zone, service);
                                                      Dialogs.close();
                                                  }} />
            );
        } else {
            firewall.removeService(zone, service);
        }
    }

    onEditService(zone, service) {
        const tcp_ports = [];
        const udp_ports = [];
        service.ports.forEach(port => {
            if (port.protocol === "tcp")
                tcp_ports.push(port.port);
            else
                udp_ports.push(port.port);
        });

        const zone_name = zone.name ? zone.name : upperCaseFirstLetter(zone.id);

        const Dialogs = this.context;
        Dialogs.show(<AddEditServicesModal zoneId={zone.id} zoneName={zone_name} custom_id={service.id}
                                           custom_tcp_ports={tcp_ports} custom_udp_ports={udp_ports} custom_description={service.description}
                                           custom_tcp_value={tcp_ports.join(", ")} custom_udp_value={udp_ports.join(", ")} />);
    }

    componentDidMount() {
        firewall.addEventListener("changed", this.onFirewallChanged);
    }

    componentWillUnmount() {
        firewall.removeEventListener("changed", this.onFirewallChanged);
    }

    openServicesDialog(zoneId, zoneName) {
        const Dialogs = this.context;
        Dialogs.show(<AddEditServicesModal zoneId={zoneId} zoneName={zoneName} />);
    }

    openAddZoneDialog() {
        const Dialogs = this.context;
        Dialogs.show(<ActivateZoneModal />);
    }

    render() {
        function go_up(event) {
            cockpit.jump("/network", cockpit.transport.host);
        }

        if (!this.state.firewall.installed) {
            return <EmptyStatePanel title={ _("Firewall is not available") }
                                    paragraph={ cockpit.format(_("Please install the $0 package"), "firewalld") }
                                    icon={ ExclamationCircleIcon }
            />;
        }

        if (!this.state.firewall.ready)
            return <EmptyStatePanel loading />;

        const addZoneAction = (
            <Button variant="primary" onClick={this.openAddZoneDialog} id="add-zone-button" aria-label={_("Add a new zone")}>
                {_("Add new zone")}
            </Button>
        );

        const zones = [...this.state.firewall.activeZones].sort((z1, z2) =>
            z1 === firewall.defaultZone ? -1 : z2 === firewall.defaultZone ? 1 : 0
        ).map(id => this.state.firewall.zones[id]);

        const enabled = this.state.firewall.enabled;

        return (
            <Page>
                <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                    <Breadcrumb>
                        <BreadcrumbItem onClick={go_up} className="pf-c-breadcrumb__link">{_("Networking")}</BreadcrumbItem>
                        <BreadcrumbItem isActive>{_("Firewall")}</BreadcrumbItem>
                    </Breadcrumb>
                </PageBreadcrumb>
                <PageSection id="firewall-heading" variant={PageSectionVariants.light} className="firewall-heading">
                    <Flex alignItems={{ default: 'alignItemsCenter' }} justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                        <Flex alignItems={{ default: 'alignItemsCenter' }} id="firewall-heading-title-group">
                            <Title headingLevel="h2" size="3xl">
                                {_("Firewall")}
                            </Title>
                            <FirewallSwitch firewall={firewall} />
                            <p>{_("Incoming requests are blocked by default. Outgoing requests are not blocked.")}</p>
                        </Flex>
                        { enabled && !firewall.readonly && <span className="btn-group">{addZoneAction}</span> }
                    </Flex>
                </PageSection>
                <PageSection id="zones-listing">
                    { enabled && <Stack hasGutter>
                        {
                            zones.map(z => <ZoneSection key={z.id}
                                                        zone={z}
                                                        openServicesDialog={this.openServicesDialog}
                                                        readonly={this.state.firewall.readonly}
                                                        onRemoveZone={this.onRemoveZone}
                                                        onEditService={this.onEditService}
                                                        onRemoveService={this.onRemoveService} />
                            )
                        }
                    </Stack> }
                </PageSection>
            </Page>
        );
    }
}

document.addEventListener("DOMContentLoaded", () => {
    document.title = cockpit.gettext(document.title);
    const root = createRoot(document.getElementById("firewall"));
    root.render(<WithDialogs><Firewall /></WithDialogs>);
});
