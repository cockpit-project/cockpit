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
import { connectToAccessPoint, existingConnectionConnectToAP, NM_DEVICE_STATE_REASON_NO_SECRETS, NMAccessPoint, NMDevice, NMError } from '../utils';

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

const _ = cockpit.gettext;

// Special "Connect to a hidden network" entry shown as the last item in the list
const HIDDEN_NETWORK = { _kind: "hidden" as const };
type WifiSelection = NMAccessPoint | typeof HIDDEN_NETWORK;

function isHiddenNetwork(selection: WifiSelection): selection is typeof HIDDEN_NETWORK {
    return "_kind" in selection;
}

function isSecuredNetwork(selectedAP: WifiSelection): boolean {
    return !isHiddenNetwork(selectedAP) && !!(selectedAP.WpaFlags || selectedAP.RsnFlags);
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
        const selectedAP = dlg.field("selectedAP").get();

        dlg.field("selectedAP").validate(val => {
            if (val === null) {
                return _("Select a network");
            }
        });

        cockpit.assert(selectedAP);
        const isHidden = isHiddenNetwork(selectedAP);
        const unsecuredHidden = isHidden && (dlg.field("security").get() !== "none");

        if (isSecuredNetwork(selectedAP) || unsecuredHidden) {
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

    const selectedAP = dlg.field("selectedAP").get();
    const isSelectedHidden = selectedAP && isHiddenNetwork(selectedAP);
    const isSelectedSecured = selectedAP && isSecuredNetwork(selectedAP);
    const unsecuredHidden = isSelectedHidden && (dlg.field("security").get() !== "none");

    function generateKey(selection: WifiSelection) {
        return isHiddenNetwork(selection) ? "__hidden__" : `${selection.Ssid}-${selection.HwAddress}`;
    }

    function renderListItem(selection: WifiSelection) {
        if (isHiddenNetwork(selection)) {
            return _("Connect to a hidden network");
        }

        const isSecured = !!(selection.WpaFlags || selection.RsnFlags);
        return (
            <Flex flexWrap={{ default: "nowrap" }}
                spaceItems={{ default: "spaceItemsSm" }}
                alignItems={{ default: "alignItemsCenter" }}
            >
                {isSecured
                    ? <LockIcon aria-label={_("Secured")} />
                    : <LockOpenIcon aria-label={_("Unsecured")} />}
                {selection.Ssid}
            </Flex>
        );
    }

    function selectedAPChanged(val: WifiSelection | null) {
        if (!val) {
            return;
        }

        dlg.field("selectedAP").set(val);

        const isSecured = isSecuredNetwork(val);
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

        const isHidden = isHiddenNetwork(selectedAP);
        if (!isHidden && selectedAP.Connection) {
            await existingConnectionConnectToAP(selectedAP, dev);
            return;
        }

        const ssid = isHidden ? networkName : selectedAP.Ssid;

        try {
            await connectToAccessPoint(dev, ssid, security, password, cancel => dlg.set_cancel(cancel));
        } catch (ex) {
            const err = ex as NMError;
            throw new DialogError(
                _("Failed to connect"),
                err.reason === NM_DEVICE_STATE_REASON_NO_SECRETS
                    ? _("Check your password.")
                    : err.message);
        }
    }

    // Don't show hidden APs, and add the "Connect to a hidden network" entry last.
    const availableAPs: WifiSelection[] = [
        ...dev.AccessPoints.filter(ap => !!ap.Ssid),
        HIDDEN_NETWORK,
    ];

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
                    {(isSelectedSecured || unsecuredHidden) &&
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
