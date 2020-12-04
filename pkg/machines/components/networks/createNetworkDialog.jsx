
/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import React from 'react';
import PropTypes from 'prop-types';
import { Button, Checkbox, Form, FormGroup, FormSection, Modal, TextInput } from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { networkCreate } from '../../libvirt-dbus.js';
import * as Select from 'cockpit-components-select.jsx';
import { isEmpty, LIBVIRT_SYSTEM_CONNECTION, rephraseUI } from '../../helpers.js';
import * as utils from './utils';
import cockpit from 'cockpit';

import './createNetworkDialog.css';

const _ = cockpit.gettext;

const ConnectionRow = ({ connectionName }) => {
    return (
        <FormGroup fieldId="create-network-connection-name" label={_("Connection")} hasNoPaddingTop>
            <samp id="create-network-connection-name">
                {connectionName}
            </samp>
        </FormGroup>
    );
};

function validateParams(dialogValues) {
    const validationFailed = {};

    if (isEmpty(dialogValues.name.trim()))
        validationFailed.name = _("Name should not be empty");

    if (dialogValues.ip === "IPv4 only" || dialogValues.ip === "IPv4 and IPv6") {
        if (isEmpty(dialogValues.ipv4.trim()))
            validationFailed.ipv4 = _("IPv4 network should not be empty");
        else if (!utils.validateIpv4(dialogValues.ipv4))
            validationFailed.ipv4 = _("Invalid IPv4 address");

        if (isEmpty(dialogValues.netmask.trim()))
            validationFailed.netmask = _("Mask or prefix length should not be empty");
        else if (!utils.validateNetmask(dialogValues.netmask))
            validationFailed.netmask = _("Invalid IPv4 mask or prefix length");

        if (dialogValues.ipv4DhcpEnabled) {
            if (isEmpty(dialogValues.ipv4DhcpRangeStart.trim()))
                validationFailed.ipv4DhcpRangeStart = _("Start should not be empty");
            else if (!utils.validateIpv4(dialogValues.ipv4DhcpRangeStart))
                validationFailed.ipv4DhcpRangeStart = _("Invalid IPv4 address");
            else if (!utils.isIpv4InNetwork(dialogValues.ipv4, dialogValues.netmask, dialogValues.ipv4DhcpRangeStart))
                validationFailed.ipv4DhcpRangeStart = _("Address not within subnet");

            if (isEmpty(dialogValues.ipv4DhcpRangeEnd.trim()))
                validationFailed.ipv4DhcpRangeEnd = _("End should not be empty");
            else if (!utils.validateIpv4(dialogValues.ipv4DhcpRangeEnd))
                validationFailed.ipv4DhcpRangeEnd = _("Invalid IPv4 address");
            else if (!utils.isIpv4InNetwork(dialogValues.ipv4, dialogValues.netmask, dialogValues.ipv4DhcpRangeEnd))
                validationFailed.ipv4DhcpRangeEnd = _("Address not within subnet");
        }
    }

    if (dialogValues.ip === "IPv6 only" || dialogValues.ip === "IPv4 and IPv6") {
        if (isEmpty(dialogValues.ipv6.trim()))
            validationFailed.ipv6 = _("IPv6 network should not be empty");
        else if (!utils.validateIpv6(dialogValues.ipv6))
            validationFailed.ipv6 = _("Invalid IPv6 address");

        if (isEmpty(dialogValues.prefix.trim()))
            validationFailed.prefix = _("Prefix length should not be empty");
        else if (!utils.validateIpv6Prefix(dialogValues.prefix))
            validationFailed.prefix = _("Invalid IPv6 prefix");

        if (dialogValues.ipv6DhcpEnabled) {
            if (isEmpty(dialogValues.ipv6DhcpRangeStart.trim()))
                validationFailed.ipv6DhcpRangeStart = _("Start should not be empty");
            else if (!utils.validateIpv6(dialogValues.ipv6DhcpRangeStart))
                validationFailed.ipv6DhcpRangeStart = _("Invalid IPv6 address");
            else if (!utils.isIpv6InNetwork(dialogValues.ipv6, dialogValues.prefix, dialogValues.ipv6DhcpRangeStart))
                validationFailed.ipv6DhcpRangeStart = _("Address not within subnet");

            if (isEmpty(dialogValues.ipv6DhcpRangeEnd.trim()))
                validationFailed.ipv6DhcpRangeEnd = _("End should not be empty");
            else if (!utils.validateIpv6(dialogValues.ipv6DhcpRangeEnd))
                validationFailed.ipv6DhcpRangeEnd = _("Invalid IPv6 address");
            else if (!utils.isIpv6InNetwork(dialogValues.ipv6, dialogValues.prefix, dialogValues.ipv6DhcpRangeEnd))
                validationFailed.ipv6DhcpRangeEnd = _("Address not within subnet");
        }
    }

    return validationFailed;
}

const NetworkNameRow = ({ onValueChanged, dialogValues, validationFailed }) => {
    const validationState = validationFailed.name ? 'error' : 'default';

    return (
        <FormGroup fieldId='create-network-name' label={_("Name")}
                   helperTextInvalid={validationFailed.name}
                   validated={validationState}>
            <TextInput id='create-network-name'
                       placeholder={_("Unique network name")}
                       value={dialogValues.name}
                       validated={validationState}
                       onChange={value => onValueChanged('name', value)} />
        </FormGroup>
    );
};

const NetworkForwardModeRow = ({ onValueChanged, dialogValues }) => {
    const forwardModes = ['nat', 'open', 'none'];

    return (
        <FormGroup fieldId='create-network-forward-mode' label={_("Forward mode")}>
            <Select.Select id='create-network-forward-mode'
                           extraClass="pf-c-form-control"
                           initial={dialogValues.forwardMode}
                           onChange={value => onValueChanged('forwardMode', value)}>
                { forwardModes.map(mode => {
                    return (
                        <Select.SelectEntry data={mode} key={mode}>
                            {rephraseUI('networkForward', mode)}
                        </Select.SelectEntry>
                    );
                })
                }
            </Select.Select>
        </FormGroup>
    );
};

const NetworkDeviceRow = ({ devices, onValueChanged, dialogValues }) => {
    return (
        <FormGroup fieldId='create-network-device' label={_("Device")}>
            <Select.Select id='create-network-device'
                           extraClass='pf-c-form-control'
                           enabled={devices.length > 0}
                           initial={dialogValues.device}
                           onChange={value => onValueChanged('device', value)}>
                <Select.SelectEntry data='automatic' key='automatic'>
                    {_("Automatic")}
                </Select.SelectEntry>
                <Select.SelectDivider />
                <optgroup key="Devices" label="Devices">
                    { devices.map(dev => {
                        return (
                            <Select.SelectEntry data={dev} key={dev}>
                                {dev}
                            </Select.SelectEntry>
                        );
                    })}
                </optgroup>
            </Select.Select>
        </FormGroup>
    );
};

const IpRow = ({ onValueChanged, dialogValues, validationFailed }) => {
    return (
        <FormGroup fieldId='create-network-ip-configuration' label={_("IP configuration")}>
            <Select.Select id='create-network-ip-configuration'
                           extraClass='pf-c-form-control'
                           initial={dialogValues.ip}
                           onChange={value => onValueChanged('ip', value)}>
                { (dialogValues.forwardMode === "none") &&
                <Select.SelectEntry data='None' key='None'>
                    {_("None")}
                </Select.SelectEntry>}
                <Select.SelectEntry data='IPv4 only' key='IPv4 only'>
                    {_("IPv4 only")}
                </Select.SelectEntry>
                <Select.SelectEntry data='IPv6 only' key='IPv6 only'>
                    {_("IPv6 only")}
                </Select.SelectEntry>
                <Select.SelectEntry data='IPv4 and IPv6' key='IPv4 and IPv6'>
                    {_("IPv4 and IPv6")}
                </Select.SelectEntry>
            </Select.Select>
            { (dialogValues.ip === "IPv4 only" || dialogValues.ip === "IPv4 and IPv6") &&
            <Ipv4Row dialogValues={dialogValues}
                     onValueChanged={onValueChanged}
                     validationFailed={validationFailed} /> }

            { (dialogValues.ip === "IPv6 only" || dialogValues.ip === "IPv4 and IPv6") &&
            <Ipv6Row dialogValues={dialogValues}
                     onValueChanged={onValueChanged}
                     validationFailed={validationFailed} /> }
        </FormGroup>
    );
};

const DhcpRow = ({ ipVersion, rangeStart, rangeEnd, expanded, onValueChanged, validationFailed }) => {
    const validationStart = validationFailed['ipv' + ipVersion + 'DhcpRangeStart'] ? 'error' : 'default';
    const validationEnd = validationFailed['ipv' + ipVersion + 'DhcpRangeEnd'] ? 'error' : 'default';

    return (
        <>
            <FormGroup>
                <Checkbox id={'network-ipv' + ipVersion + '-dhcp'}
                          isChecked={expanded}
                          label={_("Set DHCP range")}
                          onChange={() => onValueChanged('ipv' + ipVersion + 'DhcpEnabled', !expanded)} />
            </FormGroup>
            {expanded && <FormSection className="ct-form-split">
                <FormGroup fieldId={'network-ipv' + ipVersion + '-dhcp-range-start'} label={_("Start")}
                           helperTextInvalid={validationFailed['ipv' + ipVersion + 'DhcpRangeStart']}
                           validated={validationStart}>
                    <TextInput id={'network-ipv' + ipVersion + '-dhcp-range-start'}
                               value={rangeStart}
                               onChange={value => onValueChanged('ipv' + ipVersion + 'DhcpRangeStart', value)} />
                </FormGroup>
                <FormGroup fieldId={'network-ipv' + ipVersion + '-dhcp-range-end'} label={_("End")}
                           helperTextInvalid={validationFailed['ipv' + ipVersion + 'DhcpRangeEnd']}
                           validated={validationEnd}>
                    <TextInput id={'network-ipv' + ipVersion + '-dhcp-range-end'}
                               value={rangeEnd}
                               onChange={value => onValueChanged('ipv' + ipVersion + 'DhcpRangeEnd', value)} />
                </FormGroup>
            </FormSection>}
        </>
    );
};

const Ipv4Row = ({ validationFailed, dialogValues, onValueChanged }) => {
    const validationAddress = validationFailed.ipv4 ? 'error' : 'default';
    const validationNetmask = validationFailed.netmask ? 'error' : 'default';

    return (
        <>
            <FormGroup fieldId='network-ipv4-address' label={_("IPv4 network")}
                       helperTextInvalid={validationFailed.ipv4}
                       validated={validationAddress}>
                <TextInput id='network-ipv4-address'
                           value={dialogValues.ipv4}
                           validated={validationAddress}
                           onChange={value => onValueChanged('ipv4', value)} />
            </FormGroup>
            <FormGroup fieldId='network-ipv4-netmask' label={_("Mask or prefix length")}
                       helperTextInvalid={validationFailed.netmask}
                       validated={validationNetmask}>
                <TextInput id='network-ipv4-netmask'
                           value={dialogValues.netmask}
                           validated={validationNetmask}
                           onChange={value => onValueChanged('netmask', value)} />
            </FormGroup>
            <DhcpRow ipVersion='4'
                rangeStart={dialogValues.ipv4DhcpRangeStart}
                rangeEnd={dialogValues.ipv4DhcpRangeEnd}
                expanded={dialogValues.ipv4DhcpEnabled}
                onValueChanged={onValueChanged}
                validationFailed={validationFailed} />
        </>
    );
};

const Ipv6Row = ({ validationFailed, dialogValues, onValueChanged }) => {
    const validationAddress = validationFailed.ipv6 ? 'error' : 'default';
    const validationPrefix = validationFailed.prefix ? 'error' : 'default';

    return (
        <>
            <FormGroup fieldId='network-ipv6-address' label={_("IPv6 network")}
                       helperTextInvalid={validationFailed.ipv6}
                       validated={validationAddress}>
                <TextInput id='network-ipv6-address'
                           value={dialogValues.ipv6}
                           validated={validationAddress}
                           onChange={value => onValueChanged('ipv6', value)} />
            </FormGroup>
            <FormGroup fieldId='network-ipv6-prefix' label={_("Prefix length")}
                       helperTextInvalid={validationFailed.prefix}
                       validated={validationPrefix}>
                <TextInput id='network-ipv6-prefix'
                           value={dialogValues.prefix}
                           validated={validationPrefix}
                           onChange={value => onValueChanged('prefix', value)} />
            </FormGroup>
            <DhcpRow ipVersion='6'
                rangeStart={dialogValues.ipv6DhcpRangeStart}
                rangeEnd={dialogValues.ipv6DhcpRangeEnd}
                expanded={dialogValues.ipv6DhcpEnabled}
                onValueChanged={onValueChanged}
                validationFailed={validationFailed} />
        </>
    );
};

class CreateNetworkModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            createInProgress: false,
            dialogError: undefined,
            validate: false,
            name: '',
            forwardMode: 'nat',
            device: 'automatic',
            ip: 'IPv4 only',
            ipv4: '192.168.100.1',
            netmask: '24',
            ipv6: '',
            prefix: '',
            ipv4DhcpEnabled: false,
            ipv4DhcpRangeStart: '',
            ipv4DhcpRangeEnd: '',
            ipv6DhcpEnabled: false,
            ipv6DhcpRangeStart: '',
            ipv6DhcpRangeEnd: '',
        };
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.dialogErrorDismiss = this.dialogErrorDismiss.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.onCreate = this.onCreate.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    dialogErrorDismiss() {
        this.setState({ dialogError: undefined });
    }

    onValueChanged(key, value) {
        if (key === "forwardMode") {
            if (this.state.ip !== "None" && (value === "bridge" || value === "vepa"))
                this.setState({ ip: "None" });

            if (this.state.ip === "None" && (value === "nat" || value === "open"))
                this.setState({ ip: "IPv4 only" });
        }

        this.setState({ [key]: value });
    }

    onCreate() {
        if (Object.getOwnPropertyNames(validateParams(this.state)).length > 0) {
            this.setState({ inProgress: false, validate: true });
        } else {
            const {
                name, forwardMode, ip, prefix, device,
                ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd
            } = this.state;
            const ipv6 = ["IPv4 only", "None"].includes(ip) ? undefined : this.state.ipv6;
            const ipv4 = ["IPv6 only", "None"].includes(ip) ? undefined : this.state.ipv4;
            const netmask = utils.netmaskConvert(this.state.netmask);

            this.setState({ createInProgress: true });
            networkCreate({
                connectionName: LIBVIRT_SYSTEM_CONNECTION, name, forwardMode, device, ipv4, netmask, ipv6, prefix,
                ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd
            })
                    .fail(exc => {
                        this.setState({ createInProgress: false });
                        this.dialogErrorSet(_("Virtual network failed to be created"), exc.message);
                    })
                    .then(() => this.props.close());
        }
    }

    render() {
        const validationFailed = this.state.validate && validateParams(this.state);

        const body = (
            <Form isHorizontal>
                <ConnectionRow connectionName={LIBVIRT_SYSTEM_CONNECTION} />

                <NetworkNameRow dialogValues={this.state}
                                onValueChanged={this.onValueChanged}
                                validationFailed={validationFailed} />

                <NetworkForwardModeRow dialogValues={this.state}
                                       onValueChanged={this.onValueChanged} />
                { (this.state.forwardMode === "nat" || this.state.forwardMode === "route") &&
                <NetworkDeviceRow dialogValues={this.state}
                                  devices={this.props.devices}
                                  onValueChanged={this.onValueChanged}
                                  validationFailed={validationFailed} /> }

                { (this.state.forwardMode !== "vepa" && this.state.forwardMode !== "bridge") &&
                <IpRow dialogValues={this.state}
                       onValueChanged={this.onValueChanged}
                       validationFailed={validationFailed} /> }
            </Form>
        );

        return (
            <Modal position="top" variant="medium" id='create-network-dialog' className='network-create' isOpen onClose={ this.props.close }
                   title={_("Create virtual network")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button variant='primary'
                                   isLoading={ this.state.createInProgress }
                                   isDisabled={ this.state.createInProgress || Object.getOwnPropertyNames(validationFailed).length > 0 }
                                   onClick={ this.onCreate }>
                               {_("Create")}
                           </Button>
                           <Button variant='link' className='btn-cancel' onClick={ this.props.close }>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {body}
            </Modal>
        );
    }
}
CreateNetworkModal.propTypes = {
    close: PropTypes.func.isRequired,
    devices: PropTypes.array.isRequired,
};

export class CreateNetworkAction extends React.Component {
    constructor(props) {
        super(props);
        this.state = { showModal: false };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    close() {
        this.setState({ showModal: false });
    }

    open() {
        this.setState({ showModal: true });
    }

    render() {
        return (
            <>
                <Button id='create-network'
                        variant='secondary' onClick={this.open}>
                    {_("Create virtual network")}
                </Button>
                { this.state.showModal &&
                <CreateNetworkModal
                    close={this.close}
                    devices={this.props.devices} /> }
            </>
        );
    }
}
CreateNetworkAction.propTypes = {
    devices: PropTypes.array.isRequired,
};
