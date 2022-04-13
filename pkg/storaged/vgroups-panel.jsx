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

import {
    fmt_size, validate_lvm2_name,
    get_available_spaces, prepare_available_spaces
} from "./utils.js";
import { dialog_open, TextInput, SelectSpaces } from "./dialog.jsx";

const _ = cockpit.gettext;

function vgroup_row(client, path) {
    const vgroup = client.vgroups[path];

    return {
        client, kind: "array", key: path, name: vgroup.Name, job_path: path,
        devname: "/dev/" + vgroup.Name + "/",
        detail: fmt_size(vgroup.Size) + " " + _("LVM2 volume group"),
        go: () => cockpit.location.go(["vg", vgroup.Name])
    };
}

export function vgroup_rows(client) {
    function cmp_vgroup(path_a, path_b) {
        return client.vgroups[path_a].Name.localeCompare(client.vgroups[path_b].Name);
    }

    return Object.keys(client.vgroups).sort(cmp_vgroup)
            .map(p => vgroup_row(client, p));
}

export function create_vgroup(client) {
    function find_vgroup(name) {
        for (const p in client.vgroups) {
            if (client.vgroups[p].Name == name)
                return client.vgroups[p];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = "vgroup" + i.toFixed();
        if (!find_vgroup(name))
            break;
    }

    dialog_open({
        Title: _("Create volume group"),
        Fields: [
            TextInput("name", _("Name"),
                      {
                          value: name,
                          validate: validate_lvm2_name
                      }),
            SelectSpaces("disks", _("Disks"),
                         {
                             empty_warning: _("No disks are available."),
                             validate: function (disks) {
                                 if (disks.length === 0)
                                     return _("At least one disk is needed.");
                             },
                             spaces: get_available_spaces(client)
                         })
        ],
        Action: {
            Title: _("Create"),
            action: function (vals) {
                return prepare_available_spaces(client, vals.disks).then(paths => {
                    client.manager_lvm2.VolumeGroupCreate(vals.name, paths, { });
                });
            }
        }
    });
}
