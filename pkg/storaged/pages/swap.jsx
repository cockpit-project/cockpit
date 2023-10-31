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

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { useEvent } from "hooks";

import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
} from "../pages.jsx";
import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name, fmt_size, decode_filename } from "../utils.js";
import { std_lock_action } from "../actions.jsx";
import { StorageSize } from "../storage-controls.jsx";

const _ = cockpit.gettext;

export function make_swap_page(parent, backing_block, content_block, container) {
    const block_swap = client.blocks_swap[content_block.path];

    new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name: block_name(backing_block),
        columns: [
            _("Swap"),
            null,
            <StorageSize key="s" size={backing_block.Size} />,
        ],
        component: SwapPage,
        props: { block: content_block, block_swap },
        actions: [
            std_lock_action(backing_block, content_block),
            (block_swap && block_swap.Active
                ? { title: _("Stop"), action: () => block_swap.Stop({}) }
                : null),
            (block_swap && !block_swap.Active
                ? { title: _("Start"), action: () => block_swap.Start({}) }
                : null),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });
}

export const SwapPage = ({ page, block, block_swap }) => {
    const is_active = block_swap && block_swap.Active;
    let used;

    useEvent(client.swap_sizes, "changed");

    if (is_active) {
        const samples = client.swap_sizes.data[decode_filename(block.Device)];
        if (samples)
            used = fmt_size(samples[0] - samples[1]);
        else
            used = _("Unknown");
    } else {
        used = "-";
    }

    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Used")} value={used} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
