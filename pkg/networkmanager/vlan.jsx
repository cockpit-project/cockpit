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
import { FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { Name, NetworkModal, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

import { v4 as uuidv4 } from 'uuid';
import {
    is_interface_connection,
    is_interesting_interface,
} from './interfaces.js';

const _ = cockpit.gettext;

export const VlanDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-vlan-settings";
    const model = useContext(ModelContext);
    const parentChoices = [];
    model.list_interfaces().forEach(iface => {
        if (!is_interface_connection(iface, connection) &&
            is_interesting_interface(iface))
            parentChoices.push(iface.Name);
    });

    const [dialogError, setDialogError] = useState(undefined);
    const [parent, setParent] = useState(settings.vlan.parent || parentChoices[0]);
    const [vlanId, setVlanId] = useState(settings.vlan.id || 1);
    const [iface, setIface] = useState(settings.vlan.interface_name || (parent + "." + vlanId));

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            connection: {
                ...settings.connection,
                id: iface,
                interface_name: iface,
            },
            vlan: {
                ...settings.vlan,
                parent,
                id: parseInt(vlanId, 10),
                interface_name: iface,
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
                      title={_("VLAN settings")}
        >
            <>
                <FormGroup fieldId={idPrefix + "-parent-select"} label={_("Parent")}>
                    <FormSelect id={idPrefix + "-parent-select"} onChange={(_, value) => {
                        setParent(value);
                        if (iface == (parent + "." + vlanId))
                            setIface(value + "." + vlanId);
                    }}
                                value={parent}>
                        {parentChoices.map(choice => <FormSelectOption value={choice} label={choice} key={choice} />)}
                    </FormSelect>
                </FormGroup>
                <FormGroup fieldId={idPrefix + "-vlan-id-input"} label={_("VLAN ID")}>
                    <TextInput id={idPrefix + "-vlan-id-input"} value={vlanId} onChange={(_event, value) => {
                        setVlanId(value);
                        if (iface == (parent + "." + vlanId))
                            setIface(parent + "." + value);
                    }} />
                </FormGroup>
                <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
            </>
        </NetworkModal>
    );
};

export const getGhostSettings = () => {
    return (
        {
            connection: {
                id: "",
                autoconnect: true,
                type: "vlan",
                uuid: uuidv4(),
                interface_name: ""
            },
            vlan: {
                interface_name: "",
                parent: ""
            }
        }
    );
};
