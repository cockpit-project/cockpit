/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useContext, useState } from 'react';

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
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
import { active_connection_gateway, active_connection_ipv4, active_connection_ipv6, choice_title, createGhostConnectionSettings, is_managed, } from "../interfaces";
import { get_ip_method_choices } from "../ip-settings";

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
    dev: any;
    settings: any;
    topic: IPTopic;
}

// Get IP config, use what is available on ActiveConnection if the device is up.
// If it is down only show what we can get from the Connection settings.
const getIpConfig = (dev, settings, topic: IPTopic) => {
    const ipSettings: IpConfig = { addresses: [], gateway: "", dns_data: [] };
    const hasActiveCon = dev.ActiveConnection;
    const params = settings[topic];

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
    dev,
    settings,
    topic,
}: IPConfigExpandableProps) => {
    const ipSettings = getIpConfig(dev, settings, topic);

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
    );
};

const connectionState = (dev: any, isManaged: boolean) => {
    if (!dev) {
        return _("Inactive");
    } else if (isManaged) {
        return dev.StateText;
    }

    return dev.ActiveConnection ? _("Connected") : _("Disconnected");
}

interface AnacondaNetworkInterfaceProps {
    iface: any;
}

export const AnacondaNetworkInterface = ({
    iface,
}: AnacondaNetworkInterfaceProps) => {
    const model = useContext(ModelContext);
    useEvent(model, "changed");
    console.log(iface);

    // TODO: enabled and autoconnect
    const [enabled, setEnabled] = useState(false);
    const [autoConnect, setAutoConnect] = useState(false);
    const [isIpv4Expanded, setIsIpv4Expanded] = useState(true);
    const [isIpv6Expanded, setIsIpv6Expanded] = useState(true);

    const devName = iface.Name;
    const dev = iface.Device;
    const connectionSettings = iface?.MainConnection?.Settings || createGhostConnectionSettings(devName, dev);
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
                                    isChecked={enabled}
                                    onChange={(_event, checked) => setEnabled(checked)}
                                />
                            </StackItem>
                            <StackItem>
                                <Switch
                                    id="network-interface-connect-automatically"
                                    label={_("Connect automatically on reboot")}
                                    isReversed
                                    isChecked={autoConnect}
                                    onChange={(_event, checked) => setAutoConnect(checked)}
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

            {/* IP Settings header with Edit action */}
            <StackItem>
                <Flex
                    justifyContent={{ default: 'justifyContentSpaceBetween' }}
                    alignItems={{ default: 'alignItemsCenter' }}
                    flexWrap={{ default: 'nowrap' }}
                >
                    <FlexItem>
                        <Content component={ContentVariants.h3}>{_("IP Settings")}</Content>
                    </FlexItem>
                    <FlexItem>
                        <Button variant="secondary" isInline={false}>{_("Edit")}</Button>
                    </FlexItem>
                </Flex>
            </StackItem>

            {/* IPv4 */}
            <StackItem>
                <IPConfigExpandable toggleText={_("IPv4")}
                    onToggle={setIsIpv4Expanded}
                    isExpanded={isIpv4Expanded}
                    dev={dev}
                    settings={connectionSettings}
                    topic={"ipv4"}
                />
            </StackItem>

            {/* IPv6 */}
            <StackItem>
                <IPConfigExpandable toggleText={_("IPv6")}
                    onToggle={setIsIpv6Expanded}
                    isExpanded={isIpv6Expanded}
                    dev={dev}
                    settings={connectionSettings}
                    topic={"ipv6"}
                />
            </StackItem>
        </Stack>
    );
};
