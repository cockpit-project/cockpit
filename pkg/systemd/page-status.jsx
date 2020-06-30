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
import { page_status } from "notifications";

function icon_class_for_type(type) {
    if (type == "error")
        return 'fa fa-exclamation-circle';
    else if (type == "warning")
        return 'fa fa-exclamation-triangle';
    else
        return 'fa fa-info-circle';
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
                        action = <a href="#"
                                    onClick={ ev => { ev.preventDefault(); cockpit.jump("/" + status.details.link) } }>{status.title}</a>;
                    else
                        action = <span>{status.title}</span>; // no link
                } else {
                    action = <a href="#"
                                onClick={ ev => { ev.preventDefault(); cockpit.jump("/" + page) } }>{status.title}</a>;
                }

                let icon = status.details && status.details.icon;
                if (!icon)
                    icon = icon_class_for_type(status.type);
                return (
                    <li id={ "page_status_notification_" + page.replace('/', '_') } key={page}>
                        <span className={icon} />
                        {action}
                    </li>);
            } else {
                return null;
            }
        });
    }
}
