/*
 * Copyright (C) 2026 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import type { JsonObject } from 'cockpit';

type Manifests = { [pkg: string]: JsonObject | undefined };

export function collect_overview_health_pages(
    manifests: Manifests | null | undefined
): string[] {
    const seen = new Set<string>();
    if (!manifests)
        return [];

    for (const pkg of Object.keys(manifests)) {
        const list = manifests[pkg]?.["overview-health"];
        if (!Array.isArray(list))
            continue;
        for (const page of list) {
            if (typeof page === "string")
                seen.add(page);
        }
    }
    return [...seen].sort();
}
