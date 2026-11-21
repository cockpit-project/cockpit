/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import { JsonValue } from "cockpit";

import { board, PAGE_STATUS_BOARD } from "_internal/notifications";

const PAGE_STATUS_TYPES = ["info", "warning", "error"] as const;

export type PageStatus = {
    type?: typeof PAGE_STATUS_TYPES[number] | null;
    // Short, human-readable, localized; shown as a tooltip.
    title?: string;
};

export function is_page_status(v: JsonValue | undefined): v is PageStatus {
    if (typeof v !== "object" || v === null || Array.isArray(v))
        return false;
    const { type, title } = v;
    return (type === undefined || type === null || (typeof type === "string" && (PAGE_STATUS_TYPES as readonly string[]).includes(type))) &&
           (title === undefined || typeof title === "string");
}

const page_status_board = board<PageStatus>(PAGE_STATUS_BOARD);

/**
 * Status icon and tooltip next to the calling page's navigation entry.
 *
 * page_status.publish(status) replaces the page's status, null clears it.
 * The message also carries the legacy "page_status" field for older Shells.
 */
export const page_status = {
    publish(status: PageStatus | null): void {
        page_status_board.publish(status ? [status] : [], { page_status: status });
    },
};
