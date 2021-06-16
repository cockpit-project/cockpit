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
    dialog_open, TextInput, PassInput, SelectOne, SizeSlider,
    BlockingMessage, TeardownMessage
} from "./dialog.jsx";
import * as utils from "./utils.js";

import React from "react";
import { Card, CardHeader, CardTitle, CardBody, CardActions, Spinner, Text, TextVariants } from "@patternfly/react-core";
import { ExclamationTriangleIcon } from "@patternfly/react-icons";

import { ListingTable } from "cockpit-components-table.jsx";
import { ListingPanel } from 'cockpit-components-listing-panel.jsx';
import { StorageButton, StorageLink, StorageBarMenu, StorageMenuItem } from "./storage-controls.jsx";
import { format_dialog } from "./format-dialog.jsx";
import { job_progress_wrapper } from "./jobs-panel.jsx";

import { FilesystemTab, is_mounted, mounting_dialog } from "./fsys-tab.jsx";
import { CryptoTab } from "./crypto-tab.jsx";
import { get_existing_passphrase } from "./crypto-keyslots.jsx";
import { BlockVolTab, PoolVolTab } from "./lvol-tabs.jsx";
import { PVolTab, MDRaidMemberTab, VDOBackingTab } from "./pvol-tabs.jsx";
import { PartitionTab } from "./part-tab.jsx";
import { SwapTab } from "./swap-tab.jsx";
import { UnrecognizedTab } from "./unrecognized-tab.jsx";

const _ = cockpit.gettext;

var C_ = cockpit.gettext;

function next_default_logical_volume_name(client, vgroup) {
    function find_lvol(name) {
        var lvols = client.vgroups_lvols[vgroup.path];
        for (var i = 0; i < lvols.length; i++) {
            if (lvols[i].Name == name)
                return lvols[i];
        }
        return null;
    }

    var name;
    for (var i = 0; i < 1000; i++) {
        name = "lvol" + i.toFixed();
        if (!find_lvol(name))
            break;
    }

    return name;
}

function create_tabs(client, target, is_partition) {
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    var block = endsWith(target.iface, ".Block") ? target : null;
    var block_fsys = block && client.blocks_fsys[block.path];
    var block_lvm2 = block && client.blocks_lvm2[block.path];
    var block_pvol = block && client.blocks_pvol[block.path];
    var block_swap = block && client.blocks_swap[block.path];

    var lvol = (endsWith(target.iface, ".LogicalVolume")
        ? target
        : block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    var is_filesystem = (block && block.IdUsage == 'filesystem');
    var is_crypto = (block && block.IdUsage == 'crypto');

    var warnings = client.path_warnings[target.path] || [];

    var tabs = [];
    var row_action = null;

    function add_tab(name, renderer, associated_warnings) {
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
                    block: block,
                    lvol: lvol,
                    warnings: tab_warnings,
                }
            });
    }

    function create_thin() {
        var vgroup = lvol && client.vgroups[lvol.VolumeGroup];
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
            add_tab(_("Volume"), BlockVolTab, ["unused-space"]);
        }
    }

    if (is_partition) {
        add_tab(_("Partition"), PartitionTab);
    }

    let is_unrecognized = false;

    if (is_filesystem) {
        add_tab(_("Filesystem"), FilesystemTab, ["mismounted-fsys"]);
    } else if (is_crypto) {
        add_tab(_("Encryption"), CryptoTab);
    } else if ((block && block.IdUsage == "raid" && block.IdType == "LVM2_member") ||
               (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
        add_tab(_("Physical volume"), PVolTab);
    } else if ((block && block.IdUsage == "raid") ||
               (block && client.mdraids[block.MDRaidMember])) {
        add_tab(_("RAID member"), MDRaidMemberTab);
    } else if (block && client.vdo_overlay.find_by_backing_block(block)) {
        add_tab(_("VDO backing"), VDOBackingTab);
    } else if (block && block.IdUsage == "other" && block.IdType == "swap") {
        add_tab(_("Swap"), SwapTab);
    } else if (block) {
        is_unrecognized = true;
        add_tab(_("Unrecognized data"), UnrecognizedTab);
    }

    var tab_actions = [];
    var tab_menu_actions = [];

    function add_action(title, func) {
        tab_actions.push(<StorageButton key={title} onClick={func}>{title}</StorageButton>);
    }

    function add_menu_action(title, func) {
        tab_menu_actions.push({ title: title, func: func });
    }

    function lock() {
        var crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return crypto.Lock({});
    }

    function clevis_unlock() {
        var dev = utils.decode_filename(block.Device);
        var clear_dev = "luks-" + block.IdUUID;
        return cockpit.spawn(["clevis", "luks", "unlock", "-d", dev, "-n", clear_dev],
                             { superuser: true, err: "message" });
    }

    function unlock() {
        var crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return get_existing_passphrase(block, true).then(type => {
            if (type == "stored") {
                return (crypto.Unlock("", {})
                        .catch(() => unlock_with_passphrase()));
            } else if (type == "clevis") {
                return (clevis_unlock()
                        .catch(() => unlock_with_passphrase()));
            } else
                unlock_with_passphrase();
        });
    }

    function unlock_with_passphrase() {
        var crypto = client.blocks_crypto[block.path];
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
                    return crypto.Unlock(vals.passphrase, {});
                }
            }
        });
    }

    if (is_crypto) {
        if (client.blocks_cleartext[block.path]) {
            add_menu_action(_("Lock"), lock);
        } else {
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
        if (lvol.Active) {
            add_menu_action(_("Deactivate"), deactivate);
        } else {
            add_action(_("Activate"), activate);
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
        var block_part;

        /* This is called only for logical volumes and partitions
         */

        if (block)
            block_part = client.blocks_part[block.path];

        var name, danger;

        if (lvol) {
            name = utils.lvol_name(lvol);
            danger = _("Deleting a logical volume will delete all data in it.");
        } else if (block_part) {
            name = utils.block_name(block);
            danger = _("Deleting a partition will delete all data in it.");
        }

        if (name) {
            var usage = utils.get_active_usage(client, target.path);

            if (usage.Blocking) {
                dialog_open({
                    Title: cockpit.format(_("$0 is in active use"), name),
                    Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({
                Title: cockpit.format(_("Please confirm deletion of $0"), name),
                Footer: TeardownMessage(usage),
                Action: {
                    Danger: danger,
                    Title: _("Delete"),
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

    if (is_partition || lvol) {
        add_menu_action(_("Delete"), delete_);
    }

    if (block) {
        if (is_unrecognized)
            add_action(_("Format"), () => format_dialog(client, block.path));
        else
            add_menu_action(_("Format"), () => format_dialog(client, block.path));
    }

    if (block_fsys) {
        if (is_mounted(client, block))
            add_menu_action(_("Unmount"), () => mounting_dialog(client, block, "unmount"));
        else
            add_action(_("Mount"), () => mounting_dialog(client, block, "mount"));
    }

    return {
        renderers: tabs,
        actions: tab_actions,
        menu_actions: tab_menu_actions,
        row_action: row_action,
        has_warnings: warnings.length > 0
    };
}

function block_description(client, block) {
    var usage;
    var block_pvol = client.blocks_pvol[block.path];

    if (block.IdUsage == "filesystem") {
        usage = cockpit.format(C_("storage-id-desc", "$0 file system"), block.IdType);
    } else if (block.IdUsage == "raid") {
        if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
            var vgroup = client.vgroups[block_pvol.VolumeGroup];
            usage = cockpit.format(_("Physical volume of $0"), vgroup.Name);
        } else if (client.mdraids[block.MDRaidMember]) {
            var mdraid = client.mdraids[block.MDRaidMember];
            usage = cockpit.format(_("Member of RAID device $0"), utils.mdraid_name(mdraid));
        } else if (block.IdType == "LVM2_member") {
            usage = _("Physical volume");
        } else {
            usage = _("Member of RAID device");
        }
    } else if (block.IdUsage == "crypto") {
        usage = C_("storage-id-desc", "Encrypted data");
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

    return {
        size: block.Size,
        text: usage
    };
}

function append_row(client, rows, level, key, name, desc, tabs, job_object) {
    // Except in a very few cases, we don't both have a button and
    // a spinner in the same row, so we put them in the same
    // place.

    var last_column = null;
    if (job_object && client.path_jobs[job_object])
        last_column = (
            <Spinner isSVG size="md" />
        );
    if (tabs.row_action) {
        if (last_column) {
            last_column = <span>{last_column}{tabs.row_action}</span>;
        } else {
            last_column = tabs.row_action;
        }
    }

    if (tabs.has_warnings) {
        last_column = <span>{last_column}<ExclamationTriangleIcon className="ct-icon-exclamation-triangle" /></span>;
    }

    var cols = [
        {
            title: <span key={name} className={"content-level-" + level}>
                {utils.format_size_and_text(desc.size, desc.text)}
            </span>
        },
        { title: name },
        { title: last_column, props: { className: "content-action" } },
    ];

    function menuitem(action) {
        return <StorageMenuItem key={action.title} onClick={action.func}>{action.title}</StorageMenuItem>;
    }

    var menu = null;
    if (tabs.menu_actions && tabs.menu_actions.length > 0)
        menu = <StorageBarMenu id={"menu-" + name} menuItems={tabs.menu_actions.map(menuitem)} />;

    var actions = <>{tabs.actions}{menu}</>;

    rows.push({
        props: { key },
        columns: cols,
        expandedContent: <ListingPanel tabRenderers={tabs.renderers}
                                       listingActions={actions} />
    });
}

function append_non_partitioned_block(client, rows, level, block, is_partition) {
    var desc, tabs;
    var cleartext_block;

    if (block.IdUsage == 'crypto')
        cleartext_block = client.blocks_cleartext[block.path];

    tabs = create_tabs(client, block, is_partition);
    desc = block_description(client, block);

    append_row(client, rows, level, block.path, utils.block_name(block), desc, tabs, block.path);

    if (cleartext_block)
        append_device(client, rows, level + 1, cleartext_block);
}

function append_partitions(client, rows, level, block) {
    var block_ptable = client.blocks_ptable[block.path];
    var device_level = level;

    var is_dos_partitioned = (block_ptable.Type == 'dos');

    function append_free_space(level, start, size) {
        function create_partition() {
            format_dialog(client, block.path, start, size, is_dos_partitioned && level <= device_level);
        }

        var btn = (
            <StorageButton onClick={create_partition}>
                {_("Create partition")}
            </StorageButton>
        );

        var cols = [
            {
                title: <span key={start.toString() + size.toString()} className={"content-level-" + level}>
                    {utils.format_size_and_text(size, _("Free space"))}
                </span>
            },
            { },
            { title : btn, props: { className: "content-action" } }
        ];

        rows.push({
            columns: cols,
            props: { key: "free-space-" + rows.length.toString() }
        });
    }

    function append_extended_partition(level, partition) {
        var desc = {
            size: partition.size,
            text: _("Extended partition")
        };
        var tabs = create_tabs(client, partition.block, true);
        append_row(client, rows, level, partition.block.path, utils.block_name(partition.block), desc, tabs, partition.block.path);
        process_partitions(level + 1, partition.partitions);
    }

    function process_partitions(level, partitions) {
        var i, p;
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
    var rows = [];
    append_device(client, rows, 0, block);
    return rows;
}

const BlockContent = ({ client, block, allow_partitions }) => {
    if (!block)
        return null;

    if (block.Size === 0)
        return null;

    function format_disk() {
        var usage = utils.get_active_usage(client, block.path);

        if (usage.Blocking) {
            dialog_open({
                Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
                Body: BlockingMessage(usage),
            });
            return;
        }

        dialog_open({
            Title: cockpit.format(_("Format disk $0"), utils.block_name(block)),
            Footer: TeardownMessage(usage),
            Fields: [
                SelectOne("erase", _("Erase"),
                          {
                              choices: [
                                  { value: "no", title: _("Don't overwrite existing data") },
                                  { value: "zero", title: _("Overwrite existing data with zeros") }
                              ]
                          }),
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
                          })
            ],
            Action: {
                Title: _("Format"),
                Danger: _("Formatting a disk will erase all data on it."),
                wrapper: job_progress_wrapper(client, block.path),
                action: function (vals) {
                    var options = {
                        'tear-down': { t: 'b', v: true }
                    };
                    if (vals.erase != "no")
                        options.erase = { t: 's', v: vals.erase };
                    return utils.teardown_active_usage(client, usage)
                            .then(function () {
                                return block.Format(vals.type, options);
                            });
                }
            }
        });
    }

    var format_disk_btn = null;
    if (allow_partitions)
        format_disk_btn = (
            <StorageButton onClick={format_disk} excuse={block.ReadOnly ? _("Device is read-only") : null}>
                {_("Create partition table")}
            </StorageButton>
        );

    var title;
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
                              columns={[_("Content"), { title: _("Name"), header: true }, _("Actions")]}
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
    var tabs, desc;
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
    var tabs, desc, block;

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
    var rows = [];
    (client.vgroups_lvols[vgroup.path] || []).forEach(function (lvol) {
        if (lvol.ThinPool == "/" && lvol.Origin == "/")
            append_logical_volume(client, rows, 0, lvol);
    });
    return rows;
}

export class VGroup extends React.Component {
    render() {
        var self = this;
        var vgroup = this.props.vgroup;

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

        var excuse = vgroup.FreeSize == 0 && _("No free space");

        var new_volume_link = (
            <StorageLink onClick={create_logical_volume}
                         excuse={excuse}>
                <span className="pficon pficon-add-circle-o" />
                {" "}
                {_("Create new logical volume")}
            </StorageLink>
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
                                  columns={[_("Content"), { title: _("Name"), header: true }, _("Actions")]}
                                  showHeader={false}
                                  variant="compact"
                                  rows={vgroup_rows(self.props.client, vgroup)} />
                </CardBody>
            </Card>
        );
    }
}
