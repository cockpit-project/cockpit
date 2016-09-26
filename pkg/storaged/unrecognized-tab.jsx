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

var UnrecognizedTab =  React.createClass({
    render: function () {
        var self = this;

        return (
            <div>
                <div className="tab-actions">
                    <FormatButton client={this.props.client} block={this.props.block}/>
                </div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Usage")}</td>
                        <td>{this.props.block.IdUsage || "-"}</td>
                    </tr>
                    <tr>
                        <td>{_("Type")}</td>
                        <td>{this.props.block.IdType || "-"}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    UnrecognizedTab: UnrecognizedTab
};
