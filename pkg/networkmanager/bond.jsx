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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState, useContext } from 'react';
import cockpit from 'cockpit';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { FormGroup } from "@patternfly/react-core/dist/esm/components/Form/index.js";
import { FormSelect, FormSelectOption } from "@patternfly/react-core/dist/esm/components/FormSelect/index.js";
import { Popover } from "@patternfly/react-core/dist/esm/components/Popover/index.js";
import { TextInput } from "@patternfly/react-core/dist/esm/components/TextInput/index.js";
import { ExternalLinkSquareAltIcon, HelpIcon } from '@patternfly/react-icons';

import { MacMenu, MemberInterfaceChoices, NetworkModal, Name, dialogSave } from './dialogs-common.jsx';
import { ModelContext } from './model-context.jsx';
import { useDialogs } from "dialogs.jsx";

import { v4 as uuidv4 } from 'uuid';
import {
    member_connection_for_interface,
    member_interface_choices,
} from './interfaces.js';

const _ = cockpit.gettext;

export const bond_mode_choices =
    [
        { choice: 'balance-rr', title: _("Round robin") },
        { choice: 'active-backup', title: _("Active backup") },
        { choice: 'balance-xor', title: _("XOR") },
        { choice: 'broadcast', title: _("Broadcast") },
        { choice: '802.3ad', title: _("802.3ad") },
        { choice: 'balance-tlb', title: _("Adaptive transmit load balancing") },
        { choice: 'balance-alb', title: _("Adaptive load balancing") }
    ];

const bond_monitoring_choices =
    [
        { choice: 'mii', title: _("MII (recommended)") },
        { choice: 'arp', title: _("ARP") }
    ];

export const BondDialog = ({ connection, dev, settings }) => {
    const Dialogs = useDialogs();
    const idPrefix = "network-bond-settings";
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
                    ...(mode == "active-backup" && { primary })
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
                      title={!connection ? _("Add bond") : _("Edit bond settings")}
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
                                          href="https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_and_managing_networking/configuring-network-bonding_configuring-and-managing-networking#proc_configuring-a-network-bond-by-using-the-rhel-web-console_configuring-network-bonding">
                                      {_("Learn more")}
                                  </Button>
                              }
                          >
                              <Button id="bond-help-popup-button" variant="plain" aria-label="Help">
                                  <HelpIcon />
                              </Button>
                          </Popover>
                      }
                      isCreateDialog={!connection}
        >
            <>
                <Name idPrefix={idPrefix} iface={iface} setIface={setIface} />
                <FormGroup label={_("Interfaces")} fieldId={idPrefix + "-interface-members-list"} hasNoPaddingTop>
                    <MemberInterfaceChoices idPrefix={idPrefix} memberChoices={memberChoices} setMemberChoices={setMemberChoices} model={model} group={connection} />
                </FormGroup>
                <FormGroup fieldId={idPrefix + "-mac-input"} label={_("MAC")}>
                    <MacMenu idPrefix={idPrefix} model={model} mac={mac} setMAC={setMAC} />
                </FormGroup>
                <FormGroup fieldId={idPrefix + "-mode-select"} label={_("Mode")}>
                    <FormSelect id={idPrefix + "-mode-select"} onChange={(_, val) => setMode(val)}
                                value={mode}>
                        {bond_mode_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                {mode == "active-backup" && <FormGroup fieldId={idPrefix + "-primary-select"} label={_("Primary")}>
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
                <FormGroup fieldId={idPrefix + "-link-monitoring-select"} label={_("Link monitoring")}>
                    <FormSelect id={idPrefix + "-link-monitoring-select"} onChange={(_, val) => setLinkMonitoring(val)}
                                value={linkMonitoring}>
                        {bond_monitoring_choices.map(choice => <FormSelectOption value={choice.choice} label={choice.title} key={choice.choice} />)}
                    </FormSelect>
                </FormGroup>
                <FormGroup fieldId={idPrefix + "-link-monitoring-interval-input"} label={_("Monitoring interval")}>
                    <TextInput id={idPrefix + "-link-monitoring-interval-input"} className="network-number-field" value={linkMonitoringInterval} onChange={(_event, value) => setLinkMonitoringInterval(value)} />
                </FormGroup>
                {linkMonitoring == 'mii' && <>
                    <FormGroup fieldId={idPrefix + "-link-up-delay-input"} label={_("Link up delay")}>
                        <TextInput id={idPrefix + "-link-up-delay-input"} className="network-number-field" value={linkUpDelay} onChange={(_event, value) => setLinkUpDelay(value)} />
                    </FormGroup>
                    <FormGroup fieldId={idPrefix + "-link-down-delay-input"} label={_("Link down delay")}>
                        <TextInput id={idPrefix + "-link-down-delay-input"} className="network-number-field" value={linkDownDelay} onChange={(_event, value) => setLinkDownDelay(value)} />
                    </FormGroup>
                </>}
                {linkMonitoring == 'arp' && <FormGroup fieldId={idPrefix + "-monitoring-targets-input"} label={_("Monitoring targets")}>
                    <TextInput id={idPrefix + "-monitoring-targets-input"} value={monitoringTargets} onChange={(_event, value) => setMonitoringTargets(value)} />
                </FormGroup>}
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
};
