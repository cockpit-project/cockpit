/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from 'react';
import cockpit from 'cockpit';

import { Form } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Modal, ModalBody, ModalHeader, ModalFooter } from '@patternfly/react-core/dist/esm/components/Modal';
import { LockIcon } from "@patternfly/react-icons/dist/esm/icons/lock-icon";
import { LockOpenIcon } from "@patternfly/react-icons/dist/esm/icons/lock-open-icon";

import { useDialogs } from "dialogs.jsx";
import { connectToAccessPoint, existingConnectionConnectToAP, NMAccessPoint, NMDevice, NMError } from '../utils';

import {
    useDialogState, DialogState,
    DialogError,
    DialogErrorMessage,
    DialogTextInput,
    DialogActionButton, DialogCancelButton,
    DialogSimpleList,
    DialogPasswordInput,
    DialogDropdownSelect,
} from 'cockpit/dialog';
import { WIRELESS_SECURITY_OPTIONS } from '../network-interface';
import { ThumbTackIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

const HIDDEN_NETWORK = { _kind: "hidden" as const };
type WifiSelection = { ssid: string } | typeof HIDDEN_NETWORK;

// Check if the selection from the simple list is the special "Connect to a hidden network" entry.
function hiddenSelected(selection: WifiSelection): selection is typeof HIDDEN_NETWORK {
    return "_kind" in selection;
}

function getApObject(visibleSsids: NMAccessPoint[], selection: WifiSelection): NMAccessPoint | null {
    if (hiddenSelected(selection)) {
        return null;
    }
    return visibleSsids.find(ap => ap.Ssid === selection.ssid) ?? null;
}

function isSecuredAP(ap: NMAccessPoint): boolean {
    return !!(ap.WpaFlags || ap.RsnFlags);
}

interface AnacondaWirelessDialogValues {
    selectedAP: WifiSelection | null;
    // manually join network
    networkName: string;
    security: string;
    password: string;
}

export interface AnacondaWirelessDialogProps {
    dev: NMDevice;
}

export const AnacondaWirelessDialog = ({
    dev,
}: AnacondaWirelessDialogProps) => {
    // TODO: model update
    const Dialogs = useDialogs();
    const idPrefix = "anaconda-wifi";

    const init: AnacondaWirelessDialogValues = {
        selectedAP: null,
        // manually join network
        networkName: "",
        security: "wpa-psk",
        password: "",
    };

    function validate(dlg: DialogState<AnacondaWirelessDialogValues>) {
        dlg.field("selectedAP").validate(val => {
            if (val === null) {
                return _("Select a network");
            }
        });

        const selectedAP = dlg.field("selectedAP").get();
        if (!selectedAP) {
            return;
        }

        const isHidden = hiddenSelected(selectedAP);
        const securedHidden = isHidden && (dlg.field("security").get() !== "none");
        const ap = getApObject(dev.visibleSsids, selectedAP);
        const isSecured = ap && isSecuredAP(ap);
        // Don't need password if connection to this AP already exists
        const connectionExists = !!ap?.Connection;

        if ((isSecured || securedHidden) && !connectionExists) {
            dlg.field("password").validate(val => {
                if (val === "") {
                    return _("Password can not be empty");
                }
            });
        }

        if (isHidden) {
            dlg.field("networkName").validate(val => {
                if (val.trim() === "") {
                    return _("SSID can not be empty");
                }
            });
        }
    }

    const dlg = useDialogState(init, validate);

    const selectedSSID = dlg.field("selectedAP").get();
    const isSelectedHidden = !!selectedSSID && hiddenSelected(selectedSSID);
    const selectedAP = selectedSSID ? getApObject(dev.visibleSsids, selectedSSID) : null;
    const isSelectedSecured = !!selectedAP && isSecuredAP(selectedAP);
    const securedHidden = isSelectedHidden && (dlg.field("security").get() !== "none");

    function generateKey(selection: WifiSelection) {
        return hiddenSelected(selection) ? "__hidden__" : selection.ssid;
    }

    function renderListItem(selection: WifiSelection) {
        if (hiddenSelected(selection)) {
            return _("Connect to a hidden network");
        }

        const ap = getApObject(dev.visibleSsids, selection);
        const isSecured = !!ap && isSecuredAP(ap);
        return (
            <Flex flexWrap={{ default: "nowrap" }}
                spaceItems={{ default: "spaceItemsSm" }}
                alignItems={{ default: "alignItemsCenter" }}
            >
                { ap?.Connection && <ThumbTackIcon />}
                {isSecured
                    ? <LockIcon aria-label={_("Secured")} />
                    : <LockOpenIcon aria-label={_("Unsecured")} />}
                {selection.ssid}
            </Flex>
        );
    }

    function selectedAPChanged(val: WifiSelection | null) {
        if (!val) {
            return;
        }

        dlg.field("selectedAP").set(val);

        const ap = getApObject(dev.visibleSsids, val);
        const isSecured = !!ap && isSecuredAP(ap);
        dlg.field("security").set(isSecured ? "wpa-psk" : "none");
        // reset password when changing selection between secured/unsecured APs
        if (!isSecured) {
            dlg.field("password").set("");
        }
    }

    function securityChanged(val: string) {
        dlg.field("security").set(val);
    }

    async function onConnect({ selectedAP, networkName, security, password }: AnacondaWirelessDialogValues) {
        cockpit.assert(selectedAP, "AP must be selected");

        const isHidden = hiddenSelected(selectedAP);
        const ap = getApObject(dev.visibleSsids, selectedAP);
        if (!isHidden && ap?.Connection) {
            await existingConnectionConnectToAP(ap, dev);
            return;
        }

        const ssid = isHidden ? networkName : selectedAP.ssid;

        try {
            await connectToAccessPoint(dev, ssid, isHidden, security, password, cancel => dlg.set_cancel(cancel));
        } catch (ex) {
            const err = ex as NMError;
            throw DialogError.fromError(
                _("Failed to connect"),
                err.reason === 7 // NM_DEVICE_STATE_REASON_NO_SECRETS
                    ? _("Check your password.")
                    : err);
        }
    }

    // Don't show hidden APs, and add the "Connect to a hidden network" entry last.
    const availableAPs: WifiSelection[] = [
        ...dev.visibleSsids.map(ap => ({ ssid: ap.Ssid })),
        HIDDEN_NETWORK,
    ];

    const connectionExists = !!selectedAP?.Connection;

    return (
        <Modal id={idPrefix + "-dialog"}
            position="top"
            variant="small"
            isOpen
            onClose={Dialogs.close}
        >
            <ModalHeader title={_("Join a network")} />

            <ModalBody id={idPrefix + "-body"}>
                <DialogErrorMessage dialog={dlg} />
                <DialogSimpleList field={dlg.field("selectedAP", selectedAPChanged)}
                    option_key={generateKey}
                    option_node={renderListItem}
                    options={availableAPs}
                />
                <Form id={idPrefix + "-form"} onSubmit={ev => ev.preventDefault()} isHorizontal>
                    {isSelectedHidden &&
                        <>
                            <DialogTextInput label={_("Network name")}
                                field={dlg.field("networkName")}
                            />
                            <DialogDropdownSelect label={_("Security")}
                                field={dlg.field("security", securityChanged)}
                                options={WIRELESS_SECURITY_OPTIONS}
                            />
                        </>
                    }
                    {(isSelectedSecured || securedHidden) && !connectionExists &&
                        <DialogPasswordInput
                            label={_("Password")}
                            field={dlg.field("password")}
                            autoFocus={isSelectedHidden === false} // eslint-disable-line jsx-a11y/no-autofocus
                        />
                    }
                </Form>
            </ModalBody>

            <ModalFooter>
                <DialogActionButton dialog={dlg}
                    action={onConnect}
                    onClose={Dialogs.close}
                >
                    {_("Connect")}
                </DialogActionButton>
                <DialogCancelButton dialog={dlg} onClose={Dialogs.close}>
                    {_("Cancel")}
                </DialogCancelButton>
            </ModalFooter>
        </Modal>
    );
};
