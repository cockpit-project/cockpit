/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* NOTIFICATION BOARDS
 *
 * Internal mechanism behind the page_status (pkg/lib/shell) and
 * health_status (pkg/lib/overview) APIs.  Pages should import one of
 * those facades, not this module.
 *
 * A "board" is a named bulletin board any page posts a single entry to,
 * keyed by (board, host, page).  The Shell aggregates every page's posts
 * into sessionStorage so a consumer (e.g. the Overview health card) can
 * list a board's current entries.
 *
 * Not a "channel": that means a protocol channel everywhere else in
 * Cockpit (see doc/protocol.md).
 */

import cockpit, { JsonValue } from "cockpit";
import { dequal } from 'dequal/lite';

// sessionStorage key for the aggregated registry; pages watch "storage" on it.
export const NOTIFICATIONS_KEY = "cockpit:notifications";

// Board names are publisher-controlled and become keys in the persisted
// registry, so bound the charset and length.
export const BOARD_KEY_RE = /^[A-Za-z0-9_:.\-/]{1,128}$/;

export interface Notification {
    type?: string | null;
    title?: string;
    [key: string]: JsonValue | undefined;
}

export interface NotificationControlMessage {
    page_status?: Notification | null;
    board?: unknown;
    notification?: unknown;
}

export interface BoardRegistry {
    [board: string]: {
        [host: string]: {
            [page: string]: Notification;
        };
    };
}

// Distinct from null so a fresh instance after a frame reload can still clear
// a stale registry entry left by its predecessor.
const UNSENT = Symbol("unsent");

export class NotificationBoard<T extends Notification> extends EventTarget {
    readonly name: string;
    valid: boolean = false;
    #last_sent: T | null | typeof UNSENT = UNSENT;

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

    // Post (overwriting) this page's entry on the board; equal repeats are deduped.
    publish(notification: T): void {
        if (dequal(notification, this.#last_sent))
            return;
        this.#last_sent = notification;
        cockpit.transport.control("notify", {
            board: this.name,
            notification: notification as unknown as JsonValue,
        });
    }

    // Remove the calling page's entry from this board.
    clear(): void {
        if (this.#last_sent === null)
            return;
        this.#last_sent = null;
        cockpit.transport.control("notify", { board: this.name, notification: null });
    }

    // Entries on this board for HOST (default: caller's host), each tagged with
    // its 'publisher' (the posting page). Empty until 'valid'.
    list(host?: string): ReadonlyArray<T & { publisher: string }> {
        if (!this.valid)
            return [];

        if (host === undefined)
            host = cockpit.transport.host;

        let registry: BoardRegistry;
        try {
            registry = JSON.parse(sessionStorage.getItem(NOTIFICATIONS_KEY) || "{}");
        } catch {
            return [];
        }

        const slice = registry[this.name]?.[host];
        if (!slice)
            return [];

        return Object.entries(slice).map(([publisher, notification]) => ({
            ...(notification as T),
            publisher,
        }));
    }
}

const boards = new Map<string, NotificationBoard<Notification>>();

export function board<T extends Notification>(name: string): NotificationBoard<T> {
    let b = boards.get(name);
    if (!b) {
        if (!BOARD_KEY_RE.test(name))
            console.warn(`board(${JSON.stringify(name)}): name must match ${BOARD_KEY_RE}; the Shell will drop posts to it`);
        b = new NotificationBoard<Notification>(name);
        boards.set(name, b);
    }
    return b as NotificationBoard<T>;
}

/* SHELL AGGREGATION
 *
 * The Shell routes every "notify" control message into aggregate_notification(),
 * which keeps the (board, host, page) registry and its sessionStorage mirror.
 * Pages read the mirror via list() above; the Shell reads the registry
 * directly via board_hosts() (e.g. to decorate nav).
 */

let registry: BoardRegistry = Object.create(null);

export function reset_notifications(): void {
    registry = Object.create(null);
    sessionStorage.removeItem(NOTIFICATIONS_KEY);
}

// Apply one post (null clears).  Returns whether the registry changed.
// Null-prototype objects throughout so keys like __proto__ stay inert.
export function aggregate_notification({ host, page, board, notification }: {
    host: string, page: string, board: string, notification: Notification | null,
}): boolean {
    if (!BOARD_KEY_RE.test(board))
        return false;

    if (notification === null) {
        const slot = registry[board]?.[host];
        if (!slot || !(page in slot))
            return false;
        delete slot[page];
    } else {
        // Per-board fields are validated by the renderer; here just reject
        // non-objects and arrays (an array with a "title" would otherwise pass).
        if (typeof notification !== "object" || Array.isArray(notification))
            return false;
        if (notification.title !== undefined && typeof notification.title !== "string")
            return false;
        if (!registry[board])
            registry[board] = Object.create(null);
        if (!registry[board][host])
            registry[board][host] = Object.create(null);
        registry[board][host][page] = notification;
    }

    sessionStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(registry));
    return true;
}

export function aggregate_notification_control({ host, page, data, page_status_board }: {
    host: string, page: string, data: NotificationControlMessage, page_status_board: string,
}): boolean {
    if (typeof data.board === "string")
        return aggregate_notification({ host, page, board: data.board, notification: data.notification as Notification | null });

    if (data.page_status !== undefined) {
        return aggregate_notification({
            host,
            page,
            board: page_status_board,
            notification: data.page_status,
        });
    }

    return false;
}

// The (host -> page -> notification) slice for BOARD, for Shell-side
// consumers like nav.  Empty object when nothing is posted.
export function board_hosts(board: string): { [host: string]: { [page: string]: Notification } } {
    return registry[board] ?? { };
}
