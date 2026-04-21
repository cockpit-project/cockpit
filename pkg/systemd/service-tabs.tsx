/*
 * Copyright (C) 2020 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React, { useState } from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Nav, NavItem, NavList } from "@patternfly/react-core/dist/esm/components/Nav/index.js";
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";
import { ExclamationCircleIcon } from '@patternfly/react-icons';

import cockpit from "cockpit";

const _ = cockpit.gettext;

export const service_tabs_suffixes = ["service", "target", "socket", "timer", "path"];

type TabKey = "service" | "target" | "socket" | "timer" | "path";

const service_tabs: Map<TabKey, string> = new Map([
    ["service", _("Services")],
    ["target", _("Targets")],
    ["socket", _("Sockets")],
    ["timer", _("Timers")],
    ["path", _("Paths")],
]);
// TODO: switch Iterator.prototype.map (requires ES2027)
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Iterator/map
const service_tabs_keys = [...service_tabs.keys()];

export function ServiceTabs({
    onChange,
    activeTab,
    tabErrors
}: {
    onChange: (tab: TabKey) => void;
    activeTab: TabKey;
    tabErrors: Record<TabKey, boolean>;
}) {
    const [activeItem, setActiveItem] = useState(activeTab);

    return (
        <Nav variant="horizontal-subnav" id="services-filter"
             onSelect={(_event, result) => {
                 const selectedTabKey = result.itemId as TabKey;
                 setActiveItem(selectedTabKey); onChange(selectedTabKey);
             }}>
            <NavList>
                {service_tabs_keys.map(key => {
                    return (
                        <NavItem itemId={key}
                                 key={key}
                                 preventDefault
                                 isActive={activeItem == key}>
                            <Button variant="link" component="a">
                                {service_tabs.get(key)}
                                {tabErrors[key] ? <Icon status="danger"><ExclamationCircleIcon className="ct-exclamation-circle" /></Icon> : null}
                            </Button>
                        </NavItem>
                    );
                })}
            </NavList>
        </Nav>
    );
}
