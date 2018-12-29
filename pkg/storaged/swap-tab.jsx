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

import { StorageButton } from "./storage-controls.jsx";
import { FormatButton } from "./format-dialog.jsx";

const _ = cockpit.gettext;

export class SwapTab extends React.Component {
    constructor(props) {
        super(props);
        this.onSamplesChanged = this.onSamplesChanged.bind(this);
    }

    onSamplesChanged() {
        this.setState({});
    }

    componentDidMount() {
        this.props.client.swap_sizes.addEventListener("changed", this.onSamplesChanged);
    }

    componentWillUnmount() {
        this.props.client.swap_sizes.removeEventListener("changed", this.onSamplesChanged);
    }

    render() {
        var self = this;
        var block_swap = self.props.client.blocks_swap[self.props.block.path];
        var is_active = block_swap && block_swap.Active;
        var used;

        if (is_active) {
            var samples = self.props.client.swap_sizes.data[utils.decode_filename(self.props.block.Device)];
            if (samples)
                used = utils.fmt_size(samples[0] - samples[1]);
            else
                used = _("Unknown");
        } else {
            used = "-";
        }

        function start() {
            if (block_swap)
                return block_swap.Start({});
        }

        function stop() {
            if (block_swap)
                return block_swap.Stop({});
        }

        return (
            <div>
                <div className="tab-actions">
                    { (is_active)
                        ? <StorageButton onClick={stop}>{_("Stop")}</StorageButton>
                        : <StorageButton onClick={start}>{_("Start")}</StorageButton>
                    }
                    <FormatButton client={this.props.client} block={this.props.block} />
                </div>
                <table className="info-table-ct">
                    <tbody>
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
