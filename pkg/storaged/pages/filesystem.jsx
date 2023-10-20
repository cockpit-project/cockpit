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

import { Alert } from "@patternfly/react-core/dist/esm/components/Alert/index.js";
import { Flex, FlexItem } from "@patternfly/react-core/dist/esm/layouts/Flex/index.js";
import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";
import { useEvent } from "hooks";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import {
    dialog_open, TextInput,
} from "../dialog.jsx";
import { StorageButton, StorageLink, StorageUsageBar, StorageSize } from "../storage-controls.jsx";
import {
    ParentPageLink, PageContainerStackItems,
    new_page, block_location, ActionButtons, page_type,
    register_crossref,
} from "../pages.jsx";
import { format_dialog } from "../format-dialog.jsx";
import { is_mounted, mounting_dialog, get_cryptobacking_noauto } from "../fsys-tab.jsx"; // XXX
import {
    block_name, fmt_size, parse_options, unparse_options, extract_option,
    set_crypto_auto_option,
    encode_filename, decode_filename, reload_systemd, validate_fsys_label
} from "../utils.js";

const _ = cockpit.gettext;

/* This page is used in a variety of cases, which can be distinguished
 * by looking at the "backing_block" and "content_block" parameters:
 *
 * not-encrypted: backing_block == content_block,
 *                content_block != null
 *
 * encrypted and unlocked: backing_block != content_block,
 *                         backing_block != null,
 *                         content_block != null
 *
 * encrypted and locked: backing_block != null,
 *                       content_block == null
 *
 * "backing_block" is always non-null and always refers to the block
 * device that we want to talk about in the UI. "content_block" (when
 * non-null) is the block that we need to use for filesystem related
 * actions, such as mounting. It's the one with the
 * "o.fd.UDisks2.Filesystem" interface.
 *
 * When "content_block" is null, then "backing_block" is a locked LUKS
 * device, but we could figure out the fstab entry for the filesystem
 * that's on it.
 */

export function check_mismounted_fsys(backing_block, content_block, fstab_config) {
    const block_fsys = content_block && client.blocks_fsys[content_block.path];
    const [, dir, opts] = fstab_config;

    if (!(block_fsys || dir))
        return;

    const mounted_at = block_fsys ? block_fsys.MountPoints.map(decode_filename) : [];
    const split_options = parse_options(opts);
    const opt_noauto = extract_option(split_options, "noauto");
    const opt_noauto_intent = extract_option(split_options, "x-cockpit-never-auto");
    const opt_systemd_automount = split_options.indexOf("x-systemd.automount") >= 0;
    const is_mounted = mounted_at.indexOf(dir) >= 0;
    const other_mounts = mounted_at.filter(m => m != dir);
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
        // We don't complain about the rootfs, it's probably
        // configured somewhere else, like in the bootloader.
        if (other_mounts[0] != "/")
            type = "mounted-no-config";
    }

    if (type)
        return { warning: "mismounted-fsys", type, other: other_mounts[0] };
}

const MountPointUsageBar = ({ mount_point, block, short }) => {
    useEvent(client.fsys_sizes, "changed");
    const stats = client.fsys_sizes.data[mount_point];
    if (stats)
        return <StorageUsageBar stats={stats} critical={0.95} block={block_name(block)} short={short} />;
    else if (short)
        return <StorageSize key="s" size={block.Size} />;
    else
        return fmt_size(block.Size);
};

export function make_filesystem_page(parent, backing_block, content_block, fstab_config, container) {
    const [, mount_point] = fstab_config;
    const name = block_name(backing_block);
    const mismount_warning = check_mismounted_fsys(backing_block, content_block, fstab_config);
    const mounted = content_block && is_mounted(client, content_block);

    let mp_text;
    if (mount_point && mounted)
        mp_text = mount_point;
    else if (mount_point && !mounted)
        mp_text = mount_point + " " + _("(not mounted)");
    else
        mp_text = _("(not mounted)");

    const filesystem_page = new_page({
        location: [block_location(backing_block)],
        parent,
        container,
        name,
        columns: [
            content_block ? cockpit.format(_("$0 filesystem"), content_block.IdType) : _("Filesystem"),
            mp_text,
            <MountPointUsageBar key="size" mount_point={mount_point} block={backing_block} short />,
        ],
        has_warning: !!mismount_warning,
        component: FilesystemPage,
        props: { backing_block, content_block, fstab_config, mismount_warning },
        actions: [
            content_block && mounted
                ? { title: _("Unmount"), action: () => mounting_dialog(client, content_block, "unmount") }
                : { title: _("Mount"), action: () => mounting_dialog(client, content_block || backing_block, "mount") },
            { title: _("Format"), action: () => format_dialog(client, backing_block.path), danger: true },
        ]
    });

    register_crossref({
        key: backing_block,
        page: filesystem_page,
        size: fmt_size(backing_block.data.Size),
        actions: [],
    });
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
            mount_point_text = cockpit.format("$0 ($1)", old_dir, opt_texts.join(", "));
        } else {
            mount_point_text = old_dir;
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

export const MismountAlert = ({ warning, fstab_config, forced_options, backing_block, content_block }) => {
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

        function do_unmount() {
            return client.unmount_at(old_dir)
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
            return do_unmount();
        else if (type == "mounted-no-config")
            return do_unmount();
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
        <Alert variant="warning"
               isInline
               title={_("Inconsistent filesystem mount")}>
            {text}
            <div className="storage_alert_action_buttons">
                <StorageButton onClick={fix_config}>{fix_config_text}</StorageButton>
                { fix_mount_text && <StorageButton onClick={fix_mount}>{fix_mount_text}</StorageButton> }
            </div>
        </Alert>);
};

export const FilesystemPage = ({
    page, backing_block, content_block, fstab_config, mismount_warning
}) => {
    function rename_dialog() {
        // assert(content_block)
        const block_fsys = client.blocks_fsys[content_block.path];

        dialog_open({
            Title: _("Filesystem name"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              validate: name => validate_fsys_label(name, content_block.IdType),
                              value: content_block.IdLabel
                          })
            ],
            Action: {
                Title: _("Save"),
                action: function (vals) {
                    return block_fsys.SetLabel(vals.name, {});
                }
            }
        });
    }

    const [, mount_point] = fstab_config;
    const mounted = content_block && is_mounted(client, content_block);

    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Stored on")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                            <SDesc title={_("Name")}
                                   value={content_block?.IdLabel || "-"}
                                   action={<StorageLink onClick={rename_dialog}
                                                        excuse={!content_block ? _("Filesystem is locked") : null}>
                                       {_("edit")}
                                   </StorageLink>} />
                            <SDesc title={_("Mount point")}>
                                <MountPoint fstab_config={fstab_config}
                                            backing_block={backing_block} content_block={content_block} />
                            </SDesc>
                            { mounted &&
                            <SDesc title={_("Usage")}>
                                <MountPointUsageBar mount_point={mount_point} block={backing_block} />
                            </SDesc>
                            }
                        </DescriptionList>
                    </CardBody>
                    { mismount_warning &&
                    <CardBody>
                        <MismountAlert warning={mismount_warning}
                                         fstab_config={fstab_config}
                                         backing_block={backing_block} content_block={content_block} />
                    </CardBody>
                    }
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};
