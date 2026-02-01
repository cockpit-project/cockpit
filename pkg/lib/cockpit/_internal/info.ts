/*
 * Copyright (C) 2025 Red Hat, Inc.
 * SPDX-License-Identifier: GPL-3.0-or-later
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
