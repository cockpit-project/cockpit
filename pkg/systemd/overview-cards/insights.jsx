/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2020 Red Hat, Inc.
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
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Flex } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { CheckIcon, ExclamationTriangleIcon } from '@patternfly/react-icons';
import { Icon } from "@patternfly/react-core/dist/esm/components/Icon/index.js";

import cockpit from "cockpit";
import * as service from "service.js";

import "./insights.scss";

const _ = cockpit.gettext;

export class InsightsStatus extends React.Component {
    constructor() {
        super();

        this.subman_supports_insights = (cockpit.manifests.subscriptions &&
                                         cockpit.manifests.subscriptions.features &&
                                         cockpit.manifests.subscriptions.features.insights);

        this.insights_client_timer = service.proxy("insights-client.timer");
        this.insights_client_timer.addEventListener("changed", () => this.setState({}));
    }

    render() {
        if (!this.insights_client_timer) {
            // Not mounted yet
            return null;
        }

        if (!this.insights_client_timer.exists) {
            // insights-client is not installed
            return null;
        }

        let text = _("Connected to Insights");
        let icon = <Icon status='success'><CheckIcon className="ct-check-circle" /></Icon>;

        if (!this.insights_client_timer.enabled) {
            // machine is not registered with Insights
            if (this.subman_supports_insights) {
                // subscriptions page can register us
                text = _("Not connected to Insights");
                icon = <Icon status='warning'><ExclamationTriangleIcon className="ct-exclamation-triangle" /></Icon>;
            } else
                return null;
        }

        const subman_installed = cockpit.manifests?.subscriptions;

        return (
            <li className="system-health-insights">
                <Flex flexWrap={{ default: 'nowrap' }} spaceItems={{ default: 'spaceItemsSm' }} alignItems={{ default: 'alignItemsCenter' }}>
                    {icon}
                    <Button isInline variant="link" component="a"
                        onClick={ev => { ev.preventDefault(); cockpit.jump("/subscriptions") }}
                        isDisabled={!subman_installed}
                    >
                        {text}
                    </Button>
                </Flex>
            </li>
        );
    }
}
