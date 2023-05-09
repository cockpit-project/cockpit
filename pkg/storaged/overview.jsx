/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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

import React from "react";

import { Page, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Card, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import { StoragePlots } from "./plot.jsx";

import { FilesystemsPanel } from "./fsys-panel.jsx";
import { LockedCryptoPanel } from "./crypto-panel.jsx";
import { NFSPanel } from "./nfs-panel.jsx";
import { ThingsPanel } from "./things-panel.jsx";
import { IscsiPanel } from "./iscsi-panel.jsx";
import { DrivesPanel } from "./drives-panel.jsx";
import { OthersPanel } from "./others-panel.jsx";

import { JobsPanel } from "./jobs-panel.jsx";
import { StorageLogsPanel } from "./logs-panel.jsx";

export const Overview = ({ client, plot_state }) => {
    return (
        <Page id="main-storage">
            <PageSection>
                <Flex alignItems={{ default: 'alignItemsFlexStart' }}>
                    <FlexItem flex={{ lg: 'flex_3' }}>
                        <Stack hasGutter>
                            <Card>
                                <CardBody>
                                    <StoragePlots plot_state={plot_state} />
                                </CardBody>
                            </Card>
                            <FilesystemsPanel client={client} />
                            <LockedCryptoPanel client={client} />
                            <NFSPanel client={client} />
                            <JobsPanel client={client} />
                            <StorageLogsPanel />
                        </Stack>
                    </FlexItem>
                    <FlexItem flex={{ lg: 'flex_1' }} className="storage-sidebar">
                        <Stack hasGutter>
                            <ThingsPanel client={client} />
                            <DrivesPanel client={client} />
                            <IscsiPanel client={client} />
                            <OthersPanel client={client} />
                        </Stack>
                    </FlexItem>
                </Flex>
            </PageSection>
        </Page>
    );
};
