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

import cockpit from "cockpit";
import React from "react";
import client from "../client.js";

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";

import {
    encode_filename,
    parse_options, unparse_options, extract_option, reload_systemd,
    set_crypto_auto_option, get_mount_points,
} from "../utils.js";
import { StorageButton } from "../storage-controls.jsx";

import { mounting_dialog } from "./mounting-dialog.jsx";
import { get_cryptobacking_noauto } from "./utils.jsx";

const _ = cockpit.gettext;

export function check_mismounted_fsys(backing_block, content_block, fstab_config, subvol) {
    if (client.in_anaconda_mode())
        return;

    const block_fsys = content_block && client.blocks_fsys[content_block.path];
    const [, dir, opts] = fstab_config;

    if (!(block_fsys || dir))
        return;

    function ignore_mount(m) {
        // We don't complain about the rootfs, it's probably
        // configured somewhere else, like in the bootloader.
        if (m == "/")
            return true;

        return false;
    }

    const mounted_at = get_mount_points(client, block_fsys, subvol);
    const split_options = parse_options(opts);
    const opt_noauto = extract_option(split_options, "noauto");
    const opt_noauto_intent = extract_option(split_options, "x-cockpit-never-auto");
    const opt_systemd_automount = split_options.indexOf("x-systemd.automount") >= 0;
    const is_mounted = mounted_at.indexOf(dir) >= 0;
    const other_mounts = mounted_at.filter(m => m != dir && !ignore_mount(m));
    const crypto_backing_noauto = get_cryptobacking_noauto(client, backing_block);

    let type;
    if (dir) {
        if (!is_mounted && other_mounts.length > 0) {
            if (!opt_noauto)
                type = "change-mount-on-boot";
            else
                type = "mounted-no-config";
        } else if (crypto_backing_noauto && !opt_noauto)
            type = "locked-on-boot-mount";
        else if (!is_mounted && !opt_noauto)
            type = "mount-on-boot";
        else if (is_mounted && opt_noauto && !opt_noauto_intent && !opt_systemd_automount)
            type = "no-mount-on-boot";
    } else if (other_mounts.length > 0) {
        type = "mounted-no-config";
    }

    if (type)
        return { warning: "mismounted-fsys", type, other: other_mounts[0] };
}

export const MismountAlert = ({ warning, fstab_config, forced_options, backing_block, content_block, subvol }) => {
    if (!warning)
        return null;

    const { type, other } = warning;
    const [old_config, old_dir, old_opts, old_parents] = fstab_config;
    const split_options = parse_options(old_opts);
    extract_option(split_options, "noauto");
    const opt_ro = extract_option(split_options, "ro");
    const opt_nofail = extract_option(split_options, "nofail");
    const opt_netdev = extract_option(split_options, "_netdev");
    const split_options_for_fix_config = split_options.slice();
    if (forced_options)
        for (const opt of forced_options)
            extract_option(split_options, opt);

    function fix_config() {
        let opts = [];
        if (type == "mount-on-boot")
            opts.push("noauto");
        if (type == "locked-on-boot-mount") {
            opts.push("noauto");
            opts.push("x-cockpit-never-auto");
        }
        if (opt_ro)
            opts.push("ro");
        if (opt_nofail)
            opts.push("nofail");
        if (opt_netdev)
            opts.push("_netdev");
        if (subvol) {
            opts.push(`subvol=${subvol.pathname}`);
        }

        // Add the forced options, but only to new entries.  We
        // don't want to modify existing entries beyond what we
        // say on the button.
        if (!old_config && forced_options)
            opts = opts.concat(forced_options);

        const new_opts = unparse_options(opts.concat(split_options_for_fix_config));
        let all_new_opts;
        if (new_opts && old_parents)
            all_new_opts = new_opts + "," + old_parents;
        else if (new_opts)
            all_new_opts = new_opts;
        else
            all_new_opts = old_parents;

        let new_dir = old_dir;
        if (type == "change-mount-on-boot" || type == "mounted-no-config")
            new_dir = other;

        const new_config = [
            "fstab", {
                fsname: old_config ? old_config[1].fsname : undefined,
                dir: { t: 'ay', v: encode_filename(new_dir) },
                type: { t: 'ay', v: encode_filename("auto") },
                opts: { t: 'ay', v: encode_filename(all_new_opts || "defaults") },
                freq: { t: 'i', v: 0 },
                passno: { t: 'i', v: 0 },
                "track-parents": { t: 'b', v: !old_config }
            }];

        function fixup_crypto_backing() {
            if (!backing_block)
                return;
            if (type == "no-mount-on-boot")
                return set_crypto_auto_option(backing_block, true);
            if (type == "locked-on-boot-mount")
                return set_crypto_auto_option(backing_block, false);
        }

        function fixup_fsys() {
            if (old_config)
                return backing_block.UpdateConfigurationItem(old_config, new_config, {}).then(reload_systemd);
            else
                return backing_block.AddConfigurationItem(new_config, {}).then(reload_systemd);
        }

        return fixup_fsys().then(fixup_crypto_backing);
    }

    function fix_mount() {
        const crypto_backing_crypto = client.blocks_crypto[backing_block.path];

        function do_mount() {
            if (!content_block)
                mounting_dialog(client, backing_block, "mount", forced_options);
            else
                return client.mount_at(content_block, old_dir);
        }

        function do_unmount(dir) {
            return client.unmount_at(dir)
                    .then(() => {
                        if (backing_block != content_block)
                            return crypto_backing_crypto.Lock({});
                    });
        }

        if (type == "change-mount-on-boot")
            return client.unmount_at(other).then(() => client.mount_at(content_block, old_dir));
        else if (type == "mount-on-boot")
            return do_mount();
        else if (type == "no-mount-on-boot")
            return do_unmount(old_dir);
        else if (type == "mounted-no-config")
            return do_unmount(other);
        else if (type == "locked-on-boot-mount") {
            if (backing_block != content_block)
                return set_crypto_auto_option(backing_block, true);
        }
    }

    let text;
    let fix_config_text;
    let fix_mount_text;

    if (type == "change-mount-on-boot") {
        text = cockpit.format(_("The filesystem is currently mounted on $0 but will be mounted on $1 on the next boot."), other, old_dir);
        fix_config_text = cockpit.format(_("Mount automatically on $0 on boot"), other);
        fix_mount_text = cockpit.format(_("Mount on $0 now"), old_dir);
    } else if (type == "mount-on-boot") {
        text = _("The filesystem is currently not mounted but will be mounted on the next boot.");
        fix_config_text = _("Do not mount automatically on boot");
        fix_mount_text = _("Mount now");
    } else if (type == "no-mount-on-boot") {
        text = _("The filesystem is currently mounted but will not be mounted after the next boot.");
        fix_config_text = _("Mount also automatically on boot");
        fix_mount_text = _("Unmount now");
    } else if (type == "mounted-no-config") {
        text = cockpit.format(_("The filesystem is currently mounted on $0 but will not be mounted after the next boot."), other);
        fix_config_text = cockpit.format(_("Mount automatically on $0 on boot"), other);
        fix_mount_text = _("Unmount now");
    } else if (type == "locked-on-boot-mount") {
        text = _("The filesystem is configured to be automatically mounted on boot but its encryption container will not be unlocked at that time.");
        fix_config_text = _("Do not mount automatically on boot");
        fix_mount_text = _("Unlock automatically on boot");
    }

    return (
        <Alert variant="warning" isInline
               title={_("Inconsistent filesystem mount")}>
            {text}
            <div className="storage-alert-actions">
                <StorageButton onClick={fix_config}>{fix_config_text}</StorageButton>
                { fix_mount_text && <StorageButton onClick={fix_mount}>{fix_mount_text}</StorageButton> }
            </div>
        </Alert>);
};
