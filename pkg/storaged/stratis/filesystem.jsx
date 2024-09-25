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
import client from "../client";

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import {
    dialog_open, TextInput, BlockingMessage, TeardownMessage,
    init_teardown_usage,
} from "../dialog.jsx";
import { StorageUsageBar, StorageLink } from "../storage-controls.jsx";
import {
    StorageCard, StorageDescription,
    new_page, new_card,
    navigate_away_from_card, navigate_to_new_card_location,
} from "../pages.jsx";
import {
    MountPoint, edit_mount_point,
    is_valid_mount_point, is_mounted,
    get_fstab_config, mount_point_text,
} from "../filesystem/utils.jsx";
import { MismountAlert, check_mismounted_fsys } from "../filesystem/mismounting.jsx";
import { mounting_dialog, at_boot_input, update_at_boot_input, mount_options } from "../filesystem/mounting-dialog.jsx";
import { fmt_size, get_active_usage, teardown_active_usage } from "../utils.js";
import { std_reply, validate_fs_name, set_mount_options, destroy_filesystem } from "./utils.jsx";

const _ = cockpit.gettext;

export function make_stratis_filesystem_page(parent, pool, fsys,
    offset, forced_options, managed_fsys_sizes) {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const block = client.slashdevs_block[fsys.Devnode];

    if (!block)
        return;

    const fstab_config = get_fstab_config(block);
    const [, mount_point] = fstab_config;
    const fs_is_mounted = is_mounted(client, block);

    const mismount_warning = check_mismounted_fsys(block, block, fstab_config);

    function mount() {
        return mounting_dialog(client, block, "mount", forced_options);
    }

    function unmount() {
        return mounting_dialog(client, block, "unmount", forced_options);
    }

    function snapshot_fsys() {
        if (managed_fsys_sizes && stats.pool_free < Number(fsys.Size)) {
            dialog_open({
                Title: _("Not enough space"),
                Body: cockpit.format(_("There is not enough space in the pool to make a snapshot of this filesystem. At least $0 are required but only $1 are available."),
                                     fmt_size(Number(fsys.Size)), fmt_size(stats.pool_free))
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Create a snapshot of filesystem $0"), fsys.Name),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: "",
                              validate: name => validate_fs_name(null, name, filesystems)
                          }),
                TextInput("mount_point", _("Mount point"),
                          {
                              validate: (val, values, variant) => {
                                  return is_valid_mount_point(client,
                                                              null,
                                                              client.add_mount_point_prefix(val),
                                                              variant == "nomount");
                              }
                          }),
                mount_options(false, false),
                at_boot_input(),
            ],
            update: update_at_boot_input,
            Action: {
                Title: _("Create snapshot and mount"),
                Variants: [{ tag: "nomount", Title: _("Create snapshot only") }],
                action: function (vals) {
                    return pool.SnapshotFilesystem(fsys.path, vals.name)
                            .then(std_reply)
                            .then(result => {
                                if (result[0])
                                    return set_mount_options(result[1], vals, forced_options);
                                else
                                    return Promise.resolve();
                            });
                }
            }
        });
    }

    function delete_fsys() {
        const usage = get_active_usage(client, block.path, _("delete"));

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in use"),
                                      fsys.Name),
                Body: BlockingMessage(usage)
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Confirm deletion of $0"), fsys.Name),
            Teardown: TeardownMessage(usage),
            Action: {
                Danger: _("Deleting a filesystem will delete all data in it."),
                Title: _("Delete"),
                action: async function () {
                    await teardown_active_usage(client, usage);
                    await destroy_filesystem(fsys);
                    navigate_away_from_card(fsys_card);
                }
            },
            Inits: [
                init_teardown_usage(client, usage)
            ]
        });
    }

    const mp_text = mount_point_text(mount_point, fs_is_mounted);
    if (mp_text == null)
        return null;

    const fsys_card = new_card({
        title: _("Stratis filesystem"),
        location: mp_text,
        next: null,
        page_location: ["pool", pool.Name, fsys.Name],
        page_name: fsys.Name,
        page_size: (!managed_fsys_sizes
            ? <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                       critical={1} total={stats.fsys_total_used} offset={offset} short />
            : <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), Number(fsys.Size)]}
                                       critical={0.95} short />),
        has_warning: !!mismount_warning,
        component: StratisFilesystemCard,
        props: { pool, fsys, fstab_config, forced_options, managed_fsys_sizes, mismount_warning, offset },
        actions: [
            client.in_anaconda_mode() &&
                { title: _("Edit mount point"), action: () => edit_mount_point(block, forced_options) },
            (fs_is_mounted
                ? { title: _("Unmount"), action: unmount }
                : { title: _("Mount"), action: mount }),
            { title: _("Snapshot"), action: snapshot_fsys },
            { title: _("Delete"), action: delete_fsys, danger: true },
        ]
    });

    new_page(parent, fsys_card);
}

const StratisFilesystemCard = ({
    card, pool, fsys, fstab_config, forced_options, managed_fsys_sizes, mismount_warning, offset,
}) => {
    const filesystems = client.stratis_pool_filesystems[pool.path];
    const stats = client.stratis_pool_stats[pool.path];
    const block = client.slashdevs_block[fsys.Devnode];

    function rename_fsys() {
        dialog_open({
            Title: _("Rename filesystem"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: fsys.Name,
                              validate: name => validate_fs_name(fsys, name, filesystems)
                          })
            ],
            Action: {
                Title: _("Rename"),
                action: async function (vals) {
                    await fsys.SetName(vals.name).then(std_reply);
                    navigate_to_new_card_location(card, ["pool", pool.Name, vals.name]);
                }
            }
        });
    }

    return (
        <StorageCard card={card}
                     alert={mismount_warning &&
                     <MismountAlert warning={mismount_warning}
                                           fstab_config={fstab_config} forced_options={forced_options}
                                           backing_block={block} content_block={block} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")}
                                   value={fsys.Name}
                           action={<StorageLink onClick={rename_fsys}>
                               {_("edit")}
                           </StorageLink>} />
                    <StorageDescription title={_("Mount point")}>
                        <MountPoint fstab_config={fstab_config} forced_options={forced_options}
                                    backing_block={block} content_block={block} />
                    </StorageDescription>
                    <StorageDescription title={_("Usage")}>
                        {(!managed_fsys_sizes
                            ? <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                             critical={1} total={stats.fsys_total_used} offset={offset} />
                            : <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), Number(fsys.Size)]}
                                             critical={0.95} />)
                        }
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
