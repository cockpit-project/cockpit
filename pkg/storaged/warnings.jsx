/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import { get_parent } from "./utils.js";
import { check_mismounted_fsys } from "./fsys-tab.jsx";

export function find_warnings(client) {
    const path_warnings = { };

    function push_warning(path, warning) {
        if (!path_warnings[path])
            path_warnings[path] = [];
        path_warnings[path].push(warning);
    }

    function enter_warning(path, warning) {
        push_warning(path, warning);
        let parent = get_parent(client, path);
        while (parent) {
            path = parent;
            parent = get_parent(client, path);
        }
        push_warning(path, warning);
    }

    function check_unused_space(path) {
        const block = client.blocks[path];
        const lvm2 = client.blocks_lvm2[path];
        const lvol = lvm2 && client.lvols[lvm2.LogicalVolume];

        if (!lvol)
            return;

        if (lvol.Size != block.Size) {
            // Let's ignore inconsistent lvol/block combinations.
            // These happen during a resize and the inconsistency will
            // eventually go away.
            return;
        }

        const vgroup = client.vgroups[lvol.VolumeGroup];
        let content_path = null;
        let crypto_overhead = 0;

        const crypto = client.blocks_crypto[block.path];
        const cleartext = client.blocks_cleartext[block.path];
        if (crypto) {
            if (crypto.MetadataSize !== undefined && cleartext) {
                content_path = cleartext.path;
                crypto_overhead = crypto.MetadataSize;
            }
        } else {
            content_path = path;
        }

        const fsys = client.blocks_fsys[content_path];
        const content_block = client.blocks[content_path];
        const vdo = content_block ? client.legacy_vdo_overlay.find_by_backing_block(content_block) : null;
        const stratis_bdev = client.blocks_stratis_blockdev[content_path];

        if (fsys && fsys.Size && (lvol.Size - fsys.Size - crypto_overhead) > vgroup.ExtentSize && fsys.Resize) {
            enter_warning(path, {
                warning: "unused-space",
                volume_size: lvol.Size - crypto_overhead,
                content_size: fsys.Size
            });
        }

        if (vdo && (lvol.Size - vdo.physical_size - crypto_overhead) > vgroup.ExtentSize) {
            enter_warning(path, {
                warning: "unused-space",
                volume_size: lvol.Size - crypto_overhead,
                content_size: vdo.physical_size
            });
        }

        if (stratis_bdev && (lvol.Size - Number(stratis_bdev.TotalPhysicalSize) - crypto_overhead) > vgroup.ExtentSize) {
            enter_warning(path, {
                warning: "unused-space",
                volume_size: lvol.Size - crypto_overhead,
                content_size: Number(stratis_bdev.TotalPhysicalSize)
            });
        }
    }

    for (const path in client.blocks) {
        check_unused_space(path);
        check_mismounted_fsys(client, path, enter_warning);
    }

    return path_warnings;
}
