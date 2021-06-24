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
import { cellWidth, SortByDirection } from '@patternfly/react-table';

import { ListingTable } from "cockpit-components-table.jsx";
import { StorageUsageBar } from "./storage-controls.jsx";
import { block_name, fmt_size, go_to_block } from "./utils.js";
import { OptionalPanel } from "./optional-panel.jsx";
import { get_fstab_config } from "./fsys-tab.jsx";

const _ = cockpit.gettext;

export class FilesystemsPanel extends React.Component {
    constructor () {
        super();
        this.on_fsys_samples = () => { this.setState({}) };
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

            if (block.HintIgnore)
                return false;

            if (block.IdUsage == "filesystem" && block.IdType != "mpath_member")
                return true;

            if (block.IdUsage == "crypto" && !client.blocks_cleartext[block.path]) {
                var [, mount_point] = get_fstab_config(block, true);
                return !!mount_point;
            }

            return false;
        }

        function make_mount(path) {
            var block = client.blocks[path];
            var [, mount_point] = get_fstab_config(block, true);
            var fsys_size = client.fsys_sizes.data[mount_point];
            var backing_block = client.blocks[block.CryptoBackingDevice];

            return {
                props: { path, client, key: path },
                columns: [
                    { title:  block.IdLabel || block_name(backing_block || block) },
                    { title: mount_point || "-" },
                    {
                        title: fsys_size
                            ? <StorageUsageBar stats={fsys_size} critical={0.95} block={block.IdLabel || block_name(block)} />
                            : fmt_size(block.Size)
                    }
                ]
            };
        }

        var mounts = Object.keys(client.blocks).filter(is_mount)
                .map(make_mount);

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;
            go_to_block(row.props.client, row.props.path);
        }

        // table-hover class is needed till PF4 Table has proper support for clickable rows
        // https://github.com/patternfly/patternfly-react/issues/3267
        return (
            <OptionalPanel id="mounts" className="storage-mounts"
                title={_("Filesystems")}>
                <ListingTable variant='compact'
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    aria-label={_("Filesystems")}
                    className={mounts.length ? 'table-hover' : ''}
                    onRowClick={onRowClick}
                    columns={[
                        { title: _("Name"), transforms: [cellWidth(30)], sortable: true },
                        { title: _("Mount point"), transforms: [cellWidth(30)], sortable: true },
                        { title:  _("Size"), transforms: [cellWidth(40)] }
                    ]}
                    rows={mounts} />
            </OptionalPanel>
        );
    }
}
