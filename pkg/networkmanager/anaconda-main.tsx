/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useState } from 'react';

import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Page, } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Content, ContentVariants } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import { SimpleList, SimpleListGroup, SimpleListItem } from "@patternfly/react-core/dist/esm/components/SimpleList/index.js";
import { Split, SplitItem } from "@patternfly/react-core/dist/esm/layouts/Split/index.js";

import {
    has_group,
    is_loopback,
    is_managed,
    is_wireless,
} from './interfaces.js';
import { NetworkInterfacePage } from "./network-interface.jsx";
import { EmptyStatePanel } from "cockpit-components-empty-state.js";
import { UsageMonitor } from "./helpers.js";

const _ = cockpit.gettext;

interface AnacondaNetworkPageProps {
    privileged: boolean;
    operationInProgress: boolean;
    usage_monitor: UsageMonitor;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    interfaces: any[];
}

export const AnacondaNetworkPage = ({ privileged, operationInProgress, usage_monitor, interfaces }: AnacondaNetworkPageProps) => {
    const [selectedIfaceName, setSelectedIfaceName] = useState<string | null>(null);
    const selectedIface = interfaces.find(iface => iface.Name === selectedIfaceName) ?? null;

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

        // Show WiFi name in the list
        const activeConName = dev?.ActiveConnection?.Connection?.Settings?.connection?.id;
        const ifaceDisplayName = (isWireless && activeConName) ? `${iface.Name} (${activeConName})` : iface.Name;

        const row = (
            <SimpleListItem key={iface.Name}
                componentProps={{ "data-interface": encodeURIComponent(iface.Name) }}
                onClick={() => { setSelectedIfaceName(iface.Name) }}
            >
                <Flex
                    direction={{ default: 'row' }}
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    flexWrap={{ default: 'nowrap' }}
                >
                    <FlexItem flex={{ default: 'flex_1' }}>{ifaceDisplayName}</FlexItem>
                    <FlexItem>
                        <Content component={ContentVariants.small}>{connectionStatus}</Content>
                    </FlexItem>
                </Flex>
            </SimpleListItem>
        );

        if (!dev || is_managed(dev)) {
            if (isWireless) {
                managedWireless.push(row);
            } else {
                managedWired.push(row);
            }
        }
    });

    return (
        <Page data-test-wait={operationInProgress} id="networking" className="pf-m-no-sidebar anaconda">
            <Content component="h1">{_("Networks")}</Content>
            <Split hasGutter id="networking-interfaces">
                <SplitItem>
                    <SimpleList>
                        {managedWireless.length !== 0 && (
                            <SimpleListGroup title={_("Wireless")} id="wireless-connections">{managedWireless}</SimpleListGroup>
                        )}
                        {managedWired.length !== 0 && (
                            <SimpleListGroup title={_("Wired")} id="wired-connections">{managedWired}</SimpleListGroup>
                        )}
                        {(managedWireless.length === 0 && managedWired.length === 0) && (
                            <SimpleListItem key="not-found">{_("No networks found")}</SimpleListItem>
                        )}
                    </SimpleList>
                </SplitItem>
                <SplitItem isFilled>
                    {selectedIface
                        ? <NetworkInterfacePage
                            privileged={privileged}
                            operationInProgress={operationInProgress}
                            usage_monitor={usage_monitor}
                            plot_state={undefined}
                            interfaces={interfaces}
                            iface={selectedIface} />
                        : <EmptyStatePanel
                            title={_("No network selected.")}
                            paragraph={_("Select a network interface to configure the connection.")}
                        />
                    }
                </SplitItem>
            </Split>

        </Page>
    );
};
