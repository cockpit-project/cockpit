/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

function drop_slashes(path : string): string {
    // Drop all trailing slashes, but never drop the first character.
    let pos = path.length;
    while (pos > 1 && path[pos - 1] == "/")
        pos -= 1;
    return pos == path.length ? path : path.substring(0, pos);
}

export function dirname(path : string): string {
    const norm = drop_slashes(path);
    const pos = norm.lastIndexOf("/");
    if (pos < 0)
        return ".";
    else if (pos == 0)
        return "/";
    else
        return drop_slashes(norm.substring(0, pos));
}

export function basename(path : string): string {
    const norm = drop_slashes(path);
    const pos = norm.lastIndexOf("/");
    if (pos < 0)
        return norm;
    else if (pos === 0 && norm.length === 1)
        return "/";
    else
        return norm.substring(pos + 1);
}
