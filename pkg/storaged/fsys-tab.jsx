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

var FilesystemTab = React.createClass({
    onSamplesChanged: function () {
        this.setState({});
    },
    componentDidMount: function () {
        $(this.props.client.fsys_sizes).on("changed", this.onSamplesChanged);
    },
    componentWillUnmount: function () {
        $(this.props.client.fsys_sizes).off("changed", this.onSamplesChanged);
    },
    render: function () {
        var self = this;
        var block = self.props.block;
        var block_fsys = block && self.props.client.blocks_fsys[block.path];
        var is_filesystem_mounted = (block_fsys && block_fsys.MountPoints.length > 0);
        var used;

        if (is_filesystem_mounted) {
            var m = utils.decode_filename(block_fsys.MountPoints[0]);
            var samples = self.props.client.fsys_sizes.data[m];
            if (samples)
                used = cockpit.format(_("$0 of $1"),
                                      utils.fmt_size(samples[0]),
                                      utils.fmt_size(samples[1]));
            else
                used = _("Unknown");
        } else {
            used = "-";
        }

        function rename_dialog() {
            dialog.open({ Title: _("Filesystem Name"),
                          Fields: [
                              { TextInput: "name",
                                Title: _("Name"),
                                Value: block.IdLabel
                              },
                          ],
                          Action: {
                              Title: _("Apply"),
                              action: function (vals) {
                                  return block_fsys.SetLabel(vals.name, {});
                              }
                          }
            });
        }

        var old_config, old_dir, old_opts;

        old_config = utils.array_find(block.Configuration, function (c) { return c[0] == "fstab"; });
        if (old_config) {
            old_dir = utils.decode_filename(old_config[1].dir.v);
            old_opts = (utils.decode_filename(old_config[1].opts.v).
                              split(",").
                              filter(function (s) { return s.indexOf("x-parent") !== 0; }).
                              join(","));
        }

        var mounted_at = block_fsys? block_fsys.MountPoints.map(utils.decode_filename) : [ ];

        function maybe_update_config(new_is_custom, new_dir, new_opts) {
            var new_config = null;
            if (new_is_custom) {
                new_config = [
                    "fstab", {
                        dir: { t: 'ay', v: utils.encode_filename(new_dir) },
                        type: { t: 'ay', v: utils.encode_filename("auto") },
                        opts: { t: 'ay', v: utils.encode_filename(new_opts || "defaults") },
                        freq: { t: 'i', v: 0 },
                        passno: { t: 'i', v: 0 },
                        "track-parents": { t: 'b', v: true }
                    }];
            }

            if (!old_config && new_config)
                return block.AddConfigurationItem(new_config, {});
            else if (old_config && !new_config)
                return block.RemoveConfigurationItem(old_config, {});
            else if (old_config && new_config && (new_dir != old_dir || new_opts != old_opts))
                return block.UpdateConfigurationItem(old_config, new_config, {});
        }

        function mounting_dialog() {
            dialog.open({ Title: _("Filesystem Mounting"),
                          Fields: [
                              { SelectOne: "mounting",
                                Title: _("Mounting"),
                                Options: [
                                    { value: "default", Title: _("Default"), selected: !old_config },
                                    { value: "custom", Title: _("Custom"), selected: !!old_config }
                                ],
                              },
                              { TextInput: "mount_point",
                                Title: _("Mount Point"),
                                Value: old_dir,
                                visible: function (vals) {
                                    return vals.mounting == "custom";
                                }
                              },
                              { TextInput: "mount_options",
                                Title: _("Mount Options"),
                                Value: old_opts,
                                visible: function (vals) {
                                    return vals.mounting == "custom";
                                }
                              }
                          ],
                          Action: {
                              Title: _("Apply"),
                              action: function (vals) {
                                  return maybe_update_config(vals.mounting == "custom",
                                                             vals.mount_point, vals.mount_options);
                              }
                          }
            });
        }

        function mount() {
            return block_fsys.Mount({});
        }

        function unmount() {
            return block_fsys.Unmount({});
        }

        // See format-dialog.jsx for why we don't offer editing
        // fstab for the old UDisks2

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block}/>
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Name")}</td>
                        <td>
                            <StorageLink onClick={rename_dialog}>
                                {this.props.block.IdLabel || "-"}
                            </StorageLink>
                        </td>
                    </tr>
                    { (!self.props.client.is_old_udisks2)
                          ? (
                              <tr>
                                  <td>{_("Mount Point")}</td>
                                  <td>
                                      <StorageLink onClick={mounting_dialog}>
                                          {old_dir || _("(default)")}
                                      </StorageLink>
                                      { (!is_filesystem_mounted)
                                            ? <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                                            : null
                                      }
                                  </td>
                              </tr>
                          )
                          : null
                    }
                    { (old_opts)
                          ? (
                              <tr>
                                  <td>{_("Mount Options")}</td>
                                  <td>
                                      <StorageLink onClick={mounting_dialog}>
                                          {old_opts}
                                      </StorageLink>
                                  </td>
                              </tr>
                          )
                          : null
                    }
                    { (mounted_at.length > 0 || self.props.client.is_old_udisks2)
                          ? (
                              <tr>
                                  <td>{_("Mounted At")}</td>
                                  <td>
                                      {mounted_at.join(", ")}
                                      { (mounted_at.length > 0)
                                            ? <StorageButton onClick={unmount}>{_("Unmount")}</StorageButton>
                                            : <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                                      }
                                  </td>
                              </tr>
                          )
                          : null
                    }
                    <tr>
                        <td>{_("Used")}</td>
                        <td>{used}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    FilesystemTab: FilesystemTab
};
