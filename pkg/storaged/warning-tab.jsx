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

import cockpit from "cockpit";
import React from "react";

import { StorageButton } from "./storage-controls.jsx";
import { fmt_size, get_parent } from "./utils.js";
import { get_resize_info, lvol_shrink, lvol_grow } from "./lvol-tabs.jsx";

const _ = cockpit.gettext;

export function find_warnings(client) {
    let path_warnings = { };

    function push_warning(path, warning) {
        if (!path_warnings[path])
            path_warnings[path] = [ ];
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

    for (let path in client.blocks) {
        let block = client.blocks[path];
        let lvm2 = client.blocks_lvm2[path];
        let lvol = lvm2 && client.lvols[lvm2.LogicalVolume];

        if (!lvol)
            continue;

        if (lvol.Size != block.Size) {
            // Let's ignore inconsistent lvol/block combinations.
            // These happen during a resize and the inconsistency will
            // eventually go away.
            continue;
        }

        let vgroup = client.vgroups[lvol.VolumeGroup];
        let content_path = null;
        let crypto_overhead = 0;

        let crypto = client.blocks_crypto[block.path];
        let cleartext = client.blocks_cleartext[block.path];
        if (crypto) {
            if (crypto.MetadataSize !== undefined && cleartext) {
                content_path = cleartext.path;
                crypto_overhead = crypto.MetadataSize;
            }
        } else {
            content_path = path;
        }

        let fsys = client.blocks_fsys[content_path];
        let content_block = client.blocks[content_path];
        let vdo = content_block ? client.vdo_overlay.find_by_backing_block(content_block) : null;

        if (fsys && fsys.Size && (lvol.Size - fsys.Size - crypto_overhead) > vgroup.ExtentSize && fsys.Resize) {
            enter_warning(content_path, "unused-space");
        }

        if (vdo && (lvol.Size - vdo.physical_size - crypto_overhead) > vgroup.ExtentSize) {
            enter_warning(content_path, "unused-space");
        }
    }

    return path_warnings;
}

export class WarningTab extends React.Component {
    render() {
        let { client, block } = this.props;
        let crypto = block && client.blocks_crypto[block.CryptoBackingDevice];
        let lvm2 = client.blocks_lvm2[crypto ? crypto.path : block.path];
        let lvol = lvm2 && client.lvols[lvm2.LogicalVolume];
        let block_fsys = client.blocks_fsys[block.path];
        let vdo = client.vdo_overlay.find_by_backing_block(block);
        let crypto_overhead = crypto ? crypto.MetadataSize : 0;

        let { info, shrink_excuse, grow_excuse } = get_resize_info(client, client.blocks[lvm2.path], true);

        function shrink_to_fit() {
            lvol_shrink(client, lvol, info, true);
        }

        function grow_to_fit() {
            lvol_grow(client, lvol, info, true);
        }

        return (
            <div>
                <strong>{_("This logical volume is not completely used by its content.")}</strong>
                <br />
                {cockpit.format(_("Volume size is $0. Content size is $1."),
                                fmt_size(lvol.Size - crypto_overhead),
                                fmt_size(block_fsys ? block_fsys.Size : vdo.physical_size))}
                { "\n" }
                <div className="pull-right">
                    <StorageButton excuse={shrink_excuse} onClick={shrink_to_fit}>{_("Shrink Volume")}</StorageButton>
                    {"\n"}
                    <StorageButton excuse={grow_excuse} onClick={grow_to_fit}>{_("Grow Content")}</StorageButton>
                </div>
            </div>
        );
    }
}
