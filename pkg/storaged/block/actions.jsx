/*
 * Copyright (C) 2024 Red Hat, Inc.
 * SPDX-License-Identifier: LGPL-2.1-or-later
 */

import cockpit from "cockpit";
import client from "../client";

import { format_dialog } from "./format-dialog.jsx";

const _ = cockpit.gettext;

export function std_format_action(backing_block, content_block) {
    const excuse = backing_block.ReadOnly ? _("Device is read-only") : null;

    return {
        title: _("Format"),
        action: () => format_dialog(client, backing_block.path),
        excuse,
        danger: true
    };
}
