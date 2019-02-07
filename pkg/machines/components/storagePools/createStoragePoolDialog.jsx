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
import PropTypes from 'prop-types';
import { Button, FormGroup, HelpBlock, Modal } from 'patternfly-react';

import { LIBVIRT_SYSTEM_CONNECTION } from '../../helpers.js';
import { MachinesConnectionSelector } from '../machinesConnectionSelector.jsx';
import { ModalError } from '../notification/inlineNotification.jsx';
import { FileAutoComplete } from 'cockpit-components-file-autocomplete.jsx';
import * as Select from 'cockpit-components-select.jsx';
import { createStoragePool } from '../../actions/provider-actions.js';
import cockpit from 'cockpit';

import './createStoragePoolDialog.css';

const _ = cockpit.gettext;

const StoragePoolConnectionRow = ({ onValueChanged, dialogValues, loggedUser }) => {
    return (
        <React.Fragment>
            <label className='control-label'>
                {_("Connection")}
            </label>
            <MachinesConnectionSelector id='storage-pool-dialog-connection'
                dialogValues={dialogValues}
                onValueChanged={onValueChanged}
                loggedUser={loggedUser} />
        </React.Fragment>
    );
};

const StoragePoolNameRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.name.length == 0 && dialogValues.validationFailed.name ? 'error' : undefined;

    return (
        <React.Fragment>
            <label className='control-label'>
                {_("Name")}
            </label>
            <FormGroup validationState={validationState} controlId='name'>
                <input id='storage-pool-dialog-name'
                       type='text'
                       placeholder={_("Storage Pool Name")}
                       value={dialogValues.name || ''}
                       onChange={e => onValueChanged('name', e.target.value)}
                       className='form-control' />
                { validationState == 'error' &&
                <HelpBlock>
                    <p className="text-danger">{_("Name should not be empty")}</p>
                </HelpBlock> }
            </FormGroup>
        </React.Fragment>
    );
};

const StoragePoolTypeRow = ({ onValueChanged, dialogValues }) => {
    const poolTypes = [
        { type: 'dir', detail: _("Filesystem Directory") },
        { type: 'netfs', detail:_("Network File System") },
    ];

    /* TODO
        { type: 'disk', detail _("Physical Disk Device") },
        { type: 'fs', detail _("Pre-formated Block Device") },
        { type: 'gluster', detail _("Gluster Filesystem") },
        { type: 'iscsi', detail _("iSCSI Target") },
        { type: 'logical', detail _("LVM Volume Group") },
        { type: 'mpath', detail _("Multipath Device Enumerator") },
        { type: 'rbd', detail _("RADOS Block Device/Ceph") },
        { type: 'scsi', detail _("SCSI Host Adapter") },
        { type: 'sheepdog', detail _("Sheepdog Filesystem") },
        { type: 'zfs', detail _("ZFS Pool") },
     */

    return (
        <React.Fragment>
            <label className='control-label'>
                {_("Type")}
            </label>
            <Select.Select id='storage-pool-dialog-type'
                           initial={dialogValues.type}
                           onChange={value => onValueChanged('type', value)}>
                { poolTypes
                        .map(pool => {
                            return (
                                <Select.SelectEntry data={pool.type} key={pool.type}>
                                    {pool.detail}
                                </Select.SelectEntry>
                            );
                        })
                }
            </Select.Select>
        </React.Fragment>
    );
};

const StoragePoolTargetRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.target.length == 0 && dialogValues.validationFailed.target ? 'error' : undefined;

    if (['dir', 'netfs'].includes(dialogValues.type)) {
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Target Path")}
                </label>
                <FormGroup validationState={validationState} controlId='target'>
                    <FileAutoComplete id='storage-pool-dialog-target'
                        placeholder={_("Path on host's filesystem")}
                        onChange={value => onValueChanged('target', value)} />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Target path should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
            </React.Fragment>
        );
    }
};

const StoragePoolHostRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.source.host.length == 0 && dialogValues.validationFailed.host ? 'error' : undefined;

    if (['netfs'].includes(dialogValues.type))
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Host")}
                </label>
                <FormGroup validationState={validationState} controlId='host'>
                    <input id='storage-pool-dialog-host'
                           type='text'
                           placeholder={_("Host Name")}
                           value={dialogValues.source.host || ''}
                           onChange={e => onValueChanged('source', { 'host': e.target.value })}
                           className='form-control' />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Host should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <hr />
            </React.Fragment>
        );
    return null;
};

const StoragePoolSourceRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.source.dir.length == 0 && dialogValues.validationFailed.source ? 'error' : undefined;

    if (['netfs'].includes(dialogValues.type))
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Source Path")}
                </label>
                <FormGroup validationState={validationState} controlId='source'>
                    <input id='storage-pool-dialog-source'
                           type='text'
                           minLength={1}
                           placeholder={_("The directory on the server being exported")}
                           value={dialogValues.source.dir || ''}
                           onChange={e => onValueChanged('source', { 'dir': e.target.value })}
                           className='form-control' />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Source path should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <hr />
            </React.Fragment>
        );
    return null;
};

const StoragePoolAutostartRow = ({ onValueChanged, dialogValues }) => {
    return (
        <React.Fragment>
            <label className='control-label'>
                {_("Startup")}
            </label>
            <label className='checkbox-inline'>
                <input id='storage-pool-dialog-autostart'
                    type='checkbox'
                    checked={dialogValues.autostart}
                    onChange={e => onValueChanged('autostart', e.target.checked)} />
                {_("Start pool when host boots")}
            </label>
        </React.Fragment>
    );
};

class CreateStoragePoolModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            dialogError: undefined,
            name: '',
            connectionName: LIBVIRT_SYSTEM_CONNECTION,
            type: 'dir',
            source: { 'host': '', 'dir': '' },
            target: '',
            autostart: true,
            validationFailed: {},
        };
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.dialogErrorDismiss = this.dialogErrorDismiss.bind(this);
        this.onCreateClicked = this.onCreateClicked.bind(this);
    }

    onValueChanged(key, value) {
        if (key == 'source') {
            let property = Object.keys(value)[0];
            let propertyValue = value[Object.keys(value)[0]];
            this.setState({
                source: Object.assign({}, this.state.source, { [property]: propertyValue })
            });
        } else
            this.setState({ [key]: value });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    dialogErrorDismiss() {
        this.setState({ dialogError: undefined });
    }

    onCreateClicked() {
        const { dispatch } = this.props;
        let modalIsIncomplete = false;
        let validationFailed = Object.assign({}, this.state.validationFailed);

        // Mandatory props for all pool types
        ['name', 'target'].forEach(prop => {
            if (this.state[prop].length == 0) {
                modalIsIncomplete = true;
                validationFailed[prop] = true;
            }
        });

        // Mandatory props for netfs pool type
        if (this.state.type == 'netfs') {
            if (this.state.source.dir.length == 0) {
                modalIsIncomplete = true;
                validationFailed.source = true;
            }
            if (this.state.source.host.length == 0) {
                modalIsIncomplete = true;
                validationFailed.host = true;
            }
        }

        this.setState({ validationFailed });

        if (!modalIsIncomplete)
            dispatch(createStoragePool(this.state))
                    .fail(exc => {
                        this.dialogErrorSet(_("Storage Pool failed to be created"), exc.message);
                    })
                    .then(() => {
                        this.props.close();
                    });
    }

    render() {
        const defaultBody = (
            <form className="ct-form-layout">
                <StoragePoolConnectionRow dialogValues={this.state}
                                          onValueChanged={this.onValueChanged}
                                          loggedUser={this.props.loggedUser} />
                <hr />
                <StoragePoolNameRow dialogValues={this.state}
                                    onValueChanged={this.onValueChanged} />
                <hr />
                <StoragePoolTypeRow dialogValues={this.state}
                                    onValueChanged={this.onValueChanged} />
                <hr />
                <StoragePoolTargetRow dialogValues={this.state}
                                      onValueChanged={this.onValueChanged} />
                <hr />
                <StoragePoolHostRow dialogValues={this.state}
                                    onValueChanged={this.onValueChanged} />
                <StoragePoolSourceRow dialogValues={this.state}
                                      onValueChanged={this.onValueChanged} />
                <StoragePoolAutostartRow dialogValues={this.state}
                                         onValueChanged={this.onValueChanged} />
            </form>
        );

        return (
            <Modal id='create-storage-pool-dialog' className='pool-create' show onHide={ this.props.close }>
                <Modal.Header>
                    <Modal.CloseButton onClick={ this.props.close } />
                    <Modal.Title> {`Create Storage Pool`} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <Button bsStyle='default' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' onClick={this.onCreateClicked}>
                        {_("Create")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}
CreateStoragePoolModal.propTypes = {
    close: PropTypes.func.isRequired,
    dispatch: PropTypes.func.isRequired,
    loggedUser: PropTypes.object.isRequired,
};

export class CreateStoragePoolAction extends React.Component {
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
            <div>
                <Button className='pull-right' id='create-storage-pool' bsStyle='default' onClick={this.open} >
                    {_("Create Storage Pool")}
                </Button>
                { this.state.showModal &&
                <CreateStoragePoolModal
                    close={this.close}
                    dispatch={this.props.dispatch}
                    loggedUser={this.props.loggedUser} /> }
            </div>
        );
    }
}
CreateStoragePoolAction.propTypes = {
    dispatch: PropTypes.func.isRequired,
    loggedUser: PropTypes.object.isRequired,
};
