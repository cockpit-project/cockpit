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
import cockpit from "cockpit";
import React from 'react';

import {
    Button,
} from "@patternfly/react-core";

import {
    PageNetworkBondSettings,
    PageNetworkBridgeSettings,
    PageNetworkTeamSettings,
    PageNetworkVlanSettings,
    settings_applier,
    syn_click,
} from './interfaces.js';
import { ModelContext } from './model-context.jsx';
import { v4 as uuidv4 } from 'uuid';

const _ = cockpit.gettext;

export class NetworkPageDialogs extends React.Component {
    constructor(props, context) {
        super(props, context);
        this.state = {
            /* HACK - hide "Add team" if it doesn't work due to missing bits
             * https://bugzilla.redhat.com/show_bug.cgi?id=1375967
             */
            showAddTeam: undefined,
        };
        this.addBond = this.addBond.bind(this);
        this.addBridge = this.addBridge.bind(this);
        this.addTeam = this.addTeam.bind(this);
        this.addVlan = this.addVlan.bind(this);

        this.model = context;
    }

    componentDidMount() {
        // We need both the plugin and teamd
        cockpit.script("test -f /usr/bin/teamd && " +
                       "( test -f /usr/lib*/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib*/NetworkManager/*/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/libnm-device-plugin-team.so || " +
                       "  test -f /usr/lib/*-linux-gnu/NetworkManager/*/libnm-device-plugin-team.so)",
                       { err: "ignore" })
                .done(() => {
                    this.setState({ showAddTeam: true });
                })
                .fail(() => {
                    this.setState({ showAddTeam: false });
                });

        const desc = _("A network bond combines multiple network interfaces into one logical interface with higher throughput or redundancy.");
        const lm = _("Learn more");
        const url = "https://access.redhat.com/documentation/en-us/red_hat_enterprise_linux/8/html/managing_systems_using_the_rhel_8_web_console/managing-networking-in-the-web-console_system-management-using-the-rhel-8-web-console#configuring-network-bonds-using-the-web-console_managing-networking-in-the-web-console";
        const popover_content = desc + ' <a href="' + url + '" target="_blank" rel="noopener noreferrer"><i class="fa fa-external-link fa-xs"></i>' + lm + '</a>';

        const popover_options = {
            content: popover_content,
            placement: "left",
            title: _("Network bond"),
            html: true,
        };
        $('#bond-help-popup-button').popover(popover_options);
    }

    addBond() {
        let iface;

        const uuid = uuidv4();
        for (let i = 0; i < 100; i++) {
            iface = "bond" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        const ghost_settings = {
            connection: {
                id: iface,
                autoconnect: true,
                type: "bond",
                uuid: uuid,
                interface_name: iface
            },
            bond: {
                options: {
                    mode: "active-backup"
                },
                interface_name: iface
            }
        };
        this.show_dialog(PageNetworkBondSettings, '#network-bond-settings-dialog', ghost_settings);
    }

    addTeam() {
        let iface;

        const uuid = uuidv4();
        for (let i = 0; i < 100; i++) {
            iface = "team" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        const ghost_settings = {
            connection: {
                id: iface,
                autoconnect: true,
                type: "team",
                uuid: uuid,
                interface_name: iface
            },
            team: {
                config: { },
                interface_name: iface
            }
        };
        this.show_dialog(PageNetworkTeamSettings, '#network-team-settings-dialog', ghost_settings);
    }

    addBridge() {
        let iface;

        const uuid = uuidv4();
        for (let i = 0; i < 100; i++) {
            iface = "bridge" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        const ghost_settings = {
            connection: {
                id: iface,
                autoconnect: true,
                type: "bridge",
                uuid: uuid,
                interface_name: iface
            },
            bridge: {
                interface_name: iface,
                stp: false,
                priority: 32768,
                forward_delay: 15,
                hello_time: 2,
                max_age: 20,
                ageing_time: 300
            }
        };
        this.show_dialog(PageNetworkBridgeSettings, '#network-bridge-settings-dialog', ghost_settings);
    }

    addVlan() {
        let iface;

        const uuid = uuidv4();
        for (let i = 0; i < 100; i++) {
            iface = "vlan" + i;
            if (!this.model.find_interface(iface))
                break;
        }

        const ghost_settings = {
            connection: {
                id: "",
                autoconnect: true,
                type: "vlan",
                uuid: uuid,
                interface_name: ""
            },
            vlan: {
                interface_name: "",
                parent: ""
            }
        };
        this.show_dialog(PageNetworkVlanSettings, '#network-vlan-settings-dialog', ghost_settings);
    }

    show_dialog(dialog, id, ghost_settings) {
        dialog.model = this.model;
        dialog.connection = null;
        dialog.ghost_settings = ghost_settings;
        dialog.apply_settings = settings_applier(this.model);
        dialog.done = null;
        $(id).trigger('show');
    }

    render() {
        return (
            <>
                <Button id="networking-add-bond"
                        onClick={syn_click(this.model, this.addBond)}
                        variant="secondary">{_("Add bond")}</Button>
                {this.state.showAddTeam &&
                <Button data-test-stable={this.state.showAddTeam !== undefined}
                        id="networking-add-team"
                        onClick={syn_click(this.model, this.addTeam)}
                        variant="secondary">{_("Add team")}</Button>}
                <Button id="networking-add-bridge"
                        onClick={syn_click(this.model, this.addBridge)}
                        variant="secondary">{_("Add bridge")}</Button>
                <Button id="networking-add-vlan"
                        onClick={syn_click(this.model, this.addVlan)}
                        variant="secondary">{_("Add VLAN")}</Button>
            </>
        );
    }
}
NetworkPageDialogs.contextType = ModelContext;
