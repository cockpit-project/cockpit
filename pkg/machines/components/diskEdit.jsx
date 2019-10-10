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
import { Button, Modal } from 'patternfly-react';
import cockpit from 'cockpit';

import { ModalError } from 'cockpit-components-inline-notification.jsx';

import { changeDiskAccessPolicy } from '../libvirt-dbus.js';
import { getDiskPrettyName, getDiskFullName } from '../helpers.js';

import 'form-layout.less';

const _ = cockpit.gettext;

const NameRow = ({ idPrefix, name, diskType }) => {
    let label = _("Id");
    if (["file", "block", "dir"].includes(diskType))
        label = _("Path");
    else if (diskType === "network")
        label = _("Url");
    else if (diskType === "volume")
        label = _("Storage Volume");

    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-name`}>
                {label}
            </label>
            <samp id={`${idPrefix}-name`}>
                {name}
            </samp>
        </>
    );
};

const AccessRow = ({ onValueChanged, dialogValues, driverType, idPrefix }) => {
    return (
        <>
            <label className='control-label' htmlFor={`${idPrefix}-access`}>
                {_("Access")}
            </label>
            <label className="radio" onClick={e => e.stopPropagation()}>
                <input id={`${idPrefix}-readonly`}
                       type="radio"
                       name="readonly"
                       checked={dialogValues.readonly}
                       onChange={e => {
                           onValueChanged('readonly', true);
                           onValueChanged('shareable', false);
                       }}
                       className={dialogValues.readonly ? "active" : ''} />
                {_("Read-only")}
            </label>
            <label className="radio" onClick={e => e.stopPropagation()}>
                <input id={`${idPrefix}-writable`}
                       type="radio"
                       name="writable"
                       checked={!dialogValues.readonly && !dialogValues.shareable}
                       onChange={e => {
                           onValueChanged('readonly', false);
                           onValueChanged('shareable', false);
                       }}
                       className={!dialogValues.readonly && !dialogValues.shareable ? "active" : ''} />
                {_("Writeable")}
            </label>
            {(driverType === "raw") &&
            <label className="radio" onClick={e => e.stopPropagation()}>
                <input id={`${idPrefix}-writable-shareable`}
                       type="radio"
                       name="writable-shareable"
                       checked={dialogValues.shareable}
                       onChange={e => {
                           onValueChanged('readonly', false);
                           onValueChanged('shareable', true);
                       }}
                       className={dialogValues.shareable ? "active" : ''} />
                {_("Writeable and shared")}
            </label>}
        </>
    );
};

class EditDiskModalBody extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            readonly: props.disk.readonly,
            shareable: props.disk.shareable,
        };
        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onSaveClicked = this.onSaveClicked.bind(this);
    }

    onValueChanged(key, value) {
        this.setState({ [key]: value });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onSaveClicked() {
        const { disk, vm } = this.props;
        changeDiskAccessPolicy(vm.connectionName, vm.id, disk.target, this.state.readonly, this.state.shareable)
                .then(() => this.props.close())
                .fail((exc) => {
                    this.dialogErrorSet(_("Disk settings could not be saved"), exc.message);
                });
    }

    render() {
        const { vm, disk } = this.props;
        const idPrefix = `${this.props.idPrefix}-edit`;

        const defaultBody = (
            <div className='ct-form'>
                <NameRow idPrefix={idPrefix}
                         diskType={vm.disks[disk.target].type}
                         name={getDiskFullName(vm.disks[disk.target])} />

                <AccessRow dialogValues={this.state}
                           idPrefix={idPrefix}
                           driverType={vm.disks[disk.target].driver.type}
                           onValueChanged={this.onValueChanged} />
            </div>
        );

        const showFooterWarning = () => {
            if (vm.state === 'running' && (
                this.state.readonly !== disk.readonly ||
                this.state.shareable !== disk.shareable)) {
                return (
                    <span id={`${idPrefix}-idle-message`} className='idle-message'>
                        <i className='pficon pficon-pending' />
                        <span>{_("Changes will take effect after shutting down the VM")}</span>
                    </span>
                );
            }
        };

        return (
            <Modal id={`${idPrefix}-dialog`} show onHide={this.props.close}>
                <Modal.Header>
                    <Modal.CloseButton onClick={this.props.close} />
                    <Modal.Title> {'Edit ' + getDiskPrettyName(vm.disks[disk.target]) + ' Attributes'} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {defaultBody}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    { showFooterWarning() }
                    <Button id={`${idPrefix}-dialog-cancel`} bsStyle='default' className='btn-cancel' onClick={this.props.close}>
                        {_("Cancel")}
                    </Button>
                    <Button id={`${idPrefix}-dialog-save`} bsStyle='primary' onClick={this.onSaveClicked}>
                        {_("Save")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}

const EditDiskActionShowModal = { };

export class EditDiskAction extends React.Component {
    constructor(props) {
        super(props);
        this.open = this.open.bind(this);
        this.close = this.close.bind(this);
    }

    close() {
        EditDiskActionShowModal[this.props.idPrefix] = false;
        this.setState({ });
    }

    open() {
        EditDiskActionShowModal[this.props.idPrefix] = true;
        this.setState({ });
    }

    render() {
        const { disk, vm, provider } = this.props;
        const idPrefix = `${this.props.idPrefix}`;
        const showModal = EditDiskActionShowModal[this.props.idPrefix];

        return (
            <>
                <Button id={`${idPrefix}-edit`} bsStyle='default' onClick={this.open} className='pull-right'>
                    {_("Edit")}
                </Button>
                { showModal && <EditDiskModalBody close={this.close} disk={disk} idPrefix={idPrefix} vm={vm} provider={provider} /> }
            </>
        );
    }
}
