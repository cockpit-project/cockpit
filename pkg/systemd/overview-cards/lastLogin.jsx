/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import { ExclamationTriangleIcon, UserIcon } from "@patternfly/react-icons";

import * as timeformat from "timeformat";

import cockpit from "cockpit";

import './lastLogin.scss';

const _ = cockpit.gettext;

// Do the full combinatorial thing to improve translatability
const generate_line = (host, line) => {
    let message = "";
    if (host && line) {
        message = cockpit.format(_("from <host> on <terminal>", "from $0 on $1"), host, line);
    } else if (host) {
        message = cockpit.format(_("from <host>", "from $0"), host);
    } else if (line) {
        message = cockpit.format(_("on <terminal>", "on $0"), line);
    }
    return message;
};

const getFormattedDateTime = (time) => {
    const now = new Date();
    const date = new Date(time);
    if (date.getFullYear() == now.getFullYear()) {
        return timeformat.dateTimeNoYear(date);
    }
    return timeformat.dateTime(date);
};

const LastLogin = () => {
    const [messages, setLoginMessages] = useState(null);
    const [name, setName] = useState(null);

    useEffect(() => {
        if (messages === null) {
            const bridge = cockpit.dbus(null, { bus: "internal" });
            bridge.call("/LoginMessages", "cockpit.LoginMessages", "Get", [])
                    .then(reply => {
                        const obj = JSON.parse(reply[0]);
                        if (obj.version == 1) {
                            setLoginMessages(obj);
                        } else {
                        // empty reply is okay -- older bridges just don't send that information
                            if (obj.version !== undefined)
                                console.error("unknown login-messages:", reply[0]);
                        }
                    })
                    .catch(error => {
                        console.error("failed to fetch login messages:", error);
                    });
        }
        if (name === null) {
            cockpit.user().then(user => setName(user.name));
        }
    }, [messages, name]);

    if (messages === null || !messages['last-login-time']) {
        return null;
    }

    let icon = null;
    let headerText = null;
    let underlineText = null;
    let headerClass = "pf-v5-u-text-break-word";
    let underlineClass = "pf-v5-u-text-break-word";
    const lastLoginText = _("Last successful login:") + " " + getFormattedDateTime(messages['last-login-time'] * 1000);
    const failedLogins = messages['fail-count'];

    if (failedLogins) {
        let iconClass = "system-information-failed-login-warning-icon";
        if (failedLogins > 5) {
            iconClass = "system-information-failed-login-danger-icon";
            headerClass += " system-information-failed-login-danger";
        } else {
            headerClass += " system-information-failed-login-warning";
        }

        icon = <ExclamationTriangleIcon className={iconClass} />;
        headerText = cockpit.format(cockpit.ngettext("$0 failed login attempt", "$0 failed login attempts", failedLogins), failedLogins);
        underlineText = getFormattedDateTime(messages['last-login-time'] * 1000) + " " + generate_line(messages['last-login-host'], messages['last-login-line']);
    } else {
        icon = <UserIcon className="system-information-last-login-icon" />;
        headerText = lastLoginText;
        underlineClass += " ct-grey-text pf-v5-u-font-size-sm";
        underlineText = generate_line(messages['last-login-host'], messages['last-login-line']);
    }

    return (
        <li className="last-login" id="page_status_last_login">
            <Flex flexWrap={{ default: 'nowrap' }}>
                <FlexItem>{icon}</FlexItem>
                <div>
                    <div id="system_last_login"
                            className={headerClass}
                    >
                        {headerText}
                    </div>
                    <div id="system_last_login_from"
                              className={underlineClass}
                    >
                        {underlineText}
                    </div>
                    {failedLogins &&
                    <div id="system_last_login_success" className="pf-v5-u-text-break-word">
                        {lastLoginText}
                    </div>
                    }
                    {name &&
                        <Button variant="link" isInline
                                className="pf-v5-u-font-size-sm"
                                onClick={() => cockpit.jump("/users#/" + name)}>
                            {_("View login history")}
                        </Button>
                    }
                </div>
            </Flex>
        </li>
    );
};

export default LastLogin;
