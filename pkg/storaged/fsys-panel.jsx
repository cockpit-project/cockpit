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
import { SortByDirection } from '@patternfly/react-table';

import { ListingTable } from "cockpit-components-table.jsx";
import { StorageUsageBar } from "./storage-controls.jsx";
import { block_name, fmt_size, go_to_block, flatten, is_snap } from "./utils.js";
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
        const client = this.props.client;

        function is_mount(path) {
            const block = client.blocks[path];

            // Stratis filesystems are handled separately
            if (client.blocks_stratis_fsys[path])
                return false;

            if (block.HintIgnore)
                return false;

            if (is_snap(client, block))
                return false;

            if (block.IdUsage == "filesystem" && block.IdType != "mpath_member")
                return true;

            if (block.IdUsage == "crypto" && !client.blocks_cleartext[block.path]) {
                const [, mount_point] = get_fstab_config(block, true);
                return !!mount_point;
            }

            return false;
        }

        function make_mount(path) {
            const block = client.blocks[path];
            const [, mount_point] = get_fstab_config(block, true);
            const fsys_size = client.fsys_sizes.data[mount_point];
            const backing_block = client.blocks[block.CryptoBackingDevice] || block;
            const block_lvm2 = client.blocks_lvm2[backing_block.path];
            const lvol = block_lvm2 && client.lvols[block_lvm2.LogicalVolume];
            const vgroup = lvol && client.vgroups[lvol.VolumeGroup];
            let name = null;

            if (vgroup)
                name = vgroup.Name + "/" + lvol.Name;

            if (!name)
                name = block_name(backing_block || block);

            if (block.IdLabel)
                name = name + " (" + block.IdLabel + ")";

            return {
                props: { path, client, key: path },
                columns: [
                    { title: name },
                    { title: block.IdType },
                    { title: mount_point || "-" },
                    {
                        title: fsys_size
                            ? <StorageUsageBar stats={fsys_size} critical={0.95} block={block.IdLabel || block_name(block)} />
                            : fmt_size(block.Size),
                        props: { className: "pf-v5-u-text-align-right" }
                    }
                ]
            };
        }

        const mounts = Object.keys(client.blocks).filter(is_mount)
                .map(make_mount);

        function has_filesystems(path) {
            return client.stratis_pool_filesystems[path].length > 0;
        }

        function make_pool(path) {
            const pool = client.stratis_pools[path];
            const filesystems = client.stratis_pool_filesystems[path].sort((a, b) => a.Devnode.localeCompare(b.Devnode));

            const offsets = [];
            let total = 0;
            filesystems.forEach(fs => {
                offsets.push(total);
                if (fs.Used[0])
                    total += Number(fs.Used[1]);
            });

            return filesystems.map((fs, i) => {
                const block = client.slashdevs_block[fs.Devnode];
                let mount = "-";
                if (block) {
                    const [, mp] = get_fstab_config(block, true);
                    if (mp)
                        mount = mp;
                }
                return {
                    props: { path, client, key: fs.path },
                    columns: [
                        { title: pool.Name + "/" + fs.Name },
                        { title: "Stratis" },
                        { title: mount },
                        {
                            title: <StorageUsageBar stats={[Number(fs.Used[0] && Number(fs.Used[1])),
                                Number(pool.TotalPhysicalSize)]}
                                                    critical={1} total={total} offset={offsets[i]} />,
                            props: { className: "pf-v5-u-text-align-right" }
                        }
                    ]
                };
            });
        }

        const pools = Object.keys(client.stratis_pools).filter(has_filesystems)
                .map(make_pool);

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;

            const stratis_pool = row.props.client.stratis_pools[row.props.path];
            if (stratis_pool) {
                cockpit.location.go(["pool", stratis_pool.Name]);
            } else
                go_to_block(row.props.client, row.props.path);
        }

        // table-hover class is needed till PF4 Table has proper support for clickable rows
        // https://github.com/patternfly/patternfly-react/issues/3267
        return (
            <OptionalPanel id="mounts" className="storage-mounts"
                title={_("Filesystems")}>
                <ListingTable
                    gridBreakPoint="grid-xl"
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    aria-label={_("Filesystems")}
                    className={mounts.length ? 'table-hover' : ''}
                    onRowClick={onRowClick}
                    columns={[
                        { title: _("Source"), sortable: true },
                        { title: _("Type"), sortable: true },
                        { title: _("Mount"), sortable: true },
                        { title: _("Size") }
                    ]}
                    rows={mounts.concat(flatten(pools))} />
            </OptionalPanel>
        );
    }
}
