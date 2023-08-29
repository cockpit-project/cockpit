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
import { PlusIcon } from '@patternfly/react-icons';

import { ListingTable } from "cockpit-components-table.jsx";
import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";
import { nfs_fstab_dialog } from "./nfs-details.jsx";
import { OptionalPanel } from "./optional-panel.jsx";

const _ = cockpit.gettext;

export class NFSPanel extends React.Component {
    render() {
        const client = this.props.client;

        function make_nfs_mount(entry) {
            let fsys_size;
            if (entry.mounted)
                fsys_size = client.nfs.get_fsys_size(entry);

            const server = entry.fields[0].split(":")[0];
            const remote_dir = entry.fields[0].split(":")[1];

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

        const mounts = client.nfs.entries.map(make_nfs_mount);

        function add() {
            nfs_fstab_dialog(client, null);
        }

        const actions = (
            <StorageButton ariaLabel={_("Add")} kind="primary" onClick={add}>
                <PlusIcon />
            </StorageButton>
        );

        const nfs_feature = {
            is_enabled: () => client.features.nfs,
            package: client.get_config("nfs_client_package", false),
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

        return (
            <OptionalPanel className="storage-mounts" id="nfs-mounts"
                       client={client}
                       title={_("NFS mounts")}
                       actions={actions}
                       feature={nfs_feature}
                       not_installed_text={_("NFS support not installed")}
                       install_title={_("Install NFS support")}>
                <ListingTable
                    sortBy={{ index: 0, direction: SortByDirection.asc }}
                    aria-label={_("NFS mounts")}
                    onRowClick={onRowClick}
                    emptyCaption={_("No NFS mounts set up")}
                    columns={[
                        { title: _("Server"), sortable: true },
                        { title: _("Mount point"), sortable: true },
                        { title: _("Size") }
                    ]}
                    rows={mounts} />
            </OptionalPanel>
        );
    }
}
