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

import { Card, CardHeader, CardBody, CardTitle } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { fmt_to_fragments } from "utils.jsx";

import * as utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import { block_description, create_tabs } from "./content-views.jsx";
import { StorageButton } from "./storage-controls.jsx";

const _ = cockpit.gettext;

export function block_nav_parents(client, block) {
    // XXX - terrible. The client should build a proper hierachical model.

    const drive = client.drives[block.Drive];
    const drive_block = drive && client.drives_block[drive.path];
    if (drive && drive_block) {
        return [
            {
                location: ["drive", utils.block_name(drive_block).replace(/^\/dev\//, "")],
                title: utils.drive_name(drive)
            }
        ];
    }

    const mdraid = client.mdraids[block.MDRaid];
    if (mdraid) {
        return [{ location: ["md", mdraid.UUID], title: "XXX - mdraid" }];
    }

    const lvol = client.blocks_lvm2[block.path] && client.lvols[client.blocks_lvm2[block.path].LogicalVolume];
    const pool = lvol && client.lvols[lvol.Pool];
    const vgroup = lvol && client.vgroups[lvol.VolumeGroup];

    if (lvol && vgroup && pool) {
        return [{ location: ["vg", vgroup.Name, pool.Name], title: pool.Name },
            { location: ["vg", vgroup.Name], title: vgroup.Name }
        ];
    }

    if (lvol && vgroup) {
        return [{ location: ["vg", vgroup.Name], title: vgroup.Name }];
    }

    const stratis_fsys = client.blocks_stratis_fsys[block.path];
    const stratis_pool = stratis_fsys && client.stratis_pools[stratis_fsys.Pool];
    if (stratis_fsys && stratis_pool) {
        return [{ location: ["pool", stratis_pool.Uuid], title: stratis_pool.Name }];
    }

    return [];
}

export class BlockDetails extends React.Component {
    render() {
        const client = this.props.client;
        const block = this.props.block;
        const tabs = create_tabs(this.props.client, block, {});

        const actions = tabs.actions;
        tabs.menu_actions.forEach(a => {
            if (!a.only_narrow)
                actions.push(<StorageButton onClick={a.func}>{a.title}</StorageButton>);
        });
        tabs.menu_danger_actions.forEach(a => {
            if (!a.only_narrow)
                actions.push(<StorageButton kind="danger" onClick={a.func}>{a.title}</StorageButton>);
        });

        const cparts = utils.get_block_link_parts(client, block.path);

        function is_container(r) {
            return r.name == _("Logical volume") || r.name == _("Partition");
        }

        const container_renderers = tabs.renderers.filter(is_container);
        const content_renderers = tabs.renderers.filter(r => !is_container(r));

        const header = (
            <Card>
                <CardHeader actions={{ actions }}>
                    <CardTitle component="h2">
                        {block_description(client, block, {}).type}
                    </CardTitle>
                </CardHeader>
                <CardBody>
                    <DescriptionList className="pf-m-horizontal-on-sm">
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("Stored on")}</DescriptionListTerm>
                            <DescriptionListDescription>
                                {fmt_to_fragments(
                                    cparts.format,
                                    <Button variant="link"
                                            isInline
                                            role="link"
                                            onClick={() => cockpit.location.go(cparts.location)}>
                                        {cparts.link}
                                    </Button>)}
                            </DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Capacity")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.fmt_size_long(block.Size) }</DescriptionListDescription>
                        </DescriptionListGroup>
                        <DescriptionListGroup>
                            <DescriptionListTerm>{_("storage", "Device file")}</DescriptionListTerm>
                            <DescriptionListDescription>{ utils.block_name(block) }</DescriptionListDescription>
                        </DescriptionListGroup>
                    </DescriptionList>
                    { content_renderers.map(t => <React.Fragment key={t.name}><br /><t.renderer {...t.data} /></React.Fragment>) }
                </CardBody>
            </Card>
        );

        const content = container_renderers.map(t => {
            return (
                <Card key={t.name}>
                    <CardHeader>
                        <CardTitle component="h2">
                            {t.name}
                        </CardTitle>
                    </CardHeader>
                    <CardBody>
                        <t.renderer {...t.data} />
                    </CardBody>
                </Card>);
        });

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
