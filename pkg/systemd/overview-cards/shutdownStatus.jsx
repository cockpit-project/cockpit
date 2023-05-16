/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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
import React, { useState, useEffect } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { PowerOffIcon, RedoIcon } from "@patternfly/react-icons";

import * as timeformat from "timeformat";

import cockpit from "cockpit";

import "./shutdownStatus.scss";

const _ = cockpit.gettext;

const getScheduledShutdown = (setShutdownTime, setShutdownType) => {
    const client = cockpit.dbus("org.freedesktop.login1");
    return client.call("/org/freedesktop/login1", "org.freedesktop.DBus.Properties", "Get",
                       ["org.freedesktop.login1.Manager", "ScheduledShutdown"], { type: "ss" })
            .then(([result]) => {
                setShutdownType(result.v[0]);
                setShutdownTime(result.v[1]);
            })
            .catch(err => console.warn("Failed to get ScheduledShutdown property", err.toString()));
};

const cancelShutdownAction = () => {
    const client = cockpit.dbus("org.freedesktop.login1", { superuser: "try" });
    return client.call("/org/freedesktop/login1", "org.freedesktop.login1.Manager", "CancelScheduledShutdown")
            .then(([cancelled]) => {
                if (!cancelled) {
                    console.warn("Unable to cancel shutdown");
                }
            })
            .catch(err => console.warn("Failed to cancel shutdown", err.toString()));
};

export const ShutDownStatus = () => {
    const [shutdownType, setShutdownType] = useState(null);
    const [shutdownTime, setShutdownTime] = useState(0);

    useEffect(() => {
        getScheduledShutdown(setShutdownTime, setShutdownType);
        // logind does not have a propertieschanged mechanism https://github.com/systemd/systemd/issues/22244
        cockpit.file("/run/systemd/shutdown/scheduled").watch(() => {
            getScheduledShutdown(setShutdownTime, setShutdownType);
        });
    }, []);

    // We only care about these two types
    if (shutdownType !== "poweroff" && shutdownType !== "reboot") {
        // don't log undefined
        if (shutdownType !== null && shutdownType !== "") {
            console.log(`unsupported shutdown type ${shutdownType}`);
        }
        return null;
    }

    const date = new Date(shutdownTime / 1000);
    const now = new Date();
    let displayDate = null;
    if (date.getFullYear() == now.getFullYear()) {
        displayDate = timeformat.dateTimeNoYear(date);
    } else {
        displayDate = timeformat.dateTime(date);
    }

    let text;
    let cancelText;
    let icon;
    if (shutdownType === "poweroff") {
        icon = <PowerOffIcon className="shutdown-status-poweroff-icon" />;
        text = _("Scheduled poweroff at $0");
        cancelText = _("Cancel poweroff");
    } else {
        icon = <RedoIcon className="reboot-status-poweroff-icon" />;
        text = _("Scheduled reboot at $0");
        cancelText = _("Cancel reboot");
    }

    return (
        <li id="system-health-shutdown-status">
            <Flex spacer={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'nowrap' }}>
                <FlexItem>{icon}</FlexItem>
                <Flex id="system-health-shutdown-status-text" direction={{ default: 'column' }}>
                    {cockpit.format(text, displayDate)}
                    <FlexItem>
                        <Button variant="link" isInline
                                id="system-health-shutdown-status-cancel-btn"
                                className="pf-v5-u-font-size-sm"
                                onClick={cancelShutdownAction}>
                            {cancelText}
                        </Button>
                    </FlexItem>
                </Flex>
            </Flex>
        </li>);
};
