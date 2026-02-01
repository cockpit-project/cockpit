/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */
import cockpit from "cockpit";

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
 * Calculate the overall btrfs "volume" usage. UDisks only knows the usage per block.
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
