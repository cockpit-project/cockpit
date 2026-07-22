/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* SHELL API
 *
 * Things a page can ask the Shell to do.  Currently just page_status:
 * announce a status (icon + tooltip) on the page's own navigation entry.
 */

import cockpit, { JsonValue } from "cockpit";
import { dequal } from 'dequal/lite';

export interface PageStatus {
    // "info", "warning", "error", or null for no icon.
    type?: "info" | "warning" | "error" | null;
    // Short, human-readable, localized; shown as a tooltip.
    title?: string;
}

// Board the Shell decorates nav entries from; pkg/shell/state.tsx reads it back.
export const PAGE_STATUS_BOARD = "shell:page-status";

// Distinct from null so a fresh instance after a frame reload still sends its
// first publish/clear, even if it matches the stale registry entry.
const UNSENT = Symbol("unsent");

let last: PageStatus | null | typeof UNSENT = UNSENT;

export const page_status = {
    // Announce (or, with null, clear) this page's nav status. Sends both the
    // legacy "page_status" field (for older shells) and the board entry that
    // current shells read; equal repeats are deduped.
    publish(status: PageStatus | null): void {
        if (dequal(status, last))
            return;
        last = status;
        cockpit.transport.control("notify", {
            page_status: status as unknown as JsonValue,
            board: PAGE_STATUS_BOARD,
            notification: status as unknown as JsonValue,
        });
    },
};
