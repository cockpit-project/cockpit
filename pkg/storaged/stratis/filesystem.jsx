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
    dialog_open, TextInput, CheckBoxes, SizeSlider, BlockingMessage, TeardownMessage,
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
    offset, forced_options) {
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
        page_size: <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                    critical={1} total={stats.fsys_total_used} offset={offset} short />,
        has_warning: !!mismount_warning,
        component: StratisFilesystemCard,
        props: { pool, fsys, fstab_config, forced_options, mismount_warning, offset },
        actions: [
            client.in_anaconda_mode() &&
                { title: _("Edit mount point"), action: () => edit_mount_point(block, forced_options) },
            (fs_is_mounted
                ? { title: _("Unmount"), action: unmount }
                : { title: _("Mount"), action: mount }),
            {
                title: _("Snapshot"),
                action: snapshot_fsys,
                excuse: ((!pool.Overprovisioning && stats.pool_free < Number(fsys.Size))
                    ? _("Not enough free space")
                    : null),
            },
            { title: _("Delete"), action: delete_fsys, danger: true },
        ]
    });

    new_page(parent, fsys_card);
}

const StratisFilesystemCard = ({
    card, pool, fsys, fstab_config, forced_options, mismount_warning, offset,
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

    function set_limit() {
        dialog_open({
            Title: _("Set limit of virtual filesystem size"),
            Fields: [
                CheckBoxes("size_options", _("Options"),
                           {
                               value: {
                                   custom_limit: fsys.SizeLimit[0],
                               },
                               fields: [
                                   { tag: "custom_limit", title: _("Limit virtual filesystem size") },
                               ]
                           }),
                SizeSlider("limit", _("Virtual size limit"),
                           {
                               visible: vals => vals.size_options.custom_limit,
                               value: fsys.SizeLimit[0] && Number(fsys.SizeLimit[1]),
                               min: Number(fsys.Size),
                               max: pool.Overprovisioning ? stats.pool_total : stats.pool_free + Number(fsys.Size),
                               allow_infinite: true,
                               round: 512
                           }),
            ],
            Action: {
                Title: _("Set"),
                action: async function (vals) {
                    await client.stratis_set_property(fsys,
                                                      "SizeLimit",
                                                      "(bs)", (vals.size_options.custom_limit
                                                          ? [true, vals.limit.toString()]
                                                          : [false, ""]));
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
                        <StorageUsageBar stats={[Number(fsys.Used[0] && Number(fsys.Used[1])), stats.pool_total]}
                                             critical={1} total={stats.fsys_total_used} offset={offset} />
                    </StorageDescription>
                    <StorageDescription title={_("Virtual size")}
                                        value={fmt_size(Number(fsys.Size))} />
                    <StorageDescription title={_("Virtual size limit")}
                                        value={fsys.SizeLimit[0] ? fmt_size(Number(fsys.SizeLimit[1])) : _("none")}
                                        action={<StorageLink onClick={set_limit}>
                                            {_("edit")}
                                        </StorageLink>} />
                </DescriptionList>
            </CardBody>
        </StorageCard>
    );
};
