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
import client from "../client.js";

import { decode_filename } from "../utils.js";

const _ = cockpit.gettext;

/*
 * Calculate the usage based on the data from `btrfs filesystem show` which has
 * been made available to client.uuids_btrfs_usage. The size/usage is provided
 * per block device.
 */
export function btrfs_device_usage(client, uuid, path) {
    const block = client.blocks[path];
    const device = block && block.Device;
    const uuid_usage = client.uuids_btrfs_usage[uuid];
    if (uuid_usage && device) {
        const usage = uuid_usage[decode_filename(device)];
        if (usage) {
            return [usage, block.Size];
        }
    }
    return [0, block.Size];
}

/**
 * Calculate the overal btrfs "volume" usage. UDisks only knows the usage per block.
 */
export function btrfs_usage(client, volume) {
    const block_fsys = client.blocks_fsys[volume.path];
    const mount_point = block_fsys && block_fsys.MountPoints[0];
    let use = mount_point && client.fsys_sizes.data[decode_filename(mount_point)];
    if (!use)
        use = [volume.data.used, client.uuids_btrfs_blocks[volume.data.uuid].reduce((sum, b) => sum + b.Size, 0)];
    return use;
}

/**
 * Is the btrfs volume mounted anywhere
 */
export function btrfs_is_volume_mounted(client, block_devices) {
    for (const block_device of block_devices) {
        const block_fs = client.blocks_fsys[block_device.path];
        if (block_fs && block_fs.MountPoints.length > 0) {
            return true;
        }
    }
    return false;
}

export function parse_subvol_from_options(options) {
    const subvol = { };
    const subvolid_match = options.match(/subvolid=(?<subvolid>\d+)/);
    const subvol_match = options.match(/subvol=(?<subvol>[\w\\/]+)/);
    if (subvolid_match)
        subvol.id = subvolid_match.groups.subvolid;
    if (subvol_match)
        subvol.pathname = subvol_match.groups.subvol;

    if (subvolid_match || subvol_match)
        return subvol;
    else
        return null;
}

export function validate_subvolume_name(name) {
    if (name === "")
        return _("Name cannot be empty.");
    if (name.length > 255)
        return _("Name cannot be longer than 255 characters.");
    if (name.includes('/'))
        return cockpit.format(_("Name cannot contain the character '/'."));
}

// Find the o.fd.UDisks2.Filesystem.Btrfs proxy for a block device, if
// we can.
//
// This might also work for locked encrypted devices.

export function find_btrfs_volume(block) {
    if (client.blocks_cleartext[block.path])
        block = client.blocks_cleartext[block.path];

    const block_btrfs = client.blocks_fsys_btrfs[block.path];
    if (block_btrfs)
        return block_btrfs;

    // Might be a locked LUKS device. Try to figure out the uuid or
    // label from its child fstab entries.
    const block_crypto = client.blocks_crypto[block.path];
    if (!block_crypto)
        return null;

    for (const c of block_crypto.ChildConfiguration) {
        if (c[0] == "fstab") {
            const fsname = decode_filename(c[1].fsname.v);
            const uuid_match = fsname.match(/^UUID=(?<uuid>[A-Fa-f0-9-]+)/);
            if (uuid_match) {
                const btrfs = client.uuids_btrfs_volume[uuid_match.groups.uuid];
                if (btrfs)
                    return btrfs;
            }
        }
    }

    return null;
}

export function is_probably_single_device_btrfs_volume(block) {
    const btrfs_vol = find_btrfs_volume(block);
    return !btrfs_vol || btrfs_vol.data.num_devices <= 1;
}
