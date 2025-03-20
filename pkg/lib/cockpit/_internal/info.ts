/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2025 Red Hat, Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { Channel } from '../channel';

/* We allow accessing arbitrary fields by a Partial<Record<>> type, but having
 * an explicit list is useful for autocompletion. */
export interface OsRelease {
    NAME?: string;
    VERSION?: string;
    RELEASE_TYPE?: string;
    ID?: string;
    VERSION_ID?: string;
    VERSION_CODENAME?: string;
    PLATFORM_ID?: string;
    PRETTY_NAME?: string;
    ANSI_COLOR?: string;
    LOGO?: string;
    CPE_NAME?: string;
    DEFAULT_HOSTNAME?: string;
    HOME_URL?: string;
    DOCUMENTATION_URL?: string;
    SUPPORT_URL?: string;
    BUG_REPORT_URL?: string;
    SUPPORT_END?: string;
    VARIANT?: string;
    VARIANT_ID?: string;
}

export interface User {
    fullname: string;
    gid: number;
    group: string;
    groups: string[];
    home: string;
    name: string;
    shell: string;
    uid: number;
}

export interface WebserverInfo {
    version: string;
}

export interface Info {
    channels: Partial<Record<string, string[]>>;
    os_release: OsRelease & Partial<Record<string, string>>;
    user: User;
    ws: WebserverInfo;
}

export function fetch_info(): Promise<Info> {
    const channel = new Channel({ payload: 'info' });
    return new Promise((resolve, reject) => {
        channel.on('data', data => {
            resolve(JSON.parse(data));
            channel.close();
        });
        channel.on('close', msg => {
            reject(msg);
        });
    });
}
