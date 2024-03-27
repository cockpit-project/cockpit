"use strict";

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

interface FileInfo {
    type?: string;
    tag?: string;
    mode?: number;
    size?: number;
    uid?: number;
    user?: string | number;
    gid?: number;
    group?: string | number;
    mtime?: number;
    content?: string;
    target?: string;
    entries?: {
        [filename: string]: FileInfo;
    };
    targets?: {
        [filename: string]: FileInfo;
    };
}

interface FsInfoError {
    problem?: string;
    message?: string;
    errno?: string;
}

interface FileInfoState {
    info: FileInfo | null;
    error: FsInfoError | null;
}

interface FsInfoHandle {
    close(): void;
    effect(callback: ((state: FileInfoState) => void)): void;
    entry(name: string): FileInfo | null;
    state: FileInfoState;
    target(name: string): FileInfo | null;
}

export function fsinfo(path: string, attrs: string[], options?: cockpit.JsonObject) {
    const self: FsInfoHandle = {
        close,
        effect,
        entry,
        state: {
            info: null,
            error: null,
        },
        target,
    };

    const callbacks: ((state: FileInfoState) => void)[] = [];

    function close() {
        channel.close();
    }

    function effect(callback: (state: FileInfoState) => void) {
        callback(self.state);
        callbacks.push(callback);
        return () => callbacks.splice(callbacks.indexOf(callback), 1);
    }

    function entry(name: string): FileInfo | null {
        return self.state.info?.entries?.[name] ?? null;
    }

    function target(name: string): FileInfo | null {
        const entries = self.state.info?.entries ?? {};
        const targets = self.state.info?.targets ?? {};

        let entry = entries[name] ?? null;
        for (let i = 0; i < 40; i++) {
            const target = entry?.target;
            if (!target)
                return entry;
            entry = entries[target] ?? targets[target] ?? null;
        }
        return null; // ELOOP
    }

    const channel = cockpit.channel({
        superuser: "try",
        payload: "fsinfo",
        path,
        attrs,
        watch: true,
        ...options
    });

    let state: cockpit.JsonValue = null;
    channel.addEventListener("message", (_event: CustomEvent, payload: string) => {
        state = json_merge(state, JSON.parse(payload));

        if (is_json_dict(state) && !state.partial) {
            self.state = {
                info: is_json_dict(state.info) ? state.info : null,
                error: is_json_dict(state.error) ? state.error : null,
            };

            for (const callback of callbacks) {
                callback(self.state);
            }
        }
    });

    return self;
}

// FIXME: import at the end of the file to prevent circular import build issues
// this is a temporary measure until we move cockpit.js to cockpit.ts in a follow up.
import cockpit from "./cockpit.js";
