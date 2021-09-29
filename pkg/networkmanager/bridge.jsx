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

import $ from 'jquery';
import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import {
    Button,
    Checkbox,
    Form, FormGroup,
    Modal,
    Stack,
    TextInput,
} from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';

import { v4 as uuidv4 } from 'uuid';
import {
    apply_group_member,
    connection_devices,
    member_connection_for_interface,
    member_interface_choices,
    settings_applier,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
} from './interfaces.js';

const _ = cockpit.gettext;

const BridgeDialog = ({ connection, dev, done, setIsOpen, settings }) => {
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

        const apply_settings = settings_applier(model, dev, connection);

        const modify = () => {
            // When all dialogs are ported to React this helper should stop using jquery
            return apply_group_member($('#network-bridge-settings-body'),
                                      model,
                                      apply_settings,
                                      connection,
                                      createSettingsObj(),
                                      "bridge")
                    .then(() => {
                        setIsOpen(false);
                        if (connection)
                            cockpit.location.go([iface]);
                        if (done)
                            return done();
                    })
                    .catch(ex => setDialogError(ex.message));
        };
        const membersChanged = Object.keys(memberChoicesInit).some(iface => memberChoicesInit[iface] != memberChoices[iface]);

        if (connection) {
            with_settings_checkpoint(model, modify,
                                     {
                                         devices: (membersChanged
                                             ? [] : connection_devices(connection)),
                                         hack_does_add_or_remove: membersChanged,
                                         rollback_on_failure: membersChanged
                                     });
        } else {
            with_checkpoint(
                model,
                modify,
                {
                    fail_text: _("Creating this bridge will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true,
                    rollback_on_failure: true
                });
        }

        // Prevent dialog from closing because of <form> onsubmit event
        if (event)
            event.preventDefault();

        return false;
    };

    return (
        <Modal id="network-bridge-settings-dialog" position="top" variant="medium"
            isOpen
            onClose={() => setIsOpen(false)}
            title={_("Bridge settings")}
            footer={
                <>
                    {dialogError && <ModalError id="network-bridge-settings-error" dialogError={_("Failed to apply settings")} dialogErrorDetail={dialogError} />}
                    <Button variant='primary' id="network-bridge-settings-apply" onClick={onSubmit}>
                        {_("Apply")}
                    </Button>
                    <Button variant='link' id="network-bridge-settings-cancel" onClick={() => setIsOpen(false)}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id="network-bridge-settings-body" onSubmit={onSubmit} isHorizontal>
                <FormGroup fieldId="network-bridge-settings-name-input" label={_("Name")}>
                    <TextInput id="network-bridge-settings-name-input" value={iface} onChange={setIface} />
                </FormGroup>
                <FormGroup label={_("Ports")} fieldId="network-bridge-settings-interface-members-list" hasNoPaddingTop>
                    <MemberInterfaceChoices memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup label={_("Options")} fieldId="network-bridge-settings-stp-enabled-input" hasNoPaddingTop>
                    <Checkbox id="network-bridge-settings-stp-enabled-input" isChecked={stp} onChange={setStp} label={_("Spanning tree protocol (STP)")} />
                    {stp && <>
                        <FormGroup fieldId="network-bridge-stp-settings-priority-input" label={_("STP priority")}>
                            <TextInput id="network-bridge-stp-settings-priority-input" className="network-number-field" value={priority} onChange={setPriority} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-forward-delay-input" label={_("STP forward delay")}>
                            <TextInput id="network-bridge-stp-settings-forward-delay-input" className="network-number-field" value={forwardDelay} onChange={setForwardDelay} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-hello-time-input" label={_("STP hello time")}>
                            <TextInput id="network-bridge-stp-settings-hello-time-input" className="network-number-field" value={helloTime} onChange={setHelloTime} />
                        </FormGroup>
                        <FormGroup fieldId="network-bridge-stp-settings-max-age-input" label={_("STP maximum message age")}>
                            <TextInput id="network-bridge-stp-settings-max-age-input" className="network-number-field" value={maxAge} onChange={setMaxAge} />
                        </FormGroup>
                    </>}
                </FormGroup>
            </Form>
        </Modal>
    );
};

const MemberInterfaceChoices = ({ memberChoices, setMemberChoices, model, group }) => {
    return (
        <Stack hasGutter id="network-bridge-settings-interface-members-list">
            {Object.keys(memberChoices).map((iface, idx) => (
                <Checkbox data-iface={iface}
                          id={"network-bridge-settings-interface-members-" + iface}
                          isChecked={memberChoices[iface]}
                          key={iface}
                          label={iface}
                          onChange={checked => setMemberChoices({ ...memberChoices, [iface]: checked })}
                />
            ))}
        </Stack>
    );
};

export const BridgeAction = ({ iface, done, connectionSettings }) => {
    const [isBridgeOpen, setIsBridgeOpen] = useState(false);

    const con = iface && iface.MainConnection;
    const dev = iface && iface.Device;
    const model = useContext(ModelContext);
    const getName = () => {
        let name;
        // Find the first free interface name
        for (let i = 0; i < 100; i++) {
            name = "bridge" + i;
            if (!model.find_interface(name))
                break;
        }
        return name;
    };

    const newIfaceName = !iface ? getName() : undefined;
    const settings = (
        iface
            ? connectionSettings
            : {
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

    return (
        <>
            <Button id="networking-add-bridge"
                    isInline={!!iface}
                    onClick={syn_click(model, setIsBridgeOpen, true)}
                    variant={!iface ? "secondary" : "link"}>
                {!iface ? _("Add bridge") : _("edit")}
            </Button>
            {isBridgeOpen ? <BridgeDialog connection={con}
                                      dev={dev} done={done}
                                      setIsOpen={setIsBridgeOpen}
                                      settings={settings} /> : null}
        </>
    );
};
