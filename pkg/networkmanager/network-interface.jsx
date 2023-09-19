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
import cockpit from "cockpit";
import React, { useContext } from "react";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Checkbox } from "@patternfly/react-core/dist/esm/components/Checkbox/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Page, PageBreadcrumb, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";

import { ModelContext } from './model-context.jsx';
import { NetworkInterfaceMembers } from "./network-interface-members.jsx";
import { NetworkAction } from './dialogs-common.jsx';
import { NetworkPlots } from "./plots";
import { fmt_to_fragments } from 'utils.jsx';

import {
    array_join,
    choice_title,
    complete_settings,
    connection_settings,
    free_member_connection,
    is_managed,
    render_active_connection,
    settings_applier,
    show_unexpected_error,
    syn_click,
    with_checkpoint,
} from './interfaces.js';
import {
    team_runner_choices,
    team_watch_choices,
} from './team.jsx';
import {
    bond_mode_choices,
} from './bond.jsx';
import {
    ipv4_method_choices, ipv6_method_choices,
} from './ip-settings.jsx';

const _ = cockpit.gettext;

export const NetworkInterfacePage = ({
    privileged,
    operationInProgress,
    usage_monitor,
    plot_state,
    interfaces,
    iface
}) => {
    const model = useContext(ModelContext);

    const dev_name = iface.Name;
    const dev = iface.Device;
    const isManaged = iface && (!dev || is_managed(dev));

    let ghostSettings = null;
    let connectionSettings = null;

    if (iface) {
        if (iface.MainConnection) {
            connectionSettings = iface.MainConnection.Settings;
        } else {
            ghostSettings = createGhostConnectionSettings();
            connectionSettings = ghostSettings;
        }
    }

    function deleteConnections() {
        function deleteConnectionAndMembers(con) {
            return Promise.all(con.Members.map(s => free_member_connection(s))).then(() => con.delete_());
        }

        function deleteConnections(cons) {
            return Promise.all(cons.map(deleteConnectionAndMembers));
        }

        function deleteIfaceConnections(iface) {
            return deleteConnections(iface.Connections);
        }

        const location = cockpit.location;

        function modify() {
            return deleteIfaceConnections(iface)
                    .then(function () {
                        location.go("/");
                    })
                    .catch(show_unexpected_error);
        }

        if (iface) {
            with_checkpoint(model, modify,
                            {
                                devices: dev ? [dev] : [],
                                fail_text: fmt_to_fragments(_("Deleting $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                                anyway_text: cockpit.format(_("Delete $0"), dev_name),
                                hack_does_add_or_remove: true,
                                rollback_on_failure: true
                            });
        }
    }

    function connect() {
        if (!(iface.MainConnection || (dev && ghostSettings)))
            return;

        function fail(error) {
            show_unexpected_error(error);
        }

        function modify() {
            if (iface.MainConnection) {
                return iface.MainConnection.activate(dev, null).catch(fail);
            } else {
                return dev.activate_with_settings(ghostSettings, null).catch(fail);
            }
        }

        with_checkpoint(model, modify,
                        {
                            devices: dev ? [dev] : [],
                            fail_text: fmt_to_fragments(_("Switching on $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                            anyway_text: cockpit.format(_("Switch on $0"), dev_name)
                        });
    }

    function disconnect() {
        if (!dev) {
            console.log("Trying to switch off without a device?");
            return;
        }

        function modify () {
            return dev.disconnect()
                    .catch(error => show_unexpected_error(error));
        }

        with_checkpoint(model, modify,
                        {
                            devices: [dev],
                            fail_text: fmt_to_fragments(_("Switching off $0 will break the connection to the server, and will make the administration UI unavailable."), <b>{dev_name}</b>),
                            anyway_text: cockpit.format(_("Switch off $0"), dev_name)
                        });
    }

    function renderDesc() {
        let desc, cs;
        if (dev) {
            if (dev.DeviceType == 'ethernet' || dev.IdVendor || dev.IdModel) {
                desc = cockpit.format("$IdVendor $IdModel $Driver", dev);
            } else if (dev.DeviceType == 'bond') {
                desc = _("Bond");
            } else if (dev.DeviceType == 'team') {
                desc = _("Team");
            } else if (dev.DeviceType == 'vlan') {
                desc = _("VLAN");
            } else if (dev.DeviceType == 'bridge') {
                desc = _("Bridge");
            } else if (dev.Driver == 'wireguard') {
                desc = "WireGuard";
            } else
                desc = cockpit.format(_("Unknown \"$0\""), dev.DeviceType);
        } else if (iface) {
            cs = connection_settings(iface.Connections[0]);
            if (cs.type == "bond")
                desc = _("Bond");
            else if (cs.type == "team")
                desc = _("Team");
            else if (cs.type == "vlan")
                desc = _("VLAN");
            else if (cs.type == "bridge")
                desc = _("Bridge");
            else if (cs.type == "wireguard")
                desc = "WireGuard";
            else if (cs.type)
                desc = cockpit.format(_("Unknown \"$0\""), cs.type);
            else
                desc = _("Unknown");
        } else
            desc = _("Unknown");

        return desc;
    }

    function renderMac() {
        let mac;
        if (dev &&
            dev.HwAddress) {
            mac = dev.HwAddress;
        } else if (iface &&
                   iface.MainConnection &&
                   iface.MainConnection.Settings &&
                   iface.MainConnection.Settings.ethernet &&
                   iface.MainConnection.Settings.ethernet.assigned_mac_address) {
            mac = iface.MainConnection.Settings.ethernet.assigned_mac_address;
        }

        const can_edit_mac = (iface && iface.MainConnection &&
                              (connection_settings(iface.MainConnection).type == "802-3-ethernet" ||
                               connection_settings(iface.MainConnection).type == "bond"));

        let mac_desc;
        if (can_edit_mac) {
            mac_desc = (
                <NetworkAction type="mac" iface={iface} buttonText={mac} connectionSettings={iface.MainConnection.Settings} />
            );
        } else {
            mac_desc = mac;
        }

        return mac_desc;
    }

    function renderCarrierStatusRow() {
        if (dev && dev.Carrier !== undefined) {
            return (
                <DescriptionListGroup>
                    <DescriptionListTerm>{_("Carrier")}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {dev.Carrier ? (dev.Speed ? cockpit.format_bits_per_sec(dev.Speed * 1e6) : _("Yes")) : _("No")}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        } else
            return null;
    }

    function renderActiveStatusRow() {
        let state;

        if (iface.MainConnection && iface.MainConnection.Groups.length > 0)
            return null;

        if (!dev)
            state = _("Inactive");
        else if (isManaged && dev.State != 100)
            state = dev.StateText;
        else
            state = null;

        const activeConnection = render_active_connection(dev, true, false);
        return (
            <DescriptionListGroup>
                <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                <DescriptionListDescription className="networking-interface-status">
                    {activeConnection}
                    {state ? <span>{state}</span> : null}
                </DescriptionListDescription>
            </DescriptionListGroup>
        );
    }

    function renderConnectionSettingsRows(con, settings) {
        if (!isManaged || !settings)
            return [];

        let group_settings = null;
        if (con && con.Groups.length > 0)
            group_settings = con.Groups[0].Settings;

        function renderIpSettings(topic) {
            const params = settings[topic];
            const parts = [];

            if (params.method != "manual")
                parts.push(choice_title((topic == "ipv4") ? ipv4_method_choices : ipv6_method_choices,
                                        params.method, _("Unknown configuration")));

            const addr_is_extra = (params.method != "manual");
            const addrs = [];
            params.addresses.forEach(function (a) {
                let addr = a[0] + "/" + a[1];
                if (a[2] && a[2] != "0.0.0.0" && a[2] != "0:0:0:0:0:0:0:0")
                    addr += " via " + a[2];
                addrs.push(addr);
            });
            if (addrs.length > 0)
                parts.push(cockpit.format(addr_is_extra ? _("Additional address $val") : _("Address $val"),
                                          { val: addrs.join(", ") }));

            const dns_is_extra = (!params["ignore-auto-dns"] && params.method != "manual");
            if (params.dns.length > 0)
                parts.push(cockpit.format(dns_is_extra ? _("Additional DNS $val") : _("DNS $val"),
                                          { val: params.dns.join(", ") }));
            if (params.dns_search.length > 0)
                parts.push(cockpit.format(dns_is_extra ? _("Additional DNS search domains $val") : _("DNS search domains $val"),
                                          { val: params.dns_search.join(", ") }));

            return parts;
        }

        function renderAutoconnectRow() {
            if (settings.connection.autoconnect !== undefined) {
                return (
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("General")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            <Checkbox id="autoreconnect" isDisabled={!privileged}
                                      onChange={(_event, checked) => {
                                          settings.connection.autoconnect = checked;
                                          settings_applier(self.model, dev, con)(settings);
                                      }}
                                      isChecked={settings.connection.autoconnect}
                                      label={_("Connect automatically")} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                );
            }
        }

        function renderSettingsRow(title, rows, configure) {
            const link_text = [];
            for (let i = 0; i < rows.length; i++) {
                link_text.push(rows[i]);
                if (i < rows.length - 1)
                    link_text.push(<br key={"break-" + i} />);
            }

            return (
                <DescriptionListGroup>
                    <DescriptionListTerm>{title}</DescriptionListTerm>
                    <DescriptionListDescription>
                        {link_text.length
                            ? <span className="network-interface-settings-text">
                                {link_text}
                            </span>
                            : null}
                        {privileged
                            ? (typeof configure === 'function' ? <Button variant="link" isInline onClick={syn_click(model, configure)}>{_("edit")}</Button> : configure)
                            : null}
                    </DescriptionListDescription>
                </DescriptionListGroup>
            );
        }

        function renderIpSettingsRow(topic, title) {
            if (!settings[topic])
                return null;

            const configure = <NetworkAction type={topic} iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(title, renderIpSettings(topic), configure);
        }

        function renderMtuSettingsRow() {
            const rows = [];
            const options = settings.ethernet;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.mtu)
                addRow("$mtu", options);
            else
                addRow(_("Automatic"), options);

            const configure = <NetworkAction type="mtu" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("MTU"), rows, configure);
        }

        function render_connection_link(con, key) {
            return <span key={key}>
                {
                    array_join(
                        con.Interfaces.map(iface =>
                            <Button variant="link" key={iface.Name}
                                    isInline
                                    onClick={() => cockpit.location.go([iface.Name])}>{iface.Name}</Button>),
                        ", ")
                }
            </span>;
        }

        function render_group() {
            if (con && con.Groups.length > 0) {
                return (
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Group")}</DescriptionListTerm>
                        <DescriptionListDescription>
                            {array_join(con.Groups.map(render_connection_link), ", ")}
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                );
            } else
                return null;
        }

        function renderBondSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.bond)
                return null;

            const options = settings.bond.options;

            parts.push(choice_title(bond_mode_choices, options.mode, options.mode));
            if (options.arp_interval)
                parts.push(_("ARP monitoring"));

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="bond" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bond"), rows, configure);
        }

        function renderTeamSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.team)
                return null;

            const config = settings.team.config;

            if (config === null)
                parts.push(_("Broken configuration"));
            else {
                if (config.runner)
                    parts.push(choice_title(team_runner_choices, config.runner.name, config.runner.name));
                if (config.link_watch && config.link_watch.name != "ethtool")
                    parts.push(choice_title(team_watch_choices, config.link_watch.name, config.link_watch.name));
            }

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="team" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Team"), rows, configure);
        }

        function renderTeamPortSettingsRow() {
            const parts = [];
            const rows = [];

            if (!settings.team_port)
                return null;

            /* Only "activebackup" and "lacp" team ports have
             * something to configure.
             */
            if (!group_settings ||
                !group_settings.team ||
                !group_settings.team.config ||
                !group_settings.team.config.runner ||
                !(group_settings.team.config.runner.name == "activebackup" ||
                  group_settings.team.config.runner.name == "lacp"))
                return null;

            const config = settings.team_port.config;

            if (config === null)
                parts.push(_("Broken configuration"));

            if (parts.length > 0)
                rows.push(parts.join(", "));

            const configure = <NetworkAction type="teamport" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Team port"), rows, configure);
        }

        function renderBridgeSettingsRow() {
            const rows = [];
            const options = settings.bridge;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.stp) {
                addRow(_("Spanning tree protocol"));
                if (options.priority != 32768)
                    addRow(_("Priority $priority"), options);
                if (options.forward_delay != 15)
                    addRow(_("Forward delay $forward_delay"), options);
                if (options.hello_time != 2)
                    addRow(_("Hello time $hello_time"), options);
                if (options.max_age != 20)
                    addRow(_("Maximum message age $max_age"), options);
            }

            const configure = <NetworkAction type="bridge" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bridge"), rows, configure);
        }

        function renderBridgePortSettingsRow() {
            const rows = [];
            const options = settings.bridge_port;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            if (options.priority != 32)
                addRow(_("Priority $priority"), options);
            if (options.path_cost != 100)
                addRow(_("Path cost $path_cost"), options);
            if (options.hairpin_mode)
                addRow(_("Hairpin mode"));

            const configure = <NetworkAction type="bridgeport" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("Bridge port"), rows, configure);
        }

        function renderVlanSettingsRow() {
            const rows = [];
            const options = settings.vlan;

            if (!options)
                return null;

            function addRow(fmt, args) {
                rows.push(cockpit.format(fmt, args));
            }

            addRow(_("Parent $parent"), options);
            addRow(_("ID $id"), options);

            const configure = <NetworkAction type="vlan" iface={iface} connectionSettings={settings} />;
            return renderSettingsRow(_("VLAN"), rows, configure);
        }

        function renderWireGuardSettingsRow() {
            const rows = [];
            const options = settings.wireguard;

            if (!options) {
                return null;
            }

            const configure = <NetworkAction type="wg" iface={iface} connectionSettings={settings} />;

            return renderSettingsRow(_("WireGuard"), rows, configure);
        }

        return [
            render_group(),
            renderAutoconnectRow(),
            renderIpSettingsRow("ipv4", _("IPv4")),
            renderIpSettingsRow("ipv6", _("IPv6")),
            renderMtuSettingsRow(),
            renderVlanSettingsRow(),
            renderBridgeSettingsRow(),
            renderBridgePortSettingsRow(),
            renderBondSettingsRow(),
            renderTeamSettingsRow(),
            renderTeamPortSettingsRow(),
            renderWireGuardSettingsRow(),
        ];
    }

    function renderConnectionMembers(con) {
        const memberIfaces = { };
        const members = { };

        const rx_plot_data = {
            direct: "network.interface.in.bytes",
            internal: "network.interface.rx",
            units: "bytes",
            derive: "rate",
            factor: 8
        };

        const tx_plot_data = {
            direct: "network.interface.out.bytes",
            internal: "network.interface.tx",
            units: "bytes",
            derive: "rate",
            factor: 8
        };

        const cs = con && connection_settings(con);
        if (!con || (cs.type != "bond" && cs.type != "team" && cs.type != "bridge")) {
            plot_state.plot_instances('rx', rx_plot_data, [dev_name], true);
            plot_state.plot_instances('tx', tx_plot_data, [dev_name], true);
            return null;
        }

        const plot_ifaces = [];

        con.Members.forEach(member_con => {
            member_con.Interfaces.forEach(iface => {
                if (iface.MainConnection != member_con)
                    return;

                const dev = iface.Device;

                /* Unmanaged devices shouldn't show up as members
                 * but let's not take any chances.
                 */
                if (dev && !is_managed(dev))
                    return;

                plot_ifaces.push(iface.Name);
                usage_monitor.add(iface.Name);
                members[iface.Name] = iface;
                memberIfaces[iface.Name] = true;
            });
        });

        plot_state.plot_instances('rx', rx_plot_data, plot_ifaces, true);
        plot_state.plot_instances('tx', tx_plot_data, plot_ifaces, true);

        const sorted_members = Object.keys(members).sort()
                .map(name => members[name]);

        return (
            <NetworkInterfaceMembers members={sorted_members}
                                     memberIfaces={memberIfaces}
                                     interfaces={interfaces}
                                     iface={iface}
                                     usage_monitor={usage_monitor}
                                     privileged={privileged} />
        );
    }

    function createGhostConnectionSettings() {
        const settings = {
            connection: {
                interface_name: iface.Name
            },
            ipv4: {
                method: "auto",
                addresses: [],
                dns: [],
                dns_search: [],
                routes: []
            },
            ipv6: {
                method: "auto",
                addresses: [],
                dns: [],
                dns_search: [],
                routes: []
            }
        };
        complete_settings(settings, dev);
        return settings;
    }

    /* Disable the On/Off button for interfaces that we don't know about at all,
       and for devices that NM declares to be unavailable. Neither can be activated.
    */

    let onoff;
    if (isManaged) {
        onoff = (
            <Switch isChecked={!!(dev && dev.ActiveConnection)}
                    isDisabled={!iface || (dev && dev.State == 20)}
                    onChange={(_event, enable) => enable ? connect() : disconnect()}
                    aria-label={_("Enable or disable the device")} />
        );
    }

    const isDeletable = (iface && !dev) || (dev && (dev.DeviceType == 'bond' ||
                                                    dev.DeviceType == 'team' ||
                                                    dev.DeviceType == 'vlan' ||
                                                    dev.DeviceType == 'bridge' ||
                                                    dev.DeviceType == 'wireguard'));

    const settingsRows = renderConnectionSettingsRows(iface.MainConnection, connectionSettings)
            .map((component, idx) => <React.Fragment key={idx}>{component}</React.Fragment>);

    return (
        <Page id="network-interface"
              data-test-wait={operationInProgress}>
            <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                <Breadcrumb>
                    <BreadcrumbItem to='#/'>
                        {_("Networking")}
                    </BreadcrumbItem>
                    <BreadcrumbItem isActive>
                        {dev_name}
                    </BreadcrumbItem>
                </Breadcrumb>
            </PageBreadcrumb>
            <PageSection variant={PageSectionVariants.light}>
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection>
                <Gallery hasGutter>
                    <Card className="network-interface-details">
                        <CardHeader actions={{
                            actions: (
                                <>
                                    {isDeletable && isManaged &&
                                    <Button variant="danger"
                                                 onClick={syn_click(model, deleteConnections)}
                                                 id="network-interface-delete">
                                        {_("Delete")}
                                    </Button>}
                                    {onoff}
                                </>
                            ),
                        }}>
                            <CardTitle className="network-interface-details-title">
                                <span id="network-interface-name">{dev_name}</span>
                                <span id="network-interface-hw">{renderDesc()}</span>
                                <span id="network-interface-mac">{renderMac()}</span>
                            </CardTitle>
                        </CardHeader>
                        <CardBody>
                            <DescriptionList id="network-interface-settings" className="network-interface-settings pf-m-horizontal-on-sm">
                                {renderActiveStatusRow()}
                                {renderCarrierStatusRow()}
                                {settingsRows}
                            </DescriptionList>
                        </CardBody>
                        { !isManaged
                            ? <CardBody>
                                {_("This device cannot be managed here.")}
                            </CardBody>
                            : null
                        }
                    </Card>
                    {renderConnectionMembers(iface.MainConnection)}
                </Gallery>
            </PageSection>
        </Page>
    );
};
