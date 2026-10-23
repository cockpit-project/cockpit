/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

// Entries displayed in the Overview page's Health card.

import { board } from "_internal/notifications";

// A health entry's link target is a Cockpit page path (e.g. "updates",
// "system/services").  The renderer validates it before calling cockpit.jump.
export const SAFE_LINK_RE = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

export type HealthStatus = {
    title: string;
    // "info"/"warning"/"error", or an icon name the Overview health card
    // knows ("security", "enhancement", "bug", "check", "spinner").
    type?: string | null;
    // Cockpit page path to link the entry to; omit for no link.
    link?: string;
};

export const health_status = board<HealthStatus>("overview:health");
