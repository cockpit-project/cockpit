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

import cockpit from "cockpit";
import React from "react";

import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Grid, GridItem } from "@patternfly/react-core/dist/esm/layouts/Grid/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import * as utils from "./utils.js";
import { BlockDetails } from "./block-details.jsx";
import { DriveDetails } from "./drive-details.jsx";
import { VGroupDetails } from "./vgroup-details.jsx";
import { MDRaidDetails } from "./mdraid-details.jsx";
import { VDODetails } from "./vdo-details.jsx";
import { NFSDetails } from "./nfs-details.jsx";
import { StratisPoolDetails, StratisLockedPoolDetails } from "./stratis-details.jsx";
import { JobsPanel } from "./jobs-panel.jsx";

const _ = cockpit.gettext;

export class StdDetailsLayout extends React.Component {
    render() {
        if (this.props.sidebar) {
            return (
                <>
                    <GridItem id="detail-header" span={12}>
                        { this.props.alert }
                        { this.props.header }
                    </GridItem>
                    <GridItem span={12}>
                        <Flex direction={{ default: 'column', xl: 'row', "2xl": 'row' }}>
                            <FlexItem flex={{ default: 'flex_3' }}>
                                <div id="detail-content">
                                    { this.props.content }
                                    <JobsPanel client={this.props.client} />
                                </div>
                            </FlexItem>
                            <FlexItem id="detail-sidebar"
                                      flex={{ default: 'flex_1' }}>
                                { this.props.sidebar }
                            </FlexItem>
                        </Flex>
                    </GridItem>
                </>
            );
        } else {
            return (
                <>
                    <GridItem id="detail-header" md={12}>
                        { this.props.alert }
                        { this.props.header }
                    </GridItem>
                    <GridItem md={12}>
                        <GridItem id="detail-content">
                            { this.props.content }
                        </GridItem>
                        <JobsPanel client={this.props.client} />
                    </GridItem>
                </>
            );
        }
    }
}

export class Details extends React.Component {
    render() {
        const client = this.props.client;

        let body = null;
        let name = this.props.name;
        if (this.props.type == "block") {
            const block = client.slashdevs_block["/dev/" + this.props.name];
            const drive = block && client.drives[block.Drive];

            if (drive) {
                name = utils.drive_name(drive);
                body = <DriveDetails client={client} drive={drive} />;
            } else if (block) {
                name = utils.block_name(block);
                body = <BlockDetails client={client} block={block} />;
            }
        } else if (this.props.type == "vg") {
            const vgroup = client.vgnames_vgroup[this.props.name];
            if (vgroup) {
                name = vgroup.Name;
                body = <VGroupDetails client={client} vgroup={vgroup} />;
            }
        } else if (this.props.type == "mdraid") {
            const mdraid = client.uuids_mdraid[this.props.name];
            if (mdraid) {
                name = utils.mdraid_name(mdraid);
                body = <MDRaidDetails client={client} mdraid={mdraid} />;
            }
        } else if (this.props.type == "vdo") {
            const vdo = client.legacy_vdo_overlay.by_name[this.props.name];
            if (vdo) {
                name = vdo.name;
                body = <VDODetails client={client} vdo={vdo} />;
            }
        } else if (this.props.type == "nfs") {
            const entry = client.nfs.find_entry(name, this.props.name2);
            if (entry)
                body = <NFSDetails client={client} entry={entry} />;
        } else if (this.props.type == "pool") {
            const pool = (client.stratis_poolnames_pool[this.props.name] ||
                          client.stratis_pooluuids_pool[this.props.name]);
            const locked_props = client.stratis_manager.LockedPools[this.props.name];

            if (pool)
                body = <StratisPoolDetails client={client} pool={pool} />;
            else if (locked_props)
                body = <StratisLockedPoolDetails client={client} uuid={this.props.name} />;
        }

        if (!body)
            body = <GridItem span={12}>{_("Not found")}</GridItem>;

        return (
            <Page id="storage-detail">
                <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                    <Breadcrumb>
                        <BreadcrumbItem to="#/">{_("Storage")}</BreadcrumbItem>
                        <BreadcrumbItem isActive>{name}</BreadcrumbItem>
                    </Breadcrumb>
                </PageBreadcrumb>
                <PageSection>
                    <Grid hasGutter>
                        {body}
                    </Grid>
                </PageSection>
            </Page>
        );
    }
}
