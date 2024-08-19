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

import cockpit from "cockpit";
import React from 'react';
import { useEvent } from "hooks";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Page, PageSection, PageSectionVariants } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import { FirewallSwitch } from "./firewall-switch.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { NetworkAction } from "./dialogs-common.jsx";
import { LogsPanel } from "cockpit-components-logs-panel.jsx";
import { NetworkPlots } from "./plots";

import firewall from './firewall-client.js';
import {
    device_state_text,
    is_managed,
    render_active_connection,
} from './interfaces.js';

const _ = cockpit.gettext;

export const NetworkPage = ({ privileged, operationInProgress, usage_monitor, plot_state, interfaces }) => {
    useEvent(firewall, "changed");
    useEvent(usage_monitor.grid, "notify");

    const managed = [];
    const unmanaged = [];
    const plot_ifaces = [];

    interfaces.forEach(iface => {
        function hasGroup(iface) {
            return ((iface.Device &&
                     iface.Device.ActiveConnection &&
                     iface.Device.ActiveConnection.Group &&
                     iface.Device.ActiveConnection.Group.Members.length > 0) ||
                    (iface.MainConnection &&
                     iface.MainConnection.Groups.length > 0));
        }

        // Skip loopback
        if (iface.Name == "lo" || (iface.Device && iface.Device.DeviceType == 'loopback'))
            return;

        // Skip members
        if (hasGroup(iface))
            return;

        const dev = iface.Device;
        const show_traffic = (dev && (dev.State == 100 || dev.State == 10) && dev.Carrier === true);

        plot_ifaces.push(iface.Name);
        usage_monitor.add(iface.Name);

        const activeConnection = render_active_connection(dev, false, true);
        const row = {
            columns: [
                { title: (!dev || is_managed(dev)) ? <Button variant="link" isInline onClick={() => cockpit.location.go([iface.Name])}>{iface.Name}</Button> : iface.Name },
                { title: activeConnection },
            ],
            props: {
                key: iface.Name,
                "data-interface": encodeURIComponent(iface.Name),
                "data-sample-id": show_traffic ? encodeURIComponent(iface.Name) : null,
                "data-row-id": iface.Name,
            }
        };

        if (show_traffic) {
            const samples = usage_monitor.samples[iface.Name];
            row.columns.push({ title: samples ? cockpit.format_bits_per_sec(samples[1][0] * 8) : "" });
            row.columns.push({ title: samples ? cockpit.format_bits_per_sec(samples[0][0] * 8) : "" });
        } else {
            row.columns.push({ title: device_state_text(dev), props: { colSpan: 2 } });
        }

        if (!dev || is_managed(dev)) {
            managed.push(row);
        } else {
            unmanaged.push(row);
        }
    });

    const rx_plot_data = {
        direct: "network.interface.in.bytes",
        internal: "network.interface.rx",
        units: "bytes",
        derive: "rate",
        threshold: 200,
        factor: 8
    };

    const tx_plot_data = {
        direct: "network.interface.out.bytes",
        internal: "network.interface.tx",
        units: "bytes",
        derive: "rate",
        threshold: 200,
        factor: 8
    };

    plot_state.plot_instances('rx', rx_plot_data, plot_ifaces);
    plot_state.plot_instances('tx', tx_plot_data, plot_ifaces);

    /* Start of properties for the LogsPanel component */
    const match = [
        "_SYSTEMD_UNIT=NetworkManager.service", "+",
        "_SYSTEMD_UNIT=firewalld.service"
    ];
    const search_options = {
        prio: "debug",
        _SYSTEMD_UNIT: "NetworkManager.service,firewalld.service"
    };
    const url = "/system/logs/#/?prio=debug&_SYSTEMD_UNIT=NetworkManager.service,firewalld.service";
    /* End of properties for the LogsPanel component */

    const actions = privileged && (
        <>
            <NetworkAction buttonText={_("Add VPN")} type='wg' />
            <NetworkAction buttonText={_("Add bond")} type='bond' />
            <NetworkAction buttonText={_("Add team")} type='team' />
            <NetworkAction buttonText={_("Add bridge")} type='bridge' />
            <NetworkAction buttonText={_("Add VLAN")} type='vlan' />
        </>
    );

    return (
        <Page data-test-wait={operationInProgress} id="networking">
            <PageSection id="networking-graphs" className="networking-graphs" variant={PageSectionVariants.light}>
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection>
                <Gallery hasGutter>
                    {firewall.installed && <Card id="networking-firewall-summary">
                        <CardHeader actions={{
                            actions: <Button variant="secondary" id="networking-firewall-link"
                                        component="a"
                                        onClick={() => cockpit.jump("/network/firewall", cockpit.transport.host)}>
                                {_("Edit rules and zones")}
                            </Button>,
                        }}>
                            <Flex spaceItems={{ default: 'spaceItemsMd' }} alignItems={{ default: 'alignItemsCenter' }}>
                                <CardTitle component="h2">{_("Firewall")}</CardTitle>
                                <FirewallSwitch firewall={firewall} />
                            </Flex>
                        </CardHeader>
                        <CardBody>
                            <Button variant="link"
                                    component="a"
                                    isInline
                                    onClick={() => cockpit.jump("/network/firewall", cockpit.transport.host)}>
                                {cockpit.format(cockpit.ngettext("$0 active zone", "$0 active zones", firewall.activeZones.size), firewall.activeZones.size)}
                            </Button>
                        </CardBody>
                    </Card>}
                    <Card id="networking-interfaces">
                        <CardHeader actions={{ actions }}>
                            <CardTitle component="h2">{_("Interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable aria-label={_("Managed interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, props: { width: 25 } },
                                          { title: _("IP address"), props: { width: 25 } },
                                          { title: _("Sending"), props: { width: 25 } },
                                          { title: _("Receiving"), props: { width: 25 } },
                                      ]}
                                      rows={managed} />
                    </Card>
                    {unmanaged.length > 0 &&
                    <Card id="networking-unmanaged-interfaces">
                        <CardHeader>
                            <CardTitle component="h2">{_("Unmanaged interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable aria-label={_("Unmanaged interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, props: { width: 25 } },
                                          { title: _("IP address"), props: { width: 25 } },
                                          { title: _("Sending"), props: { width: 25 } },
                                          { title: _("Receiving"), props: { width: 25 } },
                                      ]}
                                      rows={unmanaged} />
                    </Card>}
                    <LogsPanel title={_("Network logs")} match={match}
                               max={10} search_options={search_options}
                               goto_url={url}
                               className="contains-list" />
                </Gallery>
            </PageSection>
        </Page>
    );
};
