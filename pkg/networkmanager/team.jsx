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
    FormGroup,
    FormSelect, FormSelectOption,
    TextInput,
} from '@patternfly/react-core';

import { MemberInterfaceChoices, NetworkModal, Name, dialogApply } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';

import { v4 as uuidv4 } from 'uuid';
import {
    team_balancer_choices,
    team_runner_choices,
    team_watch_choices,
    member_connection_for_interface,
    member_interface_choices,
} from './interfaces.js';

const _ = cockpit.gettext;

export const TeamDialog = ({ connection, dev, setIsOpen, settings }) => {
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

        dialogApply({
            model,
            dev,
            connection,
            members: memberChoices,
            membersInit: memberChoicesInit,
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
                      idPrefix="network-team-settings"
                      onSubmit={onSubmit}
                      setIsOpen={setIsOpen}
                      title={_("Team settings")}
        >
            <>
                <Name idPrefix="network-team-settings" iface={iface} setIface={setIface} />
                <FormGroup label={_("Ports")} fieldId="network-team-settings-interface-members-list" hasNoPaddingTop>
                    <MemberInterfaceChoices idPrefix="network-team-settings" memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
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
};
