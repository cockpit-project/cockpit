/*
 * Copyright (C) 2022 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

function parse_simple_vars(text: string): Record<string, string> {
    const res: Record<string, string> = { };
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
