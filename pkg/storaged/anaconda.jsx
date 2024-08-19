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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import client from "./client.js";

import { decode_filename } from "./utils.js";
import { parse_subvol_from_options } from "./btrfs/utils.jsx";

function parse_parent_from_options(options) {
    const parent_match = options.match(/x-parent=(?<parent>[\w\\-]+)/);
    if (parent_match) {
        return parent_match.groups.parent;
    } else
        return null;
}

function uuid_equal(a, b) {
    return a.replace("-", "").toUpperCase() == b.replace("-", "").toUpperCase();
}

function device_name(block) {
    // Prefer symlinks in /dev/stratis/.
    return (block.Symlinks.map(decode_filename).find(n => n.indexOf("/dev/stratis/") == 0) ||
            decode_filename(block.PreferredDevice));
}

export function remember_passphrase(block, passphrase) {
    if (!client.in_anaconda_mode())
        return;

    if (!window.isSecureContext)
        return;

    try {
        const passphrases = JSON.parse(window.sessionStorage.getItem("cockpit_passphrases")) || { };
        passphrases[device_name(block)] = passphrase;
        window.sessionStorage.setItem("cockpit_passphrases", JSON.stringify(passphrases));
    } catch {
        console.warn("Can't record passphrases");
    }
}

export function export_mount_point_mapping() {
    if (!client.in_anaconda_mode())
        return;

    function tab_info(config, for_parent) {
        let dir;
        let subvols;

        for (const c of config) {
            if (c[0] == "fstab") {
                const o = decode_filename(c[1].opts.v);
                if (for_parent && !uuid_equal(parse_parent_from_options(o), for_parent))
                    continue;

                const d = client.strip_mount_point_prefix(decode_filename(c[1].dir.v));
                if (d) {
                    const sv = parse_subvol_from_options(o);
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

        for (const c of config) {
            if (c[0] == "crypttab") {
                const o = decode_filename(c[1].options.v);
                if (for_parent && !uuid_equal(parse_parent_from_options(o), for_parent))
                    continue;

                const device = decode_filename(c[1].device.v);
                let content_info;
                if (device.startsWith("UUID=")) {
                    content_info = tab_info(config, device.substr(5));
                }

                return {
                    type: "crypto",
                    content: content_info,
                };
            }
        }
    }

    function block_info(block) {
        if (block.IdUsage == "filesystem") {
            return tab_info(block.Configuration);
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
                    content_info = tab_info(block_crypto.ChildConfiguration, block.IdUUID);
            }

            if (content_info) {
                return {
                    type: "crypto",
                    cleartext_device: cleartext_block && device_name(cleartext_block),
                    content: content_info,
                };
            }
        }
    }

    const mpm = { };
    for (const p in client.blocks) {
        const b = client.blocks[p];
        mpm[device_name(b)] = block_info(b);
    }

    // Add inactive logical volumes
    for (const vg_p in client.vgroups) {
        const vg = client.vgroups[vg_p];
        for (const lv of client.vgroups_lvols[vg_p] || []) {
            const b = client.lvols_block[lv.path];
            const dev_name = "/dev/" + vg.Name + "/" + lv.Name;
            if (!b && !mpm[dev_name]) {
                const info = tab_info(lv.ChildConfiguration, lv.UUID);
                if (info)
                    mpm[dev_name] = info;
            }
        }
    }

    window.sessionStorage.setItem("cockpit_mount_points", JSON.stringify(mpm));
}
