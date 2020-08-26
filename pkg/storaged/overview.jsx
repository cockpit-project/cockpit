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

import { Page, PageSection, Grid, GridItem } from "@patternfly/react-core";

import { StoragePlots } from "./plot.jsx";

import { FilesystemsPanel } from "./fsys-panel.jsx";
import { NFSPanel } from "./nfs-panel.jsx";
import { ThingsPanel } from "./things-panel.jsx";
import { IscsiPanel } from "./iscsi-panel.jsx";
import { DrivesPanel } from "./drives-panel.jsx";
import { OthersPanel } from "./others-panel.jsx";

import { JobsPanel } from "./jobs-panel.jsx";
import { StorageLogsPanel } from "./logs-panel.jsx";

export class Overview extends React.Component {
    constructor() {
        super();
        this.state = { highlight: false };
    }

    render() {
        var client = this.props.client;

        return (
            <Page>
                <Grid>
                    <GridItem md={8} lg={9}>
                        <PageSection>
                            <StoragePlots client={client} onHover={(dev) => this.setState({ highlight: dev })} />
                        </PageSection>
                        <PageSection>
                            <FilesystemsPanel client={client} />
                            <NFSPanel client={client} />
                            <JobsPanel client={client} />
                            <StorageLogsPanel />
                        </PageSection>
                    </GridItem>
                    <GridItem md={4} lg={3} className="storage-sidebar">
                        <PageSection>
                            <ThingsPanel client={client} />
                            <DrivesPanel client={client} highlight={this.state.highlight} />
                            <IscsiPanel client={client} />
                            <OthersPanel client={client} />
                        </PageSection>
                    </GridItem>
                </Grid>
            </Page>
        );
    }
}
