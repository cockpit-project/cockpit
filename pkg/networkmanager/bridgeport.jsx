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
import {
    Checkbox,
    FormGroup,
    TextInput,
} from '@patternfly/react-core';

import { NetworkModal, dialogApply } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';

const _ = cockpit.gettext;

export const BridgePortDialog = ({ connection, dev, setIsOpen, settings }) => {
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

        dialogApply({
            model,
            dev,
            connection,
            settings: createSettingsObj(),
            setDialogError,
            setIsOpen,
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
                      setIsOpen={setIsOpen}
                      title={_("Bridge port settings")}
        >
            <FormGroup fieldId={idPrefix + "-prio-input"} label={_("Priority")}>
                <TextInput id={idPrefix + "-prio-input"} value={priority} onChange={setPriority} />
            </FormGroup>
            <FormGroup fieldId={idPrefix + "-path-cost-input"} label={_("Path cost")}>
                <TextInput id={idPrefix + "-path-cost-input"} value={pathCost} onChange={setPathCost} />
            </FormGroup>
            <FormGroup fieldId={idPrefix + "-hairPin-mode-input"}>
                <Checkbox id={idPrefix + "-hairPin-mode-input"} isChecked={hairPin} onChange={setHairPin} label={_("Hair pin mode")} />
            </FormGroup>
        </NetworkModal>
    );
};
