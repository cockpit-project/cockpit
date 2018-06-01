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

import { StorageUsageBar } from "./storage-controls.jsx";
import { decode_filename, block_name, fmt_size, format_fsys_usage, go_to_block } from "./utils.js";

const _ = cockpit.gettext;

export class FilesystemsPanel extends React.Component {
    constructor () {
        super();
        this.on_fsys_samples = () => { this.setState({}); }
    }

    componentDidMount() {
        this.props.client.fsys_sizes.addEventListener("changed", this.on_fsys_samples);
    }

    componentWillUnmount() {
        this.props.client.fsys_sizes.removeEventListener("changed", this.on_fsys_samples);
    }

    render() {
        var client = this.props.client;

        function is_mount(path) {
            var block = client.blocks[path];
            var fsys = client.blocks_fsys[path];
            return fsys && block.IdUsage == "filesystem" && block.IdType != "mpath_member" && !block.HintIgnore;
        }

        function cmp_mount(path_a, path_b) {
            var name_a = client.blocks[path_a].IdLabel || block_name(client.blocks[path_a]);
            var name_b = client.blocks[path_b].IdLabel || block_name(client.blocks[path_b]);
            return name_a.localeCompare(name_b);
        }

        function make_mount(path) {
            var block = client.blocks[path];
            var fsys = client.blocks_fsys[path];
            var mount_points = fsys.MountPoints.map(decode_filename);
            var fsys_size;
            for (var i = 0; i < mount_points.length && !fsys_size; i++)
                fsys_size = client.fsys_sizes.data[mount_points[i]];

            function go(event) {
                if (!event || event.button !== 0)
                    return;
                go_to_block(client, path);
            }

            return (
                <tr onClick={go} key={path}>
                    <td>{ block.IdLabel || block_name(block) }</td>
                    <td>
                        { fsys.MountPoints.length > 0
                            ? fsys.MountPoints.map((mp) => <div key={mp}>{decode_filename(mp)}</div>)
                            : "-"
                        }
                    </td>
                    <td>
                        { fsys.MountPoints.length > 0
                            ? <StorageUsageBar stats={fsys_size} critical={0.95} />
                            : null
                        }
                    </td>
                    <td className="usage-text">
                        { fsys_size
                            ? format_fsys_usage(fsys_size[0], fsys_size[1])
                            : fmt_size(block.Size)
                        }
                    </td>
                </tr>
            );
        }

        var mounts = Object.keys(client.blocks).filter(is_mount)
                .sort(cmp_mount)
                .map(make_mount);

        return (
            <div id="mounts" className="panel panel-default storage-mounts">
                <div className="panel-heading">
                    <span>{_("Filesystems")}</span>
                </div>
                <table className="table table-hover">
                    <thead>
                        <tr>
                            <th className="mount-name">{_("Name")}</th>
                            <th className="mount-point">{_("Mount Point")}</th>
                            <th className="mount-size-graph">{_("Size")}</th>
                            <th className="mount-size-number">&nbsp;</th>
                        </tr>
                    </thead>
                    <tbody id="storage_mounts">
                        { mounts }
                    </tbody>
                </table>
            </div>
        );
    }
}
