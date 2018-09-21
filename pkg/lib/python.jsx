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

// FIXME: eventually convert all images to python 3
const pyinvoke = [ "sh", "-ec", "exec $(which /usr/libexec/platform-python 2>/dev/null || which python3 2>/dev/null || which python) $@", "--", "-" ];

export function spawn (script_pieces, args, options) {
    var script;
    if (typeof script_pieces == "string")
        script = script_pieces;
    else
        script = script_pieces.join("\n");

    return cockpit.spawn(pyinvoke.concat(args), options).input(script);
}
