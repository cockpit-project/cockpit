/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { ClipboardCopy, ClipboardCopyVariant } from "@patternfly/react-core/dist/esm/components/ClipboardCopy/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ActionGroup, Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { HelperText, HelperTextItem } from "@patternfly/react-core/dist/esm/components/HelperText/index.js";
import {
    Modal, ModalBody, ModalFooter, ModalHeader
} from '@patternfly/react-core/dist/esm/components/Modal/index.js';
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { InfoCircleIcon } from '@patternfly/react-icons';

import * as credentials from "credentials";
import { FileChooserButton } from "cockpit-components-file-chooser.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { ListingTable } from 'cockpit-components-table.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { useEvent, useObject } from 'hooks';
import { DialogResult } from "dialogs";

import "./credentials.scss";

const _ = cockpit.gettext;

const KeyDetails = ({ currentKey } : { currentKey: credentials.Key }) => {
    return (
        <DescriptionList className="pf-m-horizontal-on-sm">
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Comment")}</DescriptionListTerm>
                <DescriptionListDescription data-name="comment">{currentKey.comment}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Type")}</DescriptionListTerm>
                <DescriptionListDescription data-name="type">{currentKey.type}</DescriptionListDescription>
            </DescriptionListGroup>
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Fingerprint")}</DescriptionListTerm>
                <DescriptionListDescription data-name="fingerprint">{currentKey.fingerprint}</DescriptionListDescription>
            </DescriptionListGroup>
        </DescriptionList>
    );
};

const PublicKey = ({ currentKey } : { currentKey: credentials.Key }) => {
    return (
        <ClipboardCopy isReadOnly hoverTip={_("Copy")} clickTip={_("Copied")} variant={ClipboardCopyVariant.expansion}>
            {currentKey.data.trim()}
        </ClipboardCopy>
    );
};

const KeyPassword = ({
    currentKey,
    keys,
    setDialogError
} : {
    currentKey: credentials.Key,
    keys: credentials.Keys,
    setDialogError: (msg: string | null) => void
}) => {
    const [confirmPassword, setConfirmPassword] = useState('');
    const [inProgress, setInProgress] = useState<boolean | undefined>(undefined);
    const [newPassword, setNewPassword] = useState('');
    const [oldPassword, setOldPassword] = useState('');

    function changePassword() {
        if (!currentKey || !currentKey.name)
            return;

        setInProgress(true);
        setDialogError(null);

        if (oldPassword === undefined || newPassword === undefined || confirmPassword === undefined)
            setDialogError("Invalid password fields");

        keys.change(currentKey.name, oldPassword, newPassword)
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
                {... inProgress !== undefined ? { isDisabled: inProgress, isLoading: inProgress } : {} }
                onClick={() => changePassword()}>{_("Change password")}</Button>
    );

    return (
        <Form onSubmit={e => { e.preventDefault(); return false }} isHorizontal>
            {inProgress === false && <HelperText>
                <HelperTextItem variant="success">
                    {_("Password changed successfully")}
                </HelperTextItem>
            </HelperText>}
            <FormGroup label={_("Password")} fieldId={(currentKey.name || currentKey.comment) + "-old-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-old-password"} value={oldPassword} onChange={(_event, value) => setOldPassword(value)} />
            </FormGroup>
            <FormGroup label={_("New password")} fieldId={(currentKey.name || currentKey.comment) + "-new-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-new-password"} value={newPassword} onChange={(_event, value) => setNewPassword(value)} />
            </FormGroup>
            <FormGroup label={_("Confirm password")} fieldId={(currentKey.name || currentKey.comment) + "-confirm-password"} type="password">
                <TextInput type="password" id={(currentKey.name || currentKey.comment) + "-confirm-password"} value={confirmPassword} onChange={(_event, value) => setConfirmPassword(value)} />
            </FormGroup>
            <ActionGroup>
                <Flex spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    <Popover
                        aria-label={_("Password tip")}
                        bodyContent={_("Tip: Make your key password match your login password to automatically authenticate against other systems.")}
                    >
                        <button className="pf-v6-c-form__group-label-help ct-icon-info-circle"
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

const UnlockKey = ({
    keyName,
    keys,
    onClose
} : {
    keyName: string,
    keys: credentials.Keys,
    onClose: () => void
}) => {
    const [password, setPassword] = useState("");
    const [dialogError, setDialogError] = useState("");

    function load_key() {
        if (!keyName)
            return;

        keys.load(keyName, password)
                .then(onClose)
                .catch(ex => {
                    setDialogError(ex.message);
                    console.warn("loading key failed: ", ex.message);
                });
    }

    return (
        <Modal isOpen position="top" variant="small"
               onClose={onClose}>
            <ModalHeader title={cockpit.format(_("Unlock key $0"), keyName)} />
            <ModalBody>
                <Form onSubmit={e => { e.preventDefault(); return false }} isHorizontal>
                    {dialogError && <ModalError dialogError={dialogError} />}
                    <FormGroup label={_("Password")} fieldId={keyName + "-password"} type="password">
                        <TextInput type="password" id={keyName + "-password"} value={password} onChange={(_event, value) => setPassword(value)} />
                    </FormGroup>
                </Form>
            </ModalBody>
            <ModalFooter>
                <Button variant="primary" id={keyName + "-unlock"} isDisabled={!keyName} onClick={load_key}>{_("Unlock")}</Button>
                <Button variant='link' onClick={onClose}>{_("Cancel")}</Button>
            </ModalFooter>
        </Modal>
    );
};

export const CredentialsModal = ({
    dialogResult,
    homeDir,
} : {
    dialogResult: DialogResult<void>,
    homeDir: string,
}) => {
    const keys = useObject(() => credentials.keys_instance(), null, []);
    const [dialogError, setDialogError] = useState();
    const [unlockKey, setUnlockKey] = useState<string | undefined>();

    useEvent(keys as unknown as cockpit.EventSource<cockpit.EventMap>, "changed");

    if (!keys)
        return null;

    function onToggleKey(id: string, enable: boolean) {
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

    const addCustomKey = async (newKeyPath: string): Promise<void> => {
        try {
            await keys.load(newKeyPath, "");
        } catch (ex) {
            if (!(ex instanceof credentials.KeyLoadError) || !ex.sent_password)
                throw ex;
            else
                setUnlockKey(newKeyPath);
        }
    };

    let home = cockpit.info.user.home;
    if (!home.endsWith("/"))
        home += "/";

    return (
        <>
            <Modal isOpen position="top" variant="medium"
                   onClose={() => dialogResult.resolve()}
                   id="credentials-modal"
            >
                <ModalHeader title={_("SSH keys")} />
                <ModalBody>
                    <Stack hasGutter>
                        {dialogError && <ModalError dialogError={dialogError} />}
                        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                            <FlexItem>{_("Use the following keys to authenticate against other systems")}</FlexItem>
                            <FileChooserButton
                                variant='secondary'
                                id="ssh-file-add-custom"
                                title={_("Add private SSH key")}
                                initialLocation={home + ".ssh/"}
                                shortcuts={
                                    [
                                        { label: _("Home"), path: home },
                                    ]
                                }
                                onSelect={addCustomKey}
                                selectTitle={_("Add key")}
                            >
                                {_("Add key")}
                            </FileChooserButton>
                        </Flex>
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
                                        data: { currentKey, keys, setDialogError },
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
                                                           onChange={(_event, value) => onToggleKey(currentKeyId, value)} />,
                                        }
                                    ],
                                    expandedContent,
                                    props: { key: currentKey.fingerprint, 'data-name': currentKey.name || currentKey.comment, 'data-loaded': !!currentKey.loaded },
                                });
                            })} />
                    </Stack>
                </ModalBody>
                <ModalFooter>
                    <Button variant='secondary' onClick={() => dialogResult.resolve()}>{_("Close")}</Button>
                </ModalFooter>
            </Modal>
            {unlockKey && <UnlockKey keyName={unlockKey} keys={keys} onClose={() => { setUnlockKey(undefined) }} />}
        </>
    );
};
