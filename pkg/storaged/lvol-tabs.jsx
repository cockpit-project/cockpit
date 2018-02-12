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
var StorageControls = require("./storage-controls.jsx");

var StorageButton = StorageControls.StorageButton;
var StorageLink =   StorageControls.StorageLink;

var _ = cockpit.gettext;

function lvol_rename(lvol) {
    dialog.open({ Title: _("Rename Logical Volume"),
                  Fields: [
                      { TextInput: "name",
                        Title: _("Name"),
                        Value: lvol.Name
                      }
                  ],
                  Action: {
                      Title: _("Rename"),
                      action: function (vals) {
                          return lvol.Rename(vals.name, { });
                      }
                  }
    });
}

function lvol_and_fsys_resize(client, lvol, size, offline) {
    var block, crypto, fsys;
    var crypto_overhead;
    var vdo;
    var orig_size = lvol.Size;

    block = client.lvols_block[lvol.path];
    if (!block)
        return lvol.Resize(size, { });

    crypto = client.blocks_crypto[block.path];
    if (crypto) {
        var cleartext = client.blocks_cleartext[block.path];
        if (!cleartext)
            return;
        fsys = client.blocks_fsys[cleartext.path];
        vdo = client.vdo_overlay.find_by_backing_block(cleartext);
        crypto_overhead = block.Size - cleartext.Size;
    } else {
        fsys = client.blocks_fsys[block.path];
        vdo = client.vdo_overlay.find_by_backing_block(block);
        crypto_overhead = 0;
    }

    function fsys_resize() {
        if (fsys) {
            // When doing an offline resize, we need to first repair the filesystem.
            if (offline) {
                return fsys.Repair({ }).then(function () { return fsys.Resize(size - crypto_overhead, { }); });
            } else {
                return fsys.Resize(size - crypto_overhead, { });
            }
        } else if (size < orig_size) {
            // This shouldn't happen.  But if it does, continuing is harmful, so we throw an error.
            console.warn("Trying to shrink unrecognized content.  Ignored.");
            return cockpit.reject();
        } else if (vdo) {
            return vdo.grow_physical();
        } else {
            // Growing unrecognized content, nothing to do.
            return cockpit.resolve();
        }
    }

    function crypto_resize() {
        if (crypto) {
            return crypto.Resize(size - crypto_overhead, { });
        } else {
            return cockpit.resolve();
        }
    }

    function lvm_resize() {
        return lvol.Resize(size, { });
    }

    if (fsys && !fsys.Resize) {
        // Fallback for old versions of UDisks.  This doesn't handle encrypted volumes.
        if (size != orig_size) {
            return lvol.Resize(size, { resize_fsys: { t: 'b', v: true } });
        }
    } else {
        if (size < orig_size) {
            return fsys_resize().then(crypto_resize).then(lvm_resize);
        } else if (size > orig_size) {
            return lvm_resize().then(crypto_resize).then(fsys_resize);
        }
    }
}

function lvol_grow(client, lvol, info) {
    var block = client.lvols_block[lvol.path];
    var vgroup = client.vgroups[lvol.VolumeGroup];
    var pool = client.lvols[lvol.ThinPool];

    var usage = utils.get_active_usage(client, block && info.grow_needs_unmount? block.path : null);

    if (usage.Blocking) {
        dialog.open({ Title: cockpit.format(_("$0 is in active use"), lvol.Name),
                      Blocking: usage.Blocking,
                      Fields: [ ]
        });
        return;
    }

    dialog.open({ Title: _("Grow Logical Volume"),
                  Teardown: usage.Teardown,
                  Fields: [
                      { SizeSlider: "size",
                        Title: _("Size"),
                        Value: lvol.Size,
                        Min: lvol.Size,
                        Max: (pool ?
                              pool.Size * 3 :
                              lvol.Size + vgroup.FreeSize),
                        AllowInfinite: !!pool,
                        Round: vgroup.ExtentSize
                      }
                  ],
                  Action: {
                      Title: _("Grow"),
                      action: function (vals) {
                          return utils.teardown_active_usage(client, usage).
                                       then(function () {
                                           return lvol_and_fsys_resize(client, lvol, vals.size,
                                                                       info.grow_needs_unmount);
                                       });
                      }
                  }
    });
}

function lvol_shrink(client, lvol, info) {
    var block = client.lvols_block[lvol.path];
    var vgroup = client.vgroups[lvol.VolumeGroup];

    var usage = utils.get_active_usage(client, block && info.shrink_needs_unmount? block.path : null);

    if (usage.Blocking) {
        dialog.open({ Title: cockpit.format(_("$0 is in active use"), lvol.Name),
                      Blocking: usage.Blocking,
                      Fields: [ ]
        });
        return;
    }

    dialog.open({ Title: _("Shrink Logical Volume"),
                  Teardown: usage.Teardown,
                  Fields: [
                      { SizeSlider: "size",
                        Title: _("Size"),
                        Value: lvol.Size,
                        Max: lvol.Size,
                        Round: vgroup.ExtentSize
                      }
                  ],
                  Action: {
                      Title: _("Shrink"),
                      action: function (vals) {
                          return utils.teardown_active_usage(client, usage).
                                       then(function () {
                                           return lvol_and_fsys_resize(client, lvol, vals.size,
                                                                       info.shrink_needs_unmount);
                                       });
                      }
                  }
    });
}

var BlockVolTab = React.createClass({
    render: function () {
        var self = this;
        var client = self.props.client;
        var lvol = self.props.lvol;
        var pool = client.lvols[lvol.ThinPool];
        var block = client.lvols_block[lvol.path];
        var vgroup = client.vgroups[lvol.VolumeGroup];

        function create_snapshot() {
            dialog.open({ Title: _("Create Snapshot"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                validate: utils.validate_lvm2_name
                              },
                              { SizeSlider: "size",
                                Title: _("Size"),
                                Value: lvol.Size * 0.2,
                                Max: lvol.Size,
                                Round: vgroup.ExtentSize,
                                visible: function () {
                                    return lvol.ThinPool == "/";
                                }
                              }
                          ],
                          Action: {
                              Title: _("Create"),
                              action: function (vals) {
                                  return lvol.CreateSnapshot(vals.name, vals.size || 0, { });
                              }
                          }
            });
        }

        function rename() {
            lvol_rename(lvol);
        }

        function get_info(block) {
            if (block) {
                if (block.IdUsage == 'crypto' && client.blocks_crypto[block.path]) {
                    var encrypted = client.blocks_crypto[block.path];
                    var cleartext = client.blocks_cleartext[block.path];

                    if (!encrypted.Resize) {
                        info = { };
                        shrink_excuse = grow_excuse = _("Encrypted volumes can not be resized here.");
                    } else if (!cleartext) {
                        info = { };
                        shrink_excuse = grow_excuse = _("Encrypted volumes need to be unlocked before they can be resized.");
                    } else {
                        return get_info(cleartext);
                    }
                } else if (block.IdUsage == 'filesystem') {
                    info = client.fsys_info[block.IdType];

                    if (!info) {
                        info = { };
                        shrink_excuse = grow_excuse = cockpit.format(_("$0 filesystems can not be resized here."),
                                                                     block.IdType);
                    } else {
                        if (!info.can_shrink)
                            shrink_excuse = cockpit.format(_("$0 filesystems can not be made smaller."),
                                                           block.IdType);
                        if (!info.can_grow)
                            grow_excuse = cockpit.format(_("$0 filesystems can not be made larger."),
                                                         block.IdType);
                    }
                } else if (block.IdUsage == 'raid') {
                    info = { };
                    shrink_excuse = grow_excuse = _("Physical volumes can not be resized here.");
                } else if (client.vdo_overlay.find_by_backing_block (block)) {
                    info = {
                        can_shrink: false,
                        can_grow: true,
                        grow_needs_unmount: false
                    };
                    shrink_excuse = _("VDO backing devices can not be made smaller");
                } else {
                    info = {
                        can_shrink: false,
                        can_grow: true,
                        grow_needs_unmount: true
                    };
                    shrink_excuse = _("Unrecognized data can not be made smaller here.");
                }
            } else {
                info = { };
                shrink_excuse = grow_excuse = _("This volume needs to be activated before it can be resized.");
            }

            return { info: info, shrink_excuse: shrink_excuse, grow_excuse: grow_excuse };
        }

        var { info, shrink_excuse, grow_excuse } = get_info(block);

        if (!grow_excuse && !pool && vgroup.FreeSize == 0) {
            grow_excuse = _("No free space");
        }

        function shrink() {
            lvol_shrink(client, lvol, info);
        }

        function grow() {
            lvol_grow(client, lvol, info);
        }

        return (
            <div>
                <div className="tab-actions">
                    <StorageButton onClick={create_snapshot}>{_("Create Snapshot")}</StorageButton>
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Name")}</td>
                        <td>
                            <StorageLink onClick={rename}>{this.props.lvol.Name}</StorageLink>
                        </td>
                    </tr>
                    <tr>
                        <td>{_("Size")}</td>
                        <td>
                            {utils.fmt_size(this.props.lvol.Size)}
                            <div className="tab-row-actions">
                                <StorageButton excuse={shrink_excuse} onClick={shrink}>{_("Shrink")}</StorageButton>
                                <StorageButton excuse={grow_excuse} onClick={grow}>{_("Grow")}</StorageButton>
                            </div>
                        </td>
                    </tr>
                </table>
            </div>
        );
    },
});

var PoolVolTab = React.createClass({
    render: function () {
        var self = this;

        function perc(ratio) {
            return (ratio*100).toFixed(0) + "%";
        }

        function rename() {
            lvol_rename(self.props.lvol);
        }

        function grow() {
            lvol_grow(self.props.client, self.props.lvol, { });
        }

        return (
            <div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Name")}</td>
                        <td>
                            <StorageLink onClick={rename}>{this.props.lvol.Name}</StorageLink>
                        </td>
                    </tr>
                    <tr>
                        <td>{_("Size")}</td>
                        <td>
                            {utils.fmt_size(this.props.lvol.Size)}
                            <div className="tab-row-actions">
                                <StorageButton onClick={grow}>{_("Grow")}</StorageButton>
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td>{_("Data Used")}</td>
                        <td>{perc(this.props.lvol.DataAllocatedRatio)}</td>
                    </tr>
                    <tr>
                        <td>{_("Metadata Used")}</td>
                        <td>{perc(this.props.lvol.MetadataAllocatedRatio)}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    BlockVolTab: BlockVolTab,
    PoolVolTab:  PoolVolTab
};
