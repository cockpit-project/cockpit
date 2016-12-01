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

"use strict";

var cockpit = require("cockpit");
var dialog = require("./dialog");
var utils = require("./utils.js");

var React = require("react");
var CockpitListing = require("cockpit-components-listing.jsx");
var StorageControls = require("./storage-controls.jsx");
var FormatDialog = require("./format-dialog.jsx");

var StorageButton = StorageControls.StorageButton;
var StorageLink =   StorageControls.StorageLink;
var FormatButton =  FormatDialog.FormatButton;

var FilesystemTab   = require("./fsys-tab.jsx").FilesystemTab;
var CryptoTab       = require("./crypto-tab.jsx").CryptoTab;
var BlockVolTab     = require("./lvol-tabs.jsx").BlockVolTab;
var PoolVolTab      = require("./lvol-tabs.jsx").PoolVolTab;
var PVolTab         = require("./pvol-tabs.jsx").PVolTab;
var MDRaidMemberTab = require("./pvol-tabs.jsx").MDRaidMemberTab;
var PartitionTab    = require("./part-tab.jsx").PartitionTab;
var SwapTab         = require("./swap-tab.jsx").SwapTab;
var UnrecognizedTab = require("./unrecognized-tab.jsx").UnrecognizedTab;

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

function create_tabs(client, target, is_partition) {
    function endsWith(str, suffix) {
        return str.indexOf(suffix, str.length - suffix.length) !== -1;
    }

    var block = endsWith(target.iface, ".Block")? target : null;
    var block_lvm2 = block && client.blocks_lvm2[block.path];
    var block_pvol = block && client.blocks_pvol[block.path];

    var lvol = (endsWith(target.iface, ".LogicalVolume")?
                target :
                block_lvm2 && client.lvols[block_lvm2.LogicalVolume]);

    var is_filesystem         = (block && block.IdUsage == 'filesystem');
    var is_crypto             = (block && block.IdUsage == 'crypto');

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

        dialog.open({ Title: _("Create Thin Volume"),
                      Fields: [
                          { TextInput: "name",
                            Title: _("Name"),
                            validate: utils.validate_lvm2_name
                          },
                          { SizeSlider: "size",
                            Title: _("Size"),
                            Value: lvol.Size,
                            Max: lvol.Size * 3,
                            AllowInfinite: true,
                            Round: vgroup.ExtentSize
                          }
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
    } else if (block && block.IdUsage == "other" && block.IdType == "swap") {
        add_tab(_("Swap"), SwapTab);
    } else if (block) {
        add_tab(_("Unrecognized Data"), UnrecognizedTab);
    }

    var tab_actions = [ ];

    function add_action(title, func, excuse) {
        tab_actions.push(<StorageButton onClick={func} excuse={excuse}>{title}</StorageButton>);
    }

    function lock() {
        var crypto = client.blocks_crypto[block.path];
        if (!crypto)
            return;

        return crypto.Lock({});
    }

    function unlock() {
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

            dialog.open({ Title: _("Unlock"),
                          Fields: [
                              { PassInput: "passphrase",
                                Title: _("Passphrase")
                              }
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
            dialog.open({ Title: cockpit.format(_("Please confirm deletion of $0"), name),
                          Alerts: utils.get_usage_alerts(client, target.path),
                          Fields: [
                          ],
                          Action: {
                              Danger: danger,
                              Title: _("Delete"),
                              action: function () {
                                  if (lvol)
                                      return lvol.Delete({ 'tear-down': { t: 'b', v: true }
                                      });
                                  else if (block_part)
                                      return block_part.Delete({ 'tear-down': { t: 'b', v: true }
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
        actions: [ <div>{tab_actions}</div> ],
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
    } else {
        usage = C_("storage-id-desc", "Unrecognized Data");
    }

    return {
        size: utils.fmt_size(block.Size),
        text: usage
    };
}

function append_row(rows, level, key, name, desc, tabs, job_object) {
    // Except in a very few cases, we don't both have a button and
    // a spinner in the same row, so we put them in the same
    // place.

    var last_column = null;
    if (job_object)
        last_column = (
            <span className="spinner spinner-sm spinner-inline"
                  style={{visibility: "hidden"}}
                  data-job-object={job_object}>
            </span>);
    if (tabs.row_action) {
        if (last_column) {
            last_column = <span>{last_column}{tabs.row_action}</span>;
        } else {
            last_column = tabs.row_action;
        }
    }

    var cols = [
        <span className={"content-level-" + level}>{desc.size + " " + desc.text}</span>,
        { name: name, 'header': true },
        { name: last_column, tight: true },
    ];
    rows.push(
        <CockpitListing.ListingRow key={key}
                                   columns={cols}
                                   tabRenderers={tabs.renderers}
                                   listingActions={tabs.actions}/>
    );
}

function append_non_partitioned_block(client, rows, level, block, is_partition) {
    var id, name, desc, tabs;
    var cleartext_block;

    if (block.IdUsage == 'crypto')
        cleartext_block = client.blocks_cleartext[block.path];

    tabs = create_tabs(client, block, is_partition);
    desc = block_description(client, block);

    append_row(rows, level, block.path, utils.block_name(block), desc, tabs, block.path);

    if (cleartext_block)
        append_device(client, rows, level+1, cleartext_block);
}

function append_partitions(client, rows, level, block) {
    var block_ptable = client.blocks_ptable[block.path];
    var device_level = level;

    var is_dos_partitioned = (block_ptable.Type == 'dos');
    var partitions = client.blocks_partitions[block.path];

    function append_free_space(level, start, size) {
        // There is a lot of rounding and aligning going on in
        // the storage stack.  All of udisks2, libblockdev,
        // and libparted seem to contribute their own ideas of
        // where a partition really should start.
        //
        // The start of partitions are aggressively rounded
        // up, sometimes twice, but the end is not aligned in
        // the same way.  This means that a few megabytes of
        // free space will show up between partitions.
        //
        // We hide these small free spaces because they are
        // unexpected and can't be used for anything anyway.
        //
        // "Small" is anything less than 3 MiB, which seems to
        // work okay.  (The worst case is probably creating
        // the first logical partition inside a extended
        // partition with udisks+libblockdev.  It leads to a 2
        // MiB gap.)

        function create_partition() {
            FormatDialog.format_dialog(client, block.path, start, size, is_dos_partitioned && level <= device_level);
        }

        if (size >= 3*1024*1024) {
            var btn = (
                <StorageButton onClick={create_partition}>
                    {_("Create Partition")}
                </StorageButton>
            );

            var cols = [
                <span className={"content-level-" + level}>{utils.fmt_size(size) + " " + _("Free Space")}</span>,
                "",
                { element: btn, tight: true }
            ];

            rows.push(
                <CockpitListing.ListingRow columns={cols}/>
            );
        }
    }

    function append_extended_partition(level, block, start, size) {
        var desc = {
            size: utils.fmt_size(size),
            text: _("Extended Partition")
        };
        var tabs = create_tabs(client, block, true);
        append_row(rows, level, block.path, utils.block_name(block), desc, tabs, block.path);
        process_level(level + 1, start, size);
    }

    function process_level(level, container_start, container_size) {
        var n;
        var last_end = container_start;
        var total_end = container_start + container_size;
        var block, start, size, is_container, is_contained, partition_label;

        for (n = 0; n < partitions.length; n++) {
            block = client.blocks[partitions[n].path];
            start = partitions[n].Offset;
            size = partitions[n].Size;
            is_container = partitions[n].IsContainer;
            is_contained = partitions[n].IsContained;

            if (block === null)
                continue;

            if (level === device_level && is_contained)
                continue;

            if (level == device_level+1 && !is_contained)
                continue;

            if (start < container_start || start+size > container_start+container_size)
                continue;

            append_free_space(level, last_end, start - last_end);
            if (is_container) {
                append_extended_partition(level, block, start, size);
            } else {
                append_non_partitioned_block(client, rows, level, block, true);
            }
            last_end = start + size;
        }

        append_free_space(level, last_end, total_end - last_end);
    }

    process_level(device_level, 0, block.Size);
}

function append_device(client, rows, level, block) {
    if (client.blocks_ptable[block.path])
        append_partitions(client, rows, level, block);
    else
        append_non_partitioned_block(client, rows, level, block, null);
}

function block_rows(client, block) {
    var rows = [ ];
    append_device(client, rows, 0, block);
    return rows;
}

function block_content(client, block) {
    if (!block)
        return null;

    var drive = client.drives[block.Drive];
    if (drive)
        block = client.drives_block[drive.path];

    if (!block)
        return null;

    if (block.Size === 0)
        return null;

    function format_disk() {
        dialog.open({ Title: cockpit.format(_("Format Disk $0"), utils.block_name(block)),
                      Alerts: utils.get_usage_alerts(client, block.path),
                      Fields: [
                          { SelectOne: "erase",
                            Title: _("Erase"),
                            Options: [
                                { value: "no", Title: _("Don't overwrite existing data") },
                                { value: "zero", Title: _("Overwrite existing data with zeros") }
                            ]
                          },
                          { SelectOne: "type",
                            Title: _("Partitioning"),
                            Options: [
                                { value: "dos", Title: _("Compatible with all systems and devices (MBR)") },
                                { value: "gpt", Title: _("Compatible with modern system and hard disks > 2TB (GPT)"),
                                  selected: true
                                },
                                { value: "empty", Title: _("No partitioning") }
                            ]
                          }
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
                              return block.Format(vals.type, options);
                          }
                      }
        });
    }

    var format_disk_btn = (
        <div className="pull-right">
            <StorageButton onClick={format_disk} excuse={block.ReadOnly? _("Device is read-only") : null}>
                {_("Create partition table")}
            </StorageButton>
        </div>);

    return (
        <CockpitListing.Listing title={_("Content")}
                                actions={format_disk_btn}>
            { block_rows(client, block) }
        </CockpitListing.Listing>
    );
}

var Block = React.createClass({
    getInitialState: function () {
        return { block: null };
    },
    onClientChanged: function () {
        this.setState({ block: this.props.client.slashdevs_block[this.props.name] });
    },
    componentDidMount: function () {
        $(this.props.client).on("changed", this.onClientChanged);
        this.onClientChanged();
    },
    componentWillUnmount: function () {
        $(this.props.model).off("changed", this.onClientChanged);
    },
    render: function () {
        return block_content(this.props.client, this.state.block);
    }
});

var MDRaid = React.createClass({
    getInitialState: function () {
        return { mdraid: null, block: null };
    },
    onClientChanged: function () {
        var mdraid = this.props.client.uuids_mdraid[this.props.name];
        var block = mdraid && this.props.client.mdraids_block[mdraid.path];
        this.setState({ mdraid: mdraid, block: block });
    },
    componentDidMount: function () {
        $(this.props.client).on("changed", this.onClientChanged);
        this.onClientChanged();
    },
    componentWillUnmount: function () {
        $(this.props.model).off("changed", this.onClientChanged);
    },

    render: function () {
        return block_content(this.props.client, this.state.block);
    }
});

function append_logical_volume_block(client, rows, level, block, lvol) {
    var tabs, desc;
    if (client.blocks_ptable[block.path]) {
        desc = {
            size: utils.fmt_size(block.Size),
            text: lvol.Name
        };
        tabs = create_tabs(clienta, block, false);
        append_row(rows, level, lvol.Name, utils.block_name(block), desc, tabs, block.path);
        append_partitions(client, rows, level+1, block);
    } else {
        append_non_partitioned_block (client, rows, level, block, false);
    }
}

function append_logical_volume(client, rows, level, lvol) {
    var tabs, desc, ratio, block;

    if (lvol.Type == "pool") {
        ratio = Math.max(lvol.DataAllocatedRatio, lvol.MetadataAllocatedRatio);
        desc = {
            size: utils.fmt_size(lvol.Size),
            text: _("Pool for Thin Volumes")
        };
        tabs = create_tabs (client, lvol, false);
        append_row(rows, level, lvol.Name, lvol.Name, desc, tabs, false);
        client.lvols_pool_members[lvol.path].forEach(function (member_lvol) {
            append_logical_volume (client, rows, level+1, member_lvol);
        });
    } else {
        block = client.lvols_block[lvol.path];
        if (block)
            append_logical_volume_block (client, rows, level, block, lvol);
        else {
            // If we can't find the block for a active
            // volume, Storaged or something below is
            // probably misbehaving, and we show it as
            // "unsupported".

            desc = {
                size: utils.fmt_size(lvol.Size),
                text: lvol.Active? _("Unsupported volume") : _("Inactive volume")
            }
            tabs = create_tabs (client, lvol, false);
            append_row(rows, level, lvol.Name, lvol.Name, desc, tabs, false);
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

var VGroup = React.createClass({
    getInitialState: function () {
        return { vgroup: null };
    },
    onClientChanged: function () {
        this.setState({ vgroup: this.props.client.vgnames_vgroup[this.props.name] });
    },
    componentDidMount: function () {
        $(this.props.client).on("changed", this.onClientChanged);
        this.onClientChanged();
    },
    componentWillUnmount: function () {
        $(this.props.model).off("changed", this.onClientChanged);
    },

    render: function () {
        var self = this;
        var vgroup = self.state.vgroup;

        if (!vgroup)
            return null;

        function create_logical_volume() {
            if (vgroup.FreeSize == 0)
                return;

            function find_lvol(name) {
                var lvols = self.props.client.vgroups_lvols[vgroup.path];
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

            dialog.open({ Title: _("Create Logical Volume"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                Value: name,
                                validate: utils.validate_lvm2_name
                              },
                              { SelectOne: "purpose",
                                Title: _("Purpose"),
                                Options: [
                                    { value: "block", Title: _("Block device for filesystems"),
                                      selected: true
                                    },
                                    { value: "pool", Title: _("Pool for thinly provisioned volumes") }
                                    /* Not implemented
                                       { value: "cache", Title: _("Cache") }
                                     */
                                ]
                              },
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
                              { SizeSlider: "size",
                                Title: _("Size"),
                                Max: vgroup.FreeSize,
                                Round: vgroup.ExtentSize
                              }
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
            <div className="pull-right">
                <StorageLink onClick={create_logical_volume}
                             excuse={excuse}>
                    <span className="pficon pficon-add-circle-o"></span>
                    {" "}
                    {_("Create new Logical Volume")}
                </StorageLink>
            </div>);

        return (
            <CockpitListing.Listing title="Logical Volumes"
                                    actions={new_volume_link}
                                    emptyCaption={_("No Logical Volumes")}>
                { vgroup_rows(self.props.client, vgroup) }
            </CockpitListing.Listing>
        );
    }
});

module.exports = {
    Block: Block,
    MDRaid: MDRaid,
    VGroup: VGroup
};
