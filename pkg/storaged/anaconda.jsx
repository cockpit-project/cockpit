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

import client from "./client.js";

import { decode_filename } from "./utils.js";
import { parse_subvol_from_options } from "./btrfs/utils.jsx";

export const AnacondaAdvice = () => {
    if (!client.in_anaconda_mode())
        return null;

    // Nothing yet.
    return null;
};

export function export_mount_point_mapping() {
    if (!client.in_anaconda_mode())
        return;

    function fstab_info(config) {
        let dir;
        let subvols;

        for (const c of config) {
            if (c[0] == "fstab") {
                const d = client.strip_mount_point_prefix(decode_filename(c[1].dir.v));
                if (d) {
                    const sv = parse_subvol_from_options(decode_filename(c[1].opts.v));
                    if (sv) {
                        if (sv.pathname) {
                            if (!subvols)
                                subvols = { };
                            subvols[sv.pathname] = { dir: d };
                        }
                    } else if (!dir) {
                        dir = d;
                    }
                }
            }
        }

        if (dir || subvols)
            return {
                type: "filesystem",
                dir,
                subvolumes: subvols
            };
    }

    function block_info(block) {
        if (block.IdUsage == "filesystem") {
            return fstab_info(block.Configuration);
        } else if (block.IdUsage == "other" && block.IdType == "swap") {
            return {
                type: "swap",
            };
        } else if (block.IdUsage == "crypto") {
            const cleartext_block = client.blocks_cleartext[block.path];

            let content_info;
            if (cleartext_block)
                content_info = block_info(cleartext_block);
            else {
                const block_crypto = client.blocks_crypto[block.path];
                if (block_crypto)
                    content_info = fstab_info(block_crypto.ChildConfiguration);
            }

            if (content_info) {
                return {
                    type: "crypto",
                    cleartext_device: cleartext_block && decode_filename(cleartext_block.Device),
                    content: content_info,
                };
            }
        }
    }

    const mpm = { };
    for (const p in client.blocks) {
        const b = client.blocks[p];
        mpm[decode_filename(b.Device)] = block_info(b);
    }

    window.localStorage.setItem("cockpit_mount_points", JSON.stringify(mpm));
}
