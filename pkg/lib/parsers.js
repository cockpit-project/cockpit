/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2013 Red Hat, Inc.
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

function parse_passwd_content(content) {
    if (!content) {
        console.warn("Couldn't read /etc/passwd");
        return [];
    }

    const ret = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i])
            continue;
        const column = lines[i].split(':');
        ret.push({
            name: column[0],
            password: column[1],
            uid: parseInt(column[2], 10),
            gid: parseInt(column[3], 10),
            gecos: (column[4] || '').replace(/,*$/, ''),
            home: column[5] || '',
            shell: column[6] || '',
        });
    }

    return ret;
}

export const etc_passwd_syntax = {
    parse: parse_passwd_content
};

function parse_group_content(content) {
    // /etc/group file is used to set only secondary groups of users. The primary group is saved in /etc/passwd-
    content = (content || "").trim();
    if (!content) {
        console.warn("Couldn't read /etc/group");
        return [];
    }

    const ret = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
        if (!lines[i])
            continue;
        const column = lines[i].split(':');
        ret.push({
            name: column[0],
            password: column[1],
            gid: parseInt(column[2], 10),
            userlist: column[3].split(','),
        });
    }

    return ret;
}

export const etc_group_syntax = {
    parse: parse_group_content
};

function parse_shells_content(content) {
    content = (content || "").trim();
    if (!content) {
        console.warn("Couldn't read /etc/shells");
        return [];
    }

    const lines = content.split('\n');

    return lines.filter(line => !line.includes("#") && line.trim());
}

export const etc_shells_syntax = {
    parse: parse_shells_content
};
