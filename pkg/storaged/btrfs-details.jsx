/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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
import { useEvent } from "hooks.js";

import {
    Card, CardBody, CardTitle, CardHeader, Text, TextVariants,
    DescriptionList, DescriptionListTerm, DescriptionListGroup, DescriptionListDescription,
    Popover, Button,
    TextContent, TextList, TextListItem,
} from "@patternfly/react-core";
import { PlusIcon, MinusIcon, ExclamationTriangleIcon } from "@patternfly/react-icons";
import { ListingTable } from "cockpit-components-table.jsx";

import { mounting_dialog, is_mounted, get_fstab_config, is_valid_mount_point, mount_at } from "./fsys-tab.jsx";
import { StdDetailsLayout } from "./details.jsx";
import { StorageButton, StorageMenuItem, StorageBarMenu, StorageUsageBar } from "./storage-controls.jsx";
import { SidePanel } from "./side-panel.jsx";
import {
    dialog_open,
    TextInput,
    SelectSpaces,
    CheckBoxes,
    TeardownMessage,
    init_active_usage_processes
} from "./dialog.jsx";

import {
    flatten,
    decode_filename, encode_filename,
    teardown_active_usage,
    get_available_spaces, prepare_available_spaces,
    reload_systemd, for_each_async
} from "./utils.js";
import { fmt_to_fragments } from "utils.jsx";
import { parse_options, unparse_options, extract_option } from "./format-dialog.jsx";
import { btrfs_poll } from "./client.js";

const _ = cockpit.gettext;

export function btrfs_usage(client, volume) {
    const block_fsys = client.blocks_fsys[volume.path];
    const mount_point = block_fsys && block_fsys.MountPoints[0];
    let use = mount_point && client.fsys_sizes.data[decode_filename(mount_point)];
    if (!use)
        use = [volume.data.used, client.uuids_btrfs_blocks[volume.data.uuid].reduce((sum, b) => sum + b.Size, 0)];
    return use;
}

export function check_btrfs(client, path, push_warning) {
    const block = client.blocks[path];
    const fsys = client.blocks_fsys[path];
    const volume = client.blocks_fsys_btrfs[path];

    if (!block || !fsys || !volume || client.uuids_btrfs_volume[volume.data.uuid] != volume)
        return;

    const subvols = client.uuids_btrfs_subvols[volume.data.uuid];
    const mount_points = fsys.MountPoints.map(decode_filename);

    if (!subvols)
        return;

    // fstab for a given subvol says "auto", but fstab dir is not in MountPoints
    // fstab for a given subvol says "noauto", but fstab dir is in MountPoints
    // Not all entries in MountPoints are referenced as a fstab dir.
    // XXX - improve that via MountPointsAndOptions addition to UDisks, or similar

    const subvol_mountpoints = [];

    for (const subvol of subvols) {
        const [, mount_point, options] = get_fstab_config(block, false, subvol);
        const split_options = parse_options(options);
        const opt_noauto = extract_option(split_options, "noauto");
        const opt_noauto_intent = extract_option(split_options, "x-cockpit-never-auto");
        const opt_systemd_automount = split_options.indexOf("x-systemd.automount") >= 0;
        const is_mounted = mount_points.indexOf(mount_point) >= 0;

        subvol_mountpoints.push(mount_point);

        let type = null;
        if (!is_mounted && !opt_noauto)
            type = "mount-on-boot";
        else if (is_mounted && opt_noauto && !opt_noauto_intent && !opt_systemd_automount)
            type = "no-mount-on-boot";

        if (type)
            push_warning(path, { warning: "mismounted-fsys", type: type, subvol: subvol.id });
    }

    for (const mp of mount_points) {
        if (subvol_mountpoints.indexOf(mp) < 0)
            push_warning(path, { warning: "mismounted-fsys", type: "extra-mount", mountpoint: mp });
    }
}

const BtrfsVolumeSidebar = ({ client, volume, mounted }) => {
    const blocks = client.uuids_btrfs_blocks[volume.data.uuid] || [];

    function add_disk() {
        dialog_open({
            Title: _("Add block devices"),
            Fields: [
                SelectSpaces("disks", _("Block devices"),
                             {
                                 empty_warning: _("No disks are available."),
                                 validate: function(disks) {
                                     if (disks.length === 0)
                                         return _("At least one disk is needed.");
                                 },
                                 spaces: get_available_spaces(client)
                             })
            ],
            Action: {
                Title: _("Add"),
                action: function(vals) {
                    return prepare_available_spaces(client, vals.disks)
                            .then(paths => {
                                return for_each_async(paths, p => {
                                    return volume.AddDevice(p, { }).then(() => client.blocks[p].Rescan({ }));
                                });
                            });
                }
            }
        });
    }

    const actions = (
        <StorageButton onClick={add_disk} excuse={!mounted ? _("At least one subvolume needs to be mounted to manage devices.") : null}>
            <PlusIcon />
        </StorageButton>);

    function render_block(block) {
        let excuse = null;
        if (blocks.length == 1)
            excuse = _("The last device can not be removed.");
        else if (!mounted)
            excuse = _("At least one subvolume needs to be mounted to manage devices.");

        function remove_disk() {
            return volume.RemoveDevice(block.path, { }).then(() => block.Rescan({ }));
        }

        return {
            client: client,
            block: block,
            key: block.path,
            actions: <StorageButton aria-label={_("Remove")} onClick={remove_disk}
                                    excuse={excuse}>
                <MinusIcon />
            </StorageButton>
        };
    }

    return (
        <SidePanel title={_("Block devices")}
                   actions={actions}
                   client={client}
                   rows={blocks.map(render_block)} />);
};

const BtrfsSubvolumes = ({ client, volume }) => {
    const uuid = volume.data.uuid;
    const subvols = client.uuids_btrfs_subvols[uuid];
    const block = client.blocks[volume.path];
    const block_fsys = client.blocks_fsys[block.path];

    const warnings = client.path_warnings[volume.path];
    const warnings_by_id = { };
    if (warnings) {
        for (const w of warnings) {
            const id = w.subvol || true;
            if (!warnings_by_id[id])
                warnings_by_id[id] = [];
            warnings_by_id[id].push(w);
        }
    }

    function fabricate_subvols_from_config() {
        const subvols = [{ pathname: "/", id: 5 }];
        block.Configuration.forEach(c => {
            if (c[0] == "fstab") {
                const opts = decode_filename(c[1].opts.v).split(",");
                opts.forEach(o => {
                    const idx = o.indexOf("subvol=");
                    if (idx >= 0) {
                        const pathname = o.substring(idx + 7);
                        if (!subvols.find(sv => sv.pathname == pathname))
                            subvols.push({ pathname: o.substring(idx + 7) });
                    }
                });
            }
        });
        return subvols;
    }

    function get_direct_subvol_children(subvol) {
        function is_direct_parent(sv) {
            return (sv.pathname.length > subvol.pathname.length &&
                    sv.pathname.substring(0, subvol.pathname.length) == subvol.pathname &&
                    sv.pathname[subvol.pathname.length] == "/" &&
                    sv.pathname.substring(subvol.pathname.length + 1).indexOf("/") == -1);
        }

        return subvols.filter(is_direct_parent);
    }

    function get_subvol_children(subvol) {
        // The deepest nested children must come first
        const direct_children = get_direct_subvol_children(subvol);
        return flatten(direct_children.map(get_subvol_children)).concat(direct_children);
    }

    function render_subvol(subvol) {
        const [, mount_point] = get_fstab_config(block, false, subvol);
        const fs_is_mounted = is_mounted(client, block, subvol);

        function get_mount_point_in_parent() {
            for (const p of subvols) {
                if ((p.pathname == "/" || (subvol.pathname.substring(0, p.pathname.length) == p.pathname &&
                                           subvol.pathname[p.pathname.length] == "/")) &&
                    is_mounted(client, block, p)) {
                    const [, pmp] = get_fstab_config(block, false, p);
                    if (p.pathname == "/")
                        return pmp + "/" + subvol.pathname;
                    else
                        return pmp + subvol.pathname.substring(p.pathname.length);
                }
            }
            return null;
        }

        function mount() {
            return mounting_dialog(client, block, "mount", null, subvol);
        }

        function unmount() {
            return mounting_dialog(client, block, "unmount", null, subvol);
        }

        function set_mount_options(vals) {
            const mount_options = [];

            if (!vals.mount_options.auto || vals.mount_options.never_auto)
                mount_options.push("noauto");
            if (vals.mount_options.ro)
                mount_options.push("ro");
            if (vals.mount_options.never_auto)
                mount_options.push("x-cockpit-never-auto");
            const name = (subvol.pathname == "/" ? vals.name : subvol.pathname + "/" + vals.name);
            mount_options.push("subvol=" + name);
            if (vals.mount_options.extra)
                mount_options.push(vals.mount_options.extra);

            let mount_point = vals.mount_point;
            if (mount_point[0] != "/")
                mount_point = "/" + mount_point;

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

            return block.AddConfigurationItem(config, {})
                    .then(reload_systemd)
                    .then(() => {
                        if (vals.mount_options.auto) {
                            return mount_at(block_fsys, mount_point);
                        } else
                            return Promise.resolve();
                    });
        }

        function create_subvol() {
            const mount_point_in_parent = get_mount_point_in_parent();
            console.log("MPP", subvol.pathname, mount_point_in_parent);

            if (!fs_is_mounted && !mount_point_in_parent) {
                dialog_open({
                    Title: cockpit.format(_("Can't Create Subvolume of $0"), subvol.pathname),
                    Body: _("Either this subvolume or one of its parents needs to be mounted")
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Create Subvolume of $0"), subvol.pathname),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                              }),
                    TextInput("mount_point", _("Mount Point"),
                              {
                                  validate: val => is_valid_mount_point(client, null, val)
                              }),
                    CheckBoxes("mount_options", _("Mount Options"),
                               {
                                   value: {
                                       auto: true,
                                       ro: false,
                                       never_auto: false,
                                       extra: false
                                   },
                                   fields: [
                                       { title: _("Mount now"), tag: "auto" },
                                       { title: _("Mount read only"), tag: "ro" },
                                       {
                                           title: _("Never mount at boot"),
                                           tag: "never_auto",
                                           tooltip: "" // never_auto_explanation,
                                       },
                                       { title: _("Custom mount options"), tag: "extra", type: "checkboxWithInput" },
                                   ]
                               }),
                ],
                Action: {
                    Title: _("Create"),
                    action: function (vals) {
                        const parent_dir = fs_is_mounted ? mount_point : mount_point_in_parent;
                        return cockpit.spawn(["btrfs", "subvol", "create", parent_dir + "/" + vals.name],
                                             { superuser: true, err: "message" })
                                .then(() => {
                                    btrfs_poll();
                                    return set_mount_options(vals);
                                });
                    }
                }
            });
        }

        function delete_() {
            const mount_point_in_parent = get_mount_point_in_parent();
            console.log("MPP", subvol.pathname, mount_point_in_parent);

            if (!mount_point_in_parent) {
                dialog_open({
                    Title: cockpit.format(_("Can't delete subvolume $0"), subvol.pathname),
                    Body: _("One of the parents of this subvolume needs to be mounted")
                });
                return;
            }

            const all_subvols = get_subvol_children(subvol).concat([subvol]);

            const usage = [];
            const configs_to_remove = [];
            const paths_to_delete = [];

            for (const sv of all_subvols) {
                const [config, mount_point] = get_fstab_config(block, false, sv);
                const fs_is_mounted = is_mounted(client, block, sv);

                if (fs_is_mounted) {
                    usage.push({
                        level: 0,
                        usage: 'mounted',
                        block: block,
                        name: sv.pathname,
                        location: mount_point,
                        actions: [_("unmount"), _("delete")],
                        blocking: false,
                    });
                }

                if (config)
                    configs_to_remove.push(config);

                paths_to_delete.push(mount_point_in_parent + sv.pathname.substring(subvol.pathname.length));
            }

            function remove_configs() {
                return for_each_async(configs_to_remove, c => block.RemoveConfigurationItem(c, {}));
            }

            function delete_all_subvols() {
                return cockpit.spawn(["btrfs", "subvolume", "delete"].concat(paths_to_delete),
                                     { superuser: true, err: "message" });
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete subvolume $0?"), subvol.pathname),
                Teardown: TeardownMessage(usage),
                Action: {
                    Title: _("Delete"),
                    Danger: _("Deleting erases all data on a btrfs subvolume."),
                    action: function () {
                        return teardown_active_usage(client, usage)
                                .then(remove_configs)
                                .then(delete_all_subvols)
                                .then(btrfs_poll);
                    }
                },
                Inits: [
                    init_active_usage_processes(client, usage)
                ]
            });
        }

        function edit_mount_options(modify) {
            const [old_config] = get_fstab_config(block, false, subvol);
            if (!old_config)
                return Promise.resolve();

            const old_options = parse_options(decode_filename(old_config[1].opts.v));
            const new_options = unparse_options(modify(old_options));

            const new_config = [
                "fstab", {
                    fsname: old_config[1].fsname,
                    dir: old_config[1].dir,
                    type: old_config[1].type,
                    opts: { t: 'ay', v: encode_filename(new_options || "defaults") },
                    freq: old_config[1].freq,
                    passno: old_config[1].passno
                }];

            return block.UpdateConfigurationItem(old_config, new_config, {}).then(reload_systemd);
        }

        function fix_mount_on_boot_paragraph(w, run) {
            return (
                <TextContent>
                    <Text component={TextVariants.p}>
                        {_("The filesystem is currently not mounted but the system is configured to mount it on next boot. The system might therefore behave differently after the next reboot. This can be fixed in one of these ways:")}
                    </Text>
                    <TextList>
                        <TextListItem>
                            {_("Change the configuration of this filesystem so that it will not be mounted on the next boot.")}
                            {"\n"}
                            <Button isInline variant="link"
                                    onClick={() => run(edit_mount_options(opts => opts.concat("noauto")))}>
                                {_("Apply")}
                            </Button>
                        </TextListItem>
                        <TextListItem>
                            {_("Mount the filesystem now.")}
                            {"\n"}
                            <Button isInline variant="link"
                                    onClick={() => run(client.mount_at(block, mount_point))}>
                                {_("Apply")}
                            </Button>
                        </TextListItem>
                    </TextList>
                </TextContent>);
        }

        function fix_no_mount_on_boot_paragraph(w, run) {
            return (
                <TextContent>
                    <Text component={TextVariants.p}>
                        {_("The filesystem is currently mounted but the system is configured to not mount it on next boot. The system might therefore behave differently after the next reboot. This can be fixed in one of these ways:")}
                    </Text>
                    <TextList>
                        <TextListItem>
                            {_("Change the configuration of this filesystem so that it will also be mounted on the next boot.")}
                            {"\n"}
                            <Button isInline variant="link"
                                    onClick={() => run(edit_mount_options(opts => opts.filter(o => o != "noauto" && o != "x-cockpit-never-auto")))}>
                                {_("Apply")}
                            </Button>
                        </TextListItem>
                        <TextListItem>
                            {_("Mark this filesystem as \"Never mount at boot\". The filesystem will not be mounted during boot even if it was mounted before it.  This is useful if mounting during boot is not possible, such as when a passphrase is required to unlock the filesystem but booting is unattended.")}
                            {"\n"}
                            <Button isInline variant="link"
                                    onClick={() => run(edit_mount_options(opts => opts.concat("x-cockpit-never-auto")))}>
                                {_("Apply")}
                            </Button>
                        </TextListItem>
                        <TextListItem>
                            {_("Unmount the filesystem now.")}
                            {"\n"}
                            <Button isInline variant="link"
                                    onClick={() => run(client.unmount_at(mount_point))}>
                                {_("Apply")}
                            </Button>
                        </TextListItem>
                    </TextList>
                </TextContent>);
        }

        function fix_warnings() {
            const paragraphs = [];

            function run(promise) {
                dlg.run("Applying...", promise.then(() => dlg.close()));
            }

            for (const w of warnings_by_id[subvol.id]) {
                if (w.type == "mount-on-boot")
                    paragraphs.push(fix_mount_on_boot_paragraph(w, run));
                else if (w.type == "no-mount-on-boot")
                    paragraphs.push(fix_no_mount_on_boot_paragraph(w, run));
            }

            const dlg = dialog_open({
                Title: cockpit.format(_("Fix problems of subvolume $0"), subvol.pathname),
                Body: paragraphs,
            });
        }

        function make_warning_paragraph(w) {
            if (w.type == "mount-on-boot")
                return <p>{_("The filesystem is currently not mounted but will be mounted on the next boot.")}</p>;
            else if (w.type == "no-mount-on-boot")
                return <p>{_("The filesystem is currently mounted but will not be mounted after the next boot.")}</p>;
        }

        let warnings_icon = null;
        if (warnings_by_id[subvol.id])
            warnings_icon = (
                <Popover bodyContent={warnings_by_id[subvol.id].map(make_warning_paragraph)}
                         footerContent={hide => <StorageButton isSmall onClick={() => { hide(); fix_warnings() }}>
                             {_("Fix it")}
                         </StorageButton>}>
                    <Button variant="link">
                        <ExclamationTriangleIcon className="ct-icon-exclamation-triangle" />
                    </Button>
                </Popover>);

        const actions = [];
        const menuitems = [];
        let n_only_narrow = 0;

        if (!fs_is_mounted) {
            actions.push(<StorageButton key="mount" onlyWide onClick={mount}>{_("Mount")}</StorageButton>);
            menuitems.push(<StorageMenuItem key="mount" onlyNarrow onClick={mount}>{_("Mount")}</StorageMenuItem>);
            n_only_narrow += 1;
        }

        if (fs_is_mounted)
            menuitems.push(<StorageMenuItem key="unmount" onClick={unmount}>{_("Unmount")}</StorageMenuItem>);

        menuitems.push(<StorageMenuItem key="create" onClick={create_subvol}>{_("Create subvolume")}</StorageMenuItem>);

        if (subvol.pathname != "/")
            menuitems.push(<StorageMenuItem key="delete" onClick={delete_}>{_("Delete")}</StorageMenuItem>);

        let menu = null;
        if (menuitems.length > 0)
            menu = <StorageBarMenu onlyNarrow={menuitems.length == n_only_narrow} menuItems={menuitems} isKebab />;

        const columns = [
            {
                title: subvol.pathname
            },
            {
                title: mount_point
            },
            {
                title: "",
                props: { className: "ct-text-align-right" }
            },
            { title: <>{warnings_icon}{actions}{menu}</>, props: { className: "pf-c-table__action content-action" } },
        ];

        return {
            props: { key: subvol.pathname },
            columns: columns
        };
    }

    const rows = (subvols || fabricate_subvols_from_config()).map(render_subvol);

    return (
        <Card>
            <CardHeader>
                <CardTitle>
                    <Text component={TextVariants.h2}>{_("Subvolumes")}</Text>
                </CardTitle>
            </CardHeader>
            <CardBody>
                { !subvols && _("This list is based on configured mount points in /etc/fstab and might be incomplete. Mount at least one of the subvolumes to get an accurate list.") }
            </CardBody>
            <CardBody className="contains-list">
                <ListingTable emptyCaption={_("No subvolumes")}
                              aria-label={_("Subvolumes")}
                              columns={[_("Name"), _("Used for"), _("Size")]}
                              showHeader={false}
                              rows={rows} />
            </CardBody>
        </Card>);
};

export const BtrfsVolumeDetails = ({ client, volume }) => {
    useEvent(client.fsys_sizes, "changed");

    const uuid = volume.data.uuid;
    const block = client.blocks[volume.path];

    const all_mount_points = flatten(client.uuids_btrfs_blocks[uuid].map(b => client.blocks_fsys[b.path].MountPoints)).map(decode_filename);

    function delete_() {
        const usage = [];

        for (const subvol of client.uuids_btrfs_subvols[uuid]) {
            const [, mount_point] = get_fstab_config(block, false, subvol);
            const fs_is_mounted = is_mounted(client, block, subvol);

            if (fs_is_mounted) {
                usage.push({
                    level: 0,
                    usage: 'mounted',
                    block: block,
                    name: subvol.pathname,
                    location: mount_point,
                    actions: [_("unmount"), _("delete")],
                    blocking: false,
                });
            }
        }

        dialog_open({
            Title: cockpit.format(_("Permanently delete $0?"), volume.data.label),
            Teardown: TeardownMessage(usage),
            Action: {
                Title: _("Delete"),
                Danger: _("Deleting erases all data on a btrfs volume."),
                action: function () {
                    const location = cockpit.location;
                    return teardown_active_usage(client, usage)
                            .then(() => block.Format("empty", { 'tear-down': { t: 'b', v: true } }))
                            .then(() => location.go("/"));
                }
            },
            Inits: [
                init_active_usage_processes(client, usage)
            ]
        });
    }

    const use = btrfs_usage(client, volume);

    const header = (
        <Card>
            <CardHeader actions={{
                            actions: (
                                <>
                                    <StorageButton excuse="Not yet" onClick={null}>{_("Rename")}</StorageButton>
                                    <StorageButton kind="danger" onClick={delete_}>{_("Delete")}</StorageButton>
                                </>
                            )}}>
                <CardTitle>
                    <Text component={TextVariants.h2}>
                        {fmt_to_fragments(_("BTRFS Volume $0"), <b>{volume.data.label || ""}</b>)}
                    </Text>
                </CardTitle>
            </CardHeader>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <DescriptionListGroup>
                        <DescriptionListTerm>{_("storage", "UUID")}</DescriptionListTerm>
                        <DescriptionListDescription>{ volume.data.uuid }</DescriptionListDescription>
                    </DescriptionListGroup>
                    <DescriptionListGroup>
                        <DescriptionListTerm className="control-DescriptionListTerm">{_("storage", "Usage")}</DescriptionListTerm>
                        <DescriptionListDescription className="pf-u-align-self-center">
                            <StorageUsageBar stats={use} critical={0.95} />
                        </DescriptionListDescription>
                    </DescriptionListGroup>
                </DescriptionList>
            </CardBody>
        </Card>
    );

    const sidebar = <BtrfsVolumeSidebar client={client} volume={volume} mounted={all_mount_points.length > 0} />;
    const content = <BtrfsSubvolumes client={client} volume={volume} />;

    return <StdDetailsLayout client={client}
                             header={header}
                             sidebar={sidebar}
                             content={content} />;
};
