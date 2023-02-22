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
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import cockpit from "cockpit";
import { PageStatusNotifications } from "../page-status.jsx";
import { InsightsStatus } from "./insights.jsx";
import { ShutDownStatus } from "./shutdownStatus.jsx";
import LastLogin from "./lastLogin.jsx";
import { CryptoPolicyStatus } from "./cryptoPolicies.jsx";

import "./healthCard.scss";

const _ = cockpit.gettext;

export class HealthCard extends React.Component {
    render() {
        return (
            <Card className="system-health">
                <CardTitle>{_("Health")}</CardTitle>
                <CardBody>
                    <ul className="system-health-events">
                        <PageStatusNotifications />
                        <InsightsStatus />
                        <CryptoPolicyStatus />
                        <ShutDownStatus />
                        <LastLogin />
                    </ul>
                </CardBody>
                <CardFooter />
            </Card>
        );
    }
}
