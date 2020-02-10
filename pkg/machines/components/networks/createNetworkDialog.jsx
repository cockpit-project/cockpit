
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
import { Button, FormGroup, HelpBlock, Modal } from 'patternfly-react';

import { MachinesConnectionSelector } from '../machinesConnectionSelector.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { networkCreate } from '../../libvirt-dbus.js';
import * as Select from 'cockpit-components-select.jsx';
import { isEmpty, LIBVIRT_SYSTEM_CONNECTION, rephraseUI } from '../../helpers.js';
import * as utils from './utils';
import cockpit from 'cockpit';

import './createNetworkDialog.css';

const _ = cockpit.gettext;

function validateParams(dialogValues) {
    let validationFailed = {};

    if (isEmpty(dialogValues.name.trim()))
        validationFailed['name'] = _("Name should not be empty");

    if (dialogValues.ip === "IPv4 only" || dialogValues.ip === "IPv4 and IPv6") {
        if (isEmpty(dialogValues.ipv4.trim()))
            validationFailed['ipv4'] = _("IPv4 Network should not be empty");
        else if (!utils.validateIpv4(dialogValues.ipv4))
            validationFailed['ipv4'] = _("Invalid IPv4 address");

        if (isEmpty(dialogValues.netmask.trim()))
            validationFailed['netmask'] = _("Mask or Prefix Length should not be empty");
        else if (!utils.validateNetmask(dialogValues.netmask))
            validationFailed['netmask'] = _("Invalid IPv4 mask or prefix length");

        if (dialogValues.ipv4DhcpEnabled) {
            if (isEmpty(dialogValues.ipv4DhcpRangeStart.trim()))
                validationFailed['ipv4DhcpRangeStart'] = _("Start should not be empty");
            else if (!utils.validateIpv4(dialogValues.ipv4DhcpRangeStart))
                validationFailed['ipv4DhcpRangeStart'] = _("Invalid IPv4 address");
            else if (!utils.isIpv4InNetwork(dialogValues.ipv4, dialogValues.netmask, dialogValues.ipv4DhcpRangeStart))
                validationFailed['ipv4DhcpRangeStart'] = _("Address not within subnet");

            if (isEmpty(dialogValues.ipv4DhcpRangeEnd.trim()))
                validationFailed['ipv4DhcpRangeEnd'] = _("End should not be empty");
            else if (!utils.validateIpv4(dialogValues.ipv4DhcpRangeEnd))
                validationFailed['ipv4DhcpRangeEnd'] = _("Invalid IPv4 address");
            else if (!utils.isIpv4InNetwork(dialogValues.ipv4, dialogValues.netmask, dialogValues.ipv4DhcpRangeEnd))
                validationFailed['ipv4DhcpRangeEnd'] = _("Address not within subnet");
        }
    }

    if (dialogValues.ip === "IPv6 only" || dialogValues.ip === "IPv4 and IPv6") {
        if (isEmpty(dialogValues.ipv6.trim()))
            validationFailed['ipv6'] = _("IPv6 Network should not be empty");
        else if (!utils.validateIpv6(dialogValues.ipv6))
            validationFailed['ipv6'] = _("Invalid IPv6 address");

        if (isEmpty(dialogValues.prefix.trim()))
            validationFailed['prefix'] = _("Prefix Length should not be empty");
        else if (!utils.validateIpv6Prefix(dialogValues.prefix))
            validationFailed['prefix'] = _("Invalid IPv6 prefix");

        if (dialogValues.ipv6DhcpEnabled) {
            if (isEmpty(dialogValues.ipv6DhcpRangeStart.trim()))
                validationFailed['ipv6DhcpRangeStart'] = _("Start should not be empty");
            else if (!utils.validateIpv6(dialogValues.ipv6DhcpRangeStart))
                validationFailed['ipv6DhcpRangeStart'] = _("Invalid IPv6 address");
            else if (!utils.isIpv6InNetwork(dialogValues.ipv6, dialogValues.prefix, dialogValues.ipv6DhcpRangeStart))
                validationFailed['ipv6DhcpRangeStart'] = _("Address not within subnet");

            if (isEmpty(dialogValues.ipv6DhcpRangeEnd.trim()))
                validationFailed['ipv6DhcpRangeEnd'] = _("End should not be empty");
            else if (!utils.validateIpv6(dialogValues.ipv6DhcpRangeEnd))
                validationFailed['ipv6DhcpRangeEnd'] = _("Invalid IPv6 address");
            else if (!utils.isIpv6InNetwork(dialogValues.ipv6, dialogValues.prefix, dialogValues.ipv6DhcpRangeEnd))
                validationFailed['ipv6DhcpRangeEnd'] = _("Address not within subnet");
        }
    }

    return validationFailed;
}

const NetworkConnectionRow = ({ onValueChanged, dialogValues, loggedUser }) => {
    return (
        <React.Fragment>
            <label className='control-label' htmlFor='create-network-connection'>
                {_("Connection")}
            </label>
            <MachinesConnectionSelector id='create-network-connection'
                dialogValues={dialogValues}
                onValueChanged={onValueChanged}
                loggedUser={loggedUser} />
        </React.Fragment>
    );
};

const NetworkNameRow = ({ onValueChanged, dialogValues, validationFailed }) => {
    const validationState = validationFailed.name ? 'error' : undefined;

    return (
        <React.Fragment>
            <label className='control-label' htmlFor='create-network-name'>
                {_("Name")}
            </label>
            <FormGroup validationState={validationState} controlId='name'>
                <input
                   id='create-network-name'
                   type='text'
                   placeholder={_("Unique Network Name")}
                   value={dialogValues.name}
                   onChange={e => onValueChanged('name', e.target.value)}
                   className='form-control' />
                { validationState == 'error' &&
                <HelpBlock>
                    <p className='text-danger'>{validationFailed.name}</p>
                </HelpBlock> }
            </FormGroup>
        </React.Fragment>
    );
};

const NetworkForwardModeRow = ({ onValueChanged, dialogValues }) => {
    const forwardModes = ['nat', 'open', 'none'];

    return (
        <React.Fragment>
            <label className='control-label' htmlFor='create-network-forward-mode'>
                {_("Forward Mode")}
            </label>
            <Select.Select id='create-network-forward-mode'
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
        </React.Fragment>
    );
};

const NetworkDeviceRow = ({ devices, onValueChanged, dialogValues }) => {
    return (
        <React.Fragment>
            <label className='control-label' htmlFor='create-network-device'>
                {_("Device")}
            </label>
            <Select.Select id='create-network-device'
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
        </React.Fragment>
    );
};

const IpRow = ({ onValueChanged, dialogValues }) => {
    return (
        <React.Fragment>
            <label className='control-label' htmlFor='create-network-ip-configuration'>
                {_("IP Configuration")}
            </label>
            <Select.Select id='create-network-ip-configuration'
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
        </React.Fragment>
    );
};

const DhcpRow = ({ ipVersion, rangeStart, rangeEnd, expanded, onValueChanged, validationFailed }) => {
    const validationStart = validationFailed['ipv' + ipVersion + 'DhcpRangeStart'] ? 'error' : undefined;
    const validationEnd = validationFailed['ipv' + ipVersion + 'DhcpRangeEnd'] ? 'error' : undefined;

    return (
        <React.Fragment>
            <label className='checkbox-inline'>
                <input id={'network-ipv' + ipVersion + '-dhcp'}
                    type='checkbox'
                    checked={expanded}
                    onChange={e => onValueChanged('ipv' + ipVersion + 'DhcpEnabled', !expanded)} />
                {_("Set DHCP Range")}
            </label>

            {expanded && <React.Fragment>
                <div className='create-network-dialog-grid'>
                    <div className='ct-form'>
                        <label className='control-label' htmlFor={'network-ipv' + ipVersion + '-dhcp-range-start'}> {_("Start")} </label>
                        <FormGroup validationState={validationStart} controlId={'ipv' + ipVersion + '-dhcp-range-start'}>
                            <input
                               id={'network-ipv' + ipVersion + '-dhcp-range-start'}
                               type='text'
                               value={rangeStart}
                               onChange={e => onValueChanged('ipv' + ipVersion + 'DhcpRangeStart', e.target.value)}
                               className='form-control' />
                            { validationStart == 'error' &&
                            <HelpBlock>
                                <p className='text-danger'>{validationFailed['ipv' + ipVersion + 'DhcpRangeStart']}</p>
                            </HelpBlock> }
                        </FormGroup>
                    </div>
                    <div className='ct-form'>
                        <label className='control-label' htmlFor={'network-ipv' + ipVersion + '-dhcp-range-end'}> {_("End")} </label>
                        <FormGroup validationState={validationEnd} controlId={'ipv' + ipVersion + '-dhcp-range-end'}>
                            <input
                               id={'network-ipv' + ipVersion + '-dhcp-range-end'}
                               type='text'
                               value={rangeEnd}
                               onChange={e => onValueChanged('ipv' + ipVersion + 'DhcpRangeEnd', e.target.value)}
                               className='form-control' />
                            { validationEnd == 'error' &&
                            <HelpBlock>
                                <p className='text-danger'>{validationFailed['ipv' + ipVersion + 'DhcpRangeEnd']}</p>
                            </HelpBlock> }
                        </FormGroup>
                    </div>
                </div>
            </React.Fragment> }
        </React.Fragment>
    );
};

const Ipv4Row = ({ validationFailed, dialogValues, onValueChanged }) => {
    const validationAddress = validationFailed.ipv4 ? 'error' : undefined;
    const validationNetmask = validationFailed.netmask ? 'error' : undefined;

    return (
        <React.Fragment>
            <div className='ct-form'>
                <label className='control-label' htmlFor='network-ipv4-address'> {_("IPv4 Network")} </label>
                <FormGroup validationState={validationAddress} controlId='ipv4-address'>
                    <input id='network-ipv4-address'
                       type='text'
                       value={dialogValues.ipv4}
                       onChange={e => onValueChanged('ipv4', e.target.value)}
                       className='form-control' />
                    { validationAddress == 'error' &&
                    <HelpBlock>
                        <p className='text-danger'>{validationFailed.ipv4}</p>
                    </HelpBlock> }
                </FormGroup>
            </div>
            <div className='ct-form'>
                <label className='control-label' htmlFor='network-ipv4-netmask'> {_("Mask or Prefix Length")} </label>
                <FormGroup validationState={validationNetmask} controlId='ipv4-netmask'>
                    <input id='network-ipv4-netmask'
                       type='text'
                       value={dialogValues.netmask}
                       onChange={e => onValueChanged('netmask', e.target.value)}
                       className='form-control' />
                    { validationNetmask == 'error' &&
                    <HelpBlock>
                        <p className='text-danger'>{validationFailed.netmask}</p>
                    </HelpBlock> }
                </FormGroup>
            </div>
            <DhcpRow ipVersion='4'
                rangeStart={dialogValues.ipv4DhcpRangeStart}
                rangeEnd={dialogValues.ipv4DhcpRangeEnd}
                expanded={dialogValues.ipv4DhcpEnabled}
                onValueChanged={onValueChanged}
                validationFailed={validationFailed} />
        </React.Fragment>
    );
};

const Ipv6Row = ({ validationFailed, dialogValues, onValueChanged }) => {
    const validationAddress = validationFailed.ipv6 ? 'error' : undefined;
    const validationPrefix = validationFailed.prefix ? 'error' : undefined;

    return (
        <React.Fragment>
            <div className='ct-form'>
                <label className='control-label' htmlFor='network-ipv6-address'> {_("IPv6 Network")} </label>
                <FormGroup validationState={validationAddress} controlId='ipv6-address'>
                    <input id='network-ipv6-address'
                       type='text'
                       value={dialogValues.ipv6}
                       onChange={e => onValueChanged('ipv6', e.target.value)}
                       className='form-control' />
                    { validationAddress == 'error' &&
                    <HelpBlock>
                        <p className='text-danger'>{validationFailed.ipv6}</p>
                    </HelpBlock> }
                </FormGroup>
            </div>
            <div className='ct-form'>
                <label className='control-label' htmlFor='network-ipv6-prefix'> {_("Prefix Length")} </label>
                <FormGroup validationState={validationPrefix} controlId='ipv6-prefix'>
                    <input id='network-ipv6-prefix'
                       type='text'
                       value={dialogValues.prefix}
                       onChange={e => onValueChanged('prefix', e.target.value)}
                       className='form-control' />
                    { validationPrefix == 'error' &&
                    <HelpBlock>
                        <p className='text-danger'>{validationFailed.prefix}</p>
                    </HelpBlock> }
                </FormGroup>
            </div>
            <DhcpRow ipVersion='6'
                rangeStart={dialogValues.ipv6DhcpRangeStart}
                rangeEnd={dialogValues.ipv6DhcpRangeEnd}
                expanded={dialogValues.ipv6DhcpEnabled}
                onValueChanged={onValueChanged}
                validationFailed={validationFailed} />
        </React.Fragment>
    );
};

class CreateNetworkModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            createInProgress: false,
            dialogError: undefined,
            connectionName: LIBVIRT_SYSTEM_CONNECTION,
            validate: false,
            name: '',
            forwardMode: 'nat',
            device: 'automatic',
            ip: 'IPv4 only',
            ipv4: '192.168.100.0',
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
                this.setState({ "ip": "None" });

            if (this.state.ip === "None" && (value === "nat" || value === "open"))
                this.setState({ "ip": "IPv4 only" });
        }

        this.setState({ [key]: value });
    }

    onCreate() {
        if (Object.getOwnPropertyNames(validateParams(this.state)).length > 0) {
            this.setState({ inProgress: false, validate: true });
        } else {
            const { connectionName, name, forwardMode, ipv4, ipv6, prefix, device,
                    ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd } = this.state;
            const netmask = utils.netmaskConvert(this.state.netmask);

            this.setState({ createInProgress: true });
            networkCreate({ connectionName, name, forwardMode, device, ipv4, netmask, ipv6, prefix,
                            ipv4DhcpRangeStart, ipv4DhcpRangeEnd, ipv6DhcpRangeStart, ipv6DhcpRangeEnd })
                    .fail(exc => {
                        this.setState({ createInProgress: false });
                        this.dialogErrorSet(_("Virtual Network failed to be created"), exc.message);
                    })
                    .then(() => this.props.close());
        }
    }

    render() {
        const validationFailed = this.state.validate && validateParams(this.state);

        const body = (
            <form className='ct-form'>
                <NetworkConnectionRow dialogValues={this.state}
                                      onValueChanged={this.onValueChanged}
                                      loggedUser={this.props.loggedUser} />

                <hr />

                <NetworkNameRow dialogValues={this.state}
                                onValueChanged={this.onValueChanged}
                                validationFailed={validationFailed} />

                <hr />

                <NetworkForwardModeRow dialogValues={this.state}
                                       onValueChanged={this.onValueChanged} />
                { (this.state.forwardMode === "nat" || this.state.forwardMode === "route") &&
                <NetworkDeviceRow dialogValues={this.state}
                                  devices={this.props.devices}
                                  onValueChanged={this.onValueChanged}
                                  validationFailed={validationFailed} /> }

                <hr />

                { (this.state.forwardMode !== "vepa" && this.state.forwardMode !== "bridge") &&
                <React.Fragment>
                    <IpRow dialogValues={this.state}
                           onValueChanged={this.onValueChanged} />

                    { (this.state.ip === "IPv4 only" || this.state.ip === "IPv4 and IPv6") &&
                    <Ipv4Row dialogValues={this.state}
                             onValueChanged={this.onValueChanged}
                             validationFailed={validationFailed} /> }

                    { (this.state.ip === "IPv6 only" || this.state.ip === "IPv4 and IPv6") &&
                    <Ipv6Row dialogValues={this.state}
                             onValueChanged={this.onValueChanged}
                             validationFailed={validationFailed} /> }
                </React.Fragment> }
            </form>
        );

        return (
            <Modal id='create-network-dialog' className='network-create' show onHide={ this.props.close }>
                <Modal.Header>
                    <Modal.CloseButton onClick={ this.props.close } />
                    <Modal.Title> {_("Create Virtual Network")} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {body}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    {this.state.createInProgress && <div className="spinner spinner-sm pull-left" />}
                    <Button bsStyle='default' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary'
                        disabled={ this.state.createInProgress || Object.getOwnPropertyNames(validationFailed).length > 0 }
                        onClick={ this.onCreate }>
                        {_("Create")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}
CreateNetworkModal.propTypes = {
    close: PropTypes.func.isRequired,
    devices: PropTypes.array.isRequired,
    loggedUser: PropTypes.object.isRequired,
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
            <React.Fragment>
                <Button className='pull-right' id='create-network'
                        bsStyle='default' onClick={this.open} >
                    {_("Create Virtual Network")}
                </Button>
                { this.state.showModal &&
                <CreateNetworkModal
                    close={this.close}
                    devices={this.props.devices}
                    loggedUser={this.props.loggedUser} /> }
            </React.Fragment>
        );
    }
}
CreateNetworkAction.propTypes = {
    loggedUser: PropTypes.object.isRequired,
    devices: PropTypes.array.isRequired,
};
