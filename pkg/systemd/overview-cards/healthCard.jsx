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

import React from 'react';
import { Card, CardHeader, CardBody, CardFooter } from '@patternfly/react-core';

import cockpit from "cockpit";
import { page_status } from "notifications";
import { PageStatusNotifications } from "../page-status.jsx";
import * as service from "service.js";

import "./healthCard.less";

const _ = cockpit.gettext;

export class HealthCard extends React.Component {
    constructor() {
        super();
        this.state = { insightsLinkVisible: false, updateDetails: undefined };
        this.refresh_os_updates_state = this.refresh_os_updates_state.bind(this);
        this.refresh_insights_status = this.refresh_insights_status.bind(this);
    }

    componentDidMount() {
        page_status.addEventListener("changed", this.refresh_os_updates_state);
        this.refresh_os_updates_state();

        this.insights_client_timer = service.proxy("insights-client.timer");
        this.insights_client_timer.addEventListener("changed", this.refresh_insights_status);
        this.refresh_insights_status();
    }

    refresh_insights_status() {
        const subfeats = (cockpit.manifests.subscriptions && cockpit.manifests.subscriptions.features) || { };
        if (subfeats.insights && this.insights_client_timer.exists && !this.insights_client_timer.enabled)
            this.setState({ insightsLinkVisible: true });
        else
            this.setState({ insightsLinkVisible: false });
    }

    refresh_os_updates_state() {
        const status = page_status.get("updates") || { };
        const details = status.details;

        this.setState({
            updateDetails: details,
            updateStatus: status,
        });
    }

    render() {
        const updateDetails = this.state.updateDetails || { };
        return (
            <Card className="system-health">
                <CardHeader>{_("Health")}</CardHeader>
                <CardBody>
                    <ul className="system-health-events">
                        <PageStatusNotifications />
                        <li>
                            <>
                                {this.state.updateDetails !== undefined ? <>
                                    <span id="system_information_updates_icon" className={updateDetails.icon || ""} />
                                    <a role="link" tabIndex="0" id="system_information_updates_text" onClick={() => cockpit.jump("/" + (updateDetails.link || "updates"))}>{updateDetails.text || this.state.updateStatus.title || ""}</a>
                                </> : <>
                                    <span className="spinner spinner-xs" />
                                    <span>{_("Checking for package updates...")}</span>
                                </>}
                            </>
                        </li>
                        {this.state.insightsLinkVisible && <li className="system-health-insights">
                            <span className="fa fa-exclamation-triangle" />
                            { cockpit.manifests.subscriptions
                                ? <a id="insights_text" tabIndex='0' role="button" onClick={() => cockpit.jump("/subscriptions")}>{_("Not connected to Insights")}</a>
                                : <span id="insights_text">{_("Not connected to Insights")}</span>}
                        </li>}
                    </ul>
                </CardBody>
                <CardFooter />
            </Card>
        );
    }
}
