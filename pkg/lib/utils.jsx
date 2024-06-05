/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2018 Red Hat, Inc.
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

import React from "react";

import cockpit from "cockpit";

export function fmt_to_fragments(fmt) {
    const args = Array.prototype.slice.call(arguments, 1);

    function replace(part) {
        if (part[0] == "$") {
            return args[parseInt(part.slice(1))];
        } else
            return part;
    }

    return React.createElement.apply(null, [React.Fragment, { }].concat(fmt.split(/(\$[0-9]+)/g).map(replace)));
}

function try_fields(dict, fields, def) {
    for (let i = 0; i < fields.length; i++)
        if (fields[i] && dict[fields[i]] !== undefined)
            return dict[fields[i]];
    return def;
}

/**
 * Get an entry from a manifest's ".config[config_name]" field.
 *
 * This can either be a direct value, e.g.
 *
 *   "config": { "color": "yellow" }
 *
 * Or an object indexed by any value in "matches". Commonly these are fields
 * from os-release(5) like PLATFORM_ID or ID; e.g.
 *
 *   "config": {
 *      "fedora": { "color": "blue" },
 *      "platform:el9": { "color": "red" }
 *  }
 */
export function get_manifest_config_matchlist(manifest_name, config_name, default_value, matches) {
    const config = cockpit.manifests[manifest_name]?.config;

    if (config) {
        const val = config[config_name];
        if (typeof val === 'object' && val !== null && !Array.isArray(val))
            return try_fields(val, matches, default_value);
        else
            return val !== undefined ? val : default_value;
    } else {
        return default_value;
    }
}
