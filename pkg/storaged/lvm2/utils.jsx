/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2023 Red Hat, Inc.
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

import { get_block_link_parts } from "../utils.js";

export function check_partial_lvols(client, path, enter_warning) {
    if (client.lvols_status[path] && client.lvols_status[path] != "") {
        enter_warning(path, {
            warning: "partial-lvol",
            danger: client.lvols_status[path] != "degraded"
        });
    }
}

export function pvs_to_spaces(client, pvs) {
    return pvs.map(pvol => {
        const block = client.blocks[pvol.path];
        const parts = get_block_link_parts(client, pvol.path);
        const text = cockpit.format(parts.format, parts.link);
        return { type: 'block', block, size: pvol.FreeSize, desc: text, pvol };
    });
}

export function next_default_logical_volume_name(client, vgroup, prefix) {
    function find_lvol(name) {
        const lvols = client.vgroups_lvols[vgroup.path];
        for (let i = 0; i < lvols.length; i++) {
            if (lvols[i].Name == name)
                return lvols[i];
        }
        return null;
    }

    let name;
    for (let i = 0; i < 1000; i++) {
        name = prefix + i.toFixed();
        if (!find_lvol(name))
            break;
    }

    return name;
}
