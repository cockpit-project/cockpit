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

import { Card } from '@patternfly/react-core/dist/esm/components/Card/index.js';
import { Page, PageBreadcrumb, PageSection } from "@patternfly/react-core/dist/esm/components/Page/index.js";
import { Breadcrumb, BreadcrumbItem } from "@patternfly/react-core/dist/esm/components/Breadcrumb/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import * as utils from "./utils.js";
import { BlockDetails } from "./block-details.jsx";
import { DriveDetails } from "./drive-details.jsx";
import { VGroupDetails } from "./vgroup-details.jsx";
import { MDRaidDetails } from "./mdraid-details.jsx";
import { VDODetails } from "./vdo-details.jsx";
import { NFSDetails } from "./nfs-details.jsx";
import { StratisPoolDetails, StratisStoppedPoolDetails } from "./stratis-details.jsx";
import { JobsPanel } from "./jobs-panel.jsx";

const _ = cockpit.gettext;

export const StdDetailsLayout = ({ client, alerts, header, content, sidebar }) => {
    const top = <>
        { (alerts || []).filter(a => !!a).map((a, i) => <StackItem key={i}><Card>{a}</Card></StackItem>) }
        <StackItem id="detail-header">
            { header }
        </StackItem>
    </>;

    if (sidebar) {
        return (
            <>
                { top }
                <Flex direction={{ default: 'column', xl: 'row', "2xl": 'row' }}>
                    <FlexItem flex={{ default: 'flex_3' }}>
                        <div id="detail-content">
                            { content }
                            <JobsPanel client={client} />
                        </div>
                    </FlexItem>
                    <FlexItem id="detail-sidebar"
                              flex={{ default: 'flex_1' }}>
                        { sidebar }
                    </FlexItem>
                </Flex>
            </>
        );
    } else {
        return (
            <>
                { top }
                <StackItem>
                    <div id="detail-content">
                        { content }
                    </div>
                    <JobsPanel client={client} />
                </StackItem>
            </>
        );
    }
};

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
            const stopped_props = client.stratis_manager.StoppedPools[this.props.name];

            if (pool)
                body = <StratisPoolDetails client={client} pool={pool} />;
            else if (stopped_props)
                body = <StratisStoppedPoolDetails client={client} uuid={this.props.name} />;
        }

        if (!body)
            body = _("Not found");

        return (
            <Page id="storage-detail">
                <PageBreadcrumb stickyOnBreakpoint={{ default: "top" }}>
                    <Breadcrumb>
                        <BreadcrumbItem to="#/">{_("Storage")}</BreadcrumbItem>
                        <BreadcrumbItem isActive>{name}</BreadcrumbItem>
                    </Breadcrumb>
                </PageBreadcrumb>
                <PageSection>
                    <Stack hasGutter>
                        {body}
                    </Stack>
                </PageSection>
            </Page>
        );
    }
}
