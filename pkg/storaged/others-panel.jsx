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

import { SidePanel } from "./side-panel.jsx";
import { block_name, fmt_size, make_block_path_cmp, get_other_devices } from "./utils.js";

const _ = cockpit.gettext;

export function other_rows(client, options) {
    function make_other(path) {
        const block = client.blocks[path];
        const name = block_name(block);
        const dev = name.replace(/^\/dev\//, "");

        return {
            client,
            kind: false,
            testkey: dev,
            devname: name,
            name,
            detail: cockpit.format(_("$0 block device"), fmt_size(block.Size)),
            type: _("Block device"),
            size: block.Size,
            go: () => cockpit.location.go([dev]),
            job_path: path,
            key: path,
            block
        };
    }

    return get_other_devices(client)
            .sort(make_block_path_cmp(client))
            .map(make_other);
}

export class OthersPanel extends React.Component {
    render() {
        const client = this.props.client;
        const others = other_rows(client, {});

        if (others.length > 0)
            return (
                <SidePanel id="others"
                           title={_("Other devices")}
                           rows={others} />
            );
        else
            return null;
    }
}
