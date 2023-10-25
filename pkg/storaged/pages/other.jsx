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

import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, ActionButtons, new_page, page_type, block_location } from "../pages.jsx";
import { block_name, fmt_size } from "../utils.js";
import { format_disk } from "../content-views.jsx"; // XXX

import { make_block_pages } from "../create-pages.jsx";

const _ = cockpit.gettext;

export function make_other_page(parent, block) {
    const p = new_page({
        location: ["other", block_location(block)],
        parent,
        name: block_location(block),
        columns: [
            _("Block device"),
            block_name(block),
            fmt_size(block.Size)
        ],
        actions: [
            {
                title: _("Create partition table"),
                action: () => format_disk(client, block),
                excuse: block.ReadOnly ? _("Device is read-only") : null,
            },
        ],
        component: OtherPage,
        props: { block }
    });

    make_block_pages(p, block, null);
}

const OtherPage = ({ page, block }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Device number")}
                                   value={Math.floor(block.DeviceNumber / 256) + ":" + block.DeviceNumber % 256} />
                            <SDesc title={_("Device file")} value={block_name(block)} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageChildrenCard title={client.blocks_ptable[block.path] ? _("Partitions") : _("Content")}
                                  actions={<ActionButtons page={page} />}
                                  page={page} />
            </StackItem>
        </Stack>
    );
};
