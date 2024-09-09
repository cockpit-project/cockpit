/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hopeg that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import {
    new_card, ChildrenTable, StorageCard, StorageDescription
} from "../pages.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";
import { btrfs_device_usage } from "./utils.jsx";
import { btrfs_device_actions } from "./device.jsx";
import { BtrfsLabelDescription } from "./volume.jsx";

const _ = cockpit.gettext;

/**
 * For single btrfs volumes we show the data as a filesystem card with the
 * subvolumes directly undernearth. This differentiates from multi device
 * volumes, there they are shown under a different card.
 */
export function make_btrfs_filesystem_card(next, backing_block, content_block) {
    return new_card({
        title: _("btrfs filesystem"),
        next,
        actions: btrfs_device_actions(backing_block, content_block),
        component: BtrfsFilesystemCard,
        props: { backing_block, content_block },
    });
}

const BtrfsFilesystemCard = ({ card, backing_block, content_block }) => {
    const block_btrfs = client.blocks_fsys_btrfs[content_block.path];
    const uuid = block_btrfs && block_btrfs.data.uuid;
    const use = btrfs_device_usage(client, uuid, block_btrfs.path);

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <BtrfsLabelDescription block_btrfs={block_btrfs} />
                    <StorageDescription title={_("UUID")} value={content_block.IdUUID} />
                    { block_btrfs &&
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar key="s" stats={use} />
                    </StorageDescription>
                    }
                </DescriptionList>
            </CardBody>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No subvolumes")}
                               aria-label={_("btrfs subvolumes")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};
