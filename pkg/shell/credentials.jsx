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

import cockpit from "cockpit";
import React, { useState } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy, ClipboardCopyVariant } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ActionGroup, Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { InfoCircleIcon } from '@patternfly/react-icons';

import * as credentials from "credentials";
import { FileAutoComplete } from "cockpit-components-file-autocomplete.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { ListingTable } from 'cockpit-components-table.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { useEvent, useObject } from 'hooks';
import { useDialogs } from "dialogs.jsx";

import "./credentials.scss";

const _ = cockpit.gettext;

export const CredentialsModal = () => {
    const Dialogs = useDialogs();
    const keys = useObject(() => credentials.keys_instance(), null, []);
    const [addNewKey, setAddNewKey] = useState(false);
    const [dialogError, setDialogError] = useState();
    const [unlockKey, setUnlockKey] = useState();

    useEvent(keys, "changed");

    if (!keys)
        return null;

    function onToggleKey(id, enable) {
        const key = keys.items[id];

        if (!key || !key.name)
            return;

        /* Key needs to be loaded, show load UI */
        if (enable && !key.loaded) {
            setUnlockKey(key.name);
        /* Key needs to be unloaded, do that directly */
        } else if (!enable && key.loaded) {
            keys.unload(key).catch(ex => setDialogError(ex.message));
        }
    }

    return (
        <>
            <Modal isOpen position="top" variant="medium"
                   onClose={Dialogs.close}
                   title={_("SSH keys")}
                   id="credentials-modal"
                   footer={<Button variant='secondary' onClick={Dialogs.close}>{_("Close")}</Button>}
            >
                <Stack hasGutter>
                    {dialogError && <ModalError dialogError={dialogError} />}
                    <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                        <FlexItem>{_("Use the following keys to authenticate against other systems")}</FlexItem>
                        <Button variant='secondary'
                                id="ssh-file-add-custom"
                                onClick={() => setAddNewKey(true)}>
                            {_("Add key")}
                        </Button>
                    </Flex>
                    {addNewKey && <AddNewKey load={keys.load} unlockKey={setUnlockKey} onClose={() => setAddNewKey(false)} />}
                    <ListingTable
                        aria-label={ _("SSH keys") }
                        gridBreakPoint=''
                        id="credential-keys"
                        showHeader={false}
                        variant="compact"
                        columns={ [
                            { title: _("Name"), header: true },
                            { title: _("Toggle") },
                        ] }
                        rows={ Object.keys(keys.items).map((currentKeyId, index) => {
                            const currentKey = keys.items[currentKeyId] || { name: 'test' };
                            const tabRenderers = [
                                {
                                    data: { currentKey },
                                    name: _("Details"),
                                    renderer: KeyDetails,
                                },
                                {
                                    data: { currentKey },
                                    name: _("Public key"),
                                    renderer: PublicKey,
                                },
                                {
                                    data: { currentKey, change: keys.change, setDialogError },
                                    name: _("Password"),
                                    renderer: KeyPassword,
                                },
                            ];
                            const expandedContent = (
                                <ListingPanel tabRenderers={tabRenderers} />
                            );

                            return ({
                                columns: [
                                    {
                                        title: currentKey.name || currentKey.comment,
                                    },
                                    {
                                        title: <Switch aria-label={_("Use key")}
                                                       isChecked={!!currentKey.loaded}
                                                       key={"switch-" + index}
                                                       onChange={value => onToggleKey(currentKeyId, value)} />,
                                    }
                                ],
                                expandedContent,
                                props: { key: currentKey.fingerprint, 'data-name': currentKey.name || currentKey.comment, 'data-loaded': !!currentKey.loaded },
                            });
                        })} />
                </Stack>
            </Modal>
            {unlockKey && <UnlockKey keyName={unlockKey} load={keys.load} onClose={() => { setUnlockKey(undefined); setAddNewKey(false) }} />}
        </>
    );
};

const AddNewKey = ({ load, unlockKey, onClose }) => {
    const [addNewKeyLoading, setAddNewKeyLoading] = useState(false);
    const [newKeyPath, setNewKeyPath] = useState("");
    const [newKeyPathError, setNewKeyPathError] = useState();

    const addCustomKey = () => {
        setAddNewKeyLoading(true);
        load(newKeyPath)
                .then(onClose)
                .catch(ex => {
                    if (!ex.sent_password)
                        setNewKeyPathError(ex.message);
                    else
                        unlockKey(newKeyPath);
                })
                .finally(() => setAddNewKeyLoading(false));
    };

    return (
        <Grid hasGutter>
            <GridItem span={9} id="ssh-file-add-key">
                <FileAutoComplete onChange={setNewKeyPath}
                                  placeholder={_("Path to file")}
                                  superuser="try" />
                {newKeyPathError && <HelperText className="pf-v5-c-form__helper-text">
                    <HelperTextItem variant="error">{newKeyPathError}</HelperTextItem>
                </HelperText>}
            </GridItem>
            <GridItem span={1}>
                <Button id="ssh-file-add"
                        isDisabled={addNewKeyLoading || !newKeyPath}
                        isLoading={addNewKeyLoading}
                        onClick={addCustomKey}
                        variant="secondary">
                    {_("Add")}
                </Button>
            </GridItem>
        </Grid>
    );
};

const KeyDetails = ({ currentKey }) => {
    return (
        <DescriptionList className="pf-m-horizontal-on-sm">
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Comment")}</DescriptionListTerm>
                <DescriptionListDescription>{currentKey.comment}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Type")}</DescriptionListTerm>
                <DescriptionListDescription>{currentKey.type}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Fingerprint")}</DescriptionListTerm>
                <DescriptionListDescription>{currentKey.fingerprint}</DescriptionListDescription>
            </DescriptionListGroup>
        </DescriptionList>
    );
};

const PublicKey = ({ currentKey }) => {
    return (
        <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} variant={ClipboardCopyVariant.expansion}>
            {currentKey.data.trim()}
        </ClipboardCopy>
    );
};

const KeyPassword = ({ currentKey, change, setDialogError }) => {
    const [confirmPassword, setConfirmPassword] = useState('');
    const [inProgress, setInProgress] = useState(undefined);
    const [newPassword, setNewPassword] = useState('');
    const [oldPassword, setOldPassword] = useState('');

    function changePassword() {
        if (!currentKey || !currentKey.name)
            return;

        setInProgress(true);
        setDialogError();

        if (oldPassword === undefined || newPassword === undefined || confirmPassword === undefined)
            setDialogError("Invalid password fields");

        change(currentKey.name, oldPassword, newPassword, confirmPassword)
                .then(() => {
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setInProgress(false);
                })
                .catch(ex => {
                    setDialogError(ex.message);
                    setInProgress(undefined);
                });
    }

    const changePasswordBtn = (
        <Button variant="primary"
                id={(currentKey.name || currentKey.comment) + "-change-password"}
                isDisabled={inProgress}
                isLoading={inProgress}
                onClick={() => changePassword()}>{_("Change password")}</Button>
    );

    return (
        <Form onSubmit={e => { e.preventDefault(); return false }} isHorizontal>
            {inProgress === false && <HelperText>
                <HelperTextItem variant="success" hasIcon>
                    {_("Password changed successfully")}
                </HelperTextItem>
            </HelperText>}
            <FormGroup label={_("Password")} fieldId={(currentKey.name || currentKey.comment) + "-old-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-old-password"} value={oldPassword} onChange={setOldPassword} />
            </FormGroup>
            <FormGroup label={_("New password")} fieldId={(currentKey.name || currentKey.comment) + "-new-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-new-password"} value={newPassword} onChange={setNewPassword} />
            </FormGroup>
            <FormGroup label={_("Confirm password")} fieldId={(currentKey.name || currentKey.comment) + "-confirm-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-confirm-password"} value={confirmPassword} onChange={setConfirmPassword} />
            </FormGroup>
            <ActionGroup>
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <Popover
                        aria-label={_("Password tip")}
                        bodyContent={_("Tip: Make your key password match your login password to automatically authenticate against other systems.")}
                    >
                        <button className="pf-v5-c-form__group-label-help ct-icon-info-circle"
                                onClick={e => e.preventDefault()}
                                type="button">
                            <InfoCircleIcon />
                        </button>
                    </Popover>
                    {changePasswordBtn}
                </Flex>
            </ActionGroup>
        </Form>
    );
};

const UnlockKey = ({ keyName, load, onClose }) => {
    const [password, setPassword] = useState();
    const [dialogError, setDialogError] = useState();

    function load_key() {
        if (!keyName)
            return;

        load(keyName, password)
                .then(onClose)
                .catch(ex => {
                    setDialogError(ex.message);
                    console.warn("loading key failed: ", ex.message);
                });
    }

    return (
        <Modal isOpen position="top" variant="small"
               onClose={onClose}
               title={cockpit.format(_("Unlock key $0"), keyName)}
               footer={
                   <>
                       <Button variant="primary" id={keyName + "-unlock"} isDisabled={!keyName} onClick={load_key}>{_("Unlock")}</Button>
                       <Button variant='link' onClick={onClose}>{_("Cancel")}</Button>
                   </>
               }>
            <Form onSubmit={e => { e.preventDefault(); return false }} isHorizontal>
                {dialogError && <ModalError dialogError={dialogError} />}
                <FormGroup label={_("Password")} fieldId={keyName + "-password"} type="password">
                    <TextInput type="password" id={keyName + "-password"} value={password} onChange={setPassword} />
                </FormGroup>
            </Form>
        </Modal>
    );
};
