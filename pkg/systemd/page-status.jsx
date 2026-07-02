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

import { health_status, SAFE_LINK_RE } from "overview";

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

    return null;
}

export class PageStatusNotifications extends React.Component {
    constructor() {
        super();
        this.state = { };
        this.on_health_changed = () => this.setState({ });
    }

    componentDidMount() {
        health_status.addEventListener("changed", this.on_health_changed);
    }

    componentWillUnmount() {
        health_status.removeEventListener("changed", this.on_health_changed);
    }

    render() {
        return health_status.list()
                .filter(n => typeof n.title === "string" && n.title)
                .map(notification => {
                    const id_attr = "page_status_notification_" + notification.publisher.replace(/\//g, '_');

                    const link = (typeof notification.link === "string" && SAFE_LINK_RE.test(notification.link))
                        ? notification.link
                        : null;
                    const action = link
                        ? (
                            <Button variant="link" isInline component="a"
                                    onClick={ev => { ev.preventDefault(); cockpit.jump("/" + link) }}>
                                {notification.title}
                            </Button>
                        )
                        : <span>{notification.title}</span>;

                    // 'type' carries either a severity or an allowlisted pficon
                    // name; arbitrary CSS class names are intentionally not honored.
                    const icon = get_pficon(notification.type) ?? icon_for_type(notification.type);

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
