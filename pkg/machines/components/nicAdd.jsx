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
import cockpit from 'cockpit';
import PropTypes from 'prop-types';
import { Modal, Button } from 'patternfly-react';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { getNetworkDevices } from '../helpers.js';
import { NetworkTypeAndSourceRow, NetworkModelRow } from './nicBody.jsx';
import { getVm } from '../actions/provider-actions.js';
import { attachIface } from '../libvirt-dbus.js';

import './nic.css';
import 'form-layout.less';

const _ = cockpit.gettext;

const NetworkMacRow = ({ idPrefix, dialogValues, onValueChanged }) => {
    return (
        <>
            <>
                <label className='control-label' htmlFor={`${idPrefix}-generate-mac`}>
                    {_("MAC Address")}
                </label>
                <label className='checkbox-inline'>
                    <input id={`${idPrefix}-generate-mac`}
                        type="radio"
                        name="generate-mac"
                        checked={!dialogValues.setNetworkMac}
                        onChange={e => onValueChanged('setNetworkMac', false)}
                        className={!dialogValues.setNetworkMac ? "active" : ''} />
                    {_("Generate automatically")}
                </label>
            </>
            <div className='mac-grid'>
                <label className='checkbox-inline'>
                    <input id={`${idPrefix}-set-mac`}
                        type="radio"
                        name="set-mac"
                        checked={dialogValues.setNetworkMac}
                        onChange={e => onValueChanged('setNetworkMac', true)}
                        className={dialogValues.setNetworkMac ? "active" : ''} />
                    {_("Set manually")}
                </label>
                <input id={`${idPrefix}-mac`}
                    className='form-control'
                    type='text'
                    disabled={!dialogValues.setNetworkMac}
                    value={dialogValues.networkMac}
                    onChange={e => onValueChanged('networkMac', e.target.value)} />
            </div>
        </>
    );
};

const PermanentChange = ({ idPrefix, onValueChanged, dialogValues, provider, vm }) => {
    // By default for a running VM, the iface is attached until shut down only. Enable permanent change of the domain.xml
    if (!provider.isRunning(vm.state))
        return null;

    return (
        <>
            <label className="control-label"> {_("Persistence")} </label>
            <label className='checkbox-inline'>
                <input id={`${idPrefix}-permanent`}
                       type="checkbox"
                       checked={dialogValues.permanent}
                       onChange={e => onValueChanged('permanent', e.target.checked)} />
                {_("Always attach")}
            </label>
        </>
    );
};

export class AddNICAction extends React.Component {
    constructor(props) {
        super(props);

        this.state = this.initialState;
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.add = this.add.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    get initialState() {
        const state = {
            showModal: false,
            dialogError: undefined,
            networkType: "network",
            networkSource: undefined,
            networkModel: "virtio",
            setNetworkMac: false,
            networkMac: "",
            permanent: false,
            addDisabled: false,
        };

        const availableSources = this.props.networks.map(network => network.name);
        if (availableSources.length > 0)
            state.networkSource = availableSources[0];

        return state;
    }

    onValueChanged(key, value) {
        const stateDelta = { [key]: value };

        this.setState(stateDelta);

        if (key == 'networkType') {
            let addDisabled = false;

            if (value == 'network' || value == 'direct') {
                let availableSources;
                if (value == 'network')
                    availableSources = this.props.networks.map(network => network.name);
                else if (value == 'direct')
                    availableSources = getNetworkDevices(this.props.vm.connectionName, this.props.nodeDevices, this.props.interfaces);

                if (availableSources.length > 0) {
                    this.setState({ networkSource: availableSources[0] });
                } else {
                    this.setState({ networkSource: undefined });
                    addDisabled = true;
                }
            }
            this.setState({ addDisabled });
        }
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    close() {
        this.setState({ showModal: false, dialogError: undefined });
    }

    open() {
        this.setState({ showModal: true });
    }

    add() {
        const { dispatch, vm } = this.props;

        dispatch(attachIface({
            connectionName: vm.connectionName,
            vmId: vm.id,
            model: this.state.networkModel,
            sourceType: this.state.networkType,
            source: this.state.networkSource,
            mac: this.state.setNetworkMac ? this.state.networkMac : undefined,
            permanent: this.state.permanent,
            hotplug: vm.state === "running",
        }))
                .fail((exc) => {
                    this.dialogErrorSet(_("Network interface settings could not be saved"), exc.message);
                })
                .then(() => {
                    dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                    this.close();
                });
    }

    render() {
        const { idPrefix, vm, networks, nodeDevices, interfaces, provider } = this.props;

        const defaultBody = (
            <form className='ct-form'>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         networks={networks}
                                         interfaces={interfaces}
                                         nodeDevices={nodeDevices}
                                         connectionName={vm.connectionName} />
                <hr />
                <NetworkModelRow idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 osTypeArch={vm.arch}
                                 osTypeMachine={vm.emulatedMachine} />
                <hr />
                <NetworkMacRow idPrefix={idPrefix}
                               dialogValues={this.state}
                               onValueChanged={this.onValueChanged} />
                <hr />
                <PermanentChange idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 provider={provider}
                                 vm={vm} />
            </form>
        );

        return (
            <>
                <Button id={`${idPrefix}-button`} bsStyle='default' className='pull-right' onClick={this.open}>
                    {_("Add Network Interface")}
                </Button>

                <Modal id={`${idPrefix}-dialog`} show={this.state.showModal} onHide={this.close} className='nic-add'>
                    <Modal.Header>
                        <Modal.CloseButton onClick={this.close} />
                        <Modal.Title>{_("Add Virtual Network Interface")}</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        {defaultBody}
                    </Modal.Body>
                    <Modal.Footer>
                        {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                        <Button id={`${idPrefix}-cancel`} bsStyle='default' className='btn-cancel' onClick={this.close}>
                            {_("Cancel")}
                        </Button>
                        <Button disabled={this.state.addDisabled} id={`${idPrefix}-add`} bsStyle='primary' onClick={this.add}>
                            {_("Add")}
                        </Button>
                    </Modal.Footer>
                </Modal>
            </>
        );
    }
}

AddNICAction.propTypes = {
    dispatch: PropTypes.func.isRequired,
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
    provider: PropTypes.object.isRequired,
    networks: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default AddNICAction;
