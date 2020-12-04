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

import cockpit from 'cockpit';
import React, { useState } from 'react';
import { Button, Form, FormGroup, Modal, TextInput } from '@patternfly/react-core';

import { isEmpty, isObjectEmpty } from '../helpers.js';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

import "./vmCloneDialog.scss";
const _ = cockpit.gettext;

export const CloneDialog = ({ name, connectionName, toggleModal }) => {
    const [newVmName, setNewVmName] = useState(name + '-clone');
    const [inProgress, setInProgress] = useState(false);
    const [virtCloneOutput, setVirtCloneOutput] = useState('');
    const [error, dialogErrorSet] = useState({});

    function validateParams() {
        const validation = {};
        if (isEmpty(newVmName.trim()))
            validation.name = _("Name must not be empty");

        return validation;
    }

    function onClone() {
        const validation = validateParams();
        if (!isObjectEmpty(validation)) {
            setInProgress(false);
            return;
        }

        setInProgress(true);
        return cockpit.spawn(["virt-clone", "--connect", "qemu:///" + connectionName, "--original", name, "--name", newVmName, "--auto-clone"], { superuser: "try", pty: true })
                .stream(setVirtCloneOutput)
                .then(toggleModal, exc => {
                    setInProgress(false);
                    dialogErrorSet({ dialogError: cockpit.format(_("Failed to clone VM $0"), name) });
                });
    }

    const validationFailed = validateParams();
    return (
        <Modal position="top" variant="small" isOpen onClose={toggleModal}
           title={cockpit.format(_("Create a clone VM based on $0"), name)}
           footer={
               <>
                   {!isObjectEmpty(error) && <ModalError dialogError={error.dialogError} dialogErrorDetail={virtCloneOutput} />}
                   {isObjectEmpty(error) && virtCloneOutput && <code className="vm-clone-virt-clone-output">{virtCloneOutput}</code>}
                   <Button variant='primary'
                           isDisabled={!isObjectEmpty(validationFailed)}
                           isLoading={inProgress}
                           onClick={onClone}>
                       {_("Clone")}
                   </Button>
                   <Button variant='link' onClick={toggleModal}>
                       {_("Cancel")}
                   </Button>
               </>
           }>
            <Form isHorizontal>
                <FormGroup label={_("Name")} fieldId="vm-name"
                           id="vm-name-group"
                           helperTextInvalid={validationFailed.name}
                           validated={validationFailed.name ? "error" : "default"}>
                    <TextInput id='vm-name'
                               validated={validationFailed.name ? "error" : "default"}
                               value={newVmName}
                               onChange={setNewVmName} />
                </FormGroup>
            </Form>
        </Modal>
    );
};
