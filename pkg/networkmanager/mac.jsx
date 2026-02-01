/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import { FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";

import { MacMenu, NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

export const MacDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-mac-settings";
    const model = useContext(ModelContext);

    const [mac, setMAC] = useState((settings.ethernet && settings.ethernet.assigned_mac_address) || "");
    const [dialogError, setDialogError] = useState(undefined);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            ethernet: {
                assigned_mac_address: mac
            },
        });

        if (!mac) {
            setDialogError(_("Enter a valid MAC address"));
            return;
        }

        dialogSave({
            model,
            dev,
            connection,
            settings: createSettingsObj(),
            setDialogError,
            onClose: Dialogs.close,
        });

        // Prevent dialog from closing because of <form> onsubmit event
        if (event)
            event.preventDefault();

        return false;
    };

    return (
        <NetworkModal dialogError={dialogError}
                      idPrefix={idPrefix}
                      onSubmit={onSubmit}
                      title={_("Ethernet MAC")}
        >
            <FormGroup fieldId={idPrefix + "-mac-input"} label={_("MAC")}>
                <MacMenu idPrefix={idPrefix} model={model} mac={mac} setMAC={setMAC} />
            </FormGroup>
        </NetworkModal>
    );
};
