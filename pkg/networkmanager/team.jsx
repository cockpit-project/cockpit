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
    Modal,
    Stack,
    TextInput,
} from '@patternfly/react-core';

import { ModalError } from 'cockpit-components-inline-notification.jsx';
import { ModelContext } from './model-context.jsx';

import { v4 as uuidv4 } from 'uuid';
import {
    apply_group_member,
    team_balancer_choices,
    team_runner_choices,
    team_watch_choices,
    connection_devices,
    member_connection_for_interface,
    member_interface_choices,
    settings_applier,
    syn_click,
    with_checkpoint, with_settings_checkpoint,
} from './interfaces.js';

const _ = cockpit.gettext;

const TeamDialog = ({ connection, dev, done, setIsOpen, settings }) => {
    const model = useContext(ModelContext);
    const config = settings.team.config || {};
    if (!config.runner)
        config.runner = { };
    if (!config.runner.name)
        config.runner.name = "activebackup";
    if (!config.link_watch)
        config.link_watch = { };
    if (!config.link_watch.name)
        config.link_watch.name = "ethtool";
    if (config.link_watch.interval === undefined)
        config.link_watch.interval = 100;
    if (config.link_watch.delay_up === undefined)
        config.link_watch.delay_up = 0;
    if (config.link_watch.delay_down === undefined)
        config.link_watch.delay_down = 0;

    const memberChoicesInit = {};

    member_interface_choices(model, connection).forEach((iface) => {
        memberChoicesInit[iface.Name] = !!member_connection_for_interface(connection, iface);
    });

    const [balancer, setBalancer] = useState(config.balancer);
    const [dialogError, setDialogError] = useState(undefined);
    const [iface, setIface] = useState(settings.connection.interface_name);
    const [linkDownDelay, setLinkDownDelay] = useState(config.link_watch.delay_down);
    const [linkWatch, setLinkWatch] = useState(config.link_watch.name);
    const [linkUpDelay, setLinkUpDelay] = useState(config.link_watch.delay_up);
    const [memberChoices, setMemberChoices] = useState(memberChoicesInit);
    const [runner, setRunner] = useState(config.runner.name);
    const [pingTarget, setPingTarget] = useState(config.link_watch.target_host);
    const [pingInterval, setPingInterval] = useState(config.link_watch.interval);
    const [primary, setPrimary] = useState(undefined);

    const onSubmit = (ev) => {
        const createSettingsObj = () => ({
            ...settings,
            connection: {
                ...settings.connection,
                id: iface,
                interface_name: iface,
            },
            team: {
                ...settings.team,
                interface_name: iface,
                config: {
                    ...settings.team.config,
                    link_watch: {
                        name: linkWatch,
                        ...(linkWatch == 'ethtool' && {
                            delay_up: linkUpDelay,
                            delay_down: linkDownDelay,
                        }),
                        ...(linkWatch != 'ethtool' && {
                            interval: pingInterval,
                            target_host: pingTarget,
                        }),
                    },
                    runner: {
                        ...config.runner,
                        name: runner,
                        ...((runner == "loadbalance" || runner == "lacp") && { tx_balancer: balancer == 'none' ? {} : balancer })
                    }
                }
            }
        });

        const apply_settings = settings_applier(model, dev, connection);

        const modify = () => {
            // When all dialogs are ported to React this helper should stop using jquery
            return apply_group_member($('#network-team-settings-body'),
                                      model,
                                      apply_settings,
                                      connection,
                                      createSettingsObj(),
                                      "team")
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
                    fail_text: _("Creating this team will break the connection to the server, and will make the administration UI unavailable."),
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
        <Modal id="network-team-settings-dialog" position="top" variant="medium"
            isOpen
            onClose={() => setIsOpen(false)}
            title={_("Team settings")}
            footer={
                <>
                    {dialogError && <ModalError id="network-team-settings-error" dialogError={_("Failed to apply settings")} dialogErrorDetail={dialogError} />}
                    <Button variant='primary' id="network-team-settings-apply" onClick={onSubmit}>
                        {_("Apply")}
                    </Button>
                    <Button variant='link' id="network-team-settings-cancel" onClick={() => setIsOpen(false)}>
                        {_("Cancel")}
                    </Button>
                </>
            }
        >
            <Form id="network-team-settings-body" onSubmit={onSubmit} isHorizontal>
                <FormGroup fieldId="network-team-settings-interface-name-input" label={_("Name")}>
                    <TextInput id="network-team-settings-interface-name-input" value={iface} onChange={setIface} />
                </FormGroup>
                <FormGroup label={_("Ports")} fieldId="network-team-settings-interface-members-list" hasNoPaddingTop>
                    <MemberInterfaceChoices memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup fieldId="network-team-settings-runner-select" label={_("Runner")}>
                    <FormSelect id="network-team-settings-runner-select" onChange={setRunner}
                                value={runner}>
                        {team_runner_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {(runner == "loadbalance" || runner == "lacp") && <FormGroup fieldId="network-team-settings-balancer-select" label={_("Balancer")}>
                    <FormSelect id="network-team-settings-balancer-select" onChange={setBalancer}
                                value={balancer}>
                        {team_balancer_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>}
                {runner == "active-backup" && <FormGroup fieldId="network-team-settings-primary-select" label={_("Primary")}>
                    <FormSelect id="network-team-settings-primary-select" onChange={setPrimary}
                                value={primary}>
                        <>
                            <FormSelectOption key='-' value={null} label='-' />
                            {Object.keys(memberChoices)
                                    .filter(iface => memberChoices[iface])
                                    .map(iface => <FormSelectOption key={iface} label={iface} value={iface} />)}
                        </>
                    </FormSelect>
                </FormGroup>}
                <FormGroup fieldId="network-team-settings-link-watch-select" label={_("Link watch")}>
                    <FormSelect id="network-team-settings-link-watch-select" onChange={setLinkWatch}
                                value={linkWatch}>
                        {team_watch_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {linkWatch == 'ethtool' && <>
                    <FormGroup fieldId="network-team-settings-link-up-delay-input" label={_("Link up delay")}>
                        <TextInput id="network-team-settings-link-up-delay-input" className="network-number-field" value={linkUpDelay} onChange={setLinkUpDelay} />
                    </FormGroup>
                    <FormGroup fieldId="network-team-settings-link-down-delay-input" label={_("Link down delay")}>
                        <TextInput id="network-team-settings-link-down-delay-input" className="network-number-field" value={linkDownDelay} onChange={setLinkDownDelay} />
                    </FormGroup>
                </>}
                {linkWatch != 'ethtool' && <>
                    <FormGroup fieldId="network-team-settings-ping-interval-input" label={_("Ping interval")}>
                        <TextInput id="network-team-settings-ping-interval-input" className="network-number-field" value={pingInterval} onChange={setPingInterval} />
                    </FormGroup>
                    <FormGroup fieldId="network-team-settings-ping-target-input" label={_("Ping target")}>
                        <TextInput id="network-team-settings-ping-target-input" value={pingTarget} onChange={setPingTarget} />
                    </FormGroup>
                </>}
            </Form>
        </Modal>
    );
};

const MemberInterfaceChoices = ({ memberChoices, setMemberChoices, model, group }) => {
    return (
        <Stack hasGutter id="network-team-settings-interface-members-list">
            {Object.keys(memberChoices).map((iface, idx) => (
                <Checkbox data-iface={iface}
                          id={"network-team-settings-interface-members-" + iface}
                          isChecked={memberChoices[iface]}
                          key={iface}
                          label={iface}
                          onChange={checked => setMemberChoices({ ...memberChoices, [iface]: checked })}
                />
            ))}
        </Stack>
    );
};

export const TeamAction = ({ iface, done, connectionSettings }) => {
    const [isTeamOpen, setIsTeamOpen] = useState(false);
    const [showAddTeam, setShowAddTeam] = useState(undefined);

    useEffect(() => {
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
    }, []);

    const con = iface && iface.MainConnection;
    const dev = iface && iface.Device;
    const model = useContext(ModelContext);
    const getName = () => {
        let name;
        // Find the first free interface name
        for (let i = 0; i < 100; i++) {
            name = "team" + i;
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
                    type: "team",
                    uuid: uuidv4(),
                    interface_name: newIfaceName,
                },
                team: {
                    config: {},
                    interface_name: newIfaceName
                }
            }
    );

    if (!showAddTeam)
        return null;

    return (
        <>
            <Button id="networking-add-team"
                    isInline={!!iface}
                    onClick={syn_click(model, setIsTeamOpen, true)}
                    variant={!iface ? "secondary" : "link"}>
                {!iface ? _("Add team") : _("edit")}
            </Button>
            {isTeamOpen ? <TeamDialog connection={con}
                                      dev={dev} done={done}
                                      setIsOpen={setIsTeamOpen}
                                      settings={settings} /> : null}
        </>
    );
};
