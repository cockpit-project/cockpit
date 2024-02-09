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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import React from "react";
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import {
    new_card, ChildrenTable, StorageCard, StorageDescription
} from "../pages.jsx";
import { StorageUsageBar, StorageLink } from "../storage-controls.jsx";
import { btrfs_device_usage, btrfs_is_volume_mounted } from "./utils.jsx";
import { btrfs_device_actions } from "./device.jsx";
import { rename_dialog } from "./volume.jsx";

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
    const label = block_btrfs && block_btrfs.data.label;
    const use = btrfs_device_usage(client, uuid, block_btrfs.path);

    // Changing the label is only supported when the device is not mounted
    // otherwise we will get btrfs filesystem error ERROR: device /dev/vda5 is
    // mounted, use mount point. This is a libblockdev/udisks limitation as it
    // only passes the device and not the mountpoint when the device is mounted.
    // https://github.com/storaged-project/libblockdev/issues/966
    const is_mounted = btrfs_is_volume_mounted(client, [backing_block]);

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Label")}
                                                value={label}
                                                action={
                                                    <StorageLink onClick={() => rename_dialog(block_btrfs, label)}
                                                               excuse={is_mounted ? _("Btrfs volume is mounted") : null}>
                                                        {_("edit")}
                                                    </StorageLink>}
                    />
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
