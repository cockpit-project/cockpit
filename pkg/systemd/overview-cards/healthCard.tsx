/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import React from 'react';
import { Card, CardBody, CardFooter, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";

import cockpit from "cockpit";
import { PageStatusNotifications } from "../page-status.jsx";
import { InsightsStatus } from "./insights.jsx";
import { ShutDownStatus } from "./shutdownStatus.jsx";
import { UncleanShutdownStatus } from "./uncleanShutdownStatus.jsx";
import LastLogin from "./lastLogin.jsx";
import { CryptoPolicyStatus } from "./cryptoPolicies.jsx";

import "./healthCard.scss";
import { SmartOverviewStatus } from './smart-status.jsx';

const _ = cockpit.gettext;

export const HealthCard = () =>
    <Card className="system-health">
        <CardTitle>{_("Health")}</CardTitle>
        <CardBody>
            <ul className="system-health-events">
                <PageStatusNotifications />
                <InsightsStatus />
                <CryptoPolicyStatus />
                <ShutDownStatus />
                <UncleanShutdownStatus />
                <SmartOverviewStatus />
                <LastLogin />
            </ul>
        </CardBody>
        <CardFooter />
    </Card>;
