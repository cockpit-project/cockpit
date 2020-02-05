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
import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";
import { get_config } from "./utils.js";
import { nfs_fstab_dialog } from "./nfs-details.jsx";
import { OptionalPanel } from "./optional-panel.jsx";

const _ = cockpit.gettext;

export class NFSPanel extends React.Component {
    render() {
        var client = this.props.client;

        function make_nfs_mount(entry) {
            var fsys_size;
            if (entry.mounted)
                fsys_size = client.nfs.get_fsys_size(entry);

            var server = entry.fields[0].split(":")[0];
            var remote_dir = entry.fields[0].split(":")[1];

            return {
                props: { entry, key: entry.fields[1] },
                columns: [
                    { title: server + " " + remote_dir },
                    { title: entry.fields[1] },
                    {
                        title: entry.mounted
                            ? <StorageUsageBar stats={fsys_size} critical={0.95} />
                            : _("Not mounted")
                    }
                ]
            };
        }

        var mounts = client.nfs.entries.map(make_nfs_mount);

        function add() {
            nfs_fstab_dialog(client, null);
        }

        var actions = (
            <StorageButton kind="primary" onClick={add}>
                <span className="fa fa-plus" />
            </StorageButton>
        );

        var nfs_feature = {
            is_enabled: () => client.features.nfs,
            package: get_config("nfs_client_package", false),
            enable: () => {
                client.features.nfs = true;
                client.nfs.start();
            }
        };

        function onRowClick(event, row) {
            if (!event || event.button !== 0)
                return;
            cockpit.location.go(["nfs", row.props.entry.fields[0], row.props.entry.fields[1]]);
        }

        // table-hover class is needed till PF4 Table has proper support for clickable rows
        // https://github.com/patternfly/patternfly-react/issues/3267
        return (
            <OptionalPanel className="storage-mounts" id="nfs-mounts"
                       client={client}
                       title={_("NFS Mounts")}
                       actions={actions}
                       feature={nfs_feature}
                       not_installed_text={_("NFS Support not installed")}
                       install_title={_("Install NFS Support")}>
                <ListingTable variant='compact'
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    aria-label={_("NFS Mounts")}
                    onRowClick={onRowClick}
                    className='table-hover'
                    emptyCaption={_("No NFS mounts set up")}
                    columns={[
                        { title: _("Server"), transforms: [cellWidth(30)], sortable: true },
                        { title: _("Mount Point"), transforms: [cellWidth(33)], sortable: true },
                        { title:  _("Size"), transforms: [cellWidth(40)] }
                    ]}
                    rows={mounts} />
            </OptionalPanel>
        );
    }
}
