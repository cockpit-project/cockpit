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

import { fmt_size } from "./utils.js";

const _ = cockpit.gettext;

// these are deprecated kinds of VDO volumes created with `vdo create`
// the official way is `lvcreate --type vdo`, these are handled in content-views.jsx
function vdo_row(client, vdo) {
    const block = client.slashdevs_block[vdo.dev];
    return {
        client,
        key: vdo.name,
        kind: "array",
        name: vdo.name,
        devname: vdo.dev,
        detail: fmt_size(vdo.logical_size) + " " + _("VDO device"),
        go: () => cockpit.location.go(["vdo", vdo.name]),
        job_path: block && block.path
    };
}

export function vdo_rows(client, options) {
    function cmp_vdo(a, b) {
        return a.name.localeCompare(b.Name);
    }
    return client.legacy_vdo_overlay.volumes.sort(cmp_vdo)
            .map(vdo => vdo_row(client, vdo));
}
