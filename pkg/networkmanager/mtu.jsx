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

import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

export const MtuDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-mtu-settings";
    const model = useContext(ModelContext);

    const [dialogError, setDialogError] = useState(undefined);
    const [mode, setMode] = useState(!settings.ethernet.mtu ? "auto" : "custom");
    const [mtu, setMtu] = useState(settings.ethernet.mtu ? settings.ethernet.mtu : '');

    const onSubmit = (ev) => {
        const mtuNew = parseInt(mtu, 10);
        if (isNaN(mtuNew) || mtuNew < 0) {
            setDialogError(_("MTU must be a positive number"));
            return;
        }
        const createSettingsObj = () => ({
            ...settings,
            ethernet: {
                ...settings.ethernet,
                mtu: mode == 'auto' ? 0 : mtuNew,
            }
        });

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
                      title={_("Ethernet MTU")}
        >
            <>
                <Radio id={idPrefix + "-auto"}
                       isChecked={mode == "auto"}
                       label={_("Automatic")}
                       name="mtu-mode"
                       onChange={() => setMode("auto")}
                       value="auto" />
                <Radio id={idPrefix + "-custom"}
                       isChecked={mode == "custom"}
                       label={
                           <>
                               <span>{_("Set to")}</span>
                               <TextInput id={idPrefix + "-input"} value={mtu} onChange={setMtu} />
                           </>
                       }
                       name="mtu-mode"
                       onChange={() => setMode("custom")}
                       value="custom" />
            </>
        </NetworkModal>
    );
};
