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

var React = require("react");
var createReactClass = require('create-react-class');

var cockpit = require("cockpit");
var utils = require("./utils.js");

var FormatDialog = require("./format-dialog.jsx");

var FormatButton = FormatDialog.FormatButton;

var _ = cockpit.gettext;

var PVolTab = createReactClass({
    render: function () {
        var block_pvol = this.props.client.blocks_pvol[this.props.block.path];
        var vgroup = block_pvol && this.props.client.vgroups[block_pvol.VolumeGroup];

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Volume Group")}</td>
                        <td>{vgroup
                            ? <a role="link" tabIndex="0" onClick={() => cockpit.location.go([ "vg", vgroup.Name ])}>
                                {vgroup.Name}
                            </a>
                            : "-"
                        }
                        </td>
                    </tr>
                    <tr>
                        <td>{_("Free")}</td>
                        <td>{block_pvol ? utils.fmt_size(block_pvol.FreeSize) : "-"}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

var MDRaidMemberTab = createReactClass({
    render: function () {
        var mdraid = this.props.client.mdraids[this.props.block.MDRaidMember];

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("RAID Device")}</td>
                        <td>{mdraid
                            ? <a role="link" tabIndex="0" onClick={() => cockpit.location.go([ "mdraid", mdraid.UUID ])}>
                                {utils.mdraid_name(mdraid)}
                            </a>
                            : "-"
                        }
                        </td>
                    </tr>
                </table>
            </div>
        );
    },
});

var VDOBackingTab = createReactClass({
    render: function () {
        var vdo = this.props.client.vdo_overlay.find_by_backing_block(this.props.block);

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("VDO Device")}</td>
                        <td>{vdo
                            ? <a role="link" tabIndex="0" onClick={() => cockpit.location.go([ "vdo", vdo.name ])}>
                                {vdo.name}
                            </a>
                            : "-"
                        }
                        </td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    PVolTab:         PVolTab,
    MDRaidMemberTab: MDRaidMemberTab,
    VDOBackingTab:   VDOBackingTab
};
