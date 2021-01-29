/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import {
    Button,
    Checkbox,
    Form,
    FormGroup,
    Modal,
    Radio,
    TextInput,
    Tooltip
} from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from "@patternfly/react-icons";

import { migrateToUri } from '../../libvirt-dbus.js';
import { isEmpty, isObjectEmpty } from '../../helpers.js';
import { ModalError } from 'cockpit-components-inline-notification.jsx';

const _ = cockpit.gettext;

const DestUriRow = ({ validationFailed, destUri, setDestUri }) => {
    return (
        <FormGroup label={_("Destination URI")} fieldId="dest-uri"
                   id="dest-uri"
                   validated={validationFailed.destUri ? "error" : "default"}>
            <TextInput id='dest-uri-input'
                       validated={validationFailed.destUri ? "error" : "default"}
                       value={destUri}
                       placeholder={cockpit.format(_("Example, $0"), "qemu+ssh://192.0.2.16/system")}
                       onChange={setDestUri} />
        </FormGroup>
    );
};

const OptionsRow = ({ temporary, live, setTemporary, setLive, setStorage }) => {
    return (
        <FormGroup label={_("Options")}
                   fieldId="options"
                   id="options"
                   hasNoPaddingTop>
            <Checkbox id="live"
                      isChecked={live}
                      label={_("Run after migration")}
                      onChange={b => {
                          setLive(b);
                          if (!b)
                              setStorage("shared");
                      }} />
            {live && <Checkbox id="temporary"
                               isChecked={temporary}
                               label={
                                   <>
                                       {_("Move temporarily")}
                                       <Tooltip
                                           position="top"
                                           content={
                                               <>
                                                   <p>{_("When shut off on the destination, virtual machine will return to the original host in a shut off state.")}</p>
                                                   <p>{_("This feature is often used for hardware maintanance or load-balacing.")}</p>
                                               </>}>
                                           <OutlinedQuestionCircleIcon id="migrate-tooltip" />
                                       </Tooltip>
                                   </>
                               }
                               onChange={setTemporary} />
            }
        </FormGroup>
    );
};

const StorageRow = ({ storage, setStorage, live }) => {
    const copyDisabled = !live;
    let copyRadio = (
        <Radio id="copy"
               name="source"
               label={_("Copy storage")}
               isDisabled={copyDisabled}
               isChecked={storage === "copy"}
               onChange={() => setStorage("copy")} />
    );

    if (copyDisabled) {
        copyRadio = (
            <Tooltip id="storage-copy-tooltip"
                     content={_("Offline migration doesn't allow copying storage")}>
                {copyRadio}
            </Tooltip>
        );
    }

    return (
        <FormGroup label={_("Storage")}
                   fieldId="storage"
                   id="storage"
                   hasNoPaddingTop>
            <Radio id="shared"
                   name="source"
                   label={_("I have shared storage set up")}
                   isChecked={storage === "shared"}
                   onChange={() => setStorage("shared")} />
            {copyRadio}
        </FormGroup>
    );
};

export const MigrateDialog = ({ vmId, connectionName, toggleModal }) => {
    const [destUri, setDestUri] = useState("");
    const [error, setDialogError] = useState({});
    const [inProgress, setInProgress] = useState(false);
    const [storage, setStorage] = useState("shared");
    const [temporary, setTemporary] = useState(false);
    const [live, setLive] = useState(true);
    const [validationFailed, setValidationFailed] = useState(false);

    function validateParams() {
        const validation = {};
        if (isEmpty(destUri.trim()))
            validation.destUri = _("Destination URI must not be empty");

        return validation;
    }

    function onMigrate() {
        if (!isObjectEmpty(validateParams())) {
            setValidationFailed(true);
            return;
        }

        setInProgress(true);
        return migrateToUri(connectionName, vmId, destUri, storage, live, temporary)
                .then(toggleModal, exc => {
                    setInProgress(false);
                    setDialogError({ dialogError: _("Migration failed"), message: exc.message });
                });
    }

    const body = (
        <Form isHorizontal>
            <DestUriRow destUri={destUri}
                        setDestUri={setDestUri}
                        validationFailed={validationFailed} />
            <StorageRow storage={storage}
                        setStorage={setStorage}
                        live={live} />
            <OptionsRow temporary={temporary}
                        live={live}
                        setStorage={setStorage}
                        setTemporary={setTemporary}
                        setLive={setLive} />
        </Form>
    );

    const footer = (
        <>
            {!isObjectEmpty(error) && <ModalError dialogError={error.dialogError} dialogErrorDetail={error.message} />}
            <Button variant='primary'
                    isLoading={inProgress}
                    onClick={onMigrate}>
                {_("Migrate")}
            </Button>
            <Button variant='link' onClick={toggleModal}>
                {_("Cancel")}
            </Button>
        </>
    );

    return (
        <Modal position="top" variant="medium" isOpen onClose={toggleModal}
           title={_("Migrate VM to another host")}
           footer={footer}>
            {body}
        </Modal>
    );
};
