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

export const TeamPortDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
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
                      title={_("Team port settings")}
        >
            <FormGroup fieldId={idPrefix + "-" + teamMode + "-prio-input"} label={_("Priority")}>
                <TextInput id={idPrefix + "-" + teamMode + "-prio-input"} value={priority} onChange={(_event, value) => setPriority(value)} />
            </FormGroup>
            {teamMode == 'activebackup'
                ? <FormGroup fieldId={idPrefix + "-activebackup-sticky-input"}>
                    <Checkbox id={idPrefix + "-activebackup-sticky-input"} isChecked={sticky} onChange={(_, s) => setSticky(s)} label={_("Sticky")} />
                </FormGroup>
                : null}
            {teamMode == 'lacp'
                ? <FormGroup fieldId={idPrefix + "-" + teamMode + "-key-input"} label={_("LACP key")}>
                    <TextInput id={idPrefix + "-" + teamMode + "-key-input"} value={key} onChange={(_event, value) => setKey(value)} />
                </FormGroup>
                : null}
        </NetworkModal>
    );
};
