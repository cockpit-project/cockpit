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

import { CardHeader, CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { VolumeIcon } from "../icons/gnome-icons.jsx";

import {
    new_card, new_page, PAGE_CATEGORY_VIRTUAL,
    get_crossrefs, ChildrenTable, PageTable, StorageCard, StorageDescription
} from "../pages.jsx";
import { StorageUsageBar, StorageLink } from "../storage-controls.jsx";
import { fmt_size_long, validate_fsys_label, should_ignore } from "../utils.js";
import { btrfs_usage } from "./utils.jsx";
import { dialog_open, TextInput } from "../dialog.jsx";
import { make_btrfs_subvolume_pages } from "./subvolume.jsx";
import { btrfs_device_actions } from "./device.jsx";

const _ = cockpit.gettext;

/*
 * Udisks is a disk/block library so it manages that, btrfs turns this a bit
 * around and has one "volume" which can have multiple blocks by a unique uuid.
 *
 * Cockpit shows Btrfs as following:
 *
 * -> btrfs subvolume
 *    -> btrfs volume
 *        -> btrfs device
 *            -> block device
 */
export function make_btrfs_volume_page(parent, uuid) {
    const block_devices = client.uuids_btrfs_blocks[uuid];
    const block_btrfs = client.blocks_fsys_btrfs[block_devices[0].path];
    const volume = client.uuids_btrfs_volume[uuid];
    const use = btrfs_usage(client, volume);

    if (block_devices.some(blk => should_ignore(client, blk.path)))
        return;

    // Single-device btrfs volumes are shown directly on the page of
    // their device; they don't get a standalone "btrfs volume" page.
    if (block_btrfs.data.num_devices === 1)
        return;

    const name = block_btrfs.data.label || uuid;
    const btrfs_volume_card = new_card({
        title: _("btrfs volume"),
        next: null,
        page_location: ["btrfs-volume", uuid],
        page_name: name,
        page_icon: VolumeIcon,
        page_category: PAGE_CATEGORY_VIRTUAL,
        page_size: use[1],
        component: BtrfsVolumeCard,
        props: { block_devices, uuid, use },
    });

    const subvolumes_card = make_btrfs_subvolumes_card(btrfs_volume_card, null, null);

    const subvolumes_page = new_page(parent, subvolumes_card);
    make_btrfs_subvolume_pages(subvolumes_page, volume);
}

function rename_dialog(block_btrfs, label, rw_mount_point) {
    dialog_open({
        Title: _("Change label"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          validate: name => validate_fsys_label(name, "btrfs"),
                          value: label
                      })
        ],
        Action: {
            Title: _("Save"),
            action: async function (vals) {
                if (rw_mount_point) {
                    await cockpit.spawn(["btrfs", "filesystem", "label", rw_mount_point, vals.name],
                                        { superuser: true });
                    const block = client.blocks[block_btrfs.path];
                    await block.Rescan({});
                } else
                    await block_btrfs.SetLabel(vals.name, {});
            }
        }
    });
}

export const BtrfsLabelDescription = ({ block_btrfs }) => {
    const label = block_btrfs.data.label || "-";

    // We can change the label when at least one filesystem subvolume
    // is mounted rw, or when nothing is mounted.

    let rw_mount_point = null;
    let is_mounted = false;
    const mount_points = client.btrfs_mounts[block_btrfs.data.uuid];
    for (const id in mount_points) {
        const mp = mount_points[id];
        if (mp.mount_points.length > 0)
            is_mounted = true;
        if (mp.rw_mount_points.length > 0 && !rw_mount_point)
            rw_mount_point = mp.rw_mount_points[0];
    }

    let excuse = null;
    if (is_mounted && !rw_mount_point)
        excuse = _("Filesystem is mounted read-only");

    return <StorageDescription title={_("Label")}
                               value={label}
                               action={
                                   <StorageLink onClick={() => rename_dialog(block_btrfs, label, rw_mount_point)}
                                                excuse={excuse}>
                                       {_("edit")}
                                   </StorageLink>}
    />;
};

const BtrfsVolumeCard = ({ card, block_devices, uuid, use }) => {
    const block_btrfs = client.blocks_fsys_btrfs[block_devices[0].path];

    return (
        <StorageCard card={card}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <BtrfsLabelDescription block_btrfs={block_btrfs} />
                    <StorageDescription title={_("UUID")} value={uuid} />
                    <StorageDescription title={_("Capacity")} value={fmt_size_long(use[1])} />
                    <StorageDescription title={_("Usage")}>
                        <StorageUsageBar key="s" stats={use} />
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
            <CardHeader><strong>{_("btrfs devices")}</strong></CardHeader>
            <CardBody className="contains-list">
                <PageTable emptyCaption={_("No devices found")}
                                   aria-label={_("btrfs device")}
                                   crossrefs={get_crossrefs(uuid)} />
            </CardBody>
        </StorageCard>
    );
};

export function make_btrfs_subvolumes_card(next, block, backing_block) {
    return new_card({
        title: _("btrfs subvolumes"),
        next,
        actions: btrfs_device_actions(block, backing_block),
        component: BtrfsSubVolumesCard,
    });
}

const BtrfsSubVolumesCard = ({ card }) => {
    return (
        <StorageCard card={card}>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No subvolumes")}
                               aria-label={_("btrfs subvolumes")}
                               page={card.page} />
            </CardBody>
        </StorageCard>
    );
};
