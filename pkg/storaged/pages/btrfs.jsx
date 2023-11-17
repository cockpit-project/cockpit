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
import client, { btrfs_poll } from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { Stack, StackItem } from "@patternfly/react-core/dist/esm/layouts/Stack/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import { SCard } from "../utils/card.jsx";
import { SDesc } from "../utils/desc.jsx";
import { PageChildrenCard, PageContainerStackItems, ParentPageLink, PageCrossrefCard, ActionButtons, new_page, page_type, get_crossrefs, register_crossref, navigate_away_from_page } from "../pages.jsx";
import { encode_filename, decode_filename, fmt_size, fmt_size_long, get_fstab_config_with_client, reload_systemd, for_each_async, flatten, teardown_active_usage } from "../utils.js";
import { is_mounted, mounting_dialog, is_valid_mount_point, get_fstab_config } from "../fsys-tab.jsx"; // TODO: also use is_mounted?
import { dialog_open, TextInput, CheckBoxes, TeardownMessage, init_active_usage_processes } from "../dialog.jsx";

const _ = cockpit.gettext;

function btrfs_usage(uuid) {
    const block_devices = client.uuids_btrfs_blocks[uuid];

    let size = 0;
    for (const block_device of block_devices) {
        size += client.blocks[block_device.path].Size;
    }
    const used = client.blocks_fsys_btrfs[block_devices[0].path].data.used;
    return [used, size];
}

function get_mount_point_in_parent(block, subvol, subvols) {
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

function set_mount_options(block, block_fsys, subvol, vals) {
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
                    return client.mount_at(block, mount_point);
                } else
                    return Promise.resolve();
            });
}

/*
 * Udisks is a disk/block library so it manages that, btrfs turns this a bit
 * around and has one "volume" which can have multiple blocks by a unique uuid.
 */
export function make_btrfs_volume_page(parent, uuid) {
    const block_devices = client.uuids_btrfs_blocks[uuid];

    const block_btrfs = client.blocks_fsys_btrfs[block_devices[0].path];
    // TODO: label is optional, but do we want to show uuid then?
    const name = block_btrfs.data.label || uuid;
    const total_capacity = btrfs_usage(uuid)[1];
    const btrfs_volume_page = new_page({
        location: ["btrfs-volume", name],
        parent,
        name,
        columns: [
            _("Btrfs volume"),
            "",
            fmt_size(total_capacity),
        ],
        component: BtrfsVolumePage,
        props: { block_devices, name: block_btrfs.data.label, uuid: block_btrfs.data.uuid, total_capacity },
        actions: [{ title: "TEST", action: () => console.log('TEST') }],
    });

    if (client.uuids_btrfs_subvols) {
        const subvolumes = client.uuids_btrfs_subvols[uuid];
        if (subvolumes) {
            for (const subvolume of client.uuids_btrfs_subvols[uuid]) {
                make_btrfs_volume_subvolume(btrfs_volume_page, uuid, subvolume, block_btrfs, subvolumes);
            }
        }
    }
}

function make_btrfs_volume_subvolume(parent, uuid, subvol, block_btrfs, subvolumes) {
    const block = client.blocks[block_btrfs.path];
    console.log("subvolume", parent, uuid, subvol, block, block_btrfs, subvolumes);
    const [, mount_point, _options] = get_fstab_config_with_client(client, block, false, subvol);
    const block_fsys = client.blocks_fsys[block.path];
    const mount_points = block_fsys.MountPoints.map(decode_filename);
    const is_subvolume_mounted = mount_points.indexOf(mount_point) >= 0;
    // TODO: discover if mounted.. without fstab??
    // mount -o subvol=home/admin/banan /dev/vda5 /mnt/disk/

    function get_direct_subvol_children(subvol) {
        function is_direct_parent(sv) {
            return (sv.pathname.length > subvol.pathname.length &&
                    sv.pathname.substring(0, subvol.pathname.length) == subvol.pathname &&
                    sv.pathname[subvol.pathname.length] == "/" &&
                    sv.pathname.substring(subvol.pathname.length + 1).indexOf("/") == -1);
        }

        return subvolumes.filter(is_direct_parent);
    }

    function get_subvol_children(subvol) {
        // The deepest nested children must come first
        const direct_children = get_direct_subvol_children(subvol);
        return flatten(direct_children.map(get_subvol_children)).concat(direct_children);
    }

    function mount() {
        return mounting_dialog(client, block, "mount", null, subvol);
    }

    function unmount() {
        return mounting_dialog(client, block, "unmount", null, subvol);
    }

    function validate_mount_point(val) {
        if (val === "")
            return null;
        return is_valid_mount_point(client, null, val);
    }

    function create_subvolume() {
        const mount_point_in_parent = get_mount_point_in_parent(block, subvol, subvolumes);
        console.log("MPP", subvol.pathname, mount_point_in_parent);

        if (!is_subvolume_mounted && !mount_point_in_parent) {
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
                              validate: val => validate_mount_point(val)
                          }),
                CheckBoxes("mount_options", _("Mount Options"),
                           {
                               value: {
                                   auto: false,
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
                    const parent_dir = is_subvolume_mounted ? mount_point : mount_point_in_parent;
                    return cockpit.spawn(["btrfs", "subvolume", "create", parent_dir + "/" + vals.name],
                                         { superuser: true, err: "message" })
                            .then(() => {
                                btrfs_poll();
                                // A BTRFS subvolume is just a directory it doesn't have to be mounted per se
                                if (vals.mount_point !== "") {
                                    return set_mount_options(block, block_fsys, subvol, vals);
                                }
                            });
                }
            }
        });
    }

    function delete_subvolume() {
        const mount_point_in_parent = get_mount_point_in_parent(block, subvol, subvolumes);
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
                    block,
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
                action: async function () {
                    await teardown_active_usage(client, usage);
                    await remove_configs();
                    await delete_all_subvols();
                    await btrfs_poll();
                    navigate_away_from_page(subvolume_page);
                }
            },
            Inits: [
                init_active_usage_processes(client, usage)
            ]
        });
    }

    const key = `${block_btrfs.data.label || uuid}-${subvol.id}`;
    const subvolume_page = new_page({
        location: ["btrfs-volume", key],
        parent,
        name: subvol.pathname,
        component: BtrfsSubvolumePage,
        columns: [
            _("Btrfs subvolume"),
            mount_point,
        ],
        props: { uuid, id: subvol.id, name: subvol.pathname },
        actions: [
            (is_subvolume_mounted ? { title: _("Unmount"), action: unmount } : { title: _("Mount"), action: mount }),
            { title: _("Create subvolume"), action: create_subvolume },
            { title: _("Delete"), action: delete_subvolume, danger: true },
        ],
    });

    register_crossref({
        key,
        page: subvolume_page,
        actions: [],
    });
}

const BtrfsSubvolumePage = ({ page, block_devices, name, uuid, total_capacity, subvolumes }) => {
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Name")}>
                                {name}
                            </SDesc>
                            <SDesc title={_("Part of")}>
                                <ParentPageLink page={page} />
                            </SDesc>
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <PageContainerStackItems page={page} />
        </Stack>);
};

const BtrfsVolumePage = ({ page, block_devices, name, uuid, total_capacity, subvolumes }) => {
    let crossrefs = [];
    for (const blk of block_devices) {
        crossrefs = crossrefs.concat(get_crossrefs(blk));
    }
    return (
        <Stack hasGutter>
            <StackItem>
                <SCard title={page_type(page)} actions={<ActionButtons page={page} />}>
                    <CardBody>
                        <DescriptionList className="pf-m-horizontal-on-sm">
                            <SDesc title={_("Label")} value={name} />
                            <SDesc title={_("UUID")} value={uuid} />
                            <SDesc title={_("Capacity")} value={fmt_size_long(total_capacity)} />
                        </DescriptionList>
                    </CardBody>
                </SCard>
            </StackItem>
            <StackItem>
                <PageCrossrefCard title={_("Devices")}
                                  crossrefs={crossrefs} />
            </StackItem>
            <StackItem>
                <PageChildrenCard title={_("Subvolumes")}
                                  emptyCaption={_("No subvolumes")}
                                  page={page} />
            </StackItem>
        </Stack>
    );
};
