/*
 * This file is part of Cockpit.
 *
 * Copyright (C) 2024 Red Hat, Inc.
 *
 * Cockpit is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or
 * (at your option) any later version.
 *
 * Cockpit is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with Cockpit; If not, see <http://www.gnu.org/licenses/>.
 */

import cockpit from "cockpit";
import client from "../client";

import { format_disk } from "./format-disk-dialog.jsx";
import { format_dialog, add_encryption_dialog, encrypted_format_dialog } from "./format-dialog.jsx";
import { erase_dialog } from "./erase-dialog.jsx";

const _ = cockpit.gettext;

export function block_actions(block, kind) {
    if (!block || block.Size === 0)
        return [];

    const excuse = block.ReadOnly ? _("Device is read-only") : null;
    const actions = [];

    if (client.blocks_available[block.path]) {
        if (kind != "crypto") {
            actions.push({
                title: _("Add encryption"),
                action: () => add_encryption_dialog(client, block),
                excuse,
            });
        }

        if (kind == "part") {
            actions.push({
                title: _("Create partitions"),
                action: () => format_disk(block),
                primary: true,
                excuse,
            });
        }

        if (kind == "crypto") {
            actions.push({
                title: _("Format cleartext device"),
                action: () => encrypted_format_dialog(client, block),
                primary: true,
                excuse,
            });
        } else {
            actions.push({
                title: _("Format as filesystem"),
                action: () => format_dialog(client, block.path),
                primary: true,
                excuse,
            });
        }
    } else {
        actions.push({
            title: kind == "crypto" ? _("Erase cleartext device") : _("Erase"),
            action: () => erase_dialog(block),
            danger: true,
            excuse,
        });
    }

    return actions;
}

export function partitionable_block_actions(block) {
    return block_actions(block, "part");
}

export function encrypted_block_actions(block) {
    return block_actions(block, "crypto");
}
