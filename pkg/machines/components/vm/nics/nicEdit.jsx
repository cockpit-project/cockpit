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
import { Button, Alert, Form, FormGroup, Modal } from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { NetworkTypeAndSourceRow, NetworkModelRow } from './nicBody.jsx';
import {
    changeNetworkSettings,
    getVm
} from '../../../actions/provider-actions.js';

import 'form-layout.scss';

const _ = cockpit.gettext;

const NetworkMacRow = ({ network }) => {
    return (
        <FormGroup fieldId='mac' label={_("MAC address")} hasNoPaddingTop>
            <samp id='mac'>
                {network.mac}
            </samp>
        </FormGroup>
    );
};

export class EditNICModal extends React.Component {
    constructor(props) {
        super(props);

        let defaultNetworkSource;
        const currentSource = this.getNetworkSource(props.network);
        let availableSources = [];

        if (props.network.type === "network")
            availableSources = props.availableSources.network;
        else if (props.network.type === "direct")
            availableSources = props.availableSources.device;
        else if (props.network.type === "bridge")
            availableSources = props.availableSources.device;

        if (availableSources.includes(currentSource))
            defaultNetworkSource = currentSource;
        else
            defaultNetworkSource = availableSources.length > 0 ? availableSources[0] : undefined;

        this.state = {
            dialogError: undefined,
            networkType: props.network.type,
            networkSource: defaultNetworkSource,
            networkModel: props.network.model,
            saveDisabled: false,
            availableSources: props.availableSources,
        };
        this.save = this.save.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    getNetworkSource(network) {
        if (network.type === "network")
            return network.source.network;
        else if (network.type === "direct")
            return network.source.dev;
        else if (network.type === "bridge")
            return network.source.bridge;
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
                    this.props.onClose();
                });
    }

    render() {
        const { idPrefix, vm, network } = this.props;

        const defaultBody = (
            <Form>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         connectionName={vm.connectionName} />
                <NetworkModelRow idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 osTypeArch={vm.arch}
                                 osTypeMachine={vm.emulatedMachine} />
                <NetworkMacRow network={network} />
            </Form>
        );
        const showWarning = () => {
            if (vm.state === 'running' && (
                this.state.networkType !== network.type ||
                this.state.networkSource !== this.getNetworkSource(network) ||
                this.state.networkModel !== network.model)
            ) {
                return <Alert isInline variant='warning' id={`${idPrefix}-edit-dialog-idle-message`} title={_("Changes will take effect after shutting down the VM")} />;
            }
        };

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-edit-dialog-modal-window`} isOpen onClose={this.props.onClose} className='nic-edit'
                   title={cockpit.format(_("$0 virtual network interface settings"), network.mac)}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button isDisabled={this.state.saveDisabled} id={`${idPrefix}-edit-dialog-save`} variant='primary' onClick={this.save}>
                               {_("Save")}
                           </Button>
                           <Button id={`${idPrefix}-edit-dialog-cancel`} variant='link' className='btn-cancel' onClick={this.props.onClose}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                <>
                    { showWarning() }
                    {defaultBody}
                </>
            </Modal>
        );
    }
}
EditNICModal.propTypes = {
    availableSources: PropTypes.object.isRequired,
    dispatch: PropTypes.func.isRequired,
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
    network: PropTypes.object.isRequired,
    onClose: PropTypes.func.isRequired,
};
