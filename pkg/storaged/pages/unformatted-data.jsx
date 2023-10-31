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

import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
} from "../pages.jsx";
import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name } from "../utils.js";
import { std_lock_action } from "../actions.jsx";
import { StorageSize } from "../storage-controls.jsx";

const _ = cockpit.gettext;

export function make_unformatted_data_page(parent, backing_block, content_block, container) {
    new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name: block_name(backing_block),
        columns: [
            _("Unformatted data"),
            null,
            <StorageSize key="s" size={backing_block.Size} />,
        ],
        component: UnformattedDataPage,
        props: { backing_block, content_block },
        actions: [
            std_lock_action(backing_block, content_block),
            { title: _("Format"), action: () => format_dialog(client, backing_block.path) },
        ]
    });
}

export const UnformattedDataPage = ({ page, backing_block, content_block }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
