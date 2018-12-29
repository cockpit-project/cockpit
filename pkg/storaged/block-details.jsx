/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2017 Red Hat, Inc.
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
import React from "react";
import * as utils from "./utils.js";
import { StdDetailsLayout } from "./details.jsx";
import * as Content from "./content-views.jsx";

const _ = cockpit.gettext;

export class BlockDetails extends React.Component {
    render() {
        var block = this.props.block;

        var header = (
            <div className="panel panel-default">
                <div className="panel-heading">{_("Block")}</div>
                <div className="panel-body">
                    <table className="info-table-ct">
                        <tbody>
                            <tr>
                                <td>{_("storage", "Capacity")}</td>
                                <td>{ utils.fmt_size_long(block.Size) }</td>
                            </tr>
                            <tr>
                                <td>{_("storage", "Device File")}</td>
                                <td>{ utils.block_name(block) }</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );

        var content = <Content.Block client={this.props.client} block={block} />;

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
