/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import { Radio } from "@patternfly/react-core/dist/esm/components/Radio/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";
import { FormHelperText, HelperText, HelperTextItem } from '@patternfly/react-core/dist/esm/components/index.js';
import { ExclamationCircleIcon } from '@patternfly/react-icons';

const _ = cockpit.gettext;

export const MtuDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-mtu-settings";
    const model = useContext(ModelContext);

    const [dialogError, setDialogError] = useState(undefined);
    const [mode, setMode] = useState(!settings.ethernet.mtu ? "auto" : "custom");
    const [mtu, setMtu] = useState(settings.ethernet.mtu ? settings.ethernet.mtu : '');
    const [mtuValidation, setMtuValidation] = useState("");

    const handleMtuChange = (_event, mtuChange) => {
        const mtuNew = parseInt(mtuChange, 10);
        if (isNaN(mtuNew) || mtuNew < 0) {
            setMtuValidation(_("MTU must be a positive number"));
        } else {
            setMtuValidation("");
        }
        if (mtuChange !== "" && mode === "auto") {
            setMode("custom");
        } else if (mtuChange === "" && mode === "custom") {
            setMode("auto");
        }

        setMtu(mtuChange);
    };

    const onSubmit = (_ev) => {
        const mtuNew = mode === 'auto' ? 0 : parseInt(mtu, 10);
        if (mtuValidation !== "" && mode === "custom") {
            setDialogError(mtuValidation);
            return;
        }
        const createSettingsObj = () => ({
            ...settings,
            ethernet: {
                ...settings.ethernet,
                mtu: mtuNew,
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
                       className="ct-align-center"
                       label={_("Set to")}
                       body={
                           <>
                               <TextInput id={idPrefix + "-input"}
                                   value={mtu}
                                   onChange={handleMtuChange}
                                   className="mtu-label-input"
                               />
                               {mtuValidation !== "" && mode === "custom" && (
                                   <FormHelperText>
                                       <HelperText>
                                           <HelperTextItem icon={<ExclamationCircleIcon />} variant="error">
                                               {mtuValidation}
                                           </HelperTextItem>
                                       </HelperText>
                                   </FormHelperText>
                               )}
                           </>
                       }
                       name="mtu-mode"
                       onChange={() => setMode("custom")}
                       value="custom" />
            </>
        </NetworkModal>
    );
};
