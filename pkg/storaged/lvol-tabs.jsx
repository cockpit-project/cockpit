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
var FormatDialog = require("./format-dialog.jsx");

var StorageButton = StorageControls.StorageButton;
var StorageLink =   StorageControls.StorageLink;
var FormatButton =  FormatDialog.FormatButton;

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

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

function lvol_resize(client, lvol) {
    var block = client.lvols_block[lvol.path];
    var vgroup = client.vgroups[lvol.VolumeGroup];
    var pool = client.lvols[lvol.ThinPool];

    /* Resizing is only safe when lvol has a filesystem
       and that filesystem is resized at the same time.

       So we always resize the filesystem for lvols that
       have one, and refuse to shrink otherwise.

       Note that shrinking a filesystem will not always
       succeed, but it is never dangerous.
     */

    dialog.open({ Title: _("Resize Logical Volume"),
                  Fields: [
                      { SizeSlider: "size",
                        Title: _("Size"),
                        Value: lvol.Size,
                        Max: (pool ?
                              pool.Size * 3 :
                              lvol.Size + vgroup.FreeSize),
                        AllowInfinite: !!pool,
                        Round: vgroup.ExtentSize
                      },
                      { CheckBox: "fsys",
                        Title: _("Resize Filesystem"),
                        Value: block && block.IdUsage == "filesystem",
                        visible: function () {
                            return lvol.Type == "block";
                        }
                      }
                  ],
                  Action: {
                      Title: _("Resize"),
                      action: function (vals) {

                          function error(msg) {
                              return $.Deferred().reject({ message: msg }).promise();
                          }

                          var fsys = (block && block.IdUsage == "filesystem");
                          if (!fsys && vals.size < lvol.Size)
                              return error(_("This logical volume cannot be made smaller."));

                          var options = { };
                          if (fsys)
                              options.resize_fsys = { t: 'b', v: fsys };

                          return lvol.Resize(vals.size, options);
                      }
                  }
    });
}

var BlockVolTab = React.createClass({
    render: function () {
        var self = this;
        var lvol = self.props.lvol;
        var vgroup = self.props.client.vgroups[lvol.VolumeGroup];

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

        function rename(event) {
            lvol_rename(lvol);
        }

        function resize(event) {
            lvol_resize(self.props.client, lvol);
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
                            <StorageLink onClick={resize}>{utils.fmt_size(this.props.lvol.Size)}</StorageLink>
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

        function rename(event) {
            lvol_rename(self.props.lvol);
        }

        function resize(event) {
            lvol_resize(self.props.client, self.props.lvol);
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
                            <StorageLink onClick={resize}>{utils.fmt_size(this.props.lvol.Size)}</StorageLink>
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
