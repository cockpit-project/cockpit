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
import { Modal } from 'patternfly-react';
import { Button, Tooltip } from '@patternfly/react-core';
import cockpit from 'cockpit';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { units, getDefaultVolumeFormat, convertToUnit } from '../../helpers.js';
import { storageVolumeCreate } from '../../libvirt-dbus.js';
import { VolumeCreateBody } from './storageVolumeCreateBody.jsx';

const _ = cockpit.gettext;

class CreateStorageVolumeModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            createInProgress: false,
            dialogError: undefined,
            volumeName: undefined,
            size: 1,
            unit: units.GiB.name,
            format: getDefaultVolumeFormat(props.storagePool),
        };
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onCreateClicked = this.onCreateClicked.bind(this);
        this.onValueChanged = this.onValueChanged.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onValueChanged(key, value) {
        this.setState({ [key]: value });
    }

    onCreateClicked() {
        const { volumeName, format } = this.state;
        const { name, connectionName } = this.props.storagePool;
        const size = convertToUnit(this.state.size, this.state.unit, 'MiB');

        this.setState({ createInProgress: true });
        storageVolumeCreate(connectionName, name, volumeName, size, format)
                .fail(exc => {
                    this.setState({ createInProgress: false });
                    this.dialogErrorSet(_("Volume failed to be created"), exc.message);
                })
                .then(() => {
                    this.props.close();
                });
    }

    render() {
        const idPrefix = `${this.props.idPrefix}-dialog`;

        return (
            <Modal id={`${idPrefix}-modal`} className='volume-create' show onHide={ this.props.close }>
                <Modal.Header>
                    <Modal.CloseButton onClick={ this.props.close } />
                    <Modal.Title>{_("Create Storage Volume")}</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <div className='ct-form'>
                        <VolumeCreateBody idPrefix={idPrefix}
                                          storagePool={this.props.storagePool}
                                          dialogValues={this.state}
                                          onValueChanged={this.onValueChanged} />
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <Button variant="primary" onClick={this.onCreateClicked} isDisabled={this.state.createInProgress}>
                        {_("Create")}
                    </Button>
                    <Button variant='link' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                    {this.state.createInProgress && <div className="spinner spinner-sm pull-right" />}
                </Modal.Footer>
            </Modal>
        );
    }
}
CreateStorageVolumeModal.propTypes = {
    storagePool: PropTypes.object.isRequired,
    close: PropTypes.func.isRequired,
};

export class StorageVolumeCreate extends React.Component {
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
        const idPrefix = `create-volume`;
        const poolTypesNotSupportingVolumeCreation = ['iscsi', 'iscsi-direct', 'gluster', 'mpath'];

        const createButton = () => {
            if (!poolTypesNotSupportingVolumeCreation.includes(this.props.storagePool.type)) {
                return (
                    <Button id={`${idPrefix}-button`}
                        variant='secondary'
                        className='pull-right'
                        onClick={this.open}>
                        {_("Create Volume")}
                    </Button>
                );
            } else {
                return (
                    <Tooltip id='create-tooltip'
                             content={_("Pool type doesn't support volume creation")}>
                        <span>
                            <Button id={`${idPrefix}-button`}
                                    variant='secondary'
                                    isDisabled>
                                {_("Create Volume")}
                            </Button>
                        </span>
                    </Tooltip>
                );
            }
        };

        return (
            <>
                { createButton() }
                { this.state.showModal &&
                <CreateStorageVolumeModal
                    idPrefix={idPrefix}
                    storagePool={this.props.storagePool}
                    close={this.close} /> }
            </>
        );
    }
}

StorageVolumeCreate.propTypes = {
    storagePool: PropTypes.object.isRequired,
};
