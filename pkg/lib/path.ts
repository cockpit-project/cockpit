/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

function drop_slashes(path : string): string {
    // Drop all trailing slashes, but never drop the first character.
    let pos = path.length;
    while (pos > 1 && path[pos - 1] == "/")
        pos -= 1;
    return pos == path.length ? path : path.substr(0, pos);
}

export function dirname(path : string): string {
    const norm = drop_slashes(path);
    const pos = norm.lastIndexOf("/");
    if (pos < 0)
        return ".";
    else if (pos == 0)
        return "/";
    else
        return drop_slashes(norm.substr(0, pos));
}

export function basename(path : string): string {
    const norm = drop_slashes(path);
    const pos = norm.lastIndexOf("/");
    if (pos < 0)
        return norm;
    else
        return norm.substr(pos + 1);
}
