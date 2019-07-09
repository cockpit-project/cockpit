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

import { storagePoolId } from '../../helpers.js';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { storagePoolDeactivate, storagePoolUndefine, storageVolumeDelete } from '../../libvirt-dbus.js';
import cockpit from 'cockpit';

const _ = cockpit.gettext;

export class StoragePoolDelete extends React.Component {
    constructor(props) {
        super(props);

        this.state = {
            showModal: false,
            dialogError: undefined,
            deleteVolumes: false,
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
        const storagePool = this.props.storagePool;
        const volumes = storagePool.volumes || [];
        const storagePoolDeactivateAndUndefine = (storagePool) => {
            if (storagePool.active) {
                return storagePoolDeactivate(storagePool.connectionName, storagePool.id)
                        .then(() => storagePoolUndefine(storagePool.connectionName, storagePool.id));
            } else {
                return storagePoolUndefine(storagePool.connectionName, storagePool.id);
            }
        };

        if (this.state.deleteVolumes && storagePool.volumes.length > 0) {
            Promise.all(volumes.map(volume => storageVolumeDelete(storagePool.connectionName, storagePool.name, volume.name)))
                    .then(() => storagePoolDeactivateAndUndefine(storagePool))
                    .then(() => this.close,
                          exc => this.dialogErrorSet(_("The Storage Pool could not be deleted"), exc.message));
        } else {
            storagePoolDeactivateAndUndefine(storagePool)
                    .then(() => this.close,
                          exc => this.dialogErrorSet(_("The Storage Pool could not be deleted"), exc.message));
        }
    }

    render() {
        const { storagePool } = this.props;
        const id = storagePoolId(storagePool.name, storagePool.connectionName);
        const volumes = storagePool.volumes || [];

        let defaultBody = (
            <div className='ct-form'>
                { storagePool.active && volumes.length > 0 && <React.Fragment>
                    <label className='control-label'>
                        {_("Delete Content")}
                    </label>
                    <label className='checkbox-inline'>
                        <input id='storage-pool-delete-volumes'
                            type='checkbox'
                            checked={this.state.deleteVolumes}
                            onChange={e => this.onValueChanged('deleteVolumes', e.target.checked)} />
                        {_("Delete the Volumes inside this Pool")}
                    </label>
                </React.Fragment>}
                { !storagePool.active && _("Deleting an inactive Storage Pool will only undefine the Pool. Its content will not be deleted.")}
            </div>
        );

        return (
            <React.Fragment>
                <Button id={`delete-${id}`} bsStyle='danger' onClick={this.open}>
                    {_("Delete")}
                </Button>

                <Modal show={this.state.showModal} onHide={this.close}>
                    <Modal.Header>
                        <Modal.CloseButton onClick={this.close} />
                        <Modal.Title> {cockpit.format(_("Delete Storage Pool $0"), storagePool.name)} </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        {defaultBody}
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
StoragePoolDelete.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
