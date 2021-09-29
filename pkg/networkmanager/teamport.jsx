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

export const TeamPortDialog = ({ connection, dev, setIsOpen, settings }) => {
    const idPrefix = "network-team-port-settings";
    const model = useContext(ModelContext);

    const group_settings = connection.Groups[0].Settings;
    const group_config = group_settings.team.config;
    const teamMode = group_config.runner.name;
    let config = settings.team_port.config;

    if (!config)
        config = config = { };

    const [priority, setPriority] = useState(teamMode == 'activebackup' ? config.prio : config.lacp_prio);
    const [sticky, setSticky] = useState(config.sticky);
    const [key, setKey] = useState(config.lacp_key);
    const [dialogError, setDialogError] = useState(undefined);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            team_port: {
                config: {
                    ...config,
                    ...(teamMode == 'activebackup' && { prio: priority, sticky }),
                    ...(teamMode == 'lacp' && { lacp_prio: priority, lacp_key: key }),
                }
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
                      title={_("Team port settings")}
        >
            <FormGroup fieldId={idPrefix + "-" + teamMode + "-prio-input"} label={_("Priority")}>
                <TextInput id={idPrefix + "-" + teamMode + "-prio-input"} value={priority} onChange={setPriority} />
            </FormGroup>
            {teamMode == 'activebackup'
                ? <FormGroup fieldId={idPrefix + "-activebackup-sticky-input"}>
                    <Checkbox id={idPrefix + "-activebackup-sticky-input"} isChecked={sticky} onChange={setSticky} label={_("Sticky")} />
                </FormGroup> : null}
            {teamMode == 'lacp'
                ? <FormGroup fieldId={idPrefix + "-" + teamMode + "-key-input"} label={_("LACP key")}>
                    <TextInput id={idPrefix + "-" + teamMode + "-key-input"} value={key} onChange={setKey} />
                </FormGroup> : null}
        </NetworkModal>
    );
};
