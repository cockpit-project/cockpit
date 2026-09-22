/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

// Entry payloads are opaque JSON; each board's consumer validates them.

import cockpit, { JsonObject, JsonValue } from "cockpit";
import { dequal } from 'dequal/lite';

export const NOTIFICATIONS_KEY = "cockpit:notifications";

export const PAGE_STATUS_BOARD = "shell:page-status";

// Board names are publisher-controlled and become keys in the persisted
// registry, so bound the charset and length.
export const BOARD_KEY_RE = /^[A-Za-z0-9_:.\-/]{1,128}$/;

export interface Entry<T extends JsonValue = JsonValue> {
    host: string;
    page: string;
    notification: T;
}

// Raw wire input from a frame; validated in aggregate_notification_control.
export interface NotificationControlMessage {
    // legacy pre-board form: null clears the entry, undefined means "not a post"
    page_status?: JsonValue;
    board?: JsonValue;
    notifications?: JsonValue;
}

interface BoardRegistry {
    [board: string]: Entry[];
}

export class NotificationBoard<T extends JsonValue = JsonValue> extends EventTarget {
    readonly name: string;
    valid: boolean = false;
    #last_sent: JsonObject | null = null;

    constructor(name: string) {
        super();
        this.name = name;

        window.addEventListener("storage", event => {
            if (event.key == NOTIFICATIONS_KEY)
                this.dispatchEvent(new CustomEvent("changed"));
        });

        cockpit.transport.wait(() => {
            this.valid = true;
            this.dispatchEvent(new CustomEvent("changed"));
        });
    }

    // Replace this page's entries on the board.
    publish(notifications: T[], extra?: JsonObject): void {
        const message = { ...extra, board: this.name, notifications };
        if (dequal(message, this.#last_sent))
            return;
        this.#last_sent = message;
        cockpit.transport.control("notify", message);
    }

    clear(): void {
        this.publish([]);
    }

    // Entries on this board for HOST (default: caller's host). Empty until 'valid'.
    list(host: string = cockpit.transport.host): ReadonlyArray<Entry<T>> {
        if (!this.valid)
            return [];

        let registry: BoardRegistry;
        try {
            registry = JSON.parse(sessionStorage.getItem(NOTIFICATIONS_KEY) || "{}");
        } catch {
            return [];
        }

        const entries = registry[this.name];
        return Array.isArray(entries) ? entries.filter(e => e.host === host) as Entry<T>[] : [];
    }
}

const boards = new Map<string, NotificationBoard>();

export function board<T extends JsonValue = JsonValue>(name: string): NotificationBoard<T> {
    let b = boards.get(name);
    if (!b) {
        if (!BOARD_KEY_RE.test(name))
            console.warn(`board(${JSON.stringify(name)}): name must match ${BOARD_KEY_RE}; the Shell will drop posts to it`);
        b = new NotificationBoard(name);
        boards.set(name, b);
    }
    return b as NotificationBoard<T>;
}

let registry: BoardRegistry = Object.create(null);

export function reset_notifications(): void {
    registry = Object.create(null);
    sessionStorage.removeItem(NOTIFICATIONS_KEY);
}

// Preserve each page's position. Null-prototype keys keep "__proto__" inert.
export function aggregate_notification({ host, page, board, notifications }: {
    host: string, page: string, board: string, notifications: JsonValue[],
}): boolean {
    if (!BOARD_KEY_RE.test(board) || !Array.isArray(notifications))
        return false;

    const old = registry[board] ?? [];
    const idx = old.findIndex(e => e.host === host && e.page === page);
    if (idx < 0 && notifications.length === 0)
        return false;

    const kept = old.filter(e => !(e.host === host && e.page === page));
    const pos = idx < 0 ? kept.length : idx;
    const entries = kept.slice(0, pos).concat(notifications.map(notification => ({ host, page, notification })), kept.slice(pos));

    // Mirror first so a quota failure leaves memory and mirror in step.
    try {
        sessionStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify({ ...registry, [board]: entries }));
    } catch (exc) {
        console.warn(`notification board ${board}: dropping post from ${host}/${page}:`, exc);
        return false;
    }
    registry[board] = entries;
    return true;
}

export function aggregate_notification_control({ host, page, data }: {
    host: string, page: string, data: NotificationControlMessage,
}): string | null {
    let board: string;
    let notifications: JsonValue[];

    if (typeof data.board === "string") {
        if (!Array.isArray(data.notifications))
            return null;
        board = data.board;
        notifications = data.notifications;
    } else if (data.page_status !== undefined) {
        board = PAGE_STATUS_BOARD;
        notifications = data.page_status === null ? [] : [data.page_status];
    } else {
        return null;
    }

    return aggregate_notification({ host, page, board, notifications }) ? board : null;
}

export function board_entries(board: string): ReadonlyArray<Entry> {
    return registry[board] ?? [];
}

// A page's last valid entry wins. Null-prototype keys keep "__proto__" inert.
export function board_index<T extends JsonValue>(board: string, guard: (v: JsonValue) => v is T): { [host: string]: { [page: string]: T } } {
    const index: { [host: string]: { [page: string]: T } } = Object.create(null);
    for (const { host, page, notification } of board_entries(board)) {
        if (!guard(notification))
            continue;
        if (!index[host])
            index[host] = Object.create(null);
        index[host][page] = notification;
    }
    return index;
}
