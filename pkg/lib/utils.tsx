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
 * along with Cockpit; If not, see <https://www.gnu.org/licenses/>.
 */

import React from "react";

import cockpit from "cockpit";

export function fmt_to_fragments(format: string, ...args: React.ReactNode[]) {
    const fragments = format.split(/(\$[0-9]+)/g).map(part => {
        if (part[0] == "$") {
            return args[parseInt(part.slice(1))]; // placeholder, from `args`
        } else
            return part; // literal string content
    });

    return React.createElement(React.Fragment, { }, ...fragments);
}

/**
 * Checks if a JsonValue is a JsonObject, and acts as a type guard.
 *
 * This function produces correct results for any possible JsonValue, and also
 * for undefined.  If you pass other types of values to this function it may
 * return an incorrect result (ie: it doesn't check deeply, so anything that
 * looks like a "simple object" will pass the check).
 */
export function is_json_dict(value: cockpit.JsonValue | undefined): value is cockpit.JsonObject {
    return value?.constructor === Object;
}

function try_fields(
    dict: cockpit.JsonObject, fields: (string | undefined)[], def: cockpit.JsonValue
): cockpit.JsonValue {
    for (const field of fields)
        if (field && field in dict)
            return dict[field];
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
export function get_manifest_config_matchlist(
    manifest_name: string, config_name: string, default_value: cockpit.JsonValue, matches: (string | undefined)[]
): cockpit.JsonValue {
    const config = cockpit.manifests[manifest_name]?.config;

    if (is_json_dict(config)) {
        const val = config[config_name];
        if (is_json_dict(val))
            return try_fields(val, matches, default_value);
        else
            return val !== undefined ? val : default_value;
    } else {
        return default_value;
    }
}
