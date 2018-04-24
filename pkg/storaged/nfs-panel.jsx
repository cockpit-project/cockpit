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

import { StorageButton, StorageUsageBar } from "./storage-controls.jsx";
import { format_fsys_usage } from "./utils.js";
import { nfs_fstab_dialog } from "./nfs-details.jsx";

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

            function go(event) {
                if (!event || event.button !== 0)
                    return;
                cockpit.location.go([ "nfs", entry.fields[0], entry.fields[1] ]);
            }

            return (
                <tr onClick={go}>
                    <td>{ server + " " + remote_dir }</td>
                    <td>{ entry.fields[1] }</td>
                    <td>
                        { entry.mounted
                            ? <StorageUsageBar stats={fsys_size} critical={0.95}/>
                            : _("Not mounted")
                        }
                    </td>
                    <td className="usage-text">
                        { entry.mounted && fsys_size
                            ? format_fsys_usage(fsys_size[0], fsys_size[1])
                            : ""
                        }
                    </td>
                </tr>
            );
        }

        var mounts = client.nfs.entries.map(make_nfs_mount);

        function add() {
            nfs_fstab_dialog(client, null);
        }

        return (
            <div className="panel panel-default storage-mounts" id="nfs-mounts">
                <div className="panel-heading">
                    <span className="pull-right">
                        <StorageButton kind="primary" onClick={add}>
                            <span className="fa fa-plus"/>
                        </StorageButton>
                    </span>
                    <span>{_("NFS Mounts")}</span>
                </div>
                { mounts.length > 0
                    ? <table className="table table-hover">
                        <thead>
                            <tr>
                                <th className="mount-name">{_("Server")}</th>
                                <th className="mount-point">{_("Mount Point")}</th>
                                <th className="mount-size-graph">{_("Size")}</th>
                                <th className="mount-size-number">&nbsp;</th>
                            </tr>
                        </thead>
                        <tbody>
                            { mounts }
                        </tbody>
                    </table>
                    : <div className="empty-panel-text">{_("No NFS mounts set up")}</div>
                }
            </div>
        );
    }
}
