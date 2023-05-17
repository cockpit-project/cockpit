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
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { MemberInterfaceChoices, NetworkModal, Name, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

import { v4 as uuidv4 } from 'uuid';
import {
    member_connection_for_interface,
    member_interface_choices,
} from './interfaces.js';

const _ = cockpit.gettext;

export const BridgeDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-bridge-settings";
    const model = useContext(ModelContext);
    const memberChoicesInit = {};

    member_interface_choices(model, connection).forEach((iface) => {
        memberChoicesInit[iface.Name] = !!member_connection_for_interface(connection, iface);
    });

    const [dialogError, setDialogError] = useState(undefined);
    const [iface, setIface] = useState(settings.connection.interface_name);
    const [stp, setStp] = useState(!!settings.bridge.stp);
    const [priority, setPriority] = useState(settings.bridge.priority || 10);
    const [forwardDelay, setForwardDelay] = useState(settings.bridge.forward_delay || 10);
    const [helloTime, setHelloTime] = useState(settings.bridge.hello_time || 10);
    const [maxAge, setMaxAge] = useState(settings.bridge.max_age || 10);
    const [memberChoices, setMemberChoices] = useState(memberChoicesInit);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            connection: {
                ...settings.connection,
                id: iface,
                interface_name: iface,
            },
            bridge: {
                ...settings.bridge,
                stp,
                ...(stp && { priority, forward_delay: forwardDelay, hello_time: helloTime, max_age: maxAge }),
                interface_name: iface,
            }
        });

        dialogSave({
            model,
            dev,
            connection,
            members: memberChoices,
            membersInit: memberChoicesInit,
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
                      idPrefix="network-bridge-settings"
                      onSubmit={onSubmit}
                      title={_("Bridge settings")}
        >
            <>
                <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
                <FormGroup label={_("Ports")} fieldId={idPrefix + "-interface-members-list"} hasNoPaddingTop>
                    <MemberInterfaceChoices idPrefix={idPrefix} memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup label={_("Options")} fieldId={idPrefix + "-stp-enabled-input"} hasNoPaddingTop>
                    <Checkbox id={idPrefix + "-stp-enabled-input"} isChecked={stp} onChange={(_, s) => setStp(s)} label={_("Spanning tree protocol (STP)")} />
                    {stp && <>
                        <FormGroup fieldId="network-bridge-stp-settings-priority-input" label={_("STP priority")}>
                            <TextInput id="network-bridge-stp-settings-priority-input" className="network-number-field" value={priority} onChange={(_event, value) => setPriority(value)} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-forward-delay-input" label={_("STP forward delay")}>
                            <TextInput id="network-bridge-stp-settings-forward-delay-input" className="network-number-field" value={forwardDelay} onChange={(_event, value) => setForwardDelay(value)} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-hello-time-input" label={_("STP hello time")}>
                            <TextInput id="network-bridge-stp-settings-hello-time-input" className="network-number-field" value={helloTime} onChange={(_event, value) => setHelloTime(value)} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-max-age-input" label={_("STP maximum message age")}>
                            <TextInput id="network-bridge-stp-settings-max-age-input" className="network-number-field" value={maxAge} onChange={(_event, value) => setMaxAge(value)} />
                        </FormGroup>
                    </>}
                </FormGroup>
            </>
        </NetworkModal>
    );
};

export const getGhostSettings = ({ newIfaceName }) => {
    return (
        {
            connection: {
                id: newIfaceName,
                autoconnect: true,
                type: "bridge",
                uuid: uuidv4(),
                interface_name: newIfaceName
            },
            bridge: {
                interface_name: newIfaceName,
                stp: false,
                priority: 32768,
                forward_delay: 15,
                hello_time: 2,
                max_age: 20,
                ageing_time: 300
            }
        }
    );
};
