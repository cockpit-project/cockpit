/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import React, { useContext, useState } from 'react';

import {
    DescriptionList,
    DescriptionListDescription,
    DescriptionListGroup,
    DescriptionListTerm,
} from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { ExpandableSection } from "@patternfly/react-core/dist/esm/components/ExpandableSection/index.js";
import { Switch } from "@patternfly/react-core/dist/esm/components/Switch/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ModelContext } from "../model-context";
import { useEvent } from "hooks";
import { active_connection_gateway, active_connection_ipv4, active_connection_ipv6, choice_title, connectInterface, createGhostConnectionSettings, disconnectInterface, is_managed, is_wireless, toggleConnectionAutoconnect, } from "../interfaces";
import { get_ip_method_choices } from "../ip-settings";
import { NetworkAction } from "../dialogs-common.jsx";
import { NMConnectionSettings, NMDevice, NMInterface } from "../utils";
import { Card, CardBody, CardHeader, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";

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
            id: "ip-address",
        },
        {
            term: _("Default gateway"),
            description: ipSettings.gateway,
            id: "gateway",
        },
        {
            term: _("DNS"),
            description: ipSettings.dns_data.join(", "),
            id: "dns",
        },
    ];

    return (
        <Flex className="ip-expandable"
            alignItems={{ default: "alignItemsFlexStart" }}
            flexWrap={{ default: "nowrap" }}
        >
            <FlexItem flex={{ default: "flex_1" }}>
                <ExpandableSection id={`${topic}-expandable-section`}
                    toggleText={toggleText}
                    onToggle={(_event, expanded) => onToggle(expanded)}
                    isExpanded={isExpanded}
                    isIndented
                >
                    <DescriptionList aria-label={_("IP configuration")}>
                        {descriptionGroups.filter(group => !!group.description).map(group => (
                            <DescriptionListGroup key={group.term} id={group.id}>
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

interface DescriptionListWithAction {
    id?: string;
    dlTerm: React.ReactNode;
    dlDescription: React.ReactNode;
    actionButton?: React.ReactNode;
}

const DescriptionListWithAction = ({
    id,
    dlTerm,
    dlDescription,
    actionButton,
}: DescriptionListWithAction) => {
    return (
        <Flex id={id}
            alignItems={{ default: "alignItemsFlexStart" }}
            justifyContent={{ default: "justifyContentSpaceBetween" }}
            className="description-list-with-action"
        >
            <FlexItem grow={{ default: "grow" }}>
                <DescriptionList>
                    <DescriptionListGroup>
                        <DescriptionListTerm>{dlTerm}</DescriptionListTerm>
                        <DescriptionListDescription>{dlDescription}</DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </FlexItem>
            { actionButton &&
                <FlexItem id={id ? `${id}-action` : undefined}>
                    {actionButton}
                </FlexItem>
            }
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

    const toggleDevAction = (
        <Switch id="network-interface-enable-device"
            label={_("Enable device during installation")}
            isReversed
            isChecked={!!(dev?.ActiveConnection)}
            onChange={(_event, enable) => enable
                ? connectInterface(model, iface, dev, connectionSettings)
                : disconnectInterface(model, iface, dev)}
        />

    );

    const autoconnectSwitch = (
        <Switch id="network-interface-connect-automatically"
            label={_("Connect automatically on reboot")}
            isReversed
            isChecked={connectionSettings.connection.autoconnect}
            onChange={(_event, checked) => toggleConnectionAutoconnect(model, dev, iface.MainConnection, connectionSettings, checked)}
        />
    );

    const isWireless = is_wireless(iface);
    const ssid = dev?.ActiveAccessPoint ? dev?.ActiveAccessPoint.Ssid : null;

    const joinNetButton = (
        <Button variant="secondary">
            {_("Join another network")}
        </Button>
    );

    const wifiSecurity = "WPA haha";

    return (
        <Card id="anaconda-network-interface">
            <CardHeader actions={{ actions: toggleDevAction }}>
                <CardTitle>{devName}</CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionListWithAction id="network-interface-status"
                    dlTerm={_("Status")}
                    dlDescription={connectionState(dev, isManaged)}
                    actionButton={autoconnectSwitch}
                />
                { isWireless &&
                    <DescriptionListWithAction id="network-interface-network-joined"
                        dlTerm={_("Network joined")}
                        dlDescription={ssid ?? _("Disconnected")}
                        actionButton={joinNetButton}
                    />
                }
                { isWireless && ssid &&
                    <DescriptionListWithAction id="network-interface-security-type"
                        dlTerm={_("Security type")}
                        dlDescription={wifiSecurity}
                    />
                }
                <DescriptionListWithAction id="network-interface-ip-settings"
                    dlTerm={_("IP settings")}
                    dlDescription={<>
                        <IPConfigExpandable toggleText={_("IPv4")}
                            onToggle={setIsIpv4Expanded}
                            isExpanded={isIpv4Expanded}
                            iface={iface}
                            settings={connectionSettings}
                            topic="ipv4"
                        />

                        <IPConfigExpandable toggleText={_("IPv6")}
                            onToggle={setIsIpv6Expanded}
                            isExpanded={isIpv6Expanded}
                            iface={iface}
                            settings={connectionSettings}
                            topic="ipv6"
                        />
                    </>}
                />
            </CardBody>
        </Card>
    );
};
