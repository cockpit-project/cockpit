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
import { Button, Modal } from 'patternfly-react';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { networkDeactivate, networkUndefine } from '../../libvirt-dbus.js';
import { networkId } from '../../helpers.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class NetworkDelete extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
            dialogError: undefined,
        };

        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.delete = this.delete.bind(this);
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

    delete() {
        const network = this.props.network;
        const networkDeactivateAndUndefine = (network) => {
            if (network.active) {
                return networkDeactivate(network.connectionName, network.id)
                        .then(() => networkUndefine(network.connectionName, network.id));
            } else {
                return networkUndefine(network.connectionName, network.id);
            }
        };

        networkDeactivateAndUndefine(network)
                .catch(exc => this.dialogErrorSet(_("The network could not be deleted"), exc.message));
    }

    render() {
        const { network } = this.props;
        const id = networkId(network.name, network.connectionName);

        return (
            <React.Fragment>
                <Button id={`delete-${id}`} bsStyle='danger' onClick={this.open}>
                    {_("Delete")}
                </Button>

                <Modal show={this.state.showModal} onHide={this.close}>
                    <Modal.Header>
                        <Modal.CloseButton onClick={this.close} />
                        <Modal.Title>{ cockpit.format(_("Delete Network $0"), network.name) }</Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        {_("Confirm deletion of the Virtual Network")}
                    </Modal.Body>
                    <Modal.Footer>
                        {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                        <Button bsStyle='default' className='btn-cancel' onClick={this.close}>
                            {_("Cancel")}
                        </Button>
                        <Button bsStyle='danger' onClick={this.delete}>
                            {_("Delete")}
                        </Button>
                    </Modal.Footer>
                </Modal>
            </React.Fragment>
        );
    }
}
NetworkDelete.propTypes = {
    network: PropTypes.object.isRequired,
};
