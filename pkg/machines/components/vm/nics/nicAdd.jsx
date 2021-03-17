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
import { Button, Checkbox, Form, FormGroup, Modal, Radio, TextInput } from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { NetworkTypeAndSourceRow, NetworkModelRow } from './nicBody.jsx';
import { getVm } from '../../../actions/provider-actions.js';
import LibvirtDBus, { attachIface } from '../../../libvirt-dbus.js';

import './nic.css';

const _ = cockpit.gettext;

const NetworkMacRow = ({ idPrefix, dialogValues, onValueChanged }) => {
    return (
        <FormGroup fieldId={`${idPrefix}-generate-mac`} label={_("MAC address")} hasNoPaddingTop isInline>
            <Radio id={`${idPrefix}-generate-mac`}
                   name="mac-setting"
                   isChecked={!dialogValues.setNetworkMac}
                   label={_("Generate automatically")}
                   onChange={() => onValueChanged('setNetworkMac', false)} />
            <Radio id={`${idPrefix}-set-mac`}
                   name="mac-setting"
                   isChecked={dialogValues.setNetworkMac}
                   label={_("Set manually")}
                   onChange={() => onValueChanged('setNetworkMac', true)} />
            <TextInput id={`${idPrefix}-mac`}
                       className="nic-add-mac-setting-manual"
                       isDisabled={!dialogValues.setNetworkMac}
                       value={dialogValues.networkMac}
                       onChange={value => onValueChanged('networkMac', value)} />
        </FormGroup>
    );
};

const PermanentChange = ({ idPrefix, onValueChanged, dialogValues, vm }) => {
    // By default for a running VM, the iface is attached until shut down only. Enable permanent change of the domain.xml
    return (
        <FormGroup label={_("Persistence")} fieldId={`${idPrefix}-permanent`} hasNoPaddingTop>
            <Checkbox id={`${idPrefix}-permanent`}
                      isChecked={dialogValues.permanent}
                      label={_("Always attach")}
                      onChange={checked => onValueChanged('permanent', checked)} />
        </FormGroup>
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
        const { idPrefix, vm } = this.props;

        const defaultBody = (
            <Form isHorizontal>
                <NetworkTypeAndSourceRow idPrefix={idPrefix}
                                         dialogValues={this.state}
                                         onValueChanged={this.onValueChanged}
                                         connectionName={vm.connectionName} />

                <NetworkModelRow idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 osTypeArch={vm.arch}
                                 osTypeMachine={vm.emulatedMachine} />

                <NetworkMacRow idPrefix={idPrefix}
                               dialogValues={this.state}
                               onValueChanged={this.onValueChanged} />

                {LibvirtDBus.isRunning(vm.state) && vm.persistent &&
                <PermanentChange idPrefix={idPrefix}
                                 dialogValues={this.state}
                                 onValueChanged={this.onValueChanged}
                                 vm={vm} />}
            </Form>
        );

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-dialog`} isOpen onClose={this.props.close} className='nic-add'
                title={_("Add virtual network interface")}
                footer={
                    <>
                        {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                        <Button isDisabled={["network", "direct", "bridge"].includes(this.state.networkType) && this.state.networkSource === undefined}
                                id={`${idPrefix}-add`}
                                variant='primary'
                                onClick={this.add}>
                            {_("Add")}
                        </Button>
                        <Button id={`${idPrefix}-cancel`} variant='link' className='btn-cancel' onClick={this.props.close}>
                            {_("Cancel")}
                        </Button>
                    </>
                }>
                {defaultBody}
            </Modal>
        );
    }
}

AddNIC.propTypes = {
    dispatch: PropTypes.func.isRequired,
    idPrefix: PropTypes.string.isRequired,
    vm: PropTypes.object.isRequired,
};

export default AddNIC;
