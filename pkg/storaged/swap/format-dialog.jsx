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
import client from "../client.js";

import {
    encode_filename, block_name, get_active_usage, teardown_active_usage,
} from "../utils.js";

import {
    dialog_open,
    BlockingMessage, TeardownMessage,
    init_active_usage_processes
} from "../dialog.jsx";

import { job_progress_wrapper } from "../jobs-panel.jsx";

const _ = cockpit.gettext;

export function format_swap_dialog(block) {
    const usage = get_active_usage(client, block.path, _("format"), _("delete"));

    if (usage.Blocking) {
        dialog_open({
            Title: cockpit.format(_("$0 is in use"), block_name(block)),
            Body: BlockingMessage(usage)
        });
        return;
    }

    dialog_open({
        Title: cockpit.format(_("Format $0 as swap"), block_name(block)),
        Teardown: TeardownMessage(usage),
        Action: {
            Variants: [
                { Title: _("Format and start") },
                { variant: "nostart", Title: _("Format only") }
            ],
            wrapper: job_progress_wrapper(client, block.path),
            disable_on_error: usage.Teardown,
            action: async function (vals) {
                const config_items = [
                    ["fstab", {
                        dir: { t: 'ay', v: encode_filename("none") },
                        type: { t: 'ay', v: encode_filename("swap") },
                        opts: { t: 'ay', v: encode_filename(vals.variant == "nostart" ? "noauto" : "defaults") },
                        freq: { t: 'i', v: 0 },
                        passno: { t: 'i', v: 0 },
                        "track-parents": { t: 'b', v: true }
                    }]
                ];

                const options = {
                    'tear-down': { t: 'b', v: true },
                    'config-items': { t: 'a(sa{sv})', v: config_items },
                };

                await teardown_active_usage(client, usage);
                await block.Format("swap", options);

                const block_part = client.blocks_part[block.path];
                if (block_part) {
                    const block_ptable = client.blocks_ptable[block_part.Table];
                    const partition_type =
                          (block_ptable && block_ptable.Type == "dos"
                              ? "0x82"
                              : "0657fd6d-a4ab-43c4-84e5-0933c84b4f4f");
                    await block_part.SetType(partition_type, {});
                }

                if (vals.varian != "nostart") {
                    const block_swap = await client.wait_for(() => client.blocks_swap[block.path]);
                    await block_swap.Start({});
                }
            }
        },
        Inits: [
            init_active_usage_processes(client, usage),
        ]
    });
}
