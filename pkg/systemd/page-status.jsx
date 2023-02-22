/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2019 Red Hat, Inc.
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

import cockpit from "cockpit";

import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import {
    BugIcon,
    CheckIcon,
    EnhancementIcon,
    ExclamationCircleIcon,
    InfoCircleIcon,
    SecurityIcon,
    ExclamationTriangleIcon,
} from '@patternfly/react-icons';

import "./page-status.scss";

import { page_status } from "notifications";

function icon_for_type(type) {
    if (type == "error")
        return <ExclamationCircleIcon className="ct-exclamation-circle" />;
    else if (type == "warning")
        return <ExclamationTriangleIcon className="ct-exclamation-triangle" />;
    else
        return <InfoCircleIcon className="ct-info-circle" />;
}

function get_pficon(name) {
    // set data-pficon for the tests
    if (name == "security")
        return <SecurityIcon data-pficon={name} />;
    if (name == "enhancement")
        return <EnhancementIcon data-pficon={name} />;
    if (name == "bug")
        return <BugIcon data-pficon={name} className="page-status-bug-icon" />;
    if (name == "check")
        return <CheckIcon color="green" data-pficon={name} />;
    if (name == "spinner")
        return <Spinner isSVG size="md" data-pficon={name} />;

    throw new Error(`get_pficon(): unknown icon name ${name}`);
}

export class PageStatusNotifications extends React.Component {
    constructor() {
        super();
        this.state = { };
        this.on_page_status_changed = () => this.setState({ });
    }

    componentDidMount() {
        page_status.addEventListener("changed", this.on_page_status_changed);
    }

    componentWillUnmount() {
        page_status.removeEventListener("changed", this.on_page_status_changed);
    }

    render() {
        // Explicit allowlist for now, until we can get a dynamic list
        return ["system/services", "updates"].map(page => {
            const status = page_status.get(page);
            if (status && (status.type || status.details) && status.title) {
                let action;
                if (status.details && status.details.link !== undefined) {
                    if (status.details.link)
                        action = <Button variant="link" isInline component="a"
                                         onClick={ ev => { ev.preventDefault(); cockpit.jump("/" + status.details.link) } }>{status.title}</Button>;
                    else
                        action = <span>{status.title}</span>; // no link
                } else {
                    action = <Button variant="link" isInline component="a"
                                     onClick={ ev => { ev.preventDefault(); cockpit.jump("/" + page) } }>{status.title}</Button>;
                }

                let icon;
                if (status.details && status.details.icon)
                    icon = <span className={status.details.icon} />;
                else if (status.details && status.details.pficon)
                    icon = get_pficon(status.details.pficon);
                else
                    icon = icon_for_type(status.type);
                return (
                    <li id={ "page_status_notification_" + page.replace('/', '_') } key={page}>
                        <Flex flexWrap={{ default: 'nowrap' }} spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                            {icon}
                            {action}
                        </Flex>
                    </li>
                );
            } else {
                return null;
            }
        });
    }
}
