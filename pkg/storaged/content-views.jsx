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
} from "./dialogx.jsx";
import utils from "./utils.js";

import React from "react";
import createReactClass from 'create-react-class';

import { Listing, ListingRow } from "cockpit-components-listing.jsx";
import { StorageButton, StorageLink } from "./storage-controls.jsx";
import { format_dialog } from "./format-dialog.jsx";

import { FilesystemTab } from "./fsys-tab.jsx";
import { CryptoTab } from "./crypto-tab.jsx";
import { BlockVolTab, PoolVolTab } from "./lvol-tabs.jsx";
import { PVolTab, MDRaidMemberTab, VDOBackingTab } from "./pvol-tabs.jsx";
import { PartitionTab } from "./part-tab.jsx";
import { SwapTab } from "./swap-tab.jsx";
import { UnrecognizedTab } from "./unrecognized-tab.jsx";

var _ = cockpit.gettext;
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
    var block_lvm2 = block && client.blocks_lvm2[block.path];
    var block_pvol = block && client.blocks_pvol[block.path];

    var lvol = (endsWith(target.iface, ".LogicalVolume")
        ? target
        : block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    var is_filesystem = (block && block.IdUsage == 'filesystem');
    var is_crypto = (block && block.IdUsage == 'crypto');

    var tabs = [ ];
    var row_action = null;

    function add_tab(name, renderer) {
        tabs.push(
            { name: name,
              renderer: renderer,
              data: {
                  client: client,
                  block: block,
                  lvol: lvol,
              }
            });
    }

    function create_thin() {
        var vgroup = lvol && client.vgroups[lvol.VolumeGroup];
        if (!vgroup)
            return;

        dialog_open({ Title: _("Create Thin Volume"),
                      Fields: [
                          TextInput("name", _("Name"),
                                    { value: next_default_logical_volume_name(client, vgroup),
                                      validate: utils.validate_lvm2_name
                                    }),
                          SizeSlider("size", _("Size"),
                                     { value: lvol.Size,
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
            row_action = <StorageButton onClick={create_thin}>{_("Create Thin Volume")}</StorageButton>;
        } else {
            add_tab(_("Volume"), BlockVolTab);
        }
    }

    if (is_partition) {
        add_tab(_("Partition"), PartitionTab);
    }

    if (is_filesystem) {
        add_tab(_("Filesystem"), FilesystemTab);
    } else if (is_crypto) {
        add_tab(_("Encryption"), CryptoTab);
    } else if ((block && block.IdUsage == "raid" && block.IdType == "LVM2_member") ||
               (block_pvol && client.vgroups[block_pvol.VolumeGroup])) {
        add_tab(_("Physical Volume"), PVolTab);
    } else if ((block && block.IdUsage == "raid") ||
               (block && client.mdraids[block.MDRaidMember])) {
        add_tab(_("RAID Member"), MDRaidMemberTab);
    } else if (block && client.vdo_overlay.find_by_backing_block(block)) {
        add_tab(_("VDO Backing"), VDOBackingTab);
    } else if (block && block.IdUsage == "other" && block.IdType == "swap") {
        add_tab(_("Swap"), SwapTab);
    } else if (block) {
        add_tab(_("Unrecognized Data"), UnrecognizedTab);
    }

    var tab_actions = [ ];

    function add_action(title, func, excuse) {
        tab_actions.push(<StorageButton key={title} onClick={func} excuse={excuse}>{title}</StorageButton>);
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
        return cockpit.spawn([ "clevis", "luks", "unlock", "-d", dev, "-n", clear_dev ],
                             { superuser: true })
                .catch(() => {
                    // HACK - https://github.com/latchset/clevis/issues/36
                    // Clevis-luks-unlock before version 10 always exit 1, so
                    // we check whether the expected device exists afterwards.
                    return cockpit.spawn([ "test", "-e", "/dev/mapper/" + clear_dev ],
                                         { superuser: true });
                });
    }

    function unlock() {
        if (!client.features.clevis)
            return unlock_with_passphrase();
        else {
            return clevis_unlock()
                    .then(null,
                          function () {
                              return unlock_with_passphrase();
                          });
        }
    }

    function unlock_with_passphrase() {
        var crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        /* If there is a stored passphrase, the Unlock method will
         * use it unconditionally.  So we don't ask for one in
         * that case.
         *
         * https://udisks.freedesktop.org/docs/latest/gdbus-org.freedesktop.UDisks2.Block.html#gdbus-method-org-freedesktop-UDisks2-Block.GetSecretConfiguration
         */
        return block.GetSecretConfiguration({}).then(function (items) {
            for (var i = 0; i < items.length; i++) {
                if (items[i][0] == 'crypttab' &&
                    items[i][1]['passphrase-contents'] &&
                    utils.decode_filename(items[i][1]['passphrase-contents'].v)) {
                    return crypto.Unlock("", { });
                }
            }

            dialog_open({ Title: _("Unlock"),
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
        });
    }

    if (is_crypto) {
        if (client.blocks_cleartext[block.path]) {
            add_action(_("Lock"), lock);
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

    if (lvol) {
        if (lvol.Active) {
            add_action(_("Deactivate"), deactivate);
        } else {
            add_action(_("Activate"), activate);
        }
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
                dialog_open({ Title: cockpit.format(_("$0 is in active use"), name),
                              Body: BlockingMessage(usage)
                });
                return;
            }

            dialog_open({ Title: cockpit.format(_("Please confirm deletion of $0"), name),
                          Footer: TeardownMessage(usage),
                          Action: {
                              Danger: danger,
                              Title: _("Delete"),
                              action: function () {
                                  return utils.teardown_active_usage(client, usage)
                                          .then(function () {
                                              if (lvol)
                                                  return lvol.Delete({ 'tear-down': { t: 'b', v: true }
                                                  });
                                              else if (block_part)
                                                  return block_part.Delete({ 'tear-down': { t: 'b', v: true }
                                                  });
                                          });
                              }
                          }
            });
        }
    }

    if (is_partition || lvol) {
        var excuse = null;
        if (client.is_old_udisks2 && is_crypto && client.blocks_cleartext[block.path])
            excuse = _("Can't delete while unlocked");
        add_action(_("Delete"), delete_, excuse);
    }

    return {
        renderers: tabs,
        actions: [ <div key="actions" >{tab_actions}</div> ],
        row_action: row_action,
    };
}

function block_description(client, block) {
    var usage;
    var block_pvol = client.blocks_pvol[block.path];

    if (block.IdUsage == "filesystem") {
        usage = cockpit.format(C_("storage-id-desc", "$0 File System"), block.IdType);
    } else if (block.IdUsage == "raid") {
        if (block_pvol && client.vgroups[block_pvol.VolumeGroup]) {
            var vgroup = client.vgroups[block_pvol.VolumeGroup];
            usage = cockpit.format(_("Physical volume of $0"), vgroup.Name);
        } else if (client.mdraids[block.MDRaidMember]) {
            var mdraid = client.mdraids[block.MDRaidMember];
            usage = cockpit.format(_("Member of RAID Device $0"), utils.mdraid_name(mdraid));
        } else if (block.IdType == "LVM2_member") {
            usage = _("Physical Volume");
        } else {
            usage = _("Member of RAID Device");
        }
    } else if (block.IdUsage == "crypto") {
        usage = C_("storage-id-desc", "Encrypted data");
    } else if (block.IdUsage == "other") {
        if (block.IdType == "swap") {
            usage = C_("storage-id-desc", "Swap Space");
        } else {
            usage = C_("storage-id-desc", "Other Data");
        }
    } else if (client.vdo_overlay.find_by_backing_block(block)) {
        usage = C_("storage-id-desc", "VDO Backing");
    } else {
        usage = C_("storage-id-desc", "Unrecognized Data");
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
    if (job_object)
        last_column = (
            <span className="spinner spinner-sm spinner-inline"
                  style={{visibility: client.path_jobs[job_object] ? "visible" : "hidden"}} />);
    if (tabs.row_action) {
        if (last_column) {
            last_column = <span>{last_column}{tabs.row_action}</span>;
        } else {
            last_column = tabs.row_action;
        }
    }

    var cols = [
        <span className={"content-level-" + level}>
            {utils.format_size_and_text(desc.size, desc.text)}
        </span>,
        { name: name, 'header': true },
        { name: last_column, tight: true },
    ];

    rows.push(
        <ListingRow key={key}
                    columns={cols}
                    tabRenderers={tabs.renderers}
                    listingActions={tabs.actions} />
    );
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
                {_("Create Partition")}
            </StorageButton>
        );

        var cols = [
            <span className={"content-level-" + level}>
                {utils.format_size_and_text(size, _("Free Space"))}
            </span>,
            "",
            { element: btn, tight: true }
        ];

        rows.push(
            <ListingRow columns={cols} key={"free-space-" + rows.length.toString()} />
        );
    }

    function append_extended_partition(level, partition) {
        var desc = {
            size: partition.size,
            text: _("Extended Partition")
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
    var rows = [ ];
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
            dialog_open({ Title: cockpit.format(_("$0 is in active use"), utils.block_name(block)),
                          Body: BlockingMessage(usage),
            });
            return;
        }

        dialog_open({ Title: cockpit.format(_("Format Disk $0"), utils.block_name(block)),
                      Footer: TeardownMessage(usage),
                      Fields: [
                          SelectOne("erase", _("Erase"),
                                    { choices: [
                                        { value: "no", title: _("Don't overwrite existing data") },
                                        { value: "zero", title: _("Overwrite existing data with zeros") }
                                    ]}),
                          SelectOne("type", _("Partitioning"),
                                    { value: "gpt",
                                      choices: [
                                          { value: "dos", title: _("Compatible with all systems and devices (MBR)") },
                                          { value: "gpt",
                                            title: _("Compatible with modern system and hard disks > 2TB (GPT)")
                                          },
                                          { value: "empty", title: _("No partitioning") }
                                      ]})
                      ],
                      Action: {
                          Title: _("Format"),
                          Danger: _("Formatting a disk will erase all data on it."),
                          action: function (vals) {
                              var options = { 'no-block': { t: 'b', v: true },
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
            <div className="pull-right" key="create-partition-table">
                <StorageButton onClick={format_disk} excuse={block.ReadOnly ? _("Device is read-only") : null}>
                    {_("Create partition table")}
                </StorageButton>
            </div>);

    return (
        <Listing title={_("Content")}
                 actions={[ format_disk_btn ]}
                 emptyCaption="">
            { block_rows(client, block) }
        </Listing>
    );
};

const Block = ({client, block, allow_partitions}) => {
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
            text: _("Pool for Thin Volumes")
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
    var rows = [ ];
    (client.vgroups_lvols[vgroup.path] || [ ]).forEach(function (lvol) {
        if (lvol.ThinPool == "/")
            append_logical_volume(client, rows, 0, lvol);
    });
    return rows;
}

var VGroup = createReactClass({
    render: function () {
        var self = this;
        var vgroup = this.props.vgroup;

        function create_logical_volume() {
            if (vgroup.FreeSize == 0)
                return;

            dialog_open({ Title: _("Create Logical Volume"),
                          Fields: [
                              TextInput("name", _("Name"),
                                        { value: next_default_logical_volume_name(self.props.client, vgroup),
                                          validate: utils.validate_lvm2_name
                                        }),
                              SelectOne("purpose", _("Purpose"),
                                        { value: "block",
                                          choices: [
                                              { value: "block",
                                                title: _("Block device for filesystems"),
                                              },
                                              { value: "pool", title: _("Pool for thinly provisioned volumes") }
                                              /* Not implemented
                                                 { value: "cache", Title: _("Cache") }
                                               */
                                          ]}),
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
                                         { max: vgroup.FreeSize,
                                           round: vgroup.ExtentSize })
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
            <div className="pull-right" key="new-logical-volume">
                <StorageLink onClick={create_logical_volume}
                             excuse={excuse}>
                    <span className="pficon pficon-add-circle-o" />
                    {" "}
                    {_("Create new Logical Volume")}
                </StorageLink>
            </div>);

        return (
            <Listing title="Logical Volumes"
                     actions={[ new_volume_link ]}
                     emptyCaption={_("No Logical Volumes")}>
                { vgroup_rows(self.props.client, vgroup) }
            </Listing>
        );
    }
});

module.exports = {
    Block: Block,
    VGroup: VGroup
};
