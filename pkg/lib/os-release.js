/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2022 Red Hat, Inc.
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

function parse_simple_vars(text) {
    const res = { };
    for (const l of text.split('\n')) {
        const pos = l.indexOf('=');
        if (pos > 0) {
            const name = l.substring(0, pos);
            let val = l.substring(pos + 1);
            if (val[0] == '"' && val[val.length - 1] == '"')
                val = val.substring(1, val.length - 1);
            res[name] = val;
        }
    }
    return res;
}

/* Return /etc/os-release as object */
export const read_os_release = () => cockpit.file("/etc/os-release", { syntax: { parse: parse_simple_vars } }).read();
