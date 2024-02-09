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
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
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
import { fmt_size_long, validate_fsys_label, decode_filename, should_ignore } from "../utils.js";
import { btrfs_usage, btrfs_is_volume_mounted, parse_subvol_from_options } from "./utils.jsx";
import { dialog_open, TextInput } from "../dialog.jsx";
import { make_btrfs_subvolume_page } from "./subvolume.jsx";
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

export function rename_dialog(block_btrfs, label) {
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
            action: function (vals) {
                return block_btrfs.SetLabel(vals.name, {});
            }
        }
    });
}

const BtrfsVolumeCard = ({ card, block_devices, uuid, use }) => {
    const block_btrfs = client.blocks_fsys_btrfs[block_devices[0].path];
    const label = block_btrfs.data.label || "-";

    // Changing the label is only supported when the device is not mounted
    // otherwise we will get btrfs filesystem error ERROR: device /dev/vda5 is
    // mounted, use mount point. This is a libblockdev/udisks limitation as it
    // only passes the device and not the mountpoint when the device is mounted.
    // https://github.com/storaged-project/libblockdev/issues/966
    const is_mounted = btrfs_is_volume_mounted(client, block_devices);

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

export function make_btrfs_subvolume_pages(parent, volume) {
    const subvols = client.uuids_btrfs_subvols[volume.data.uuid];
    if (subvols) {
        for (const subvol of subvols) {
            make_btrfs_subvolume_page(parent, volume, subvol);
        }
    } else {
        const block = client.blocks[volume.path];
        /*
         * Try to show subvolumes based on fstab entries, this is a bit tricky
         * as mounts where subvolid cannot be shown userfriendly.
         */
        let has_root = false;
        for (const config of block.Configuration) {
            if (config[0] == "fstab") {
                const opts = config[1].opts;
                if (!opts)
                    continue;

                const fstab_subvol = parse_subvol_from_options(decode_filename(opts.v));

                if (fstab_subvol === null)
                    continue;

                if (fstab_subvol.pathname === "/")
                    has_root = true;

                if (fstab_subvol.pathname)
                    make_btrfs_subvolume_page(parent, volume, fstab_subvol);
            }
        }

        if (!has_root) {
            // Always show the root subvolume even when the volume is not mounted.
            make_btrfs_subvolume_page(parent, volume, { pathname: "/", id: 5 });
        }
    }
}
