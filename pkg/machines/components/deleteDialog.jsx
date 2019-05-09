/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import cockpit from 'cockpit';
import React from 'react';
import { Modal, Button } from 'patternfly-react';

import { vmId } from '../helpers.js';
import { deleteVm } from '../actions/provider-actions.js';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

import './deleteDialog.css';

const _ = cockpit.gettext;

const DeleteDialogBody = ({ disks, destroy, onChange }) => {
    function disk_row(disk, index) {
        return (
            <li className='list-group-item' key={disk.target}>
                <div className='checkbox disk-row'>
                    <label>
                        <input type="checkbox" checked={disk.checked}
                            onChange={(event) => {
                                onChange(index, event.target.checked);
                            }} />
                        <strong>{disk.target}</strong>
                        {disk.type == 'file' &&
                        <div className='disk-source'>
                            <span> {_("Path")} </span>
                            <strong id='disk-source-file'> {disk.source.file} </strong>
                        </div>}
                        {disk.type == 'volume' &&
                        <div className='disk-source'>
                            <span htmlFor='disk-source-volume'> {_("Volume")} </span>
                            <strong id='disk-source-volume'> {disk.source.volume} </strong>

                            <span htmlFor='disk-source-pool'> {_("Pool")} </span>
                            <strong id='disk-source-pool'> {disk.source.pool} </strong>
                        </div>}
                    </label>
                </div>
            </li>
        );
    }

    let alert = null;
    if (destroy)
        alert = <p>{_("The VM is running and will be forced off before deletion.")}</p>;

    let disksBody = null;
    if (disks.length > 0)
        disksBody = (
            <React.Fragment>
                <p>{_("Delete associated storage files:")}</p>
                <form>
                    <ul className="list-group dialog-list-ct">
                        { disks.map(disk_row) }
                    </ul>
                </form>
            </React.Fragment>
        );

    return (
        <div className="modal-body">
            {alert}
            {disksBody}
        </div>
    );
};

export class DeleteDialog extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            showModal: false,
            destroy: false,
            disks: []
        };
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
        this.delete = this.delete.bind(this);
        this.onDiskCheckedChanged = this.onDiskCheckedChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onDiskCheckedChanged(index, value) {
        const disks = this.state.disks;

        disks[index].checked = value;
        this.setState(disks);
    }

    close() {
        this.setState({ showModal: false, dialogError: undefined });
    }

    open() {
        const { vm } = this.props;
        let disks = [];

        Object.keys(vm.disks).sort()
                .forEach(t => {
                    let d = vm.disks[t];

                    if ((d.type == 'file' && d.source.file) || d.type == 'volume')
                        disks.push(Object.assign(d, { checked: !d.readonly }));
                });
        this.setState({ showModal: true, disks: disks, destroy: vm.state != 'shut off' });
    }

    delete() {
        const storage = this.state.disks.filter(d => d.checked);

        return this.props.dispatch(deleteVm(this.props.vm, { destroy: this.state.destroy, storage: storage }))
                .catch(exc => {
                    this.dialogErrorSet(cockpit.format(_("VM $0 failed to get deleted"), this.props.vm.name), exc.message);
                });
    }

    render() {
        const id = vmId(this.props.vm.name);
        return (
            <span>
                <Button id={`${id}-delete`} bsStyle='danger' onClick={this.open}>
                    {_("Delete")}
                </Button>

                <Modal id={`${id}-delete-modal-dialog`} show={this.state.showModal} onHide={this.close}>
                    <Modal.Header>
                        <Modal.Title> {`Confirm deletion of ${this.props.vm.name}`} </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <DeleteDialogBody disks={this.state.disks} destroy={this.state.destroy} onChange={this.onDiskCheckedChanged} />
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
            </span>
        );
    }
}
