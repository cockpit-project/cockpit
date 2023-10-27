/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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
import client from "../client";

import { Button } from "@patternfly/react-core/dist/esm/components/Button/index.js";
import { Card, CardHeader, CardTitle, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList, DescriptionListDescription, DescriptionListGroup, DescriptionListTerm } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
    register_crossref,
} from "../pages.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name, fmt_size } from "../utils.js";
import { std_lock_action } from "../actions.jsx";

const _ = cockpit.gettext;

export function make_stratis_blockdev_page(parent, backing_block, content_block, container) {
    const blockdev = client.blocks_stratis_blockdev[content_block.path];
    const pool = blockdev && client.stratis_pools[blockdev.Pool];
    const stopped_pool = client.blocks_stratis_stopped_pool[content_block.path];

    const p = new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name: block_name(backing_block),
        columns: [
            _("Stratis block device"),
            pool ? pool.Name : stopped_pool,
            fmt_size(backing_block.Size)
        ],
        component: StratisBlockdevPage,
        props: { backing_block, content_block, pool, stopped_pool },
        actions: [
            std_lock_action(backing_block, content_block),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });

    let desc;
    if (blockdev && blockdev.Tier == 0)
        desc = cockpit.format(_("$0 data"),
                              fmt_size(Number(blockdev.TotalPhysicalSize)));
    else if (blockdev && blockdev.Tier == 1)
        desc = cockpit.format(_("$0 cache"),
                              fmt_size(Number(blockdev.TotalPhysicalSize)));
    else
        desc = cockpit.format(_("$0 of unknown tier"),
                              fmt_size(backing_block.Size));

    if (pool || stopped_pool) {
        register_crossref({
            key: pool || stopped_pool,
            page: p,
            size: desc,
            actions: [],
        });
    }
}

export const StratisBlockdevPage = ({ page, backing_block, content_block, pool, stopped_pool }) => {
    const pool_name = pool ? pool.Name : stopped_pool;
    const pool_uuid = pool ? pool.Uuid : stopped_pool;

    return (
        <Stack hasGutter>
            <StackItem>
                <Card>
                    <CardHeader actions={{ actions: <ActionButtons page={page} /> }}>
                        <CardTitle component="h2">{page_type(page)}</CardTitle>
                    </CardHeader>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Stored on")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    <ParentPageLink page={page} />
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                            <DescriptionListGroup>
                                <DescriptionListTerm>{_("Stratis pool")}</DescriptionListTerm>
                                <DescriptionListDescription>
                                    {(pool || stopped_pool)
                                        ? <Button variant="link" isInline role="link"
                                                  onClick={() => cockpit.location.go(["pool", pool_uuid])}>
                                            {pool_name}
                                        </Button>
                                        : "-"
                                    }
                                </DescriptionListDescription>
                            </DescriptionListGroup>
                        </DescriptionList>
                    </CardBody>
                </Card>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
