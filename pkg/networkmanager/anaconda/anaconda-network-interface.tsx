/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useContext, useState } from 'react';

import { Content, ContentVariants } from "@patternfly/react-core/dist/esm/components/Content/index.js";
import {
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
} from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { ModelContext } from "../model-context";
import { useEvent } from "hooks";
import { active_connection_gateway, active_connection_ipv4, active_connection_ipv6, choice_title, connectInterface, createGhostConnectionSettings, disconnectInterface, is_managed, toggleConnectionAutoconnect, } from "../interfaces";
import { get_ip_method_choices } from "../ip-settings";
import { NetworkAction } from "../dialogs-common.jsx";
import { NMConnectionSettings, NMDevice, NMInterface } from "../utils";

const _ = cockpit.gettext;

interface IpConfig {
    addresses: string[];
    gateway: string;
    dns_data: string[];
}

type IPTopic = "ipv4" | "ipv6";

interface IPConfigExpandableProps {
    toggleText: string;
    onToggle: (isExpanded: boolean) => void;
    isExpanded: boolean;
    iface: NMInterface;
    settings: NMConnectionSettings;
    topic: IPTopic;
}

// Get IP config, use what is available on ActiveConnection if the device is up.
// If it is down only show what we can get from the Connection settings.
const getIpConfig = (dev: NMDevice, settings: NMConnectionSettings, topic: IPTopic) => {
    const ipSettings: IpConfig = { addresses: [], gateway: "", dns_data: [] };
    const hasActiveCon = dev.ActiveConnection;
    const params = settings[topic];

    if (!params) {
        return ipSettings;
    }

    // IP address
    if (hasActiveCon) {
        ipSettings.addresses = (topic === "ipv4")
            ? active_connection_ipv4(dev)
            : active_connection_ipv6(dev, false);
    } else {
        ipSettings.addresses = params.address_data?.map((a) => a.address + "/" + a.prefix);
    }
    // show "choice title" if we get nothing
    if (ipSettings.addresses.length === 0 && params.method !== "manual") {
        ipSettings.addresses = [choice_title(get_ip_method_choices(topic), params.method, _("Unknown configuration"))];
    }

    // Gateway
    if (hasActiveCon) {
        ipSettings.gateway = active_connection_gateway(dev, topic);
    } else {
        ipSettings.gateway = params.gateway || _("Not configured");
    }

    // DNS
    ipSettings.dns_data = params.dns_data;

    return ipSettings;
};

const IPConfigExpandable = ({
    toggleText,
    onToggle,
    isExpanded,
    iface,
    settings,
    topic,
}: IPConfigExpandableProps) => {
    const ipSettings = getIpConfig(iface.Device, settings, topic);

    const descriptionGroups = [
        {
            term: _("IP address"),
            description: ipSettings.addresses.join(", "),
        },
        {
            term: _("Default gateway"),
            description: ipSettings.gateway,
        },
        {
            term: _("DNS"),
            description: ipSettings.dns_data.join(", "),
        },
    ];

    return (
        <Flex
            alignItems={{ default: 'alignItemsFlexStart' }}
            flexWrap={{ default: 'nowrap' }}
        >
            <FlexItem flex={{ default: 'flex_1' }}>
                <ExpandableSection
                    toggleText={toggleText}
                    onToggle={(_event, expanded) => onToggle(expanded)}
                    isExpanded={isExpanded}
                    isIndented
                >
                    <DescriptionList aria-label={_("IP configuration")}>
                        {descriptionGroups.filter(group => !!group.description).map(group => (
                            <DescriptionListGroup key={group.term}>
                                <DescriptionListTerm>{group.term}</DescriptionListTerm>
                                <DescriptionListDescription>{group.description}</DescriptionListDescription>
                            </DescriptionListGroup>
                        ))}
                    </DescriptionList>
                </ExpandableSection>
            </FlexItem>
            <FlexItem>
                <NetworkAction buttonText={_("Edit")}
                    iface={iface}
                    connectionSettings={settings}
                    type={topic}
                    buttonVariant="secondary"
                    isInline={false}
                />
            </FlexItem>
        </Flex>
    );
};

const connectionState = (dev: NMDevice, isManaged: boolean) => {
    if (!dev) {
        return _("Inactive");
    } else if (isManaged) {
        return dev.StateText;
    }

    return dev.ActiveConnection ? _("Connected") : _("Disconnected");
};

interface AnacondaNetworkInterfaceProps {
    iface: NMInterface;
}

export const AnacondaNetworkInterface = ({
    iface,
}: AnacondaNetworkInterfaceProps) => {
    const model = useContext(ModelContext);
    useEvent(model, "changed");
    console.log(iface);

    const [isIpv4Expanded, setIsIpv4Expanded] = useState(true);
    const [isIpv6Expanded, setIsIpv6Expanded] = useState(true);

    const devName = iface.Name;
    const dev = iface.Device;
    const connectionSettings = iface?.MainConnection?.Settings || (createGhostConnectionSettings(devName, dev) as NMConnectionSettings);
    const isManaged = iface && (!dev || is_managed(dev));

    const connectionStatus = connectionState(dev, isManaged);

    return (
        <Stack hasGutter className="anaconda-network-interface">
            {/* Header: device name and installation switches */}
            <StackItem>
                <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    flexWrap={{ default: 'nowrap' }}
                >
                    <FlexItem>
                        <Content component={ContentVariants.h2}>{devName}</Content>
                    </FlexItem>
                    <FlexItem>
                        <Stack hasGutter>
                            <StackItem>
                                <Switch
                                    id="network-interface-enable-device"
                                    label={_("Enable device during installation")}
                                    isReversed
                                    isChecked={!!(dev?.ActiveConnection)}
                                    onChange={(_event, enable) => enable
                                        ? connectInterface(model, iface, dev, connectionSettings)
                                        : disconnectInterface(model, iface, dev)}
                                />
                            </StackItem>
                            <StackItem>
                                <Switch
                                    id="network-interface-connect-automatically"
                                    label={_("Connect automatically on reboot")}
                                    isReversed
                                    isChecked={connectionSettings.connection.autoconnect}
                                    onChange={(_event, checked) => toggleConnectionAutoconnect(model, dev, iface.MainConnection, connectionSettings, checked)}
                                />
                            </StackItem>
                        </Stack>
                    </FlexItem>
                </Flex>
            </StackItem>

            {/* Status */}
            <StackItem>
                <DescriptionList aria-label={_("Status")}>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("Status")}</DescriptionListTerm>
                        <DescriptionListDescription>{connectionStatus}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </StackItem>

            {/* IPv4 */}
            <StackItem>
                <IPConfigExpandable toggleText={_("IPv4")}
                    onToggle={setIsIpv4Expanded}
                    isExpanded={isIpv4Expanded}
                    iface={iface}
                    settings={connectionSettings}
                    topic="ipv4"
                />
            </StackItem>

            {/* IPv6 */}
            <StackItem>
                <IPConfigExpandable toggleText={_("IPv6")}
                    onToggle={setIsIpv6Expanded}
                    isExpanded={isIpv6Expanded}
                    iface={iface}
                    settings={connectionSettings}
                    topic="ipv6"
                />
            </StackItem>
        </Stack>
    );
};
