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
                    <div className="ct-form-layout">
                        <label className="control-label">{_("storage", "Capacity")}</label>
                        <div>{ utils.fmt_size_long(block.Size) }</div>

                        <label className="control-label">{_("storage", "Device File")}</label>
                        <div>{ utils.block_name(block) }</div>
                    </div>
                </div>
            </div>
        );

        var content = <Content.Block client={this.props.client} block={block} />;

        return <StdDetailsLayout client={this.props.client} header={header} content={content} />;
    }
}
