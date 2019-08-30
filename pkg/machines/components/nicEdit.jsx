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
import React from 'react';
import cockpit from 'cockpit';
import PropTypes from 'prop-types';
import {
    Modal,
    Button
} from 'patternfly-react';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import * as Select from 'cockpit-components-select.jsx';
import { getNetworkDevices } from '../helpers.js';
import {
    changeNetworkSettings,
    getVm
} from '../actions/provider-actions.js';

import './nicEdit.css';
import 'form-layout.less';

const _ = cockpit.gettext;

const NetworkModelRow = ({ idPrefix, onValueChanged, dialogValues, network, osTypeArch, osTypeMachine, isRunning }) => {
    const availableModelTypes = [
        { 'name': 'virtio', 'desc': 'Linux, perf' },
        { 'name': 'e1000e', 'desc': 'PCI' },
        { 'name': 'e1000', 'desc': 'PCI, legacy' },
        { 'name': 'rtl8139', 'desc': 'PCI, legacy' } ];
    const defaultModelType = dialogValues.networkModel;

    if (osTypeArch == 'ppc64' && osTypeMachine == 'pseries') {
        availableModelTypes.push('spapr-vlan');
    }

    return (
        <React.Fragment>
            <label className='control-label' htmlFor={`${idPrefix}-select-model`}>
                {_("Model")}
            </label>
            <Select.Select id={`${idPrefix}-select-model`}
                           onChange={value => onValueChanged('networkModel', value)}
                           initial={defaultModelType}
                           extraClass='form-control ct-form-split'>
                {availableModelTypes
                        .map(networkModel => {
                            return (
                                <Select.SelectEntry data={networkModel.name} key={networkModel.name}>
                                    {networkModel.name} ({networkModel.desc})
                                </Select.SelectEntry>
                            );
                        })}
            </Select.Select>
        </React.Fragment>
    );
};

const NetworkTypeAndSourceRow = ({ idPrefix, onValueChanged, dialogValues, network, connectionName, networks, nodeDevices, interfaces }) => {
    const defaultNetworkType = dialogValues.networkType;
    let availableNetworkTypes = [];
    let defaultNetworkSource = dialogValues.networkSource;
    let availableSources = [];
    let networkSourcesContent;
    let networkSourceEnabled = true;
    const networkDevices = getNetworkDevices(connectionName, nodeDevices, interfaces);

    if (connectionName !== 'session')
        availableNetworkTypes = [
            { 'name': 'network', 'desc': 'Virtual network' },
            { 'name': 'bridge', 'desc': 'Bridge to LAN', 'disabled': true },
            { 'name': 'ethernet', 'desc': 'Generic ethernet connection', 'disabled': true },
            { 'name': 'direct', 'desc': 'Direct attachment' },
        ];
    else
        availableNetworkTypes = [
            { 'name': 'network', 'desc': 'Virtual network' },
            { 'name': 'user', 'desc': 'Userspace SLIRP stack' },
        ];

    // Bring to the first position in dropdown list the initial selection which reflects the current nic type
    availableNetworkTypes.sort(function(x, y) { return x.name == defaultNetworkType ? -1 : y.name == defaultNetworkType ? 1 : 0 });

    if (["network", "direct"].includes(dialogValues.networkType)) {
        if (dialogValues.networkType === "network")
            availableSources = networks.map(network => network.name);
        else if (dialogValues.networkType === "direct")
            availableSources = networkDevices;

        if (availableSources.length > 0) {
            networkSourcesContent = availableSources
                    .map(networkSource => {
                        return (
                            <Select.SelectEntry data={networkSource} key={networkSource}>
                                {networkSource}
                            </Select.SelectEntry>
                        );
                    });
        } else {
            if (dialogValues.networkType === "network")
                defaultNetworkSource = _("No Virtual Networks");
            else if (dialogValues.networkType === "direct")
                defaultNetworkSource = _("No Network Devices");

            networkSourcesContent = (
                <Select.SelectEntry data='empty-list' key='empty-list'>
                    {defaultNetworkSource}
                </Select.SelectEntry>
            );
            networkSourceEnabled = false;
        }
    }

    return (
        <React.Fragment>
            <label className='control-label' htmlFor={`${idPrefix}-select-type`}>
                {_("Interface Type")}
            </label>
            <Select.Select id={`${idPrefix}-select-type`}
                           onChange={value => onValueChanged('networkType', value)}
                           initial={defaultNetworkType}
                           extraClass='form-control ct-form-split'>
                {availableNetworkTypes
                        .map(networkType => {
                            return (
                                <Select.SelectEntry data={networkType.name} key={networkType.name} disabled={networkType.disabled || false} >
                                    {networkType.desc}
                                </Select.SelectEntry>
                            );
                        })}
            </Select.Select>
            {["network", "direct"].includes(dialogValues.networkType) && (
                <React.Fragment>
                    <label className='control-label' htmlFor={`${idPrefix}-select-source`}>
                        {_("Source")}
                    </label>
                    <Select.Select id={`${idPrefix}-select-source`}
                                   onChange={value => onValueChanged('networkSource', value)}
                                   enabled={networkSourceEnabled}
                                   initial={defaultNetworkSource}
                                   extraClass='form-control ct-form-split'>
                        {networkSourcesContent}
                    </Select.Select>
                </React.Fragment>
            )}
        </React.Fragment>
    );
};

const NetworkMacRow = ({ network }) => {
    return (
        <React.Fragment>
            <label className='control-label' htmlFor='mac'>
                {_("Mac Address")}
            </label>
            <samp id='mac'>
                {network.mac}
            </samp>
        </React.Fragment>
    );
};

export class EditNICAction extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
            dialogError: undefined,
            networkType: props.network.type,
            networkSource: props.network.source.network || props.network.source.dev,
            networkModel: props.network.model,
            saveDisabled: false,
        };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.save = this.save.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    onValueChanged(key, value) {
        const stateDelta = { [key]: value };

        this.setState(stateDelta);

        if (key == 'networkType') {
            let saveDisabled = false;

            if (value == 'network' || value == 'direct') {
                let availableSources;
                if (value == 'network')
                    availableSources = this.props.networks.map(network => network.name);
                else if (['direct'].includes(value))
                    availableSources = getNetworkDevices(this.props.vm.connectionName, this.props.nodeDevices, this.props.interfaces);

                if (availableSources.length > 0) {
                    this.setState({ 'networkSource': availableSources[0] });
                } else {
                    this.setState({ 'networkSource': undefined });
                    saveDisabled = true;
                }
            }
            this.setState({ 'saveDisabled': saveDisabled });
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

    save() {
        const { dispatch, vm, network } = this.props;

        dispatch(changeNetworkSettings({
            vm, macAddress: network.mac,
            networkModel: this.state.networkModel,
            networkType: this.state.networkType,
            networkSource: this.state.networkSource
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
        const { idPrefix, vm, network, networks, nodeDevices, interfaces } = this.props;
        const defaultBody = (
            <form className='ct-form'>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         network={network}
                                         networks={networks}
                                         interfaces={interfaces}
                                         nodeDevices={nodeDevices}
                                         connectionName={vm.connectionName}
                                         isRunning={vm.state == 'running'} />
                <hr />
                <NetworkModelRow idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 network={network}
                                 osTypeArch={vm.arch}
                                 osTypeMachine={vm.emulatedMachines}
                                 isRunning={vm.state == 'running'} />
                <hr />
                <NetworkMacRow network={network} />
            </form>
        );
        const showFooterWarning = () => {
            if (vm.state === 'running' && (
                this.state.networkType !== network.type ||
                this.state.networkSource !== network.source[network.type] ||
                this.state.networkModel !== network.model)
            ) {
                return (
                    <span id={`${idPrefix}-edit-dialog-idle-message`} className='idle-message'>
                        <i className='pficon pficon-pending' />
                        <span>{_("Changes will take effect after shutting down the VM")}</span>
                    </span>
                );
            }
        };

        return (
            <div id={`${idPrefix}-edit-dialog-full`}>
                <Button id={`${idPrefix}-edit-dialog`} bsStyle='default' onClick={this.open}>
                    {_("Edit")}
                </Button>

                <Modal id={`${idPrefix}-edit-dialog-modal-window`} show={this.state.showModal} onHide={this.close} className='nic-edit'>
                    <Modal.Header>
                        <Modal.CloseButton onClick={this.close} />
                        <Modal.Title> {`${network.mac} Virtual Network Interface Settings`} </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        {defaultBody}
                    </Modal.Body>
                    <Modal.Footer>
                        {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                        { showFooterWarning() }
                        <Button id={`${idPrefix}-edit-dialog-cancel`} bsStyle='default' className='btn-cancel' onClick={this.close}>
                            {_("Cancel")}
                        </Button>
                        <Button disabled={this.state.saveDisabled} id={`${idPrefix}-edit-dialog-save`} bsStyle='primary' onClick={this.save}>
                            {_("Save")}
                        </Button>
                    </Modal.Footer>
                </Modal>
            </div>
        );
    }
}

EditNICAction.propTypes = {
    dispatch: PropTypes.func.isRequired,
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
    network: PropTypes.object.isRequired,
    networks: PropTypes.array.isRequired,
    interfaces: PropTypes.array.isRequired,
    nodeDevices: PropTypes.array.isRequired,
};

export default EditNICAction;
