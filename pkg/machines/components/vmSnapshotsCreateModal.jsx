/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import cockpit from "cockpit";
import React from "react";
import moment from "moment";

import { Modal } from "patternfly-react";
import {
    Button,
    FormGroup,
    TextArea,
    TextInput
} from "@patternfly/react-core";

import { ModalError } from "cockpit-components-inline-notification.jsx";
import { createSnapshot } from "../libvirt-dbus.js";
import { getVmSnapshots } from '../actions/provider-actions.js';

const _ = cockpit.gettext;

const NameRow = ({ onValueChanged, dialogValues, onValidate }) => {
    return (
        <>
            <label className="control-label" htmlFor="name">
                {_("Name")}
            </label>
            <FormGroup validated={dialogValues.validationError.name ? "error" : "default"}
                fieldId="name"
                helperText={dialogValues.validationError.name}>
                <TextInput value={dialogValues.name}
                    id="name"
                    type="text"
                    onChange={(value) => onValueChanged("name", value)}
                    aria-label={_("Name input text")}
                />
            </FormGroup>
        </>
    );
};

const DescriptionRow = ({ onValueChanged, dialogValues }) => {
    return (
        <>
            <label className="control-label" htmlFor="description">
                {_("Description")}
            </label>
            <TextArea value={dialogValues.description}
                id="description"
                onChange={(value) => onValueChanged("description", value)}
                resizeOrientation="vertical"
                aria-label={_("Description input text")}
            />
        </>
    );
};

export class CreateSnapshotModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            name: props.vm.name + '_' + moment().format("YYYY-MM-DD_hh:mma"),
            description: "",
            validationError: {},
        };

        this.onValueChanged = this.onValueChanged.bind(this);
        this.dialogErrorSet = this.dialogErrorSet.bind(this);
        this.onValidate = this.onValidate.bind(this);
        this.onCreate = this.onCreate.bind(this);
    }

    onValueChanged(key, value) {
        this.setState({ [key]: value });
    }

    dialogErrorSet(text, detail) {
        this.setState({ dialogError: text, dialogErrorDetail: detail });
    }

    onValidate() {
        const { name, validationError } = this.state;
        const { vm } = this.props;

        const newValidationError = { ...validationError };
        if (vm.snapshots.findIndex(snap => snap.name === name) > -1)
            newValidationError.name = "Name already exists";
        else
            newValidationError.name = undefined;

        this.setState(prevState => ({ ...prevState, validationError: newValidationError }));
    }

    onCreate() {
        const { vm, onClose, dispatch } = this.props;
        const { name, description, validationError } = this.state;

        this.onValidate();
        if (!validationError.name) {
            createSnapshot({ connectionName: vm.connectionName, vmId: vm.id, name, description })
                    .then(() => {
                        // VM Snapshots do not trigger any events so we have to refresh them manually
                        dispatch(getVmSnapshots({ connectionName: vm.connectionName, domainPath: vm.id }));
                        onClose();
                    })
                    .catch(exc => this.dialogErrorSet(_("Snapshot failed to be created"), exc.message));
        }
    }

    render() {
        const { idPrefix, onClose } = this.props;

        const body = (
            <form className="ct-form">
                <NameRow dialogValues={this.state} onValueChanged={this.onValueChanged} />
                <DescriptionRow dialogValues={this.state} onValueChanged={this.onValueChanged} />
            </form>
        );

        return (
            <Modal id={`${idPrefix}-modal`} onHide={onClose} show>
                <Modal.Header>
                    <Modal.CloseButton onClick={onClose} />
                    <Modal.Title>{_("Create snapshot")} </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    {body}
                </Modal.Body>
                <Modal.Footer>
                    {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                    <Button variant="primary" onClick={this.onCreate}>
                        {_("Create")}
                    </Button>
                    <Button variant="link" className="btn-cancel" onClick={onClose}>
                        {_("Cancel")}
                    </Button>
                </Modal.Footer>
            </Modal>
        );
    }
}
