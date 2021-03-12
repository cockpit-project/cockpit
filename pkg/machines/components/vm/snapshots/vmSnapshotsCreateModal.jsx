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

import {
    Button,
    Form, FormGroup,
    Modal,
    TextArea,
    TextInput
} from "@patternfly/react-core";

import { ModalError } from "cockpit-components-inline-notification.jsx";
import { createSnapshot } from "../../../libvirt-dbus.js";
import { getVmSnapshots } from '../../../actions/provider-actions.js';

const _ = cockpit.gettext;

const NameRow = ({ onValueChanged, dialogValues, onValidate }) => {
    return (
        <FormGroup validated={dialogValues.validationError.name ? "error" : "default"}
            label={_("Name")}
            fieldId="name"
            helperText={dialogValues.validationError.name}>
            <TextInput value={dialogValues.name}
                validated={dialogValues.validationError.name ? "error" : "default"}
                id="name"
                type="text"
                onChange={(value) => onValueChanged("name", value)} />
        </FormGroup>
    );
};

const DescriptionRow = ({ onValueChanged, dialogValues }) => {
    return (
        <FormGroup fieldId="description" label={_("Description")}>
            <TextArea value={dialogValues.description}
                id="description"
                onChange={(value) => onValueChanged("description", value)}
                resizeOrientation="vertical"
            />
        </FormGroup>
    );
};

export class CreateSnapshotModal extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            name: props.vm.name + '_' + moment().format("YYYY-MM-DD_hh:mma"),
            description: "",
            validationError: {},
            inProgress: false,
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
            this.setState({ inProgress: true });
            createSnapshot({ connectionName: vm.connectionName, vmId: vm.id, name, description })
                    .then(() => {
                        // VM Snapshots do not trigger any events so we have to refresh them manually
                        dispatch(getVmSnapshots({ connectionName: vm.connectionName, domainPath: vm.id }));
                        onClose();
                    })
                    .catch(exc => {
                        this.setState({ inProgress: false });
                        this.dialogErrorSet(_("Snapshot failed to be created"), exc.message);
                    });
        }
    }

    render() {
        const { idPrefix, onClose } = this.props;

        const body = (
            <Form isHorizontal>
                <NameRow dialogValues={this.state} onValueChanged={this.onValueChanged} />
                <DescriptionRow dialogValues={this.state} onValueChanged={this.onValueChanged} />
            </Form>
        );

        return (
            <Modal position="top" variant="medium" id={`${idPrefix}-modal`} isOpen onClose={onClose}
                   title={_("Create snapshot")}
                   footer={
                       <>
                           {this.state.dialogError && <ModalError dialogError={this.state.dialogError} dialogErrorDetail={this.state.dialogErrorDetail} />}
                           <Button variant="primary" isLoading={this.state.inProgress} isDisabled={this.state.inProgress} onClick={this.onCreate}>
                               {_("Create")}
                           </Button>
                           <Button variant="link" className="btn-cancel" onClick={onClose}>
                               {_("Cancel")}
                           </Button>
                       </>
                   }>
                {body}
            </Modal>
        );
    }
}
