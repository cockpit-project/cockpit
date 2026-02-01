/*
 * Copyright (C) 2023 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";

import { format_disk } from "./format-disk-dialog.jsx";

const _ = cockpit.gettext;

export function partitionable_block_actions(block, tag) {
    const excuse = block.ReadOnly ? _("Device is read-only") : null;

    return [
        (block.Size > 0
            ? {
                title: _("Create partition table"),
                action: () => format_disk(block),
                danger: true,
                excuse,
                tag
            }
            : null)
    ];
}
