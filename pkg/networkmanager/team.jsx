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

import { MemberInterfaceChoices, NetworkModal, Name, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

import { v4 as uuidv4 } from 'uuid';
import {
    member_connection_for_interface,
    member_interface_choices,
} from './interfaces.js';

const _ = cockpit.gettext;

export const team_runner_choices =
    [
        { choice: 'roundrobin', title: _("Round robin") },
        { choice: 'activebackup', title: _("Active backup") },
        { choice: 'loadbalance', title: _("Load balancing") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: 'lacp', title: _("802.3ad LACP") },
    ];

export const team_balancer_choices =
    [
        { choice: 'none', title: _("Passive") },
        { choice: 'basic', title: _("Active") }
    ];

export const team_watch_choices =
    [
        { choice: 'ethtool', title: _("Ethtool") },
        { choice: 'arp-ping', title: _("ARP ping") },
        { choice: 'nsna-ping', title: _("NSNA ping") }
    ];

export const TeamDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-team-settings";
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
                      idPrefix={idPrefix}
                      onSubmit={onSubmit}
                      title={_("Team settings")}
        >
            <>
                <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
                <FormGroup label={_("Ports")} fieldId={idPrefix + "-interface-members-list"} hasNoPaddingTop>
                    <MemberInterfaceChoices idPrefix={idPrefix} memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup fieldId={idPrefix + "-runner-select"} label={_("Runner")}>
                    <FormSelect id={idPrefix + "-runner-select"} onChange={(_, val) => setRunner(val)}
                                value={runner}>
                        {team_runner_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {(runner == "loadbalance" || runner == "lacp") && <FormGroup fieldId={idPrefix + "-balancer-select"} label={_("Balancer")}>
                    <FormSelect id={idPrefix + "-balancer-select"} onChange={(_, val) => setBalancer(val)}
                                value={balancer}>
                        {team_balancer_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>}
                {runner == "active-backup" && <FormGroup fieldId={idPrefix + "-primary-select"} label={_("Primary")}>
                    <FormSelect id={idPrefix + "-primary-select"} onChange={(_, val) => setPrimary(val)}
                                value={primary}>
                        <>
                            <FormSelectOption key='-' value={null} label='-' />
                            {Object.keys(memberChoices)
                                    .filter(iface => memberChoices[iface])
                                    .map(iface => <FormSelectOption key={iface} label={iface} value={iface} />)}
                        </>
                    </FormSelect>
                </FormGroup>}
                <FormGroup fieldId={idPrefix + "-link-watch-select"} label={_("Link watch")}>
                    <FormSelect id={idPrefix + "-link-watch-select"} onChange={(_, val) => setLinkWatch(val)}
                                value={linkWatch}>
                        {team_watch_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {linkWatch == 'ethtool' && <>
                    <FormGroup fieldId={idPrefix + "-link-up-delay-input"} label={_("Link up delay")}>
                        <TextInput id={idPrefix + "-link-up-delay-input"} className="network-number-field" value={linkUpDelay} onChange={(_event, value) => setLinkUpDelay(value)} />
                    </FormGroup>
                    <FormGroup fieldId={idPrefix + "-link-down-delay-input"} label={_("Link down delay")}>
                        <TextInput id={idPrefix + "-link-down-delay-input"} className="network-number-field" value={linkDownDelay} onChange={(_event, value) => setLinkDownDelay(value)} />
                    </FormGroup>
                </>}
                {linkWatch != 'ethtool' && <>
                    <FormGroup fieldId={idPrefix + "-ping-interval-input"} label={_("Ping interval")}>
                        <TextInput id={idPrefix + "-ping-interval-input"} className="network-number-field" value={pingInterval} onChange={(_event, value) => setPingInterval(value)} />
                    </FormGroup>
                    <FormGroup fieldId={idPrefix + "-ping-target-input"} label={_("Ping target")}>
                        <TextInput id={idPrefix + "-ping-target-input"} value={pingTarget} onChange={(_event, value) => setPingTarget(value)} />
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
