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
import React, { useState, useContext, useEffect } from 'react';
import cockpit from 'cockpit';
import {
    Button,
    Checkbox,
    Form, FormGroup,
    FormSelect, FormSelectOption,
    Modal, Popover,
    Select, SelectOption, SelectVariant,
    Stack,
    TextInput,
} from '@patternfly/react-core';
import { ExternalLinkSquareAltIcon, HelpIcon } from '@patternfly/react-icons';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';

import { v4 as uuidv4 } from 'uuid';
import {
    apply_group_member,
    bond_mode_choices, bond_monitoring_choices,
    connection_devices,
    member_connection_for_interface,
    member_interface_choices,
    settings_applier,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
} from './interfaces.js';

const _ = cockpit.gettext;

const BondDialog = ({ connection, dev, done, setIsOpen, settings }) => {
    const model = useContext(ModelContext);
    const options = settings.bond.options;

    const memberChoicesInit = {};

    member_interface_choices(model, connection).forEach((iface) => {
        memberChoicesInit[iface.Name] = !!member_connection_for_interface(connection, iface);
    });

    const [dialogError, setDialogError] = useState(undefined);
    const [iface, setIface] = useState(settings.connection.interface_name);
    const [linkDownDelay, setLinkDownDelay] = useState(options.downdelay || "0");
    const [linkMonitoring, setLinkMonitoring] = useState(options.arp_interval ? "arp" : "mii");
    const [linkMonitoringInterval, setLinkMonitoringInterval] = useState(options.miimon || options.arp_interval || "100");
    const [linkUpDelay, setLinkUpDelay] = useState(options.updelay || "0");
    const [mac, setMAC] = useState((settings.ethernet && settings.ethernet.assigned_mac_address) || "");
    const [memberChoices, setMemberChoices] = useState(memberChoicesInit);
    const [mode, setMode] = useState(options.mode);
    const [monitoringTargets, setMonitoringTargets] = useState(options.arp_ip_target);
    const [primary, setPrimary] = useState(undefined);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            connection: {
                ...settings.connection,
                id: iface,
                interface_name: iface,
            },
            ethernet: {
                assigned_mac_address: mac
            },
            bond: {
                ...settings.bond,
                interface_name: iface,
                options: {
                    ...settings.bond.options,
                    mode,
                    ...(linkMonitoring == 'mii' && {
                        miimon: linkMonitoringInterval,
                        updelay: linkUpDelay,
                        downdelay: linkDownDelay,
                    }),
                    ...(linkMonitoring === 'arp' && {
                        arp_interval: linkMonitoringInterval,
                        arp_ip_target: monitoringTargets,
                    }),
                    ...(mode == "active-backup" && { primary: primary })
                }
            }
        });

        const apply_settings = settings_applier(model, dev, connection);

        const modify = () => {
            // When all dialogs are ported to React this helper should stop using jquery
            return apply_group_member($('#network-bond-settings-body'),
                                      model,
                                      apply_settings,
                                      connection,
                                      createSettingsObj(),
                                      "bond")
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
                    fail_text: _("Creating this bond will break the connection to the server, and will make the administration UI unavailable."),
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
        <Modal id="network-bond-settings-dialog" position="top" variant="medium"
            isOpen
            onClose={() => setIsOpen(false)}
            title={_("Bond settings")}
            help={
                <Popover
                    headerContent={_("Network bond")}
                    id="bond-help"
                    bodyContent={
                        <div>
                            {_("A network bond combines multiple network interfaces into one logical interface with higher throughput or redundancy.")}
                        </div>
                    }
                    footerContent={
                        <Button component='a'
                                rel="noopener noreferrer" target="_blank"
                                variant='link'
                                isInline
                                icon={<ExternalLinkSquareAltIcon />} iconPosition="right"
                                href="https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/managing_systems_using_the_rhel_8_web_console/configuring-network-bonds-using-the-web-console_system-management-using-the-rhel-8-web-console">
                            {_("Learn more")}
                        </Button>
                    }
                >
                    <Button id="bond-help-popup-button" variant="plain" aria-label="Help">
                        <HelpIcon />
                    </Button>
                </Popover>
            }
            footer={
                <>
                    {dialogError && <ModalError id="network-bond-settings-error" dialogError={_("Failed to apply settings")} dialogErrorDetail={dialogError} />}
                    <Button variant='primary' id="network-bond-settings-apply" onClick={onSubmit}>
                        {_("Apply")}
                    </Button>
                    <Button variant='link' id="network-bond-settings-cancel" onClick={() => setIsOpen(false)}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id="network-bond-settings-body" onSubmit={onSubmit} isHorizontal>
                <FormGroup fieldId="network-bond-settings-interface-name-input" label={_("Name")}>
                    <TextInput id="network-bond-settings-interface-name-input" value={iface} onChange={setIface} />
                </FormGroup>
                <FormGroup label={_("Interfaces")} fieldId="network-bond-settings-interface-members-lis" hasNoPaddingTop>
                    <MemberInterfaceChoices memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup fieldId="network-bond-settings-mac-input" label={_("MAC")}>
                    <MacMenu model={model} mac={mac} setMAC={setMAC} />
                </FormGroup>
                <FormGroup fieldId="network-bond-settings-mode-select" label={_("Mode")}>
                    <FormSelect id="network-bond-settings-mode-select" onChange={setMode}
                                value={mode}>
                        {bond_mode_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {mode == "active-backup" && <FormGroup fieldId="network-bond-settings-primary-select" label={_("Primary")}>
                    <FormSelect id="network-bond-settings-primary-select" onChange={setPrimary}
                                value={primary}>
                        <>
                            <FormSelectOption key='-' value={null} label='-' />
                            {Object.keys(memberChoices)
                                    .filter(iface => memberChoices[iface])
                                    .map(iface => <FormSelectOption key={iface} label={iface} value={iface} />)}
                        </>
                    </FormSelect>
                </FormGroup>}
                <FormGroup fieldId="network-bond-settings-link-monitoring-select" label={_("Link monitoring")}>
                    <FormSelect id="network-bond-settings-link-monitoring-select" onChange={setLinkMonitoring}
                                value={linkMonitoring}>
                        {bond_monitoring_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                <FormGroup fieldId="network-bond-settings-link-monitoring-interval-input" label={_("Monitoring interval")}>
                    <TextInput id="network-bond-settings-link-monitoring-interval-input" className="network-number-field" value={linkMonitoringInterval} onChange={setLinkMonitoringInterval} />
                </FormGroup>
                {linkMonitoring == 'mii' && <>
                    <FormGroup fieldId="network-bond-settings-link-up-delay-input" label={_("Link up delay")}>
                        <TextInput id="network-bond-settings-link-up-delay-input" className="network-number-field" value={linkUpDelay} onChange={setLinkUpDelay} />
                    </FormGroup>
                    <FormGroup fieldId="network-bond-settings-link-down-delay-input" label={_("Link down delay")}>
                        <TextInput id="network-bond-settings-link-down-delay-input" className="network-number-field" value={linkDownDelay} onChange={setLinkDownDelay} />
                    </FormGroup>
                </>}
                {linkMonitoring == 'arp' && <FormGroup fieldId="network-bond-settings-monitoring-targets-input" label={_("Monitoring targets")}>
                    <TextInput id="network-bond-settings-monitoring-targets-input" value={monitoringTargets} onChange={setMonitoringTargets} />
                </FormGroup>}
            </Form>
        </Modal>
    );
};

const MacMenu = ({ model, mac, setMAC }) => {
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
            { toString: () => _("Perserve"), value: "preserve" },
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
                selections={optionsMap.find(option => option.value == mac) || mac}
                variant={SelectVariant.typeahead}
                toggleId="network-bond-settings-mac-input"
        >
            {optionsMap.map((option, index) => (
                <SelectOption key={index}
                              value={option}
                />
            ))}
        </Select>
    );
};

const MemberInterfaceChoices = ({ memberChoices, setMemberChoices, model, group }) => {
    return (
        <Stack hasGutter id="network-bond-settings-interface-members-list">
            {Object.keys(memberChoices).map((iface, idx) => (
                <Checkbox data-iface={iface}
                          id={"network-bond-settings-interface-members-" + iface}
                          isChecked={memberChoices[iface]}
                          key={iface}
                          label={iface}
                          onChange={checked => setMemberChoices({ ...memberChoices, [iface]: checked })}
                />
            ))}
        </Stack>
    );
};

export const BondAction = ({ iface, done, connectionSettings }) => {
    const [isBondOpen, setIsBondOpen] = useState(false);

    const con = iface && iface.MainConnection;
    const dev = iface && iface.Device;
    const model = useContext(ModelContext);
    const getName = () => {
        let name;
        // Find the first free interface name
        for (let i = 0; i < 100; i++) {
            name = "bond" + i;
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
                    type: "bond",
                    uuid: uuidv4(),
                    interface_name: newIfaceName,
                },
                bond: {
                    options: {
                        mode: "active-backup"
                    },
                    interface_name: newIfaceName
                }
            }
    );

    return (
        <>
            <Button id="networking-add-bond"
                    isInline={!!iface}
                    onClick={syn_click(model, setIsBondOpen, true)}
                    variant={!iface ? "secondary" : "link"}>
                {!iface ? _("Add bond") : _("edit")}
            </Button>
            {isBondOpen ? <BondDialog connection={con}
                                      dev={dev} done={done}
                                      setIsOpen={setIsBondOpen}
                                      settings={settings} /> : null}
        </>
    );
};
