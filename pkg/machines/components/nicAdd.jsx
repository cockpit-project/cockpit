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
import { NetworkTypeAndSourceRow, NetworkModelRow } from './nicBody.jsx';
import { getVm } from '../actions/provider-actions.js';
import { attachIface } from '../libvirt-dbus.js';
import { getNetworkDevices } from '../helpers.js';

import './nic.css';
import 'form-layout.scss';

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

export class AddNIC extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            dialogError: undefined,
            networkType: "network",
            networkSource: props.availableSources.network.length > 0 ? props.availableSources.network[0] : undefined,
            networkModel: "virtio",
            setNetworkMac: false,
            networkMac: "",
            permanent: false,
            availableSources: props.availableSources,
        };
        this.add = this.add.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    onValueChanged(key, value) {
        const stateDelta = { [key]: value };

        this.setState(stateDelta);

        if (key == 'networkType' && ['network', 'direct', 'bridge'].includes(value)) {
            let sources;
            if (value === "network")
                sources = this.state.availableSources.network;
            else
                sources = this.state.availableSources.device;

            if (sources && sources.length > 0)
                this.setState({ networkSource: sources[0], saveDisabled: false });
            else
                this.setState({ networkSource: undefined, saveDisabled: true });
        }
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
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
                    this.props.close();
                });
    }

    render() {
        const { idPrefix, vm, nodeDevices, interfaces, provider } = this.props;
        const networkDevices = getNetworkDevices(vm.connectionName, nodeDevices, interfaces);

        const defaultBody = (
            <form className='ct-form'>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         networkDevices={networkDevices}
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
                {vm.persistent && <>
                    <hr />
                    <PermanentChange idPrefix={idPrefix}
                                     dialogValues={this.state}
                                     onValueChanged={this.onValueChanged}
                                     provider={provider}
                                     vm={vm} />
                </>}
            </form>
        );

        return (
            <Modal id={`${idPrefix}-dialog`} onHide={this.props.close} className='nic-add' show>
                <Modal.Header>
                    <Modal.CloseButton onClick={this.props.close} />
                    <Modal.Title>{_("Add Virtual Network Interface")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <Button id={`${idPrefix}-cancel`} bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button disabled={["network", "direct", "bridge"].includes(this.state.networkType) && this.state.networkSource === undefined}
                            id={`${idPrefix}-add`}
                            bsStyle='primary'
                            onClick={this.add}>
                        {_("Add")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

AddNIC.propTypes = {
    dispatch: PropTypes.func.isRequired,
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
    provider: PropTypes.object.isRequired,
    interfaces: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default AddNIC;
