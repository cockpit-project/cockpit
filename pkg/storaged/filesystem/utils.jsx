/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2016 Red Hat, Inc.
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

import React from "react";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";

import cockpit from "cockpit";
import client from "../client.js";

import {
    block_name, decode_filename,
    parse_options, extract_option,
    get_fstab_config_with_client,
    find_children_for_mount_point,
} from "../utils.js";
import { StorageLink } from "../storage-controls.jsx";

import { mounting_dialog } from "./mounting-dialog.jsx";

const _ = cockpit.gettext;

export function is_mounted(client, block) {
    const block_fsys = client.blocks_fsys[block.path];
    const mounted_at = block_fsys ? block_fsys.MountPoints : [];
    const config = block.Configuration.find(c => c[0] == "fstab");
    if (config && config[1].dir.v) {
        let dir = decode_filename(config[1].dir.v);
        if (dir[0] != "/")
            dir = "/" + dir;
        return mounted_at.map(decode_filename).indexOf(dir) >= 0;
    } else
        return null;
}

export function get_fstab_config(block, also_child_config) {
    return get_fstab_config_with_client(client, block, also_child_config);
}

function find_blocks_for_mount_point(client, mount_point, self) {
    const blocks = [];

    function is_self(b) {
        return self && (b == self || client.blocks[b.CryptoBackingDevice] == self);
    }

    for (const p in client.blocks) {
        const b = client.blocks[p];
        const [, dir] = get_fstab_config(b);
        if (dir == mount_point && !is_self(b))
            blocks.push(b);
    }

    return blocks;
}

function nice_block_name(block) {
    return block_name(client.blocks[block.CryptoBackingDevice] || block);
}

export function is_valid_mount_point(client, block, val, format_only, for_fstab) {
    if (val === "") {
        if (!format_only || for_fstab)
            return _("Mount point cannot be empty");
        return null;
    }

    const other_blocks = find_blocks_for_mount_point(client, val, block);
    if (other_blocks.length > 0)
        return cockpit.format(_("Mount point is already used for $0"),
                              other_blocks.map(nice_block_name).join(", "));

    if (!format_only) {
        const children = find_children_for_mount_point(client, val, block);
        if (Object.keys(children).length > 0)
            return <>
                {_("Filesystems are already mounted below this mountpoint.")}
                {Object.keys(children).map(m => <div key={m}>
                    {cockpit.format("• $0 on $1", nice_block_name(children[m]),
                                    client.strip_mount_point_prefix(m))}
                </div>)}
                {_("Please unmount them first.")}
            </>;
    }
}

export function get_cryptobacking_noauto(client, block) {
    const crypto_backing = block.IdUsage == "crypto" ? block : client.blocks[block.CryptoBackingDevice];
    if (!crypto_backing)
        return false;

    const crypto_config = crypto_backing.Configuration.find(c => c[0] == "crypttab");
    if (!crypto_config)
        return false;

    const crypto_options = decode_filename(crypto_config[1].options.v).split(",")
            .map(o => o.trim());
    return crypto_options.indexOf("noauto") >= 0;
}

export const MountPoint = ({ fstab_config, forced_options, backing_block, content_block }) => {
    const is_filesystem_mounted = content_block && is_mounted(client, content_block);
    const [, old_dir, old_opts] = fstab_config;
    const split_options = parse_options(old_opts);
    extract_option(split_options, "noauto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_never_auto = extract_option(split_options, "x-cockpit-never-auto");
    const opt_nofail = extract_option(split_options, "nofail");
    const opt_netdev = extract_option(split_options, "_netdev");
    if (forced_options)
        for (const opt of forced_options)
            extract_option(split_options, opt);

    let mount_point_text = null;
    if (old_dir) {
        mount_point_text = client.strip_mount_point_prefix(old_dir);
        let opt_texts = [];
        if (opt_ro)
            opt_texts.push(_("read only"));
        if (opt_never_auto)
            opt_texts.push(_("never mount at boot"));
        else if (opt_netdev)
            opt_texts.push(_("after network"));
        else if (opt_nofail)
            opt_texts.push(_("ignore failure"));
        else
            opt_texts.push(_("stop boot on failure"));
        opt_texts = opt_texts.concat(split_options);
        if (opt_texts.length) {
            mount_point_text = cockpit.format("$0 ($1)", mount_point_text, opt_texts.join(", "));
        }
    }

    let extra_text = null;
    if (!is_filesystem_mounted) {
        if (!old_dir)
            extra_text = _("The filesystem has no permanent mount point.");
        else
            extra_text = _("The filesystem is not mounted.");
    } else if (backing_block != content_block) {
        if (!opt_never_auto)
            extra_text = _("The filesystem will be unlocked and mounted on the next boot. This might require inputting a passphrase.");
    }

    if (extra_text && mount_point_text)
        extra_text = <><br />{extra_text}</>;

    return (
        <>
            { mount_point_text &&
            <Flex>
                <FlexItem>{ mount_point_text }</FlexItem>
                <FlexItem>
                    <StorageLink onClick={() => mounting_dialog(client,
                                                                content_block || backing_block,
                                                                "update",
                                                                forced_options)}>
                        {_("edit")}
                    </StorageLink>
                </FlexItem>
            </Flex>
            }
            { extra_text }
        </>);
};

export const mount_point_text = (mount_point, mounted) => {
    let mp_text;
    if (mount_point) {
        mp_text = client.strip_mount_point_prefix(mount_point);
        if (mp_text == false)
            return null;
        if (!mounted)
            mp_text = mp_text + " " + _("(not mounted)");
    } else
        mp_text = _("(not mounted)");
    return mp_text;
};
