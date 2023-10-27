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
import client from "./client";

import { get_partitions, fmt_size } from "./utils.js";
import { get_fstab_config } from "./fsys-tab.jsx"; // XXX

import { format_dialog } from "./format-dialog.jsx";

import { make_overview_page } from "./pages/overview.jsx";
import { make_unrecognized_data_page } from "./pages/unrecognized-data.jsx";
import { make_locked_encrypted_data_page } from "./pages/locked-encrypted-data.jsx";
import { make_filesystem_page } from "./pages/filesystem.jsx";
import { make_lvm2_physical_volume_page } from "./pages/lvm2-physical-volume.jsx";
import { make_mdraid_disk_page } from "./pages/mdraid-disk.jsx";
import { make_stratis_blockdev_page } from "./pages/stratis-blockdev.jsx";
import { make_swap_page } from "./pages/swap.jsx";

import { make_partition_container, delete_partition } from "./containers/partition.jsx";
import { make_encryption_container } from "./containers/encryption.jsx";

import { new_page, reset_pages } from "./pages.jsx";

const _ = cockpit.gettext;

/* Creating all the pages
 *
 * This is where a lot of the hair is.
 */

export function make_block_pages(parent, block) {
    if (client.blocks_ptable[block.path])
        make_partition_pages(parent, block);
    else
        make_block_page(parent, block, null);
}

function make_partition_pages(parent, block) {
    const block_ptable = client.blocks_ptable[block.path];

    function make_free_space_page(parent, start, size, enable_dos_extended) {
        new_page({
            parent,
            name: _("Free space"),
            columns: [
                null,
                null,
                fmt_size(size),
            ],
            actions: [
                {
                    title: _("Create partition"),
                    action: () => format_dialog(client, block.path, start, size,
                                                enable_dos_extended),
                }
            ],
        });
    }

    function make_extended_partition_page(parent, partition) {
        const page = new_page({
            parent,
            name: _("Extended partition"),
            columns: [
                null,
                null,
                fmt_size(partition.size),
            ],
            actions: [
                { title: _("Delete"), action: () => delete_partition(partition.block, page) },
            ]
        });
        process_partitions(page, partition.partitions, false);
    }

    function process_partitions(parent, partitions, enable_dos_extended) {
        let i, p;
        for (i = 0; i < partitions.length; i++) {
            p = partitions[i];
            if (p.type == 'free')
                make_free_space_page(parent, p.start, p.size, enable_dos_extended);
            else if (p.type == 'container')
                make_extended_partition_page(parent, p);
            else {
                const container = make_partition_container(null, p.block);
                make_block_page(parent, p.block, container);
            }
        }
    }

    process_partitions(parent, get_partitions(client, block),
                       block_ptable.Type == 'dos');
}

export function make_block_page(parent, block, container) {
    let is_crypto = block.IdUsage == 'crypto';
    let content_block = is_crypto ? client.blocks_cleartext[block.path] : block;
    const fstab_config = get_fstab_config(content_block || block, true);

    const block_stratis_blockdev = client.blocks_stratis_blockdev[block.path];
    const block_stratis_stopped_pool = client.blocks_stratis_stopped_pool[block.path];

    const is_stratis = ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "stratis") ||
                        (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) ||
                        block_stratis_stopped_pool);

    // Adjust for encryption leaking out of Stratis
    if (is_crypto && is_stratis) {
        is_crypto = false;
        content_block = block;
    }

    if (is_crypto)
        container = make_encryption_container(container, block);

    if (!content_block) {
        // assert(is_crypto);
        if (fstab_config.length > 0) {
            make_filesystem_page(parent, block, null, fstab_config, container);
        } else {
            make_locked_encrypted_data_page(parent, block, container);
        }
        return;
    }

    const is_filesystem = content_block.IdUsage == 'filesystem';
    const block_pvol = client.blocks_pvol[content_block.path];
    const block_swap = client.blocks_swap[content_block.path];

    if (is_filesystem) {
        make_filesystem_page(parent, block, content_block, fstab_config, container);
    } else if ((content_block.IdUsage == "raid" && content_block.IdType == "LVM2_member") ||
               (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
        make_lvm2_physical_volume_page(parent, block, content_block, container);
    } else if (is_stratis) {
        make_stratis_blockdev_page(parent, block, content_block, container);
    } else if ((content_block.IdUsage == "raid") ||
               (client.mdraids[content_block.MDRaidMember])) {
        make_mdraid_disk_page(parent, block, content_block, container);
    } else if (block_swap || (content_block && content_block.IdUsage == "other" && content_block.IdType == "swap")) {
        make_swap_page(parent, block, content_block, container);
    } else {
        make_unrecognized_data_page(parent, block, content_block, container);
    }
}

export function create_pages() {
    reset_pages();
    make_overview_page();
}
