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
var utils = require("./utils.js");

var React = require("react");
var FormatDialog = require("./format-dialog.jsx");

var FormatButton =  FormatDialog.FormatButton;

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

var PVolTab = React.createClass({
    render: function () {
        var block_pvol = this.props.client.blocks_pvol[this.props.block.path];
        var vgroup = block_pvol && this.props.client.vgroups[block_pvol.VolumeGroup];

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block}/>
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Volume Group")}</td>
                        <td>{vgroup? <a data-goto-vgroup={vgroup.Name}>{vgroup.Name}</a> : "-"}</td>
                    </tr>
                    <tr>
                        <td>{_("Free")}</td>
                        <td>{block_pvol? utils.fmt_size(block_pvol.FreeSize) : "-"}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

var MDRaidMemberTab = React.createClass({
    render: function () {
        var mdraid = this.props.client.mdraids[this.props.block.MDRaidMember];

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block}/>
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("RAID Device")}</td>
                        <td>{mdraid? <a data-goto-mdraid={mdraid.UUID}>{utils.mdraid_name(mdraid)}</a> : "-"}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    PVolTab:         PVolTab,
    MDRaidMemberTab: MDRaidMemberTab
};
