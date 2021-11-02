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
        const client = this.props.client;

        function is_mount(path) {
            const block = client.blocks[path];

            // Stratis filesystems are handled separate
            if (client.blocks_stratis_fsys[path])
                return false;

            if (block.HintIgnore)
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
            const backing_block = client.blocks[block.CryptoBackingDevice];

            return {
                props: { path, client, key: path },
                columns: [
                    { title:  block.IdLabel || block_name(backing_block || block) },
                    { title: mount_point || "-" },
                    {
                        title: fsys_size
                            ? <StorageUsageBar stats={fsys_size} critical={0.95} block={block.IdLabel || block_name(block)} />
                            : fmt_size(block.Size),
                        props: { className: "ct-text-align-right" }
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
            const use = [pool.TotalPhysicalUsed[0] && Number(pool.TotalPhysicalUsed[1]),
                Number(pool.TotalPhysicalSize)];
            const filesystems = client.stratis_pool_filesystems[path].sort((a, b) => a.Devnode.localeCompare(b.Devnode));
            const prefix = "/dev/stratis/" + pool.Name;

            const suffices = [];
            const mount_points = [];
            const offsets = [];
            let total = 0;
            filesystems.forEach(fs => {
                const block = client.slashdevs_block[fs.Devnode];
                if (!block)
                    mount_points.push("-");
                else {
                    const [, mp] = get_fstab_config(block, true);
                    mount_points.push(mp || "-");
                }
                offsets.push(total);
                if (fs.Used[0])
                    total += Number(fs.Used[1]);
                if (fs.Devnode.indexOf(prefix) == 0)
                    suffices.push(<span>&emsp;...{fs.Devnode.substr(prefix.length)}</span>);
                else
                    suffices.push(fs.Devnode);
            });

            return {
                props: { path, client, key: path },
                columns: [
                    {
                        sortKey: prefix,
                        title: <>
                            <div>{prefix}</div>
                            { filesystems.map((fs, i) => <div key={fs.Devnode}>{suffices[i]}</div>) }
                        </>
                    },
                    {
                        sortKey: "",
                        title: <>
                            <div><span style={{ visibility: "hidden" }}>X</span></div>
                            { mount_points.map(mp => <div key={mp}>{mp}</div>) }
                        </>
                    },
                    {
                        title: <>
                            <div><StorageUsageBar stats={use} critical={0.95} /></div>
                            { filesystems.map((fs, i) =>
                                <div key={i}>
                                    <StorageUsageBar stats={[fs.Used[0] && Number(fs.Used[1]), use[1]]}
                                                            critical={1} small total={total} offset={offsets[i]} />
                                </div>)
                            }
                        </>,
                        props: { className: "ct-text-align-right" }

                    }
                ]
            };
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
                    rows={mounts.concat(pools)} />
            </OptionalPanel>
        );
    }
}
