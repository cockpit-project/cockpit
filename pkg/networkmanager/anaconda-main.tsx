/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from 'react';

import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, } from "@patternfly/react-core/dist/esm/components/Page/index.js";

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
import { EmptyStatePanel } from "cockpit-components-empty-state.js";

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

    const managedWired: React.ReactNode[] = [];
    const managedWireless: React.ReactNode[] = [];

    interfaces.forEach(iface => {
        // Skip loopback
        if (is_loopback(iface))
            return;

        // Skip members
        else if (has_group(iface))
            return;

        const dev = iface.Device;
        const connectionStatus = dev?.ActiveConnection ? _("Connected") : _("Disconnected");
        const isWireless = is_wireless(iface);

        const row = (
            <SimpleListItem key={iface.Name} onClick={() => {setActive({isWireless, iface})}}>
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

        if (!dev || is_managed(dev)) {
            isWireless ? managedWireless.push(row) : managedWired.push(row);
        }
    });

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
                    {active?.iface ?
                        <NetworkInterfacePage
                            privileged={privileged}
                            operationInProgress={operationInProgress}
                            usage_monitor={usage_monitor}
                            plot_state={undefined}
                            interfaces={interfaces}
                            iface={active.iface} /> :
                        <EmptyStatePanel
                            title={_("No network selected.")}
                            paragraph={_("Select a network interface to configure the connection.")}
                        />
                    }
                </SplitItem>
            </Split>

        </Page>
    );
};
