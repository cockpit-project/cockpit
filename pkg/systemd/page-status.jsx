/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import React from "react";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Spinner } from "@patternfly/react-core/dist/esm/components/Spinner/index.js";
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";
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

import { channel, OVERVIEW_HEALTH_CHANNEL, SAFE_LINK_RE } from "notifications";

function icon_for_type(type) {
    if (type == "error")
        return (
            <Icon status="danger">
                <ExclamationCircleIcon />
            </Icon>
        );
    else if (type == "warning")
        return (
            <Icon status="warning">
                <ExclamationTriangleIcon />
            </Icon>
        );
    else
        return (
            <Icon status="info">
                <InfoCircleIcon />
            </Icon>
        );
}

function get_pficon(name) {
    // set data-pficon for the tests
    if (name == "security")
        return <Icon isInline status="danger"><SecurityIcon data-pficon={name} /></Icon>;
    if (name == "enhancement")
        return <Icon isInline status="custom"><EnhancementIcon data-pficon={name} /></Icon>;
    if (name == "bug")
        return <Icon isInline className="pf-m-important"><BugIcon data-pficon={name} /></Icon>;
    if (name == "check")
        return <Icon isInline status="success"><CheckIcon data-pficon={name} /></Icon>;
    if (name == "spinner")
        return <Spinner diameter="1em" data-pficon={name} />;

    throw new Error(`get_pficon(): unknown icon name ${name}`);
}

export class PageStatusNotifications extends React.Component {
    constructor() {
        super();
        this.state = { };
        this.health_channel = channel(OVERVIEW_HEALTH_CHANNEL);
        this.on_channel_changed = () => this.setState({ });
    }

    componentDidMount() {
        this.health_channel.addEventListener("changed", this.on_channel_changed);
    }

    componentWillUnmount() {
        this.health_channel.removeEventListener("changed", this.on_channel_changed);
    }

    render() {
        return this.health_channel.list()
                .filter(n => typeof n.title === "string" && n.title && (n.type || n.details))
                .map(notification => {
                    const id = typeof notification.id === "string" ? notification.id : "";
                    const id_attr = "page_status_notification_" + id.replace(/\//g, '_');
                    const raw_link = notification.details?.link;
                    const link = (typeof raw_link === "string" && SAFE_LINK_RE.test(raw_link)) ? raw_link : null;

                    const action = link
                        ? (
                            <Button variant="link" isInline component="a"
                                    onClick={ev => { ev.preventDefault(); cockpit.jump("/" + link) }}>
                                {notification.title}
                            </Button>
                        )
                        : <span>{notification.title}</span>;

                    // Publisher-supplied pficon must be allowlisted; arbitrary
                    // CSS class names are intentionally not honored.
                    let icon;
                    const pficon = notification.details?.pficon;
                    if (typeof pficon === "string") {
                        try {
                            icon = get_pficon(pficon);
                        } catch {
                            icon = icon_for_type(notification.type);
                        }
                    } else {
                        icon = icon_for_type(notification.type);
                    }

                    return (
                        <li id={id_attr} key={notification.publisher}>
                            <Flex flexWrap={{ default: 'nowrap' }} spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                                {icon}
                                {action}
                            </Flex>
                        </li>
                    );
                });
    }
}
