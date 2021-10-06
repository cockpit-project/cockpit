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

import React, { useContext, useEffect, useState } from 'react';
import cockpit from 'cockpit';

import { Button, Checkbox, Form, FormGroup, Modal, Stack, TextInput } from '@patternfly/react-core';

import { BondDialog, getGhostSettings as getBondGhostSettings } from './bond.jsx';
import { BridgeDialog, getGhostSettings as getBridgeGhostSettings } from './bridge.jsx';
import { TeamDialog, getGhostSettings as getTeamGhostSettings } from './team.jsx';
import { VlanDialog, getGhostSettings as getVlanGhostSettings } from './vlan.jsx';
import { MtuDialog } from './mtu.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';

import {
    apply_group_member,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
    connection_devices,
    settings_applier,
} from './interfaces.js';
import { reactivateConnection } from './network-interface.jsx';

const _ = cockpit.gettext;

export const MemberInterfaceChoices = ({ idPrefix, memberChoices, setMemberChoices, model, group }) => {
    return (
        <Stack hasGutter id={idPrefix + "-interface-members-list"}>
            {Object.keys(memberChoices).map((iface, idx) => (
                <Checkbox data-iface={iface}
                          id={idPrefix + "-interface-members-" + iface}
                          isChecked={memberChoices[iface]}
                          key={iface}
                          label={iface}
                          onChange={checked => setMemberChoices({ ...memberChoices, [iface]: checked })}
                />
            ))}
        </Stack>
    );
};

export const Name = ({ idPrefix, iface, setIface }) => {
    return (
        <FormGroup fieldId={idPrefix + "-interface-name-input"} label={_("Name")}>
            <TextInput id={idPrefix + "-interface-name-input"} value={iface} onChange={setIface} />
        </FormGroup>
    );
};

export const NetworkModal = ({ dialogError, help, idPrefix, setIsOpen, title, onSubmit, children }) => {
    return (
        <Modal id={idPrefix + "-dialog"} position="top" variant="medium"
            isOpen
            help={help}
            onClose={() => setIsOpen(false)}
            title={title}
            footer={
                <>
                    {dialogError && <ModalError id={idPrefix + "-error"} dialogError={_("Failed to apply settings")} dialogErrorDetail={dialogError} />}
                    <Button variant='primary' id={idPrefix + "-apply"} onClick={onSubmit}>
                        {_("Apply")}
                    </Button>
                    <Button variant='link' id={idPrefix + "-cancel"} onClick={() => setIsOpen(false)}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id={idPrefix + "-body"} onSubmit={onSubmit} isHorizontal>
                {children}
            </Form>
        </Modal>
    );
};

export const NetworkAction = ({ addButtonText, iface, connectionSettings, type }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [showAddTeam, setShowAddTeam] = useState(undefined);
    const model = useContext(ModelContext);

    useEffect(() => {
        if (type != "team")
            return;

        /* HACK - hide "Add team" if it doesn't work due to missing bits
         * https://bugzilla.redhat.com/show_bug.cgi?id=1375967
         * We need both the plugin and teamd
         */
        cockpit.script("test -f /usr/bin/teamd && " +
                       "( test -f /usr/lib*/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib*/NetworkManager/*/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/*/libnm-device-plugin-team.so)",
                       { err: "ignore" })
                .then(() => setShowAddTeam(true))
                .fail(() => setShowAddTeam(false));
    }, [type]);

    if (type == "team" && !showAddTeam)
        return null;

    const con = iface && iface.MainConnection;
    const dev = iface && iface.Device;

    const getName = () => {
        let name;
        // Find the first free interface name
        for (let i = 0; i < 100; i++) {
            name = type + i;
            if (!model.find_interface(name))
                break;
        }
        return name;
    };

    const newIfaceName = !iface ? getName() : undefined;

    let settings = connectionSettings;
    if (!settings) {
        if (type == 'bond') settings = getBondGhostSettings({ newIfaceName });
        if (type == 'vlan') settings = getVlanGhostSettings();
        if (type == 'team') settings = getTeamGhostSettings({ newIfaceName });
        if (type == 'bridge') settings = getBridgeGhostSettings({ newIfaceName });
    }

    const properties = { connection: con, dev, setIsOpen, settings };

    return (
        <>
            <Button id={"networking-add-" + type}
                    isInline={!!iface}
                    onClick={syn_click(model, setIsOpen, true)}
                    variant={!iface ? "secondary" : "link"}>
                {!iface ? addButtonText : _("edit")}
            </Button>
            {isOpen && type == 'bond' ? <BondDialog {...properties} /> : null}
            {isOpen && type == 'vlan' ? <VlanDialog {...properties} /> : null}
            {isOpen && type == 'team' ? <TeamDialog {...properties} /> : null}
            {isOpen && type == 'bridge' ? <BridgeDialog {...properties} /> : null}
            {isOpen && type == 'mtu' ? <MtuDialog {...properties} /> : null}
        </>
    );
};

export const dialogApply = ({ model, dev, connection, members, membersInit, settings, setDialogError, setIsOpen }) => {
    const apply_settings = settings_applier(model, dev, connection);
    const iface = settings.connection.interface_name;
    const type = settings.connection.type;
    const done = () => reactivateConnection({ con: connection, dev });
    const membersChanged = members ? Object.keys(membersInit).some(iface => membersInit[iface] != members[iface]) : false;

    const modify = () => {
        return ((members !== undefined)
            ? apply_group_member(members,
                                 model,
                                 apply_settings,
                                 connection,
                                 settings,
                                 type)
            : apply_settings(settings))
                .then(() => {
                    setIsOpen(false);
                    if (connection)
                        cockpit.location.go([iface]);
                    if (dev)
                        return done();
                })
                .catch(ex => setDialogError(typeof ex === 'string' ? ex : ex.message));
    };
    if (connection) {
        with_settings_checkpoint(model, modify,
                                 {
                                     ...(type != 'vlan' && {
                                         devices: (membersChanged ? [] : connection_devices(connection))
                                     }),
                                     hack_does_add_or_remove: type == 'vlan' || membersChanged,
                                     rollback_on_failure: type !== 'vlan' && membersChanged
                                 });
    } else {
        with_checkpoint(
            model,
            modify,
            {
                fail_text: cockpit.format(_("Creating this $0 will break the connection to the server, and will make the administration UI unavailable."), type == 'vlan' ? 'VLAN' : type),
                anyway_text: _("Create it"),
                hack_does_add_or_remove: true,
                rollback_on_failure: type != 'vlan',
            });
    }
};
