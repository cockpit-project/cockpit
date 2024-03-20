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

import { CardBody } from "@patternfly/react-core/dist/esm/components/Card/index.js";
import { DescriptionList } from "@patternfly/react-core/dist/esm/components/DescriptionList/index.js";

import {
    StorageCard, StorageDescription, ChildrenTable, new_card, new_page, navigate_away_from_card
} from "../pages.jsx";
import { StorageUsageBar } from "../storage-controls.jsx";
import {
    encode_filename, decode_filename,
    get_fstab_config_with_client, reload_systemd, extract_option, parse_options,
    flatten, teardown_active_usage,
} from "../utils.js";
import { btrfs_usage, validate_subvolume_name, parse_subvol_from_options } from "./utils.jsx";
import { at_boot_input, update_at_boot_input, mounting_dialog, mount_options } from "../filesystem/mounting-dialog.jsx";
import {
    dialog_open, TextInput,
    TeardownMessage, init_active_usage_processes,
} from "../dialog.jsx";
import { check_mismounted_fsys, MismountAlert } from "../filesystem/mismounting.jsx";
import {
    is_mounted, is_valid_mount_point, mount_point_text, MountPoint, edit_mount_point
} from "../filesystem/utils.jsx";
import client, { btrfs_poll } from "../client.js";

const _ = cockpit.gettext;

function subvolume_unmount(volume, subvol, forced_options) {
    const block = client.blocks[volume.path];
    mounting_dialog(client, block, "unmount", forced_options, subvol);
}

function subvolume_mount(volume, subvol, forced_options) {
    const block = client.blocks[volume.path];
    mounting_dialog(client, block, "mount", forced_options, subvol);
}

function get_mount_point_in_parent(volume, subvol) {
    const block = client.blocks[volume.path];
    const subvols = client.uuids_btrfs_subvols[volume.data.uuid];
    if (!subvols)
        return null;

    for (const p of subvols) {
        const has_parent_subvol = (p.pathname == "/" && subvol.pathname !== "/") ||
                                  (subvol.pathname.substring(0, p.pathname.length) == p.pathname &&
                                   subvol.pathname[p.pathname.length] == "/");
        if (has_parent_subvol && is_mounted(client, block, p)) {
            const [, pmp, opts] = get_fstab_config_with_client(client, block, false, p);
            const opt_ro = extract_option(parse_options(opts), "ro");
            if (!opt_ro) {
                if (p.pathname == "/")
                    return pmp + "/" + subvol.pathname;
                else
                    return pmp + subvol.pathname.substring(p.pathname.length);
            }
        }
    }
    return null;
}

function set_mount_options(subvol, block, vals) {
    const mount_options = [];
    const mount_now = vals.variant != "nomount";

    if (!mount_now || vals.at_boot == "never") {
        mount_options.push("noauto");
    }
    if (vals.mount_options?.ro)
        mount_options.push("ro");
    if (vals.at_boot == "never")
        mount_options.push("x-cockpit-never-auto");
    if (vals.at_boot == "nofail")
        mount_options.push("nofail");
    if (vals.at_boot == "netdev")
        mount_options.push("_netdev");

    const name = (subvol.pathname == "/" ? vals.name : subvol.pathname + "/" + vals.name);
    mount_options.push("subvol=" + name);
    if (vals.mount_options?.extra)
        mount_options.push(vals.mount_options.extra);

    let mount_point = vals.mount_point;
    if (mount_point[0] != "/")
        mount_point = "/" + mount_point;
    mount_point = client.add_mount_point_prefix(mount_point);

    const config =
                  ["fstab",
                      {
                          dir: { t: 'ay', v: encode_filename(mount_point) },
                          type: { t: 'ay', v: encode_filename("btrfs") },
                          opts: { t: 'ay', v: encode_filename(mount_options.join(",") || "defaults") },
                          freq: { t: 'i', v: 0 },
                          passno: { t: 'i', v: 0 },
                          "track-parents": { t: 'b', v: true }
                      }
                  ];

    return block.AddConfigurationItem(config, {})
            .then(reload_systemd)
            .then(() => {
                if (mount_now) {
                    return client.mount_at(block, mount_point);
                } else
                    return Promise.resolve();
            });
}

function subvolume_create(volume, subvol, parent_dir) {
    const block = client.blocks[volume.path];

    let action_variants = [
        { tag: null, Title: _("Create and mount") },
        { tag: "nomount", Title: _("Create only") }
    ];

    if (client.in_anaconda_mode()) {
        action_variants = [
            { tag: "nomount", Title: _("Create") }
        ];
    }

    dialog_open({
        Title: _("Create subvolume"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          validate: name => validate_subvolume_name(name)
                      }),
            TextInput("mount_point", _("Mount Point"),
                      {
                          validate: (val, _values, variant) => {
                              return is_valid_mount_point(client,
                                                          block,
                                                          client.add_mount_point_prefix(val),
                                                          variant == "nomount");
                          }
                      }),
            mount_options(false, false),
            at_boot_input(),
        ],
        update: update_at_boot_input,
        Action: {
            Variants: action_variants,
            action: async function (vals) {
                // HACK: cannot use block_btrfs.CreateSubvolume as it always creates a subvolume relative to MountPoints[0] which
                // makes it impossible to handle a situation where we have multiple subvolumes mounted.
                // https://github.com/storaged-project/udisks/issues/1242
                await cockpit.spawn(["btrfs", "subvolume", "create", `${parent_dir}/${vals.name}`], { superuser: "require", err: "message" });
                await btrfs_poll();
                if (vals.mount_point !== "") {
                    await set_mount_options(subvol, block, vals);
                }
            }
        }
    });
}

function subvolume_delete(volume, subvol, mount_point_in_parent, card) {
    const block = client.blocks[volume.path];
    const subvols = client.uuids_btrfs_subvols[volume.data.uuid];

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

    const all_subvols = get_subvol_children(subvol).concat([subvol]);
    const configs_to_remove = [];
    const paths_to_delete = [];
    const usage = [];

    for (const sv of all_subvols) {
        const [config, mount_point] = get_fstab_config_with_client(client, block, false, sv);
        const fs_is_mounted = is_mounted(client, block, sv);

        usage.push({
            level: 0,
            usage: fs_is_mounted ? 'mounted' : 'none',
            block,
            name: sv.pathname,
            location: mount_point,
            actions: fs_is_mounted ? [_("unmount"), _("delete")] : [_("delete")],
            blocking: false,
        });

        if (config)
            configs_to_remove.push(config);

        paths_to_delete.push(mount_point_in_parent + sv.pathname.substring(subvol.pathname.length));
    }

    dialog_open({
        Title: cockpit.format(_("Permanently delete subvolume $0?"), subvol.pathname),
        Teardown: TeardownMessage(usage),
        Action: {
            Title: _("Delete"),
            Danger: _("Deleting erases all data on this subvolume and all it's children."),
            action: async function () {
                await teardown_active_usage(client, usage);
                for (const c of configs_to_remove)
                    await block.RemoveConfigurationItem(c, {});
                await cockpit.spawn(["btrfs", "subvolume", "delete"].concat(paths_to_delete),
                                    { superuser: true, err: "message" });
                await btrfs_poll();
                navigate_away_from_card(card);
            }
        },
        Inits: [
            init_active_usage_processes(client, usage)
        ]
    });
}

function dirname(path) {
    const i = path.lastIndexOf("/");
    if (i < 0)
        return null;
    else
        return path.substr(0, i);
}

export function make_btrfs_subvolume_pages(parent, volume) {
    let subvols = client.uuids_btrfs_subvols[volume.data.uuid];
    if (!subvols) {
        const block = client.blocks[volume.path];
        /*
         * Try to show subvolumes based on fstab entries. We collect
         * all subvolumes that are mentioned in fstab entries so that
         * the user can at least mount those.
         *
         * The real subvolume data structure has "id" fields and
         * "parent" fields that refer to the ids to form a tree.  We
         * want to do the same here, and we give fake ids to our fake
         * subvolumes for this reason.  We don't store these fake ids
         * in the "id" field since we don't want them to be taken
         * seriously by the rest of the code.
         */
        let fake_id = 5;
        subvols = [{ pathname: "/", id: 5, fake_id: fake_id++ }];
        const subvols_by_pathname = { };
        for (const config of block.Configuration) {
            if (config[0] == "fstab") {
                const opts = config[1].opts;
                if (!opts)
                    continue;

                const fstab_subvol = parse_subvol_from_options(decode_filename(opts.v));

                if (fstab_subvol && fstab_subvol.pathname && fstab_subvol.pathname !== "/") {
                    fstab_subvol.fake_id = fake_id++;
                    subvols_by_pathname[fstab_subvol.pathname] = fstab_subvol;
                    subvols.push(fstab_subvol);
                }
            }
        }

        // Find parents
        for (const pn in subvols_by_pathname) {
            let dn = pn;
            while (true) {
                dn = dirname(dn);
                if (!dn) {
                    subvols_by_pathname[pn].parent = 5;
                    break;
                } else if (subvols_by_pathname[dn]) {
                    subvols_by_pathname[pn].parent = subvols_by_pathname[dn].fake_id;
                    break;
                }
            }
        }
    }

    const root = subvols.find(s => s.id == 5);
    if (root)
        make_btrfs_subvolume_page(parent, volume, root, "", subvols);
}

function make_btrfs_subvolume_page(parent, volume, subvol, path_prefix, subvols) {
    const actions = [];

    const use = btrfs_usage(client, volume);
    const block = client.blocks[volume.path];
    const fstab_config = get_fstab_config_with_client(client, block, false, subvol);
    const [, mount_point, opts] = fstab_config;
    const opt_ro = extract_option(parse_options(opts), "ro");
    const mismount_warning = check_mismounted_fsys(block, block, fstab_config, subvol);
    const mounted = is_mounted(client, block, subvol);
    const mp_text = mount_point_text(mount_point, mounted);
    if (mp_text == null)
        return null;
    const forced_options = [`subvol=${subvol.pathname}`];
    const mount_point_in_parent = get_mount_point_in_parent(volume, subvol);

    if (client.in_anaconda_mode()) {
        actions.push({
            title: _("Edit mount point"),
            action: () => edit_mount_point(block, forced_options, subvol),
        });
    }

    if (mounted) {
        actions.push({
            title: _("Unmount"),
            action: () => subvolume_unmount(volume, subvol, forced_options),
        });
    } else {
        actions.push({
            title: _("Mount"),
            action: () => subvolume_mount(volume, subvol, forced_options),
        });
    }

    // If the current subvolume is mounted rw with an fstab entry or any parent
    // subvolume is mounted rw with an fstab entry allow subvolume creation.
    let create_excuse = "";
    if (!mount_point_in_parent) {
        if (!mounted)
            create_excuse = _("Subvolume needs to be mounted");
        else if (opt_ro)
            create_excuse = _("Subvolume needs to be mounted writable");
    }

    actions.push({
        title: _("Create subvolume"),
        excuse: create_excuse,
        action: () => subvolume_create(volume, subvol, (mounted && !opt_ro) ? mount_point : mount_point_in_parent),
    });

    let delete_excuse = "";
    if (!mount_point_in_parent) {
        delete_excuse = _("At least one parent needs to be mounted writable");
    }

    // Don't show deletion for the root subvolume as it can never be deleted.
    if (subvol.id !== 5 && subvol.pathname !== "/")
        actions.push({
            danger: true,
            title: _("Delete"),
            excuse: delete_excuse,
            action: () => subvolume_delete(volume, subvol, mount_point_in_parent, card),
        });

    function strip_prefix(str, prefix) {
        if (str.startsWith(prefix))
            return str.slice(prefix.length);
        else
            return str;
    }

    const card = new_card({
        title: _("btrfs subvolume"),
        next: null,
        page_location: ["btrfs", volume.data.uuid, subvol.pathname],
        page_name: strip_prefix(subvol.pathname, path_prefix),
        page_size: mounted && <StorageUsageBar stats={use} short />,
        location: mp_text,
        component: BtrfsSubvolumeCard,
        has_warning: !!mismount_warning,
        props: { subvol, mount_point, mismount_warning, block, fstab_config, forced_options },
        actions,
    });
    const page = new_page(parent, card);
    for (const sv of subvols) {
        if (sv.parent && (sv.parent === subvol.id || sv.parent === subvol.fake_id)) {
            make_btrfs_subvolume_page(page, volume, sv, subvol.pathname + "/", subvols);
        }
    }
}

const BtrfsSubvolumeCard = ({ card, subvol, mismount_warning, block, fstab_config, forced_options }) => {
    return (
        <StorageCard card={card} alert={mismount_warning &&
        <MismountAlert warning={mismount_warning}
                                    fstab_config={fstab_config}
                                    backing_block={block} content_block={block} subvol={subvol} />}>
            <CardBody>
                <DescriptionList className="pf-m-horizontal-on-sm">
                    <StorageDescription title={_("Name")} value={subvol.pathname} />
                    <StorageDescription title={_("ID")} value={subvol.id} />
                    <StorageDescription title={_("Mount point")}>
                        <MountPoint fstab_config={fstab_config}
                                    backing_block={block} content_block={block}
                                    forced_options={forced_options} subvol={subvol} />
                    </StorageDescription>
                </DescriptionList>
            </CardBody>
            <CardBody className="contains-list">
                <ChildrenTable emptyCaption={_("No subvolumes")}
                               aria-label={_("btrfs subvolumes")}
                               page={card.page} />
            </CardBody>
        </StorageCard>);
};
