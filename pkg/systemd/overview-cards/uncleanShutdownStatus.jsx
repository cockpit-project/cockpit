/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";

import cockpit from "cockpit";

import { useInit } from 'hooks';

const _ = cockpit.gettext;

export const UncleanShutdownStatus = () => {
    const [uncleanShutdownId, setUncleanShutdownId] = useState(null);
    const [uncleanShutdownStatusVisible, setUncleanShutdownStatusVisible] = useState(false);

    useInit(() => {
        cockpit.spawn(
            ["last", "--system", "--limit=2", "--time-format=iso", "shutdown", "reboot"],
            { environ: ["LC_ALL=C"], err: "message", }
        ).then((data) => {
            const previous_boot = data.split("\n")[1];
            if (previous_boot === undefined)
                return;

            // "crash" on wtmpdb, "still running" on util-linux
            if (!previous_boot.includes("crash") && !previous_boot.includes("still running"))
                return;

            const lines = previous_boot.split(/ +/);
            const started = new Date(lines[4]);
            if (isNaN(started)) {
                console.warn("cannot parse start date of last line", previous_boot);
            } else {
                const epoch = started.getTime().toString();
                setUncleanShutdownId(epoch);
                setUncleanShutdownStatusVisible(epoch != cockpit.sessionStorage.getItem("dismissed-unclean-shutdown-id"));
            }
        });
    });

    if (!uncleanShutdownId || !uncleanShutdownStatusVisible) {
        return null;
    }

    function hideAlert() {
        setUncleanShutdownStatusVisible(false);
        cockpit.sessionStorage.setItem('dismissed-unclean-shutdown-id', uncleanShutdownId);
    }

    return (
        <li id="unclean-shutdown-status">
            <Flex flexWrap={{ default: 'nowrap' }}>
                <FlexItem>
                    <Icon status="danger">
                        <ExclamationTriangleIcon />
                    </Icon>
                </FlexItem>
                <div>
                    <div className="pf-v6-u-text-break-word pf-v6-u-text-color-status-danger">
                        {_("Unclean shutdown")}
                    </div>
                    <Flex>
                        <Button variant="link" isInline
                                    className="pf-v6-u-font-size-sm"
                                    onClick={() => cockpit.jump("/system/logs#/?boot=-1")}>
                            {_("View logs")}
                        </Button>
                        <Button variant="link" isInline
                                    className="pf-v6-u-font-size-sm"
                                    onClick={() => hideAlert()}
                                    id="unclean-shutdown-status-dismiss">
                            {_("Dismiss")}
                        </Button>
                    </Flex>
                </div>
            </Flex>
        </li>
    );
};
