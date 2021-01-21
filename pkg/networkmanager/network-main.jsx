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
import React, { useState } from 'react';
import { useEvent } from "hooks";

import {
    Button,
    Card, CardActions, CardBody, CardTitle, CardHeader,
    Gallery,
    Page, PageSection, PageSectionVariants,
    Text, TextVariants,
} from "@patternfly/react-core";
import { cellWidth } from '@patternfly/react-table';

import { FirewallSwitch } from "./firewall-switch.jsx";
import { ListingTable } from "cockpit-components-table.jsx";
import { LogsPanel } from "cockpit-components-logs-panel.jsx";
import { NetworkPageDialogs } from './network-main-dialogs.jsx';
import { NetworkPlots } from "./plots";

import firewall from './firewall-client.js';
import {
    device_state_text,
    is_managed,
    render_active_connection,
} from './interfaces.js';

const _ = cockpit.gettext;

export const NetworkPage = ({ privileged, usage_monitor, plot_state, interfaces }) => {
    useEvent(firewall, "changed");
    useEvent(usage_monitor.grid, "notify");
    const [highlight, setHighlight] = useState(null);

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
        if (iface.Device && iface.Device.DeviceType == 'loopback')
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
                { title: activeConnection ? activeConnection[0].innerHTML : activeConnection },
            ],
            rowId: iface.Name,
            extraClasses: highlight == iface.Name ? ["highlight-ct"] : [],
            props: {
                key: iface.Name,
                "data-interface": encodeURIComponent(iface.Name),
                "data-sample-id": show_traffic ? encodeURIComponent(iface.Name) : null
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

    return (
        <Page id="networking">
            <PageSection id="networking-graphs" className="networking-graphs" variant={PageSectionVariants.light}>
                <NetworkPlots plot_state={plot_state} onHover={setHighlight} />
            </PageSection>
            <PageSection>
                <Gallery hasGutter>
                    {firewall.installed && <Card id="networking-firewall-summary">
                        <CardHeader>
                            <CardTitle><Text component={TextVariants.h2}>{_("Firewall")}</Text></CardTitle>
                            <FirewallSwitch firewall={firewall} />
                            <CardActions>
                                <Button variant="secondary" id="networking-firewall-link"
                                        component="a"
                                        onClick={() => cockpit.jump("/network/firewall", cockpit.transport.host)}>
                                    {_("Edit rules and zones")}
                                </Button>
                            </CardActions>
                        </CardHeader>
                        <CardBody>
                            <Button variant="link"
                                    component="a"
                                    isInline
                                    onClick={() => cockpit.jump("/network/firewall", cockpit.transport.host)}>
                                {cockpit.format(cockpit.ngettext(_("$0 active zone"), _("$0 active zones"), firewall.activeZones.size), firewall.activeZones.size)}
                            </Button>
                        </CardBody>
                    </Card>}
                    <Card id="networking-interfaces">
                        <CardHeader>
                            <CardTitle><Text component={TextVariants.h2}>{_("Interfaces")}</Text></CardTitle>
                            {privileged && <CardActions><NetworkPageDialogs /></CardActions>}
                        </CardHeader>
                        <ListingTable aria-label={_("Managed interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, transforms: [cellWidth(25)] },
                                          { title: _("IP address"), transforms: [cellWidth(25)] },
                                          { title: _("Sending"), transforms: [cellWidth(25)] },
                                          { title: _("Receiving"), transforms: [cellWidth(25)] },
                                      ]}
                                      rows={managed} />
                    </Card>
                    {unmanaged.length > 0 &&
                    <Card id="networking-unmanaged-interfaces">
                        <CardHeader>
                            <CardTitle><Text component={TextVariants.h2}>{_("Unmanaged interfaces")}</Text></CardTitle>
                        </CardHeader>
                        <ListingTable aria-label={_("Unmanaged interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, transforms: [cellWidth(25)] },
                                          { title: _("IP address"), transforms: [cellWidth(25)] },
                                          { title: _("Sending"), transforms: [cellWidth(25)] },
                                          { title: _("Receiving"), transforms: [cellWidth(25)] },
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
