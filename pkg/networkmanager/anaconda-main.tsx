/*
 * Copyright (C) 2021 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from 'react';

import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, } from "@patternfly/react-core/dist/esm/components/Page/index.js";

import { ListingTableRowProps } from "cockpit-components-table.jsx";

import {
    has_group,
    is_loopback,
    is_managed,
    is_wireless,
    render_active_connection,
} from './interfaces.js';
import { Content, ContentVariants, SimpleList, SimpleListGroup, SimpleListItem, Split, SplitItem } from "@patternfly/react-core";
import { NetworkInterfacePage } from "./network-interface.jsx";
import "./anaconda-main.css";

const _ = cockpit.gettext;

interface AnacondaNetworkPageProps {
    privileged: boolean;
    operationInProgress: boolean;
    usage_monitor: any;
    interfaces: any[];
    iface?: any;
}

interface AnacondaActiveNetwork {
    isWireless?: boolean;
    iface: any;
}

export const AnacondaNetworkPage = ({ privileged, operationInProgress, usage_monitor, interfaces }: AnacondaNetworkPageProps) => {
    const [active, setActive] = useState<AnacondaActiveNetwork>();
    // useEvent(usage_monitor.grid, "notify");

    const managedWired: ListingTableRowProps[] = [];
    const managedWireless: ListingTableRowProps[] = [];
    let hasDetails = false;

    interfaces.forEach(iface => {
        // Skip loopback
        if (is_loopback(iface))
            return;

        // Skip members
        else if (has_group(iface))
            return;

        const dev = iface.Device;
        // const show_traffic = (dev && (dev.State == 100 || dev.State == 10) && dev.Carrier === true);

        // usage_monitor.add(iface.Name);

        const activeConnection = render_active_connection(dev, false, true);
        const isWireless = is_wireless(iface);

        let connectionStatus;
        if (activeConnection) {
            connectionStatus = _("Connected")
        } else {
            connectionStatus = _("Disconnected")
        }

        const row = (
            <SimpleListItem key={iface.name} onClick={() => {setActive({isWireless, iface})}}>
                <Flex
                    direction={{ default: 'row' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    flexWrap={{ default: 'nowrap' }}
                >
                    <FlexItem flex={{ default: 'flex_1' }}>{iface.Name}</FlexItem>
                    <FlexItem>
                        <Content component={ContentVariants.small}>{connectionStatus}</Content>
                    </FlexItem>
                </Flex>
            </SimpleListItem>
        )

        // Details column: show type-specific information
        // let detailsColumn = null;
        // if (dev?.DeviceType === '802-11-wireless') {
        //     const networkCount = dev.visibleSsids.length;
        //     if (networkCount > 0 || dev.ActiveAccessPoint?.Ssid) {
        //         hasDetails = true;
        //         detailsColumn = (
        //             <Flex columnGap={{ default: 'columnGapSm' }}>
        //                 {networkCount > 0 && (
        //                     <FlexItem>
        //                         <Label status="info">
        //                             {cockpit.format(cockpit.ngettext("$0 network", "$0 networks", networkCount), networkCount)}
        //                         </Label>
        //                     </FlexItem>
        //                 )}
        //                 {dev.ActiveAccessPoint?.Ssid && (
        //                     <FlexItem>
        //                         <Label status="success" icon={<ConnectedIcon />}>{dev.ActiveAccessPoint?.Ssid}</Label>
        //                     </FlexItem>
        //                 )}
        //             </Flex>
        //         );
        //     }
        // }
        // row.columns.push({ title: detailsColumn });

        if (!dev || is_managed(dev)) {
            isWireless ? managedWireless.push(row) : managedWired.push(row);
        }
    });

    // TODO: Actions: turn on off action and edit (wired) or join wifi (wireless)
    const actions = privileged && (
        <>
            {/* <NetworkAction buttonText={_("Add VPN")} type='wg' />
            <NetworkAction buttonText={_("Add bond")} type='bond' />
            <NetworkAction buttonText={_("Add team")} type='team' />
            <NetworkAction buttonText={_("Add bridge")} type='bridge' />
            <NetworkAction buttonText={_("Add VLAN")} type='vlan' /> */}
        </>
    );

    return (
        <Page data-test-wait={operationInProgress} id="networking" className="pf-m-no-sidebar anaconda">
            <Content component="h1">{_("Networks")}</Content>
            <Split hasGutter>
                <SplitItem>
                    <SimpleList>
                        {managedWireless.length !== 0 && (
                            <SimpleListGroup title={_("Wireless")} id="wireless-connections">{...managedWireless}</SimpleListGroup>
                        )}
                        {managedWired.length !== 0 && (
                            <SimpleListGroup title={_("Wired")} id="wired-connections">{...managedWired}</SimpleListGroup>
                        )}
                        {(managedWireless.length === 0 && managedWired.length === 0) && (
                            <SimpleListItem key="not-found">{_("No networks found")}</SimpleListItem>
                        )}
                    </SimpleList>
                </SplitItem>
                <SplitItem isFilled>
                    {active?.iface &&
                        <NetworkInterfacePage
                            privileged={privileged}
                            operationInProgress={operationInProgress}
                            usage_monitor={usage_monitor}
                            plot_state={undefined}
                            interfaces={interfaces}
                            iface={active.iface} />
                    }
                </SplitItem>
            </Split>

        </Page>
    );
};

export const AnacondaWirelessDetail = ({active}: {active: AnacondaActiveNetwork}) => {
    return <>
        <Content component="h2">{_("Wireless")}</Content>
        Interface
        {active.iface.Name}
        Status
        Network joined
        Security type
    </>
}

export const AnacondaWiredDetail = ({active}: {active: AnacondaActiveNetwork}) => {
    return <>
        <Content component="h2">{_("Wired")}</Content>
        Interface
        {active.iface.Name}
        Status
        IP Settings
    </>
}
