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
    Button,
    Form, FormGroup,
    FormSelect, FormSelectOption,
    Modal,
    TextInput,
} from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';

import { v4 as uuidv4 } from 'uuid';
import {
    is_interface_connection,
    is_interesting_interface,
    settings_applier,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
} from './interfaces.js';

const _ = cockpit.gettext;

const VlanDialog = ({ connection, dev, done, setIsOpen, settings }) => {
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

        const apply_settings = settings_applier(model, dev, connection);

        const modify = () => {
            return apply_settings(createSettingsObj())
                    .then(() => {
                        setIsOpen(false);
                        if (connection)
                            cockpit.location.go([iface]);
                        if (done)
                            return done();
                    })
                    .catch(ex => setDialogError(ex.message));
        };

        if (connection) {
            with_settings_checkpoint(model, modify, { hack_does_add_or_remove: true });
        } else {
            with_checkpoint(
                model,
                modify,
                {
                    fail_text: _("Creating this vlan will break the connection to the server, and will make the administration UI unavailable."),
                    anyway_text: _("Create it"),
                    hack_does_add_or_remove: true,
                });
        }

        // Prevent dialog from closing because of <form> onsubmit event
        if (event)
            event.preventDefault();

        return false;
    };

    return (
        <Modal id="network-vlan-settings-dialog" position="top" variant="medium"
            isOpen
            onClose={() => setIsOpen(false)}
            title={_("VLAN settings")}
            footer={
                <>
                    {dialogError && <ModalError id="network-vlan-settings-error" dialogError={_("Failed to apply settings")} dialogErrorDetail={dialogError} />}
                    <Button variant='primary' id="network-vlan-settings-apply" onClick={onSubmit}>
                        {_("Apply")}
                    </Button>
                    <Button variant='link' id="network-vlan-settings-cancel" onClick={() => setIsOpen(false)}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id="network-vlan-settings-body" onSubmit={onSubmit} isHorizontal>
                <FormGroup fieldId="network-vlan-settings-parent-select" label={_("Parent")}>
                    <FormSelect id="network-vlan-settings-parent-select" onChange={value => {
                        setParent(value);
                        if (iface == (parent + "." + vlanId))
                            setIface(value + "." + vlanId);
                    }}
                                value={parent}>
                        {parentChoices.map(choice => <FormSelectOption value={choice} label={choice} key={choice} />)}
                    </FormSelect>
                </FormGroup>
                <FormGroup fieldId="network-vlan-settings-vlan-id-input" label={_("VLAN ID")}>
                    <TextInput id="network-vlan-settings-vlan-id-input" value={vlanId} onChange={value => {
                        setVlanId(value);
                        if (iface == (parent + "." + vlanId))
                            setIface(parent + "." + value);
                    }} />
                </FormGroup>
                <FormGroup fieldId="network-vlan-settings-interface-name-input" label={_("Name")}>
                    <TextInput id="network-vlan-settings-interface-name-input" value={iface} onChange={setIface} />
                </FormGroup>
            </Form>
        </Modal>
    );
};

export const VlanAction = ({ iface, done, connectionSettings }) => {
    const [isVlanOpen, setIsVlanOpen] = useState(false);

    const con = iface && iface.MainConnection;
    const dev = iface && iface.Device;
    const model = useContext(ModelContext);

    const settings = (
        iface
            ? connectionSettings
            : {
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

    return (
        <>
            <Button id="networking-add-vlan"
                    isInline={!!iface}
                    onClick={syn_click(model, setIsVlanOpen, true)}
                    variant={!iface ? "secondary" : "link"}>
                {!iface ? _("Add VLAN") : _("edit")}
            </Button>
            {isVlanOpen ? <VlanDialog connection={con}
                                      dev={dev} done={done}
                                      setIsOpen={setIsVlanOpen}
                                      settings={settings} /> : null}
        </>
    );
};
