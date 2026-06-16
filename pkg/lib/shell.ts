/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* SHELL API
 *
 * Things a page can ask the Shell to do.  Currently just page_status:
 * announce a status (icon + tooltip) on the page's own navigation entry.
 */

import { JsonValue } from "cockpit";

import { Notification, board } from "_internal/notifications";

export interface PageStatus extends Notification {
    // "info", "warning", "error", or null for no icon.
    type?: "info" | "warning" | "error" | null;
    // Short, human-readable, localized; shown as a tooltip.
    title?: string;
}

// Board the Shell decorates nav entries from; pkg/shell/state.tsx reads it back.
export const PAGE_STATUS_BOARD = "shell:page-status";

const page_status_board = board<PageStatus>(PAGE_STATUS_BOARD);

export const page_status = {
    // Announce (or, with null, clear) this page's nav status; the legacy
    // "page_status" field rides along for older shells.
    publish(status: PageStatus | null): void {
        const legacy = { page_status: status as unknown as JsonValue };
        if (status === null)
            page_status_board.clear(legacy);
        else
            page_status_board.publish(status, legacy);
    },
};
