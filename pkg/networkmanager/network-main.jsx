/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React from 'react';
import { useEvent } from "hooks";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Label } from "@patternfly/react-core/dist/esm/components/Label/index.js";
import { Card, CardBody, CardHeader, CardTitle } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Gallery } from "@patternfly/react-core/dist/esm/layouts/Gallery/index.js";
import { Page, PageSection, } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { ConnectedIcon } from "@patternfly/react-icons";

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

        // Details column: show type-specific information
        let detailsColumn = null;
        if (dev?.DeviceType === '802-11-wireless') {
            const networkCount = dev.AccessPoints?.length;
            detailsColumn = (
                <Flex columnGap={{ default: 'columnGapSm' }}>
                    {networkCount > 0 && (
                        <FlexItem>
                            <Label status="info">
                                {cockpit.format(cockpit.ngettext("$0 network", "$0 networks", networkCount), networkCount)}
                            </Label>
                        </FlexItem>
                    )}
                    {dev.ActiveAccessPoint?.Ssid && (
                        <FlexItem>
                            <Label status="success" icon={<ConnectedIcon />}>{dev.ActiveAccessPoint?.Ssid}</Label>
                        </FlexItem>
                    )}
                </Flex>
            );
        }
        row.columns.push({ title: detailsColumn });

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
        <Page data-test-wait={operationInProgress} id="networking" className="pf-m-no-sidebar">
            <PageSection hasBodyWrapper={false} id="networking-graphs" className="networking-graphs">
                <NetworkPlots plot_state={plot_state} />
            </PageSection>
            <PageSection hasBodyWrapper={false}>
                <Gallery hasGutter>
                    {firewall.installed && <Card isPlain id="networking-firewall-summary">
                        <CardHeader actions={{
                            actions: <Button variant="secondary" id="networking-firewall-link"
                                        component="a"
                                        onClick={() => cockpit.jump("/network/firewall", cockpit.transport.host)}>
                                {_("Edit rules and zones")}
                            </Button>,
                        }}>
                            <Flex gap={{ default: 'gapMd' }} alignItems={{ default: 'alignItemsCenter' }}>
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
                    <Card isPlain id="networking-interfaces">
                        <CardHeader actions={{ actions }}>
                            <CardTitle component="h2">{_("Interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable aria-label={_("Managed interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, props: { width: 15 } },
                                          { title: _("IP address"), props: { width: 35 } },
                                          { title: _("Sending"), props: { width: 15 } },
                                          { title: _("Receiving"), props: { width: 15 } },
                                          { title: _("Details"), props: { width: 20 } },
                                      ]}
                                      rows={managed} />
                    </Card>
                    {unmanaged.length > 0 &&
                    <Card isPlain id="networking-unmanaged-interfaces">
                        <CardHeader>
                            <CardTitle component="h2">{_("Unmanaged interfaces")}</CardTitle>
                        </CardHeader>
                        <ListingTable aria-label={_("Unmanaged interfaces")}
                                      variant='compact'
                                      columns={[
                                          { title: _("Name"), header: true, props: { width: 15 } },
                                          { title: _("IP address"), props: { width: 35 } },
                                          { title: _("Sending"), props: { width: 15 } },
                                          { title: _("Receiving"), props: { width: 15 } },
                                          { title: _("Details"), props: { width: 20 } },
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
