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
    Form,
    FormGroup,
    Grid,
    Modal,
    Button
} from 'patternfly-react';

import { ModalError } from './notification/inlineNotification.jsx';
import * as Select from 'cockpit-components-select.jsx';
import {
    changeNetworkSettings,
    getVm
} from '../actions/provider-actions.es6';

import './nicEdit.css';

const _ = cockpit.gettext;

const NetworkModelRow = ({ idPrefix, onValueChanged, dialogValues, network, osTypeArch, osTypeMachine, isRunning }) => {
    let availableModelTypes = [
        { 'name': 'virtio', 'desc': 'Linux, perf' },
        { 'name': 'e1000e', 'desc': 'PCI' },
        { 'name': 'e1000', 'desc': 'PCI, legacy' },
        { 'name': 'rtl8139', 'desc': 'PCI, legacy' } ];
    let defaultModelType = dialogValues.networkModel;

    if (osTypeArch == 'ppc64' && osTypeMachine == 'pseries') {
        availableModelTypes.push('spapr-vlan');
    }

    return (
        <FormGroup controlId='model' disabled={false}>
            <Grid.Col componentClass={Form.ControlLabel} sm={2}>
                {_("Model")}
            </Grid.Col>
            <Grid.Col sm={4}>
                <Select.Select id={`${idPrefix}-select-model`}
                               onChange={value => onValueChanged('networkModel', value)}
                               initial={defaultModelType}
                               extraClass='form-control'>
                    {availableModelTypes
                            .map(networkModel => {
                                return (
                                    <Select.SelectEntry data={networkModel.name} key={networkModel.name}>
                                        {networkModel.name} ({networkModel.desc})
                                    </Select.SelectEntry>
                                );
                            })}
                </Select.Select>
            </Grid.Col>
        </FormGroup>
    );
};

const NetworkTypeAndSourceRow = ({ idPrefix, onValueChanged, dialogValues, network, connectionName, networks }) => {
    let defaultNetworkType = dialogValues.networkType;
    let availableNetworkTypes = [];
    let defaultNetworkSource = dialogValues.networkSource;
    let availableNetworkSources = [];
    let networkSourcesContent;

    if (connectionName !== 'session')
        availableNetworkTypes = [
            { 'name': 'network', 'desc': 'Virtual network' },
            { 'name': 'bridge', 'desc': 'Bridge to LAN', 'disabled': true },
            { 'name': 'ethernet', 'desc': 'Generic ethernet connection', 'disabled': true },
            { 'name': 'direct', 'desc': 'Direct attachment', 'disabled': true },
        ];
    else
        availableNetworkTypes = [
            { 'name': 'network', 'desc': 'Virtual network' },
            { 'name': 'user', 'desc': 'Userspace SLIRP stack' },
        ];

    // Bring to the first position in dropdown list the initial selection which reflects the current nic type
    availableNetworkTypes.sort(function(x, y) { return x.name == defaultNetworkType ? -1 : y.name == defaultNetworkType ? 1 : 0 });

    if (dialogValues.networkType == 'network')
        availableNetworkSources = networks.map(network => network.name);
    if (availableNetworkSources.length > 0) {
        defaultNetworkSource = defaultNetworkSource == undefined ? availableNetworkSources[0] : defaultNetworkSource;
        networkSourcesContent = availableNetworkSources
                .map(networkSource => {
                    return (
                        <Select.SelectEntry data={networkSource} key={networkSource}>
                            {networkSource}
                        </Select.SelectEntry>
                    );
                });
    } else {
        networkSourcesContent = (
            <Select.SelectEntry data='empty' key='empty-list'>
                <i>{_("No virtual networks")}</i>
            </Select.SelectEntry>
        );
        defaultNetworkSource = 'empty';
    }

    const onNetworkTypeChanged = (value) => {
        onValueChanged('networkType', value);
        onValueChanged('networkSource', defaultNetworkSource);
    };

    return (
        <FormGroup controlId="type" disabled={false}>
            <Grid.Col componentClass={Form.ControlLabel} sm={2}>
                {_("Network Type")}
            </Grid.Col>
            <Grid.Col sm={4}>
                <Select.Select id={`${idPrefix}-select-type`}
                               onChange={value => onNetworkTypeChanged(value)}
                               initial={defaultNetworkType}
                               extraClass='form-control'>
                    {availableNetworkTypes
                            .map(networkType => {
                                return (
                                    <Select.SelectEntry data={networkType.name} key={networkType.name} disabled={networkType.disabled || false} >
                                        {networkType.desc}
                                    </Select.SelectEntry>
                                );
                            })}
                </Select.Select>
            </Grid.Col>
            {(dialogValues.networkType === 'network') && (
                <React.Fragment>
                    <Grid.Col componentClass={Form.ControlLabel} sm={2}>
                        {_("Source")}
                    </Grid.Col>
                    <Grid.Col sm={4}>
                        <Select.Select id={`${idPrefix}-select-source`}
                                       onChange={value => onValueChanged('networkSource', value)}
                                       initial={defaultNetworkSource}
                                       extraClass='form-control'>
                            {networkSourcesContent}
                        </Select.Select>
                    </Grid.Col>
                </React.Fragment>
            )}
        </FormGroup>
    );
};

const NetworkMacRow = ({ network }) => {
    return (
        <FormGroup controlId='mac' disabled >
            <Grid.Col componentClass={Form.ControlLabel} sm={2}>
                {_("Mac Address")}
            </Grid.Col>
            <Grid.Col sm={2}>
                <samp className='form-text'>
                    {network.mac}
                </samp>
            </Grid.Col>
        </FormGroup>
    );
};

export class EditNICAction extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
            dialogError: undefined,
            networkType: props.network.type,
            networkSource: props.network.source[props.network.type],
            networkModel: props.network.model,
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
                    this.dialogErrorSet(_("Network settings could not be saved"), exc.message);
                })
                .then(() => {
                    dispatch(getVm({ connectionName: vm.connectionName, id: vm.id }));
                    this.close();
                });
    }

    render() {
        const { idPrefix, vm, network, networks } = this.props;
        const networksFiltered = networks.filter(network => network.connectionName == vm.connectionName);
        const defaultBody = (
            <Form horizontal>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         network={network}
                                         networks={networksFiltered}
                                         connectionName={vm.connectionName}
                                         isRunning={vm.state == 'running'} />
                <NetworkModelRow idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 network={network}
                                 osTypeArch={vm.arch}
                                 osTypeMachine={vm.emulatedMachines}
                                 isRunning={vm.state == 'running'} />
                <NetworkMacRow network={network} />
            </Form>
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
                        <Button id={`${idPrefix}-edit-dialog-save`} bsStyle='primary' onClick={this.save}>
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
};

export default EditNICAction;
