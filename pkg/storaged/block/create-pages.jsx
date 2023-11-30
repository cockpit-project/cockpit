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

import client from "../client";

import { get_fstab_config } from "../filesystem/utils.jsx";

import { make_partition_table_page } from "../partitions/partition-table.jsx";
import { make_legacy_vdo_page } from "../legacy-vdo/legacy-vdo.jsx";

import { make_unrecognized_data_card } from "./unrecognized-data.jsx";
import { make_unformatted_data_card } from "./unformatted-data.jsx";
import { make_locked_encrypted_data_card } from "../crypto/locked-encrypted-data.jsx";
import { make_filesystem_card } from "../filesystem/filesystem.jsx";
import { make_lvm2_physical_volume_card } from "../lvm2/physical-volume.jsx";
import { make_mdraid_disk_card } from "../mdraid/mdraid-disk.jsx";
import { make_stratis_blockdev_card } from "../stratis/blockdev.jsx";
import { make_swap_card } from "../swap/swap.jsx";
import { make_encryption_card } from "../crypto/encryption.jsx";
import { make_btrfs_device_card } from "../btrfs/device.jsx";

import { new_page } from "../pages.jsx";

/* CARD must have page_name, page_location, and page_size set.
 */

export function make_block_page(parent, block, card) {
    let is_crypto = block.IdUsage == 'crypto';
    let content_block = is_crypto ? client.blocks_cleartext[block.path] : block;
    const fstab_config = get_fstab_config(content_block || block, true);

    const block_stratis_blockdev = client.blocks_stratis_blockdev[block.path];
    const block_stratis_stopped_pool = client.blocks_stratis_stopped_pool[block.path];
    const legacy_vdo = client.legacy_vdo_overlay.find_by_backing_block(block);

    const is_stratis = ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "stratis") ||
                        (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) ||
                        block_stratis_stopped_pool);

    const is_btrfs = (fstab_config.length > 0 &&
                      (fstab_config[2].indexOf("subvol=") >= 0 || fstab_config[2].indexOf("subvolid=") >= 0));

    if (client.blocks_ptable[block.path]) {
        make_partition_table_page(parent, block, card);
        return;
    }

    if (legacy_vdo) {
        make_legacy_vdo_page(parent, legacy_vdo, block, card);
        return;
    }

    // Adjust for encryption leaking out of Stratis
    if (is_crypto && is_stratis) {
        is_crypto = false;
        content_block = block;
    }

    if (is_crypto)
        card = make_encryption_card(card, block);

    if (!content_block) {
        if (!is_crypto) {
            // can not happen unless there is a bug in the code above.
            console.error("Assertion failure: is_crypto == false");
        }
        if (fstab_config.length > 0 && !is_btrfs) {
            card = make_filesystem_card(card, block, null, fstab_config);
        } else {
            card = make_locked_encrypted_data_card(card, block);
        }
    } else {
        const is_filesystem = content_block.IdUsage == 'filesystem';
        const block_pvol = client.blocks_pvol[content_block.path];
        const block_swap = client.blocks_swap[content_block.path];
        const block_btrfs_blockdev = client.blocks_fsys_btrfs[content_block.path];

        if (block_btrfs_blockdev) {
            card = make_btrfs_device_card(card, block, content_block, block_btrfs_blockdev);
        } else if (is_filesystem) {
            card = make_filesystem_card(card, block, content_block, fstab_config);
        } else if ((content_block.IdUsage == "raid" && content_block.IdType == "LVM2_member") ||
                   (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
            card = make_lvm2_physical_volume_card(card, block, content_block);
        } else if (is_stratis) {
            card = make_stratis_blockdev_card(card, block, content_block);
        } else if ((content_block.IdUsage == "raid") ||
                   (client.mdraids[content_block.MDRaidMember])) {
            card = make_mdraid_disk_card(card, block, content_block);
        } else if (block_swap ||
                   (content_block.IdUsage == "other" && content_block.IdType == "swap")) {
            card = make_swap_card(card, block, content_block);
        } else if (client.blocks_available[content_block.path]) {
            card = make_unformatted_data_card(card, block, content_block);
        } else {
            card = make_unrecognized_data_card(card, block, content_block);
        }
    }

    if (card)
        new_page(parent, card);
}
