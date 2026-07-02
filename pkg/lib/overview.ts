/*
 * Copyright (C) 2019 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

/* OVERVIEW API
 *
 * health_status: post an entry to the Overview page's "Health" card.  A
 * page publishes its health (e.g. "Software updates" announcing available
 * updates); the Overview lists every page's entry.
 */

import { board, NotificationBoard, Notification } from "_internal/notifications";

// A health entry's link target is a Cockpit page path (e.g. "updates",
// "system/services").  The renderer validates it before calling cockpit.jump.
export const SAFE_LINK_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export interface HealthStatus extends Notification {
    title: string;
    // "type" carries "info"/"warning"/"error" or a PatternFly icon name
    // accepted by get_pficon() in pkg/systemd/page-status.jsx (e.g.
    // "security", "bug", "spinner", "check", "enhancement").

    // Cockpit page path to link the entry to; omit for no link.
    link?: string;
}

export const health_status: NotificationBoard<HealthStatus> = board<HealthStatus>("overview:health");
