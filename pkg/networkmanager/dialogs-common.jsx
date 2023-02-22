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

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { Form, FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { Modal } from "@patternfly/react-core/dist/esm/components/Modal/index.js";
import { Select, SelectOption, SelectVariant } from "@patternfly/react-core/dist/esm/components/Select/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";

import { BondDialog, getGhostSettings as getBondGhostSettings } from './bond.jsx';
import { BridgeDialog, getGhostSettings as getBridgeGhostSettings } from './bridge.jsx';
import { BridgePortDialog } from './bridgeport.jsx';
import { IpSettingsDialog } from './ip-settings.jsx';
import { TeamDialog, getGhostSettings as getTeamGhostSettings } from './team.jsx';
import { TeamPortDialog } from './teamport.jsx';
import { VlanDialog, getGhostSettings as getVlanGhostSettings } from './vlan.jsx';
import { MtuDialog } from './mtu.jsx';
import { MacDialog } from './mac.jsx';
import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

import {
    apply_group_member,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
    connection_devices,
    settings_applier,
    show_unexpected_error,
} from './interfaces.js';

const _ = cockpit.gettext;
// nm-dbus-interface.h
const NM_CAPABILITY_TEAM = 1;

export const MacMenu = ({ idPrefix, model, mac, setMAC }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [optionsMap, setOptionsMap] = useState([]);

    useEffect(() => {
        const optionsMapInit = [];

        model.list_interfaces().forEach(iface => {
            if (iface.Device && iface.Device.HwAddress && iface.Device.HwAddress !== "00:00:00:00:00:00") {
                optionsMapInit.push({
                    toString: () => cockpit.format("$0 ($1)", iface.Device.HwAddress, iface.Name),
                    value: iface.Device.HwAddress
                });
            }
        });
        optionsMapInit.push(
            { toString: () => _("Permanent"), value: "permanent" },
            { toString: () => _("Preserve"), value: "preserve" },
            { toString: () => _("Random"), value: "random" },
            { toString: () => _("Stable"), value: "stable" },
        );
        setOptionsMap(optionsMapInit);
    }, [model]);

    const clearSelection = () => {
        setMAC(undefined);
        setIsOpen(false);
    };

    const onSelect = (_, selection) => {
        if (typeof selection == 'object')
            setMAC(selection.value);
        else
            setMAC(selection);
        setIsOpen(false);
    };

    const onCreateOption = newValue => {
        setOptionsMap([...optionsMap, { value: newValue, toString: () => newValue }]);
    };

    return (
        <Select createText={_("Use")}
                isCreatable
                isOpen={isOpen}
                menuAppendTo={() => document.body}
                onClear={clearSelection}
                onCreateOption={onCreateOption}
                onSelect={onSelect}
                onToggle={value => setIsOpen(value)}
                selections={optionsMap.find(option => option.value == mac)}
                variant={SelectVariant.typeahead}
                toggleId={idPrefix + "-mac-input"}
        >
            {optionsMap.map((option, index) => (
                <SelectOption key={index}
                              value={option}
                />
            ))}
        </Select>
    );
};

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

export const NetworkModal = ({ dialogError, help, idPrefix, title, onSubmit, children, isFormHorizontal }) => {
    const Dialogs = useDialogs();

    return (
        <Modal id={idPrefix + "-dialog"} position="top" variant="medium"
            isOpen
            help={help}
            onClose={Dialogs.close}
            title={title}
            footer={
                <>
                    <Button variant='primary' id={idPrefix + "-save"} onClick={onSubmit}>
                        {_("Save")}
                    </Button>
                    <Button variant='link' id={idPrefix + "-cancel"} onClick={Dialogs.close}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id={idPrefix + "-body"} onSubmit={onSubmit} isHorizontal={isFormHorizontal !== false}>
                {dialogError && <ModalError id={idPrefix + "-error"} dialogError={_("Failed to save settings")} dialogErrorDetail={dialogError} />}
                {children}
            </Form>
        </Modal>
    );
};

export const NetworkAction = ({ buttonText, iface, connectionSettings, type }) => {
    const Dialogs = useDialogs();
    const model = useContext(ModelContext);

    if (type == "team" && !model.get_manager().Capabilities.includes(NM_CAPABILITY_TEAM))
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

    const properties = { connection: con, dev, settings };

    function show() {
        let dlg = null;
        if (type == 'bond')
            dlg = <BondDialog {...properties} />;
        else if (type == 'vlan')
            dlg = <VlanDialog {...properties} />;
        else if (type == 'team')
            dlg = <TeamDialog {...properties} />;
        else if (type == 'bridge')
            dlg = <BridgeDialog {...properties} />;
        else if (type == 'mtu')
            dlg = <MtuDialog {...properties} />;
        else if (type == 'mac')
            dlg = <MacDialog {...properties} />;
        else if (type == 'teamport')
            dlg = <TeamPortDialog {...properties} />;
        else if (type == 'bridgeport')
            dlg = <BridgePortDialog {...properties} />;
        else if (type == 'ipv4')
            dlg = <IpSettingsDialog topic="ipv4" {...properties} />;
        else if (type == 'ipv6')
            dlg = <IpSettingsDialog topic="ipv6" {...properties} />;
        if (dlg)
            Dialogs.show(dlg);
    }

    return (
        <>
            <Button id={"networking-" + (!iface ? "add-" : "edit-") + type}
                    isInline={!!iface}
                    onClick={syn_click(model, show)}
                    variant={!iface ? "secondary" : "link"}>
                {buttonText || _("edit")}
            </Button>
        </>
    );
};

function reactivateConnection({ con, dev }) {
    if (con.Settings.connection.interface_name &&
        con.Settings.connection.interface_name != dev.Interface) {
        return dev.disconnect().then(function () { return con.activate(null, null) })
                .fail(show_unexpected_error);
    } else {
        return con.activate(dev, null)
                .fail(show_unexpected_error);
    }
}

export const dialogSave = ({ model, dev, connection, members, membersInit, settings, setDialogError, onClose }) => {
    const apply_settings = settings_applier(model, dev, connection);
    const iface = settings.connection.interface_name;
    const type = settings.connection.type;
    const membersChanged = members ? Object.keys(membersInit).some(iface => membersInit[iface] != members[iface]) : false;

    model.set_operation_in_progress(true);

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
                    onClose();
                    if (connection)
                        cockpit.location.go([iface]);
                    if (connection && dev && dev.ActiveConnection && dev.ActiveConnection.Connection === connection)
                        return reactivateConnection({ con: connection, dev });
                })
                .catch(ex => setDialogError(typeof ex === 'string' ? ex : ex.message))
                .then(() => model.set_operation_in_progress(false));
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
