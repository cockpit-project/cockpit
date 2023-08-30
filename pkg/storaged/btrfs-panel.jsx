/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2021 Red Hat, Inc.
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

import { dialog_open, TextInput, SelectSpaces } from "./dialog.jsx";
import {
    // decode_filename, fmt_size,
    get_available_spaces, prepare_available_spaces,
} from "./utils.js";

const _ = cockpit.gettext;

export function btrfs_feature(client) {
    return {
        is_enabled: () => client.features.btrfs,
    };
}

function btrfs_volume_row(client, uuid) {
    const volume = client.uuids_btrfs_volume[uuid];

    return {
        client: client,
        key: uuid,
        name: volume.data.label || "-",
        detail: _("BTRFS volume"),
        job_path: volume.path,
        go: () => cockpit.location.go(["btrfs", uuid])
    };
}

export function btrfs_rows(client) {
    function cmp_volume(uuid_a, uuid_b) {
        return uuid_a.localeCompare(uuid_b);
    }

    return Object.keys(client.uuids_btrfs_volume).sort(cmp_volume)
            .map(uuid => btrfs_volume_row(client, uuid));
}

export function create_btrfs_volume(client) {
    function find_volume(name) {
        for (const u in client.uuids_btrfs_volume) {
            if (client.uuids_btrfs_volume[u].data.label == name)
                return client.uuids_btrfs_volume[u];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = "volume" + i.toFixed();
        if (!find_volume(name))
            break;
    }

    dialog_open({
        Title: _("Create BTRFS volume"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: name,
                      }),
            SelectSpaces("disks", _("Block devices"),
                         {
                             empty_warning: _("No block devices are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one block device is needed.");
                             },
                             spaces: get_available_spaces(client)
                         })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, vals.disks).then(function (paths) {
                    console.log("CREATE", paths);
                    // XXX - Let mkfs.btrfs choose the default
                    return client.manager_btrfs.CreateVolume(paths, vals.name, "single", "dup", {});
                });
            }
        }
    });
}
