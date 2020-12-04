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
import {
    Alert, Button, Form, FormGroup, Modal, Popover, Radio,
} from '@patternfly/react-core';
import { InfoAltIcon } from '@patternfly/react-icons';

import * as Select from 'cockpit-components-select.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

import { updateDiskAttributes } from '../libvirt-dbus.js';
import { getDiskPrettyName, getDiskFullName } from '../helpers.js';

import 'form-layout.scss';

const _ = cockpit.gettext;

const NameRow = ({ idPrefix, name, diskType }) => {
    let label = _("ID");
    if (["file", "block", "dir"].includes(diskType))
        label = _("Path");
    else if (diskType === "network")
        label = _("Url");
    else if (diskType === "volume")
        label = _("Storage volume");

    return (
        <FormGroup fieldId={`${idPrefix}-name`} label={label}>
            <samp id={`${idPrefix}-name`}>
                {name}
            </samp>
        </FormGroup>
    );
};

const BusRow = ({ onValueChanged, dialogValues, idPrefix, shutoff }) => {
    const busTypes = ['sata', 'scsi', 'usb', 'virtio'];

    return (
        <FormGroup fieldId={`${idPrefix}-bus-type`} label={_("Bus")}
                   labelIcon={!shutoff &&
                       <Popover bodyContent={_("Machine must be shut off before changing bus type")}>
                           <button onClick={e => e.preventDefault()} className="pf-c-form__group-label-help">
                               <InfoAltIcon noVerticalAlign />
                           </button>
                       </Popover>}>
            <Select.Select id={`${idPrefix}-bus-type`}
                onChange={value => onValueChanged('busType', value)}
                initial={dialogValues.busType}
                extraClass='pf-c-form-control'
                enabled={shutoff}>
                {busTypes.map(busType => {
                    return (
                        <Select.SelectEntry data={busType} key={busType}>
                            {busType}
                        </Select.SelectEntry>
                    );
                })}
            </Select.Select>
        </FormGroup>
    );
};

const AccessRow = ({ onValueChanged, dialogValues, driverType, idPrefix }) => {
    return (
        <FormGroup fieldId={`${idPrefix}-access`} label={_("Access")} isInline>
            <Radio id={`${idPrefix}-readonly`}
                   name="access"
                   value="readonly"
                   isChecked={dialogValues.access == "readonly" }
                   onChange={(_, event) => {
                       onValueChanged("access", event.currentTarget.value);
                   }}
                   label={_("Read-only")} />
            <Radio id={`${idPrefix}-writable`}
                   name="access"
                   value="writable"
                   isChecked={dialogValues.access == "writable" }
                   onChange={(_, event) => {
                       onValueChanged("access", event.currentTarget.value);
                   }}
                   label={_("Writeable")} />
            {(driverType === "raw") &&
            <Radio id={`${idPrefix}-writable-shareable`}
                   name="access"
                   value="shareable"
                   isChecked={dialogValues.access == "shareable" }
                   onChange={(_, event) => {
                       onValueChanged("access", event.currentTarget.value);
                   }}
                   label={_("Writeable and shared")} />}
        </FormGroup>
    );
};

class EditDiskModalBody extends React.Component {
    constructor(props) {
        super(props);
        let access;
        if (props.disk.readonly)
            access = "readonly";
        else if (props.disk.shareable)
            access = "shareable";
        else
            access = "writable";

        this.state = {
            access,
            busType: props.disk.bus,
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
        const existingTargets = Object.getOwnPropertyNames(vm.disks);

        updateDiskAttributes({
            connectionName: vm.connectionName,
            objPath: vm.id, target: disk.target,
            readonly: this.state.access == "readonly",
            shareable: this.state.access == "shareable",
            busType: this.state.busType,
            existingTargets
        })
                .then(() => this.props.close())
                .fail((exc) => {
                    this.dialogErrorSet(_("Disk settings could not be saved"), exc.message);
                });
    }

    render() {
        const { vm, disk } = this.props;
        const idPrefix = `${this.props.idPrefix}-edit`;

        const defaultBody = (
            <Form isHorizontal>
                <NameRow idPrefix={idPrefix}
                         diskType={vm.disks[disk.target].type}
                         name={getDiskFullName(vm.disks[disk.target])} />

                <AccessRow dialogValues={this.state}
                           idPrefix={idPrefix}
                           driverType={vm.disks[disk.target].driver.type}
                           onValueChanged={this.onValueChanged} />

                <BusRow dialogValues={this.state}
                        idPrefix={idPrefix}
                        onValueChanged={this.onValueChanged}
                        shutoff={vm.state == 'shut off'} />
            </Form>
        );

        const showWarning = () => {
            if (vm.state === 'running' && (
                this.state.readonly !== disk.readonly ||
                this.state.shareable !== disk.shareable)) {
                return <Alert isInline variant='warning' id={`${idPrefix}-idle-message`} title={_("Changes will take effect after shutting down the VM")} />;
            }
        };

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-dialog`} isOpen onClose={this.props.close}
                   title={cockpit.format(_("Edit $0 attributes"), getDiskPrettyName(vm.disks[disk.target]))}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button id={`${idPrefix}-dialog-save`} variant='primary' onClick={this.onSaveClicked}>
                               {_("Save")}
                           </Button>
                           <Button id={`${idPrefix}-dialog-cancel`} variant='link' className='btn-cancel' onClick={this.props.close}>
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
        const { disk, vm } = this.props;
        const idPrefix = `${this.props.idPrefix}`;
        const showModal = EditDiskActionShowModal[this.props.idPrefix];

        return (
            <>
                <Button id={`${idPrefix}-edit`} variant='secondary' onClick={this.open}>
                    {_("Edit")}
                </Button>
                { showModal && <EditDiskModalBody close={this.close} disk={disk} idPrefix={idPrefix} vm={vm} /> }
            </>
        );
    }
}
