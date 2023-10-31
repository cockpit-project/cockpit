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

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { ParentPageLink, PageContainerStackItems, new_page, block_location, ActionButtons } from "../pages.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { block_name } from "../utils.js";
import { unlock } from "../actions.jsx";
import { StorageSize } from "../storage-controls.jsx";

const _ = cockpit.gettext;

export function make_locked_encrypted_data_page(parent, block, container) {
    new_page({
        location: [block_location(block)],
        parent,
        container,
        name: block_name(block),
        columns: [
            _("Locked encrypted data"),
            null,
            <StorageSize key="s" size={(block.Size)} />,
        ],
        component: LockedEncryptedDataPage,
        props: { block },
        actions: [
            { title: _("Unlock"), action: () => unlock(block) },
            { title: _("Format"), action: () => format_dialog(client, block.path), danger: true },
        ]
    });
}

export const LockedEncryptedDataPage = ({ page, block }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={_("Locked encrypted data")} actions={<ActionButtons page={page} />}>
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
