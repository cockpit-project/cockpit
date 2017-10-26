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

import { OverviewSidePanel, OverviewSidePanelRow } from "./overview.jsx";
import { block_name, fmt_size, make_block_path_cmp } from "./utils.js";

const _ = cockpit.gettext;

export class OthersPanel extends React.Component {
    render() {
        var client = this.props.client;

        function is_other(path) {
            var block = client.blocks[path];
            var block_part = client.blocks_part[path];
            var block_lvm2 = client.blocks_lvm2[path];

            return ((!block_part || block_part.Table == "/") &&
                    block.Drive == "/" &&
                    block.CryptoBackingDevice == "/" &&
                    block.MDRaid == "/" &&
                    (!block_lvm2 || block_lvm2.LogicalVolume == "/") &&
                    !block.HintIgnore &&
                    block.Size > 0 &&
                    !client.vdo_overlay.find_by_block(block));
        }

        function make_other(path) {
            var block = client.blocks[path];
            var name = block_name(block);
            var dev = name.replace(/^\/dev\//, "");

            return (
                <OverviewSidePanelRow client={client}
                                      kind={false}
                                      testkey={dev}
                                      name={name}
                                      detail={cockpit.format(_("$0 Block Device"), fmt_size(block.Size))}
                                      go={() => cockpit.location.go([ dev ])}
                                      job_path={path}/>
            );
        }

        var others = Object.keys(client.blocks).filter(is_other).sort(make_block_path_cmp(client)).map(make_other);

        if (others.length > 0)
            return (
                <OverviewSidePanel id="others"
                                   title={_("Other Devices")}>
                    { others }
                </OverviewSidePanel>
            );
        else
            return null;
    }
}
