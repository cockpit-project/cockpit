/*
 * Copyright (C) 2022 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import React, { useState, useEffect } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { PowerOffIcon, RedoIcon, MoonIcon } from "@patternfly/react-icons";

import * as timeformat from "timeformat";

import cockpit from "cockpit";

import "./shutdownStatus.scss";

const _ = cockpit.gettext;

const getScheduledShutdown = (setShutdownTime: (t: number) => void, setShutdownType: (t: string) => void) => {
    const client = cockpit.dbus("org.freedesktop.login1");
    return client.call("/org/freedesktop/login1", "org.freedesktop.DBus.Properties", "Get",
                       ["org.freedesktop.login1.Manager", "ScheduledShutdown"], { type: "ss" })
            .then(([result]) => {
                const [type, time] = (result as cockpit.Variant).v as [string, number];
                setShutdownType(type);
                setShutdownTime(time);
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

const getSuspendTimerInfo = (setSuspendScheduled: (s: boolean) => void, setSuspendTime: (t: string | null) => void) => {
    // Check if the cockpit-suspend.timer unit is active
    cockpit.spawn(["systemctl", "is-active", "cockpit-suspend.timer"], { err: "ignore" })
            .then(() => {
                // Timer is active, get the activation time
                cockpit.spawn(["systemctl", "show", "cockpit-suspend.timer", "--property=NextElapseUSecRealtime", "--value"], { err: "ignore" })
                        .then(output => {
                            const timeStr = output.trim();
                            setSuspendScheduled(true);
                            setSuspendTime(timeStr || null);
                        })
                        .catch(() => {
                            setSuspendScheduled(true);
                            setSuspendTime(null);
                        });
            })
            .catch(() => {
                setSuspendScheduled(false);
                setSuspendTime(null);
            });
};

const cancelSuspendAction = () => {
    return cockpit.spawn(["systemctl", "stop", "cockpit-suspend.timer"], { superuser: "require", err: "message" })
            .catch(err => console.warn("Failed to cancel suspend timer", err.toString()));
};

export const ShutDownStatus = () => {
    const [shutdownType, setShutdownType] = useState<string | null>(null);
    const [shutdownTime, setShutdownTime] = useState<number | null>(0);

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

    let displayDate = null;
    if (shutdownTime) {
        const date = new Date(shutdownTime / 1000);
        const now = new Date();
        if (date.getFullYear() == now.getFullYear()) {
            displayDate = timeformat.dateTimeNoYear(date);
        } else {
            displayDate = timeformat.dateTime(date);
        }
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
            <Flex flexWrap={{ default: 'nowrap' }}>
                <FlexItem>{icon}</FlexItem>
                <Flex id="system-health-shutdown-status-text" spaceItems={{ default: 'spaceItemsNone' }} direction={{ default: 'column' }}>
                    {cockpit.format(text, displayDate)}
                    <FlexItem>
                        <Button variant="link" isInline
                                id="system-health-shutdown-status-cancel-btn"
                                className="pf-v6-u-font-size-sm"
                                onClick={cancelShutdownAction}>
                            {cancelText}
                        </Button>
                    </FlexItem>
                </Flex>
            </Flex>
        </li>);
};

export const SuspendStatus = () => {
    const [suspendScheduled, setSuspendScheduled] = useState(false);
    const [suspendTime, setSuspendTime] = useState<string | null>(null);

    useEffect(() => {
        const checkTimer = () => getSuspendTimerInfo(setSuspendScheduled, setSuspendTime);

        checkTimer();

        // Watch for transient unit changes — poll periodically since there's no
        // reliable file-watch for transient timers
        const interval = window.setInterval(checkTimer, 5000);
        return () => window.clearInterval(interval);
    }, []);

    if (!suspendScheduled) {
        return null;
    }

    let displayDate: string | null = null;
    if (suspendTime) {
        // systemctl shows NextElapseUSecRealtime in a format like "Wed 2025-04-05 10:30:00 UTC"
        const date = new Date(suspendTime);
        if (!isNaN(date.getTime())) {
            const now = new Date();
            if (date.getFullYear() == now.getFullYear()) {
                displayDate = timeformat.dateTimeNoYear(date);
            } else {
                displayDate = timeformat.dateTime(date);
            }
        } else {
            // If parsing fails, show the raw string
            displayDate = suspendTime;
        }
    }

    const handleCancel = () => {
        cancelSuspendAction().then(() => {
            setSuspendScheduled(false);
            setSuspendTime(null);
        });
    };

    const text = displayDate
        ? cockpit.format(_("Scheduled suspend at $0"), displayDate)
        : _("Scheduled suspend");

    return (
        <li id="system-health-suspend-status">
            <Flex flexWrap={{ default: 'nowrap' }}>
                <FlexItem><MoonIcon className="suspend-status-icon" /></FlexItem>
                <Flex spaceItems={{ default: 'spaceItemsNone' }} direction={{ default: 'column' }}>
                    <span id="system-health-suspend-status-text">{text}</span>
                    <FlexItem>
                        <Button variant="link" isInline
                                id="system-health-suspend-status-cancel-btn"
                                className="pf-v6-u-font-size-sm"
                                onClick={handleCancel}>
                            {_("Cancel suspend")}
                        </Button>
                    </FlexItem>
                </Flex>
            </Flex>
        </li>);
};
