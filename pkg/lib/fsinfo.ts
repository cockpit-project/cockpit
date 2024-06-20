/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
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

'use strict';

import cockpit from 'cockpit';

import { EventEmitter } from './event';

function is_json_dict(value: cockpit.JsonValue): value is cockpit.JsonObject {
    return value?.constructor === Object;
}

/* RFC 7396 — JSON Merge Patch — functional */
function json_merge(current: cockpit.JsonValue, patch: cockpit.JsonValue): cockpit.JsonValue {
    if (is_json_dict(patch)) {
        const updated = is_json_dict(current) ? { ...current } : { };

        for (const [key, value] of Object.entries(patch)) {
            if (value === null) {
                delete updated[key];
            } else {
                updated[key] = json_merge(updated[key], value);
            }
        }

        return updated;
    } else {
        return patch;
    }
}

export interface FileInfo {
    type?: string;
    tag?: string;
    mode?: number;
    size?: number;
    uid?: number;
    user?: string | number;
    gid?: number;
    group?: string | number;
    mtime?: number;
    target?: string;
    entries?: Record<string, FileInfo>;
    targets?: Record<string, FileInfo>;
}

export interface FsInfoError {
    problem: string;
    message: string;
    errno: string;
}

export interface FsInfoState {
    info?: FileInfo;
    error?: FsInfoError;
    loading?: true;
}

export interface FsInfoEvents {
    change(state: FsInfoState): void;
    close(message: cockpit.JsonObject): void;
}

export class FsInfoClient extends EventEmitter<FsInfoEvents> {
    state: FsInfoState = { loading: true };

    private partial_state: cockpit.JsonValue = null;
    private channel: cockpit.Channel<string>;

    constructor(path: string, attrs: (keyof FileInfo)[], options?: cockpit.JsonObject) {
        super();

        this.channel = cockpit.channel({
            payload: "fsinfo",
            path,
            attrs,
            watch: true,
            ...options
        });

        this.channel.addEventListener("message", (_event, payload) => {
            this.partial_state = json_merge(this.partial_state, JSON.parse(payload));

            if (is_json_dict(this.partial_state) && !this.partial_state.partial) {
                this.state = { ...this.partial_state };
                this.emit('change', this.state);
            }
        });

        this.channel.addEventListener("close", (_event, message) => {
            this.emit('close', message);
        });
    }

    close() {
        this.channel.close();
    }

    static entry(info: FileInfo, name: string): FileInfo | null {
        return info.entries?.[name] ?? null;
    }

    static target(info: FileInfo, name: string): FileInfo | null {
        const entries = info.entries ?? {};
        const targets = info.targets ?? {};

        let entry = entries[name] ?? null;
        for (let i = 0; i < 40; i++) {
            const target = entry?.target;
            if (!target)
                return entry;
            if (target === '.')
                return info;
            entry = entries[target] ?? targets[target] ?? null;
        }
        return null; // ELOOP
    }
}

export function fsinfo(path: string, attrs: (keyof FileInfo)[], options?: cockpit.JsonObject): Promise<FileInfo> {
    return new Promise((resolve, reject) => {
        const client = new FsInfoClient(path, attrs, { ...options, watch: false });
        client.on('close', (message) => {
            if (message.problem) {
                reject(message);
            } else if (client.state.info) {
                resolve(client.state.info);
            } else {
                reject(client.state.error);
            }
        });
    });
}
