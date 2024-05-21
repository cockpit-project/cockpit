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
import React from "react";
import client from "../client";

import { for_each_async, reload_systemd, encode_filename } from "../utils.js";
import { dialog_open } from "../dialog.jsx";
import { TangKeyVerification } from "../crypto/tang.jsx";

const _ = cockpit.gettext;

export function validate_pool_name(pool, name) {
    if (name == "")
        return _("Name can not be empty.");
    if ((!pool || name != pool.Name) && client.stratis_poolnames_pool[name])
        return _("A pool with this name exists already.");
}

export function std_reply(result, code, message) {
    if (code)
        return Promise.reject(message);
    else
        return Promise.resolve(result);
}

export function with_keydesc(client, pool, func) {
    if (!pool.KeyDescription ||
        !pool.KeyDescription[0] ||
        !pool.KeyDescription[1][0]) {
        return func(false);
    } else {
        const keydesc = pool.KeyDescription[1][1];
        return client.stratis_manager.ListKeys()
                .catch(() => []) // not-covered: internal error
                .then(keys => func(keydesc, keys.indexOf(keydesc) >= 0));
    }
}

export function with_stored_passphrase(client, keydesc, passphrase, func) {
    return client.stratis_store_passphrase(keydesc, passphrase)
            .then(func)
            .finally(() => {
                return client.stratis_manager.UnsetKey(keydesc)
                        .then(std_reply)
                        .catch(ex => { console.warn("Failed to remove passphrase from key ring", ex.toString()) }); // not-covered: internal error
            });
}

export function get_unused_keydesc(client, desc_prefix) {
    return client.stratis_manager.ListKeys()
            .catch(() => []) // not-covered: internal error
            .then(keys => {
                let desc;
                for (let i = 0; i < 1000; i++) {
                    desc = desc_prefix + (i > 0 ? "." + i.toFixed() : "");
                    if (keys.indexOf(desc) == -1)
                        break;
                }
                return desc;
            });
}

export function confirm_tang_trust(url, adv, action) {
    dialog_open({
        Title: _("Verify key"),
        Body: <TangKeyVerification url={url} adv={adv} />,
        Action: {
            Title: _("Trust key"),
            action
        }
    });
}

export function check_stratis_warnings(client, enter_warning) {
    for (const p in client.stratis_pools) {
        const blockdevs = client.stratis_pool_blockdevs[p] || [];
        const pool = client.stratis_pools[p];
        if (blockdevs.some(bd => bd.NewPhysicalSize[0] && Number(bd.NewPhysicalSize[1]) > Number(bd.TotalPhysicalSize)))
            enter_warning(p, { warning: "unused-blockdevs" });
        if (pool.AvailableActions && pool.AvailableActions !== "fully_operational")
            enter_warning(p, { warning: "not-fully-operational" });
    }
}

function teardown_block(block) {
    return for_each_async(block.Configuration, c => block.RemoveConfigurationItem(c, {}));
}

export function destroy_filesystem(fsys) {
    const block = client.slashdevs_block[fsys.Devnode];
    const pool = client.stratis_pools[fsys.Pool];

    return teardown_block(block).then(() => pool.DestroyFilesystems([fsys.path]).then(std_reply));
}

export function validate_fs_name(fsys, name, filesystems) {
    if (name == "")
        return _("Name can not be empty.");
    if (!fsys || name != fsys.Name) {
        for (const fs of filesystems) {
            if (fs.Name == name)
                return _("A filesystem with this name exists already in this pool.");
        }
    }
}

export function set_mount_options(path, vals, forced_options) {
    let mount_options = [];

    if (vals.variant == "nomount" || vals.at_boot == "never")
        mount_options.push("noauto");
    if (vals.mount_options?.ro)
        mount_options.push("ro");
    if (vals.at_boot == "never")
        mount_options.push("x-cockpit-never-auto");
    if (vals.at_boot == "nofail")
        mount_options.push("nofail");
    if (vals.at_boot == "netdev")
        mount_options.push("_netdev");
    if (vals.mount_options?.extra)
        mount_options.push(vals.mount_options.extra);

    mount_options = mount_options.concat(forced_options);

    let mount_point = vals.mount_point;
    if (mount_point == "")
        return Promise.resolve();
    if (mount_point[0] != "/")
        mount_point = "/" + mount_point;
    mount_point = client.add_mount_point_prefix(mount_point);

    const config =
          ["fstab",
              {
                  dir: { t: 'ay', v: encode_filename(mount_point) },
                  type: { t: 'ay', v: encode_filename("auto") },
                  opts: { t: 'ay', v: encode_filename(mount_options.join(",") || "defaults") },
                  freq: { t: 'i', v: 0 },
                  passno: { t: 'i', v: 0 },
              }
          ];

    function udisks_block_for_stratis_fsys() {
        const fsys = client.stratis_filesystems[path];
        return fsys && client.slashdevs_block[fsys.Devnode];
    }

    return client.wait_for(udisks_block_for_stratis_fsys)
            .then(block => {
            // HACK - need a explicit "change" event
                return block.Rescan({})
                        .then(() => {
                            return client.wait_for(() => client.blocks_fsys[block.path])
                                    .then(fsys => {
                                        return block.AddConfigurationItem(config, {})
                                                .then(reload_systemd)
                                                .then(() => {
                                                    if (vals.variant != "nomount")
                                                        return client.mount_at(block, mount_point);
                                                    else
                                                        return Promise.resolve();
                                                });
                                    });
                        });
            });
}
