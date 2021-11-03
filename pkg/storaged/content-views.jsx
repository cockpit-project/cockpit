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

import cockpit from "cockpit";
import {
    dialog_open, TextInput, PassInput, SelectOne, SizeSlider, CheckBoxes,
    BlockingMessage, TeardownMessage, teardown_and_apply_title
} from "./dialog.jsx";
import * as utils from "./utils.js";

import React from "react";
import {
    Card, CardHeader, CardTitle, CardBody, CardActions, Spinner, Text, TextVariants,
    DropdownSeparator
} from "@patternfly/react-core";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";

import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StorageButton, StorageBarMenu, StorageMenuItem } from "./storage-controls.jsx";
import {
    format_dialog, parse_options, extract_option, unparse_options
} from "./format-dialog.jsx";
import { job_progress_wrapper } from "./jobs-panel.jsx";

import { FilesystemTab, is_mounted, mounting_dialog, get_fstab_config } from "./fsys-tab.jsx";
import { CryptoTab, edit_config } from "./crypto-tab.jsx";
import { get_existing_passphrase, unlock_with_type } from "./crypto-keyslots.jsx";
import { BlockVolTab, PoolVolTab } from "./lvol-tabs.jsx";
import { PVolTab, MDRaidMemberTab, VDOBackingTab, StratisBlockdevTab } from "./pvol-tabs.jsx";
import { PartitionTab } from "./part-tab.jsx";
import { SwapTab } from "./swap-tab.jsx";
import { UnrecognizedTab } from "./unrecognized-tab.jsx";

const _ = cockpit.gettext;

const C_ = cockpit.gettext;

function next_default_logical_volume_name(client, vgroup) {
    function find_lvol(name) {
        const lvols = client.vgroups_lvols[vgroup.path];
        for (let i = 0; i < lvols.length; i++) {
            if (lvols[i].Name == name)
                return lvols[i];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = "lvol" + i.toFixed();
        if (!find_lvol(name))
            break;
    }

    return name;
}

export function set_crypto_options(block, readonly, auto) {
    return edit_config(block, (config, commit) => {
        const opts = config.options ? parse_options(utils.decode_filename(config.options.v)) : [];
        if (readonly !== null) {
            extract_option(opts, "readonly");
            if (readonly)
                opts.push("readonly");
        }
        if (auto !== null) {
            extract_option(opts, "noauto");
            if (!auto)
                opts.push("noauto");
        }
        config.options = { t: 'ay', v: utils.encode_filename(unparse_options(opts)) };
        return commit();
    });
}

export function set_crypto_auto_option(block, flag) {
    return set_crypto_options(block, null, flag);
}

function create_tabs(client, target, is_partition, is_extended) {
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    const block = endsWith(target.iface, ".Block") ? target : null;
    let is_crypto = (block && block.IdUsage == 'crypto');
    const content_block = is_crypto ? client.blocks_cleartext[block.path] : block;

    const block_fsys = content_block && client.blocks_fsys[content_block.path];
    const block_lvm2 = block && client.blocks_lvm2[block.path];
    const block_pvol = content_block && client.blocks_pvol[content_block.path];
    const block_swap = content_block && client.blocks_swap[content_block.path];

    const block_stratis_blockdev = block && client.blocks_stratis_blockdev[block.path];
    const block_stratis_locked_pool = block && client.blocks_stratis_locked_pool[block.path];

    const lvol = (endsWith(target.iface, ".LogicalVolume")
        ? target
        : block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    const is_filesystem = (content_block && content_block.IdUsage == 'filesystem');
    const is_stratis = ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "stratis") ||
                      (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) ||
                      block_stratis_locked_pool);

    // Adjust for encryption leaking out of Stratis
    if (is_crypto && is_stratis)
        is_crypto = false;

    let warnings = client.path_warnings[target.path] || [];
    if (content_block)
        warnings = warnings.concat(client.path_warnings[content_block.path] || []);

    const tabs = [];
    let row_action = null;

    function add_tab(name, renderer, for_content, associated_warnings) {
        let tab_warnings = [];
        if (associated_warnings)
            tab_warnings = warnings.filter(w => associated_warnings.indexOf(w.warning) >= 0);
        if (tab_warnings.length > 0)
            name = <div className="content-nav-item-warning"><ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /> {name}</div>;
        tabs.push(
            {
                name: name,
                renderer: renderer,
                data: {
                    client: client,
                    block: for_content ? content_block : block,
                    lvol: lvol,
                    warnings: tab_warnings,
                }
            });
    }

    function create_thin() {
        const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        dialog_open({
            Title: _("Create thin volume"),
            Fields: [
                TextInput("name", _("Name"),
                          {
                              value: next_default_logical_volume_name(client, vgroup),
                              validate: utils.validate_lvm2_name
                          }),
                SizeSlider("size", _("Size"),
                           {
                               value: lvol.Size,
                               max: lvol.Size * 3,
                               allow_infinite: true,
                               round: vgroup.ExtentSize
                           })
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return vgroup.CreateThinVolume(vals.name, vals.size, lvol.path, { });
                }
            }
        });
    }

    if (lvol) {
        if (lvol.Type == "pool") {
            add_tab(_("Pool"), PoolVolTab);
            row_action = <StorageButton onClick={create_thin}>{_("Create thin volume")}</StorageButton>;
        } else {
            add_tab(_("Volume"), BlockVolTab, false, ["unused-space"]);
        }
    }

    if (is_partition) {
        add_tab(_("Partition"), PartitionTab);
    }

    let is_unrecognized = false;

    if (is_filesystem) {
        add_tab(_("Filesystem"), FilesystemTab, true, ["mismounted-fsys"]);
    } else if ((content_block && content_block.IdUsage == "raid" && content_block.IdType == "LVM2_member") ||
               (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
        add_tab(_("LVM2 physical volume"), PVolTab, true);
    } else if (is_stratis) {
        add_tab(_("Stratis pool"), StratisBlockdevTab, false);
    } else if ((content_block && content_block.IdUsage == "raid") ||
               (content_block && client.mdraids[content_block.MDRaidMember])) {
        add_tab(_("RAID member"), MDRaidMemberTab, true);
    } else if (content_block && client.vdo_overlay.find_by_backing_block(content_block)) {
        add_tab(_("VDO backing"), VDOBackingTab, true);
    } else if (content_block && content_block.IdUsage == "other" && content_block.IdType == "swap") {
        add_tab(_("Swap"), SwapTab, true);
    } else if (content_block) {
        is_unrecognized = true;
        add_tab(_("Unrecognized data"), UnrecognizedTab, true);
    }

    if (is_crypto) {
        const config = utils.array_find(client.blocks_crypto[block.path].ChildConfiguration, c => c[0] == "fstab");
        if (config && !content_block)
            add_tab(_("Filesystem"), FilesystemTab, false, ["mismounted-fsys"]);
        add_tab(_("Encryption"), CryptoTab);
    }

    const tab_actions = [];
    const tab_menu_actions = [];
    const tab_menu_danger_actions = [];

    function add_action(title, func) {
        tab_actions.push(<StorageButton key={title} onClick={func}>{title}</StorageButton>);
    }

    function add_menu_action(title, func) {
        tab_menu_actions.push({ title: title, func: func });
    }

    function add_menu_danger_action(title, func) {
        tab_menu_danger_actions.push({ title: title, func: func });
    }

    function lock() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return crypto.Lock({}).then(() => set_crypto_auto_option(block, false));
    }

    function unlock() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return get_existing_passphrase(block, true).then(type => {
            return (unlock_with_type(client, block, null, type)
                    .then(() => set_crypto_auto_option(block, true))
                    .catch(() => unlock_with_passphrase()));
        });
    }

    function unlock_with_passphrase() {
        const crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        dialog_open({
            Title: _("Unlock"),
            Fields: [
                PassInput("passphrase", _("Passphrase"), {})
            ],
            Action: {
                Title: _("Unlock"),
                action: function (vals) {
                    return (crypto.Unlock(vals.passphrase, {})
                            .then(() => set_crypto_auto_option(block, true)));
                }
            }
        });
    }

    if (is_crypto) {
        if (client.blocks_cleartext[block.path]) {
            if (!block_fsys)
                add_menu_action(_("Lock"), lock);
        } else {
            const config = utils.array_find(client.blocks_crypto[block.path].ChildConfiguration,
                                            c => c[0] == "fstab");
            if (config && !content_block)
                add_action(_("Mount"), () => mounting_dialog(client, block, "mount"));
            else
                add_action(_("Unlock"), unlock);
        }
    }

    function activate() {
        return lvol.Activate({});
    }

    function deactivate() {
        return lvol.Deactivate({});
    }

    function create_snapshot() {
        dialog_open({
            Title: _("Create snapshot"),
            Fields: [
                TextInput("name", _("Name"),
                          { validate: utils.validate_lvm2_name }),
            ],
            Action: {
                Title: _("Create"),
                action: function (vals) {
                    return lvol.CreateSnapshot(vals.name, vals.size || 0, { });
                }
            }
        });
    }

    if (lvol) {
        if (lvol.Type != "pool") {
            if (lvol.Active) {
                add_menu_action(_("Deactivate"), deactivate);
            } else {
                add_action(_("Activate"), activate);
            }
        }
        if (client.lvols[lvol.ThinPool]) {
            add_menu_action(_("Create snapshot"), create_snapshot);
        }
    }

    function swap_start() {
        return block_swap.Start({});
    }

    function swap_stop() {
        return block_swap.Stop({});
    }

    if (block_swap) {
        if (block_swap.Active)
            add_menu_action(_("Stop"), swap_stop);
        else
            add_menu_action(_("Start"), swap_start);
    }

    function delete_() {
        let block_part;

        /* This is called only for logical volumes and partitions
         */

        if (block)
            block_part = client.blocks_part[block.path];

        let name, danger;

        if (lvol) {
            name = utils.lvol_name(lvol);
            danger = _("Deleting a logical volume will delete all data in it.");
        } else if (block_part) {
            name = utils.block_name(block);
            danger = _("Deleting a partition will delete all data in it.");
        }

        if (name) {
            const usage = utils.get_active_usage(client, target.path);

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in active use"), name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Permanently delete $0?"), name),
                Teardown: TeardownMessage(usage),
                Action: {
                    Danger: danger,
                    Title: teardown_and_apply_title(usage,
                                                    _("Delete"),
                                                    _("Unmount and delete"),
                                                    _("Remove and delete")),
                    action: function () {
                        return utils.teardown_active_usage(client, usage)
                                .then(function () {
                                    if (lvol)
                                        return lvol.Delete({ 'tear-down': { t: 'b', v: true } });
                                    else if (block_part)
                                        return block_part.Delete({ 'tear-down': { t: 'b', v: true } });
                                });
                    }
                }
            });
        }
    }

    if (block && !is_extended) {
        if (is_unrecognized)
            add_action(_("Format"), () => format_dialog(client, block.path));
        else
            add_menu_danger_action(_("Format"), () => format_dialog(client, block.path));
    }

    if (is_partition || lvol) {
        add_menu_danger_action(_("Delete"), delete_);
    }

    if (block_fsys) {
        if (is_mounted(client, content_block))
            add_menu_action(_("Unmount"), () => mounting_dialog(client, content_block, "unmount"));
        else
            add_action(_("Mount"), () => mounting_dialog(client, content_block, "mount"));
    }

    return {
        renderers: tabs,
        actions: tab_actions,
        menu_actions: tab_menu_actions,
        menu_danger_actions: tab_menu_danger_actions,
        row_action: row_action,
        has_warnings: warnings.length > 0
    };
}

function block_description(client, block) {
    let usage;
    const block_stratis_blockdev = client.blocks_stratis_blockdev[block.path];
    const block_stratis_locked_pool = client.blocks_stratis_locked_pool[block.path];
    const cleartext = client.blocks_cleartext[block.path];
    if (cleartext)
        block = cleartext;

    const block_pvol = client.blocks_pvol[block.path];

    if (block.IdUsage == "crypto" && !cleartext) {
        const [config] = get_fstab_config(block, true);
        if (config)
            usage = C_("storage-id-desc", "Filesystem (encrypted)");
        else if (block_stratis_locked_pool)
            usage = cockpit.format(_("Blockdev of locked Stratis pool $0"), block_stratis_locked_pool);
        else
            usage = C_("storage-id-desc", "Locked encrypted data");
    } else if (block.IdUsage == "filesystem") {
        usage = cockpit.format(C_("storage-id-desc", "$0 file system"), block.IdType);
    } else if (block.IdUsage == "raid") {
        if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
            const vgroup = client.vgroups[block_pvol.VolumeGroup];
            usage = cockpit.format(_("LVM2 physical volume of $0"), vgroup.Name);
        } else if (client.mdraids[block.MDRaidMember]) {
            const mdraid = client.mdraids[block.MDRaidMember];
            usage = cockpit.format(_("Member of RAID device $0"), utils.mdraid_name(mdraid));
        } else if (block_stratis_blockdev && client.stratis_pools[block_stratis_blockdev.Pool]) {
            const pool = client.stratis_pools[block_stratis_blockdev.Pool];
            usage = cockpit.format(_("Blockdev of Stratis pool $0"), pool.Name);
        } else if (block.IdType == "LVM2_member") {
            usage = _("LVM2 physical volume");
        } else if (block.IdType == "stratis") {
            usage = _("Member of Stratis Pool");
        } else {
            usage = _("Member of RAID device");
        }
    } else if (block.IdUsage == "other") {
        if (block.IdType == "swap") {
            usage = C_("storage-id-desc", "Swap space");
        } else {
            usage = C_("storage-id-desc", "Other data");
        }
    } else if (client.vdo_overlay.find_by_backing_block(block)) {
        usage = C_("storage-id-desc", "VDO backing");
    } else {
        usage = C_("storage-id-desc", "Unrecognized data");
    }

    if (cleartext)
        usage = cockpit.format(_("$0 (encrypted)"), usage);

    return {
        size: block.Size,
        text: usage
    };
}

function append_row(client, rows, level, key, name, desc, tabs, job_object) {
    function menuitem(action) {
        if (action)
            return <StorageMenuItem key={action.title} onClick={action.func}>{action.title}</StorageMenuItem>;
        else
            return <DropdownSeparator key="sep" />;
    }

    let menu = null;
    let menu_actions = tabs.menu_actions || [];
    if (tabs.menu_danger_actions && tabs.menu_danger_actions.length > 0) {
        if (menu_actions.length > 0)
            menu_actions.push(null); // separator
        menu_actions = menu_actions.concat(tabs.menu_danger_actions);
    }

    if (menu_actions.length > 0)
        menu = <StorageBarMenu id={"menu-" + name} menuItems={menu_actions.map(menuitem)} isKebab />;

    const actions = <>{tabs.row_action}{tabs.actions}</>;

    let info = null;
    if (job_object && client.path_jobs[job_object])
        info = <Spinner isSVG size="md" />;
    if (tabs.has_warnings)
        info = <>{info}<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /></>;
    if (info)
        info = <>{"\n"}{info}</>;

    const cols = [
        {
            title: (
                <span key={name}>
                    {utils.format_size_and_text(desc.size, desc.text)}
                    {info}
                </span>)
        },
        { title: name },
        { title: actions, props: { className: "content-action" } },
        { title: menu, props: { className: "content-action" } }
    ];

    rows.push({
        props: { key, className: "content-level-" + level },
        columns: cols,
        expandedContent: <ListingPanel tabRenderers={tabs.renderers} />
    });
}

function append_non_partitioned_block(client, rows, level, block, is_partition) {
    const tabs = create_tabs(client, block, is_partition);
    const desc = block_description(client, block);

    append_row(client, rows, level, block.path, utils.block_name(block), desc, tabs, block.path);
}

function append_partitions(client, rows, level, block) {
    const block_ptable = client.blocks_ptable[block.path];
    const device_level = level;

    const is_dos_partitioned = (block_ptable.Type == 'dos');

    function append_free_space(level, start, size) {
        function create_partition() {
            format_dialog(client, block.path, start, size, is_dos_partitioned && level <= device_level);
        }

        const btn = (
            <StorageButton onClick={create_partition}>
                {_("Create partition")}
            </StorageButton>
        );

        const cols = [
            {
                title: <span key={start.toString() + size.toString()} className={"content-level-" + level}>
                    {utils.format_size_and_text(size, _("Free space"))}
                </span>
            },
            { },
            { title : btn, props: { className: "content-action" } },
            { props: { className: "content-action" } }
        ];

        rows.push({
            columns: cols,
            props: { key: "free-space-" + rows.length.toString() }
        });
    }

    function append_extended_partition(level, partition) {
        const desc = {
            size: partition.size,
            text: _("Extended partition")
        };
        const tabs = create_tabs(client, partition.block, true, true);
        append_row(client, rows, level, partition.block.path, utils.block_name(partition.block), desc, tabs, partition.block.path);
        process_partitions(level + 1, partition.partitions);
    }

    function process_partitions(level, partitions) {
        let i, p;
        for (i = 0; i < partitions.length; i++) {
            p = partitions[i];
            if (p.type == 'free')
                append_free_space(level, p.start, p.size);
            else if (p.type == 'container')
                append_extended_partition(level, p);
            else
                append_non_partitioned_block(client, rows, level, p.block, true);
        }
    }

    process_partitions(level, utils.get_partitions(client, block));
}

function append_device(client, rows, level, block) {
    if (client.blocks_ptable[block.path])
        append_partitions(client, rows, level, block);
    else
        append_non_partitioned_block(client, rows, level, block, null);
}

// TODO: this should be refactored to React component
// The render method should collect _just_ data via more-or-less recent append_device() flow and
// then return proper React component hierarchy based on this collected data.
// Benefit: much easier debugging, better manipulation with "key" props and relying on well-tested React's functionality
function block_rows(client, block) {
    const rows = [];
    append_device(client, rows, 0, block);
    return rows;
}

const BlockContent = ({ client, block, allow_partitions }) => {
    if (!block)
        return null;

    if (block.Size === 0)
        return null;

    function format_disk() {
        const usage = utils.get_active_usage(client, block.path);

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
                Body: BlockingMessage(usage),
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Initialize disk $0"), utils.block_name(block)),
            Teardown: TeardownMessage(usage),
            Fields: [
                SelectOne("type", _("Partitioning"),
                          {
                              value: "gpt",
                              choices: [
                                  { value: "dos", title: _("Compatible with all systems and devices (MBR)") },
                                  {
                                      value: "gpt",
                                      title: _("Compatible with modern system and hard disks > 2TB (GPT)")
                                  },
                                  { value: "empty", title: _("No partitioning") }
                              ]
                          }),
                CheckBoxes("erase", _("Overwrite"),
                           {
                               fields: [
                                   { tag: "on", title: _("Overwrite existing data with zeros (slower)") }
                               ],
                           }),
            ],
            Action: {
                Title: teardown_and_apply_title(usage,
                                                _("Initialize"),
                                                _("Unmount and initialize"),
                                                _("Remove and initialize")),
                Danger: _("Initializing erases all data on a disk."),
                wrapper: job_progress_wrapper(client, block.path),
                action: function (vals) {
                    const options = {
                        'tear-down': { t: 'b', v: true }
                    };
                    if (vals.erase.on)
                        options.erase = { t: 's', v: "zero" };
                    return utils.teardown_active_usage(client, usage)
                            .then(function () {
                                return block.Format(vals.type, options);
                            });
                }
            }
        });
    }

    let format_disk_btn = null;
    if (allow_partitions)
        format_disk_btn = (
            <StorageButton onClick={format_disk} excuse={block.ReadOnly ? _("Device is read-only") : null}>
                {_("Create partition table")}
            </StorageButton>
        );

    let title;
    if (client.blocks_ptable[block.path])
        title = _("Partitions");
    else
        title = _("Content");

    return (
        <Card>
            <CardHeader>
                <CardTitle><Text component={TextVariants.h2}>{title}</Text></CardTitle>
                <CardActions>{format_disk_btn}</CardActions>
            </CardHeader>
            <CardBody className="contains-list">
                <ListingTable rows={ block_rows(client, block) }
                              aria-label={_("Content")}
                              variant="compact"
                              columns={[_("Content"), { title: _("Name"), header: true }, _("Actions"), _("Menu")]}
                              showHeader={false} />
            </CardBody>
        </Card>
    );
};

export const Block = ({ client, block, allow_partitions }) => {
    return (
        <BlockContent client={client}
                      block={block}
                      allow_partitions={allow_partitions !== false} />
    );
};

function append_logical_volume_block(client, rows, level, block, lvol) {
    let tabs, desc;
    if (client.blocks_ptable[block.path]) {
        desc = {
            size: block.Size,
            text: lvol.Name
        };
        tabs = create_tabs(client, block, false);
        append_row(client, rows, level, lvol.Name, utils.block_name(block), desc, tabs, block.path);
        append_partitions(client, rows, level + 1, block);
    } else {
        append_non_partitioned_block(client, rows, level, block, false);
    }
}

function append_logical_volume(client, rows, level, lvol) {
    let tabs, desc, block;

    if (lvol.Type == "pool") {
        desc = {
            size: lvol.Size,
            text: _("Pool for thin volumes")
        };
        tabs = create_tabs(client, lvol, false);
        append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false);
        client.lvols_pool_members[lvol.path].forEach(function (member_lvol) {
            append_logical_volume(client, rows, level + 1, member_lvol);
        });
    } else {
        block = client.lvols_block[lvol.path];
        if (block)
            append_logical_volume_block(client, rows, level, block, lvol);
        else {
            // If we can't find the block for a active
            // volume, Storaged or something below is
            // probably misbehaving, and we show it as
            // "unsupported".

            desc = {
                size: lvol.Size,
                text: lvol.Active ? _("Unsupported volume") : _("Inactive volume")
            };
            tabs = create_tabs(client, lvol, false);
            append_row(client, rows, level, lvol.Name, lvol.Name, desc, tabs, false);
        }
    }
}

function vgroup_rows(client, vgroup) {
    const rows = [];
    (client.vgroups_lvols[vgroup.path] || []).forEach(function (lvol) {
        if (lvol.ThinPool == "/" && lvol.Origin == "/")
            append_logical_volume(client, rows, 0, lvol);
    });
    return rows;
}

export class VGroup extends React.Component {
    render() {
        const self = this;
        const vgroup = this.props.vgroup;

        function create_logical_volume() {
            if (vgroup.FreeSize == 0)
                return;

            dialog_open({
                Title: _("Create logical volume"),
                Fields: [
                    TextInput("name", _("Name"),
                              {
                                  value: next_default_logical_volume_name(self.props.client, vgroup),
                                  validate: utils.validate_lvm2_name
                              }),
                    SelectOne("purpose", _("Purpose"),
                              {
                                  value: "block",
                                  choices: [
                                      {
                                          value: "block",
                                          title: _("Block device for filesystems"),
                                      },
                                      { value: "pool", title: _("Pool for thinly provisioned volumes") }
                                      /* Not implemented
                                                 { value: "cache", Title: _("Cache") }
                                               */
                                  ]
                              }),
                    /* Not Implemented
                                 { SelectOne: "layout",
                                 Title: _("Layout"),
                                 Options: [
                                 { value: "linear", Title: _("Linear"),
                                 selected: true
                                 },
                                 { value: "striped", Title: _("Striped (RAID 0)"),
                                 enabled: raid_is_possible
                                 },
                                 { value: "raid1", Title: _("Mirrored (RAID 1)"),
                                 enabled: raid_is_possible
                                 },
                                 { value: "raid10", Title: _("Striped and mirrored (RAID 10)"),
                                 enabled: raid_is_possible
                                 },
                                 { value: "raid4", Title: _("With dedicated parity (RAID 4)"),
                                 enabled: raid_is_possible
                                 },
                                 { value: "raid5", Title: _("With distributed parity (RAID 5)"),
                                 enabled: raid_is_possible
                                 },
                                 { value: "raid6", Title: _("With double distributed parity (RAID 6)"),
                                 enabled: raid_is_possible
                                 }
                                 ],
                                 },
                               */
                    SizeSlider("size", _("Size"),
                               {
                                   max: vgroup.FreeSize,
                                   round: vgroup.ExtentSize
                               })
                ],
                Action: {
                    Title: _("Create"),
                    action: function (vals) {
                        if (vals.purpose == "block")
                            return vgroup.CreatePlainVolume(vals.name, vals.size, { });
                        else if (vals.purpose == "pool")
                            return vgroup.CreateThinPoolVolume(vals.name, vals.size, { });
                    }
                }
            });
        }

        const excuse = vgroup.FreeSize == 0 && _("No free space");

        const new_volume_link = (
            <StorageButton onClick={create_logical_volume}
                           excuse={excuse}>
                {_("Create new logical volume")}
            </StorageButton>
        );

        return (
            <Card>
                <CardHeader>
                    <CardTitle><Text component={TextVariants.h2}>{_("Logical volumes")}</Text></CardTitle>
                    <CardActions>{new_volume_link}</CardActions>
                </CardHeader>
                <CardBody className="contains-list">
                    <ListingTable emptyCaption={_("No logical volumes")}
                                  aria-label={_("Logical volumes")}
                                  columns={[_("Content"), { title: _("Name"), header: true }, _("Actions"), _("Menu")]}
                                  showHeader={false}
                                  variant="compact"
                                  rows={vgroup_rows(self.props.client, vgroup)} />
                </CardBody>
            </Card>
        );
    }
}
