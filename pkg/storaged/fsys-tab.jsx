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

import React from "react";

import cockpit from "cockpit";
import * as utils from "./utils.js";

import { dialog_open, TextInput } from "./dialog.jsx";
import { StorageButton, StorageLink } from "./storage-controls.jsx";
import * as FormatDialog from "./format-dialog.jsx";

const _ = cockpit.gettext;

export class FilesystemTab extends React.Component {
    constructor(props) {
        super(props);
        this.onSamplesChanged = this.onSamplesChanged.bind(this);
    }

    onSamplesChanged() {
        this.setState({});
    }

    componentDidMount() {
        this.props.client.fsys_sizes.addEventListener("changed", this.onSamplesChanged);
    }

    componentWillUnmount() {
        this.props.client.fsys_sizes.removeEventListener("changed", this.onSamplesChanged);
    }

    render() {
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
            dialog_open({ Title: _("Filesystem Name"),
                          Fields: [
                              TextInput("name", _("Name"),
                                        { validate: name => utils.validate_fsys_label(name, block.IdType),
                                          value: block.IdLabel
                                        })
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

        old_config = utils.array_find(block.Configuration, function (c) { return c[0] == "fstab" });
        if (old_config) {
            old_dir = utils.decode_filename(old_config[1].dir.v);
            old_opts = (utils.decode_filename(old_config[1].opts.v)
                    .split(",")
                    .filter(function (s) { return s.indexOf("x-parent") !== 0 })
                    .join(","));
        }

        var mounted_at = block_fsys ? block_fsys.MountPoints.map(utils.decode_filename) : [ ];

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
            var options = old_config ? old_opts : FormatDialog.initial_tab_options(self.props.client, block, true);
            dialog_open({ Title: _("Filesystem Mounting"),
                          Fields: FormatDialog.mounting_dialog_fields(!!old_config, old_dir, options),
                          Action: {
                              Title: _("Apply"),
                              action: function (vals) {
                                  return maybe_update_config(vals.mounting == "custom",
                                                             vals.mount_point,
                                                             FormatDialog.mounting_dialog_options(vals));
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
                    <FormatDialog.FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tbody>
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
                                        <div className="tab-row-actions">
                                            { (!is_filesystem_mounted)
                                                ? <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                                                : null
                                            }
                                        </div>
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
                                        <div className="tab-row-actions">
                                            { (mounted_at.length > 0)
                                                ? <StorageButton onClick={unmount}>{_("Unmount")}</StorageButton>
                                                : <StorageButton onClick={mount}>{_("Mount")}</StorageButton>
                                            }
                                        </div>
                                    </td>
                                </tr>
                            )
                            : null
                        }
                        <tr>
                            <td>{_("Used")}</td>
                            <td>{used}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    }
}
