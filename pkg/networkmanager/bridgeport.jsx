/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

const _ = cockpit.gettext;

export const BridgePortDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-bridge-port-settings";
    const model = useContext(ModelContext);

    let config = settings.bridge_port;

    if (!config)
        config = config = { };

    const [priority, setPriority] = useState(config.priority);
    const [hairPin, setHairPin] = useState(config.hairpin_mode);
    const [pathCost, setPathCost] = useState(config.path_cost);
    const [dialogError, setDialogError] = useState(undefined);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            bridge_port: {
                ...settings.bridge_port,
                priority: parseInt(priority, 10),
                path_cost: parseInt(pathCost, 10),
                hairpin_mode: hairPin,
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
                      title={_("Bridge port settings")}
        >
            <FormGroup fieldId={idPrefix + "-prio-input"} label={_("Priority")}>
                <TextInput id={idPrefix + "-prio-input"} value={priority} onChange={(_event, value) => setPriority(value)} />
            </FormGroup>
            <FormGroup fieldId={idPrefix + "-path-cost-input"} label={_("Path cost")}>
                <TextInput id={idPrefix + "-path-cost-input"} value={pathCost} onChange={(_event, value) => setPathCost(value)} />
            </FormGroup>
            <FormGroup fieldId={idPrefix + "-hairPin-mode-input"}>
                <Checkbox id={idPrefix + "-hairPin-mode-input"} isChecked={hairPin} onChange={(_, hp) => setHairPin(hp)} label={_("Hair pin mode")} />
            </FormGroup>
        </NetworkModal>
    );
};
