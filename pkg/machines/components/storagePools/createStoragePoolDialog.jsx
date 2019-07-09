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
import { ModalError } from 'cockpit-components-inline-notification.jsx';
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

const StoragePoolTypeRow = ({ onValueChanged, dialogValues, libvirtVersion }) => {
    let poolTypes = [
        { type: 'dir', detail: _("Filesystem Directory") },
        { type: 'netfs', detail:_("Network File System") },
        { type: 'iscsi', detail: _("iSCSI Target") },
        { type: 'disk', detail: _("Physical Disk Device") },
    ];
    // iscsi-direct exists since 4.7.0
    if (libvirtVersion && libvirtVersion >= 4007000)
        poolTypes.push({ type: 'iscsi-direct', detail: _("iSCSI direct Target") });

    /* TODO
        { type: 'fs', detail _("Pre-formated Block Device") },
        { type: 'gluster', detail _("Gluster Filesystem") },
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

    if (['dir', 'netfs', 'iscsi', 'disk'].includes(dialogValues.type)) {
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Target Path")}
                </label>
                <FormGroup validationState={validationState} controlId='target'>
                    <FileAutoComplete id='storage-pool-dialog-target'
                        superuser='try'
                        placeholder={_("Path on host's filesystem")}
                        onChange={value => onValueChanged('target', value)} />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Target path should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <hr />
            </React.Fragment>
        );
    }
    return null;
};

const StoragePoolHostRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.source.host.length == 0 && dialogValues.validationFailed.host ? 'error' : undefined;

    if (['netfs', 'iscsi', 'iscsi-direct'].includes(dialogValues.type))
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

const StoragePoolInitiatorRow = ({ onValueChanged, dialogValues }) => {
    const validationState = dialogValues.source.initiator.length == 0 && dialogValues.validationFailed.source ? 'error' : undefined;

    if (['iscsi-direct'].includes(dialogValues.type))
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Initiator")}
                </label>
                <FormGroup validationState={validationState} controlId='initiator'>
                    <input id='storage-pool-dialog-initiator'
                           type='text'
                           placeholder={_("iSCSI Initiator IQN")}
                           value={dialogValues.source.initiator || ''}
                           onChange={e => onValueChanged('source', { 'initiator': e.target.value })}
                           className='form-control' />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Initiator IQN should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <hr />
            </React.Fragment>
        );
    return null;
};

const StoragePoolSourceRow = ({ onValueChanged, dialogValues }) => {
    let validationState;
    let placeholder;
    const diskPoolSourceFormatTypes = ['dos', 'dvh', 'gpt', 'mac'];

    if (dialogValues.type == 'netfs') {
        validationState = dialogValues.source.dir.length == 0 && dialogValues.validationFailed.source ? 'error' : undefined;
        placeholder = _("The directory on the server being exported");
    } else if (dialogValues.type == 'iscsi' || dialogValues.type == 'iscsi-direct') {
        validationState = dialogValues.source.device.length == 0 && dialogValues.validationFailed.source ? 'error' : undefined;
        placeholder = _("iSCSI target IQN");
    } else if (dialogValues.type == 'disk') {
        validationState = dialogValues.source.device.length == 0 && dialogValues.validationFailed.source ? 'error' : undefined;
        placeholder = _("Physical disk device on host");
    }

    if (['netfs', 'iscsi', 'iscsi-direct'].includes(dialogValues.type))
        return (
            <React.Fragment>
                <label className='control-label'>
                    {_("Source Path")}
                </label>
                <FormGroup validationState={validationState} controlId='source'>
                    <input id='storage-pool-dialog-source'
                           type='text'
                           minLength={1}
                           value={dialogValues.source.dir || dialogValues.source.device || ''}
                           onChange={e => {
                               if (dialogValues.type == 'netfs')
                                   return onValueChanged('source', { 'dir': e.target.value });
                               else
                                   return onValueChanged('source', { 'device': e.target.value });
                           }}
                           placeholder={placeholder}
                           className='form-control' />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Source path should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <hr />
            </React.Fragment>
        );
    else if (dialogValues.type == 'disk')
        return (
            <React.Fragment>
                <label className='control-label' htmlFor='storage-pool-dialog-source'>
                    {_("Source Path")}
                </label>
                <FormGroup className='ct-form-split'
                           validationState={validationState}
                           controlId='source'>
                    <FileAutoComplete id='storage-pool-dialog-source'
                        superuser='try'
                        placeholder={placeholder}
                        onChange={value => onValueChanged('source', { 'device': value })} />
                    { validationState == 'error' &&
                    <HelpBlock>
                        <p className="text-danger">{_("Source path should not be empty")}</p>
                    </HelpBlock> }
                </FormGroup>
                <label className='control-label' htmlFor='storage-pool-dialog-source-format'>
                    {_("Format")}
                </label>
                <Select.Select id='storage-pool-dialog-source-format'
                               extraClass='form-control ct-form-split'
                               initial={dialogValues.source.format}
                               onChange={value => onValueChanged('source', { 'format': value })}>
                    { diskPoolSourceFormatTypes
                            .map(format => {
                                return (
                                    <Select.SelectEntry data={format} key={format}>
                                        {format}
                                    </Select.SelectEntry>
                                );
                            })
                    }
                </Select.Select>
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
            createInProgress: false,
            dialogError: undefined,
            name: '',
            connectionName: LIBVIRT_SYSTEM_CONNECTION,
            type: 'dir',
            source: { 'host': '', 'dir': '', 'device': '', 'initiator': '', 'format': undefined },
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
        } else if (key == 'type') {
            if (value == 'disk') {
                // When switching to disk type select the default format which is 'dos'
                this.setState({
                    source: Object.assign({}, this.state.source, { 'format': 'dos' })
                });
            } else {
                this.setState({
                    source: Object.assign({}, this.state.source, { 'format': undefined })
                });
            }
            this.setState({ [key]: value });
        } else {
            this.setState({ [key]: value });
        }
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
        ['name'].forEach(prop => {
            if (this.state[prop].length == 0) {
                modalIsIncomplete = true;
                validationFailed[prop] = true;
            }
        });

        // Mandatory props for dir pool type
        if (this.state.type == 'dir') {
            if (this.state.target.length == 0) {
                modalIsIncomplete = true;
                validationFailed.target = true;
            }
        }

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
            if (this.state.target.length == 0) {
                modalIsIncomplete = true;
                validationFailed.target = true;
            }
        }

        // Mandatory props for iscsi pool type
        if (this.state.type == 'iscsi') {
            if (this.state.source.device.length == 0) {
                modalIsIncomplete = true;
                validationFailed.source = true;
            }
            if (this.state.source.host.length == 0) {
                modalIsIncomplete = true;
                validationFailed.host = true;
            }
            if (this.state.target.length == 0) {
                modalIsIncomplete = true;
                validationFailed.target = true;
            }
        }

        // Mandatory props for iscsi-direct pool type
        if (this.state.type == 'iscsi-direct') {
            if (this.state.source.device.length == 0) {
                modalIsIncomplete = true;
                validationFailed.source = true;
            }
            if (this.state.source.host.length == 0) {
                modalIsIncomplete = true;
                validationFailed.host = true;
            }
            if (this.state.source.initiator.length == 0) {
                modalIsIncomplete = true;
                validationFailed.source = true;
            }
        }

        // Mandatory props for disk pool type
        if (this.state.type == 'disk') {
            if (this.state.source.device.length == 0) {
                modalIsIncomplete = true;
                validationFailed.source = true;
            }
            if (this.state.target.length == 0) {
                modalIsIncomplete = true;
                validationFailed.target = true;
            }
        }

        this.setState({ validationFailed });

        if (!modalIsIncomplete) {
            this.setState({ createInProgress: true });
            dispatch(createStoragePool(this.state))
                    .fail(exc => {
                        this.setState({ createInProgress: false });
                        this.dialogErrorSet(_("Storage Pool failed to be created"), exc.message);
                    })
                    .then(() => {
                        this.props.close();
                    });
        }
    }

    render() {
        const defaultBody = (
            <form className="ct-form ct-form-maxmin">
                <StoragePoolConnectionRow dialogValues={this.state}
                                          onValueChanged={this.onValueChanged}
                                          loggedUser={this.props.loggedUser} />
                <hr />
                <StoragePoolNameRow dialogValues={this.state}
                                    onValueChanged={this.onValueChanged} />
                <hr />
                <StoragePoolTypeRow dialogValues={this.state}
                                    libvirtVersion={this.props.libvirtVersion}
                                    onValueChanged={this.onValueChanged} />
                <hr />
                <StoragePoolTargetRow dialogValues={this.state}
                                      onValueChanged={this.onValueChanged} />
                <StoragePoolHostRow dialogValues={this.state}
                                    onValueChanged={this.onValueChanged} />
                <StoragePoolSourceRow dialogValues={this.state}
                                      onValueChanged={this.onValueChanged} />
                <StoragePoolInitiatorRow dialogValues={this.state}
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
                    {this.state.createInProgress && <div className="spinner spinner-sm pull-left" />}
                    <Button bsStyle='default' className='btn-cancel' onClick={ this.props.close }>
                        {_("Cancel")}
                    </Button>
                    <Button bsStyle='primary' disabled={this.state.createInProgress} onClick={this.onCreateClicked}>
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
    libvirtVersion: PropTypes.number,
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
            <React.Fragment>
                <Button className='pull-right' id='create-storage-pool' bsStyle='default' onClick={this.open} >
                    {_("Create Storage Pool")}
                </Button>
                { this.state.showModal &&
                <CreateStoragePoolModal
                    close={this.close}
                    dispatch={this.props.dispatch}
                    libvirtVersion={this.props.libvirtVersion}
                    loggedUser={this.props.loggedUser} /> }
            </React.Fragment>
        );
    }
}
CreateStoragePoolAction.propTypes = {
    dispatch: PropTypes.func.isRequired,
    libvirtVersion: PropTypes.number,
    loggedUser: PropTypes.object.isRequired,
};
