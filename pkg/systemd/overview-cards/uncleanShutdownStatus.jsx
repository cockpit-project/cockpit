import React, { useState } from 'react';
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { ExclamationTriangleIcon} from "@patternfly/react-icons";

import cockpit from "cockpit";

import './uncleanShutdownStatus.scss';

const _ = cockpit.gettext;

export const UncleanShutdownStatus = () => {
    const [uncleanShutdownId, setUncleanShutdownId] = useState(() => {
        cockpit.spawn(
            ["last", "-xn2", "shutdown", "reboot"],
            { err: "ignore", }
        ).then((data) => {
            const shutdownLines = data
                .split("\n")
                .filter((line) => line.startsWith("shutdown"));

            const newUncleanShutdownId = shutdownLines.length == 0 ? data : "";
            setUncleanShutdownId(newUncleanShutdownId);
            setUncleanShutdownStatusVisible(
                newUncleanShutdownId != cockpit.localStorage.getItem("dismissed-unclean-shutdown-id")
            );
        });

        return "";
    });
    const [uncleanShutdownStatusVisible, setUncleanShutdownStatusVisible] = useState(false);

    if (!uncleanShutdownId || !uncleanShutdownStatusVisible) {
        return null;
    }

    function hideAlert() {
        setUncleanShutdownStatusVisible(false);
        cockpit.localStorage.setItem('dismissed-unclean-shutdown-id', uncleanShutdownId);
    }

    return (
        <li className="unclean-shutdown-status" id="page_status_unclean_shutdown">
            <Flex flexWrap={{ default: 'nowrap' }}>
                <FlexItem>
                    <ExclamationTriangleIcon className="system-information-unclean-shutdown-status-icon" />
                </FlexItem>
                <div>
                    <div className="pf-v6-u-text-break-word system-information-unclean-shutdown-status">
                        {_("Unclean shutdown")}
                    </div>
                    <ul className="comma-list">
                        <li>
                            <Button variant="link" isInline
                                    className="pf-v6-u-font-size-sm"
                                    onClick={() => cockpit.jump("/system/logs#/?priority=err&boot=-1")}>
                                {_("View logs")}
                            </Button>
                        </li>
                        <li>
                            <Button variant="link" isInline
                                    className="pf-v6-u-font-size-sm"
                                    onClick={() => hideAlert()}
                                    id="unclean-shutdown-status-dismiss">
                                {_("Dismiss")}
                            </Button>
                        </li>
                    </ul>
                </div>
            </Flex>
        </li>
    );
};
