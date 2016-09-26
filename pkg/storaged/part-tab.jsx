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

var _ = cockpit.gettext;
var C_ = cockpit.gettext;

var PartitionTab = React.createClass({
    render: function () {
        var block_part = this.props.client.blocks_part[this.props.block.path];

        return (
            <div>
                <table className="info-table-ct">
                    <tr>
                        <td>{_("Name")}</td>
                        <td>{block_part.Name || "-"}</td>
                    </tr>
                    <tr>
                        <td>{_("Size")}</td>
                        <td>{utils.fmt_size(block_part.Size)}</td>
                    </tr>
                    <tr>
                        <td>{_("UUID")}</td>
                        <td>{block_part.UUID}</td>
                    </tr>
                    <tr>
                        <td>{_("Type")}</td>
                        <td>{block_part.Type}</td>
                    </tr>
                </table>
            </div>
        );
    },
});

module.exports = {
    PartitionTab: PartitionTab
};
